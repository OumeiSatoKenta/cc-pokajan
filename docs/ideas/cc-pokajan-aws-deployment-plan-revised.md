# cc-pokajan AWS デプロイ実装計画（revise 案 / Phase 1〜3）

> 本書は [`cc-pokajan-aws-deployment-plan.md`](cc-pokajan-aws-deployment-plan.md)（Phase 1〜8 の全体構想）を
> 一次資料とした **revise 案**。全体構想を **今すぐ着手できる実装計画** へ落とし込み、今回対象を **Phase 1〜3**
> （静的配信 + Cognito 認証 + サーバー権威型シングルプレイ）に絞る。Phase 4〜8 は末尾にロードマップとして残す。
> 旧 [`pokajan-aws-portfolio-plan.md`](pokajan-aws-portfolio-plan.md)（別リポジトリ案・Lambda@Edge 案）と矛盾する箇所は、
> **新しい詳細計画書と本 revise 案を優先**する。

## コンテキスト

- **なぜ**: 現状は完全クライアントサイド（GitHub Pages 公開済み）。AWS 上へ「サーバー側の実装」と
  「Terraform 一式」を伴って載せ替え、ポートフォリオとして認証付き・サーバー権威型まで到達させたい。
- **今回の到達点**: **Phase 1〜3 を具体化**する。Phase 4〜8（AppSync リアルタイム／4人マルチ／画像共有／
  監視／分析）は末尾ロードマップに残し、実装対象外とする。
- **方針（確定事項）**:
  1. スコープ = **Phase 1〜3**
  2. リポジトリ = **cc-pokajan 内の monorepo**（`infra/` と `backend/` を同居、`src/engine` を共有）
  3. GitHub Pages = **併存**（`VITE_DEPLOY_TARGET` で base 切替、既存 `deploy.yml` は温存）

### 現状の要点（実装前提）

- **エンジン `src/engine/`**（barrel なし・20 モジュール）は React／config 非依存の純粋 TS。
  `Math.random()`／`Date` 不使用で **seed + アクション列から完全再現可能**。CPU は公開情報のみの
  `AiView`（`src/engine/ai.ts` の `toAiView`）を受け取る。精算 `computePayout`（`src/engine/payout.ts`）は
  都度再計算し保存しない。**→ そのまま Lambda のサーバー権威エンジンに再利用できる。**
- **`GameState`（`src/engine/types.ts`）は完全に JSON 直列化可能**（primitive / readonly array / Record /
  null のみ。`Date`/`Map`/`Set`/クラス無し）。DynamoDB マッピングが素直。
- **ビルド系の制約**: tsconfig は意図的に **全 `noEmit`・非 `composite`**（`tsconfig.test.json` に
  「leaf 同士を references すると TS6306/TS6310 で落ちる」と明記）。この制約が engine 共有方式を決める。
- **既存の配信**: `.github/workflows/deploy.yml`（gate → Pages 公開）。`vite.config.ts` の `resolveBase` が
  `/cc-pokajan/`（build/preview）と `/`（それ以外）を分岐、`tests/config/viteBase.test.ts` で回帰固定。
  `import.meta.env`/`VITE_` の使用は現状ゼロ。
- **永続化**: localStorage `cc-pokajan:prefs`（wallet/lastSeed/roster/avatars/rulesOverride）＋
  IndexedDB 画像 Blob。**user/account/auth/session/backend の概念は一切無い**。

---

## 全体アーキテクチャ（Phase 1〜3 到達点）

```text
Browser (React/Vite)
  │  ① 静的配信            ② 認証                 ③ ゲーム操作(Action)
  ▼                        ▼                       ▼
CloudFront(OAC)      Cognito User Pool       API Gateway HTTP API
  ▼                     │ JWT(idToken)         │ JWT Authorizer
Private S3              └──────────────────────┤
(dist/)                                        ▼
                                          Lambda game-api
                                          （src/engine を共有）
                                          ├─ GameState 取得/保存
                                          │    DynamoDB（version 楽観ロック）
                                          └─ PlayerView を返す
```

- **DynamoDB が GameState の Source of Truth**。クライアントは **Action のみ**送る。
- クライアントには `GameState` を丸ごと返さず、**PlayerView（自分の手札＋公開情報のみ）**を返す。
- **GitHub Pages 併存**: 同じ UI が `VITE_DEPLOY_TARGET` で「ローカル完結（Pages/オフライン）」か
  「サーバー権威（AWS）」かを切り替える。UI はフォークしない。

---

## リポジトリ構成（追加物）

`src/**` / `tests/**` / `.oxlintrc.json` / 既存 tsconfig グラフは **原則いじらない**（下記 engine 共有の方式による）。

```text
cc-pokajan/
├── src/                    # 既存フロントエンド（据え置き。engine もここに残す）
│   ├── engine/             #   ← Lambda と共有（物理移動しない）
│   ├── net/                #   ★新規: apiClient / transport(local|remote) / deploy 設定
│   └── ui/auth/            #   ★新規: AuthGate（aws 時のみ有効）
├── backend/                # ★新規: workspace member "@pokajan/game-api"
│   ├── package.json        #   deps: @aws-sdk/client-dynamodb, lib-dynamodb, ulid / dev: esbuild, @types/aws-lambda
│   ├── tsconfig.json       #   独立設定（root -b グラフに入れない）。paths { "@engine/*": ["../src/engine/*"] }
│   ├── esbuild.config.mjs  #   src/index.ts → dist/index.mjs（node22 / esm / external @aws-sdk/*）
│   └── src/                #   index/router/http/auth/routes/cpu/view/repo（詳細は Phase 3）
├── infra/                  # ★新規: Terraform
│   ├── bootstrap/          #   一度だけ apply（remote state バケット + DynamoDB ロック + GitHub OIDC ロール）
│   ├── environments/{dev,prod}/
│   └── modules/{frontend,cognito,game-api,dynamodb}/
└── .github/workflows/
    ├── deploy.yml          # 既存の GitHub Pages（温存・無変更）
    └── deploy-aws.yml      # ★新規: OIDC → build(aws) → S3 sync → CF invalidation → Lambda deploy
```

**root `package.json` の変更は 1 行のみ**: `"workspaces": ["backend"]` を追加（`private: true` は既存）。

---

## engine 共有の方式（結論: 据え置き = option b）

`src/engine` を **物理移動せず**、`backend/` が **esbuild + パスエイリアス**で `../src/engine/*` を取り込む。
`packages/engine/` への抽出（option a）は不採用：フロント約40 + テスト約70 の import 書き換えに加え、
共有パッケージを `composite` 参照にすると宣言 emit が必須になり、**全 `noEmit` の tsconfig グラフと衝突**する
（`tsconfig.test.json` が既に記録している TS6306/TS6310）。

- backend は `import { reduce, createGame } from '@engine/game'` の形で書く（`backend/tsconfig.json` の
  `paths` と esbuild alias で解決）。tests が既に `../../src/engine/*` を参照している構造と同型。
- backend の型検査は **独立した `tsc --noEmit`**（`backend` の npm script）で行い、root の `tsc -b` グラフには
  加えない。→ フロントの `typecheck`/`build`/`test`/`lint` は完全に無変更のまま。

---

## Phase 1: AWS 静的配信 + Terraform + CI/CD

**目的**: 現在の Vite ビルドを S3 + CloudFront(OAC) で配信し、Terraform 化・OIDC CI/CD を通す。サーバーコードは無し。

- **フロント変更（最小）**:
  - `src/config/deploy.ts`（新規）: `import.meta.env.VITE_DEPLOY_TARGET`（`'github-pages'|'aws'`、既定 `github-pages`）を
    読み、`{ isAuthEnabled, transport, walletSource, apiBaseUrl }` を公開。
  - `vite.config.ts`: `resolveBase` を target 対応にする（`aws` → `/`、それ以外は既存の `/cc-pokajan/`）。
    `tests/config/viteBase.test.ts` に `aws` ケースを追加（回帰を維持）。**`vite.config.ts` の変更はこれだけ**。
- **Terraform `modules/frontend`**: プライベート S3（public access 全ブロック）+ CloudFront + **OAC**（レガシー OAI 不使用）
  + SPA ルーティング（403/404 → `/index.html`、CloudFront Function か error responses）。カスタムドメインは Phase 1 では
  省略し既定 `*.cloudfront.net` を使う（ACM は us-east-1 必須のため導入時のみ `aws.us_east_1` プロバイダで渡す）。
- **Terraform `infra/bootstrap`**: remote state 用 S3 + DynamoDB ロックテーブル + **GitHub OIDC プロバイダ & デプロイロール**
  （`repo:OumeiSatoKenta/cc-pokajan:*` を信頼）。bootstrap 自身の state はローカル/コミット管理（鶏卵回避）。
- **リージョン**: アプリ資源は **ap-northeast-1（東京）**。CloudFront 用 ACM のみ us-east-1。
- **CI/CD**: `.github/workflows/deploy-aws.yml`（新規）。`aws-actions/configure-aws-credentials`（OIDC・固定キー無し）→
  `VITE_DEPLOY_TARGET=aws npm run build` → `aws s3 sync dist/` → CloudFront invalidation。**既存 `deploy.yml` は無変更**で Pages 併存。
- **変更/新規ファイル**: `src/config/deploy.ts`、`vite.config.ts`、`tests/config/viteBase.test.ts`、
  `infra/bootstrap/**`、`infra/modules/frontend/**`、`infra/environments/{dev,prod}/**`、`.github/workflows/deploy-aws.yml`。
- **完了基準**: `terraform fmt -check && terraform validate` 通過。dev 環境へ apply し、CloudFront 既定ドメインで
  対局画面が開き、リロード/ディープリンクで 404 しない（SPA rewrite 確認）。既存の Pages ゲート（lint/typecheck/test/build/
  format:check）が引き続き通る。

---

## Phase 2: Cognito 認証

**目的**: ログインユーザーのみが AWS 版に入れるようにする（アクセスゲート）。Pages 版は無認証のまま。

- **Terraform `modules/cognito`**: User Pool + アプリクライアント（SPA/public、シークレット無し）+ email/password +
  email verification + パスワードポリシー。
- **Terraform `modules/game-api`（Phase 2 では authorizer だけ先行可）**: HTTP API に **JWT Authorizer**
  （issuer = User Pool、audience = アプリクライアント）を付ける土台。
- **フロント変更（UI フォークなし）**:
  - 依存追加 **`aws-amplify`**（`aws-amplify/auth` v6 モジュラー）。Hosted UI リダイレクトは現状の単一ページ
    `App.tsx`（ルーター無しの画面ステートマシン）にコールバック経路が無いため不採用。SRP 自前実装も避ける。
  - `src/ui/auth/AuthGate.tsx`（新規）で `<App/>` を包み、`src/main.tsx` で `deployConfig.isAuthEnabled` が真のときだけ
    ログインを要求。`github-pages` では素通し（オフラインビルドを保全）。
  - `src/net/apiClient.ts`（新規）: `fetchAuthSession()` で idToken を取り `Authorization: Bearer <idToken>` を付与。
    トークンがネットワークに触れる唯一の場所。
- **変更/新規ファイル**: `src/ui/auth/AuthGate.tsx`、`src/net/apiClient.ts`、`src/main.tsx`、`package.json`（aws-amplify）、
  `infra/modules/cognito/**`、`infra/modules/game-api/**`（authorizer）。
- **完了基準**: 未ログインで AWS 版はログイン画面に留まり、サインアップ→検証→ログイン後に対局画面へ到達。
  Pages 版はログイン要求が出ない。

---

## Phase 3: サーバー権威型シングルプレイ

**目的**: 今ブラウザ内で行う GameState 更新を **Lambda + DynamoDB** に移す。クライアントは Action のみ送信。
1人 + CPU3人で「サーバー権威」を検証する（マルチプレイの前段）。

### backend/ 構成（単一 HTTP API Lambda・内部ルーティング・Node22/ARM64）

```text
backend/src/
  index.ts            # APIGatewayProxyHandlerV2 → router
  router.ts           # method+path 分岐（default で 404。網羅は switch+never を踏襲）
  http.ts             # json()/error()。IllegalActionError→400 / ConditionalCheckFailed→409
  auth.ts             # sub = event.requestContext.authorizer.jwt.claims.sub
  routes/createGame.ts    # POST /games
  routes/applyAction.ts   # POST /games/{id}/actions
  routes/getGame.ts       # GET  /games/{id}
  cpu.ts              # 人間の手番まで CPU を解決（autoplay.ts の nextAction を共有）
  view/playerView.ts  # GameState → PlayerView（toAiView に倣った再利用）
  repo/gameRepo.ts    # DynamoDB item ⇄ GameState、putWithVersion（楽観ロック）
  repo/userRepo.ts    # wallet: getWallet/debit/credit（サーバー権威の財布）
```

- **API（Phase 3 サブセット）**: `POST /games` / `POST /games/{id}/actions` / `GET /games/{id}`
  （join/leave はマルチプレイの Phase 5 まで不要）。
- **engine 再利用**: `reduce`/`createGame`（`@engine/game`）、`toAiView`/`decideDeclare`/`chooseDiscard`/`decideClaim`
  （`@engine/ai`）、検証は `src/appSettings.ts` と同じ関数、精算は `computePayout`（`@engine/payout`）。
- **DynamoDB item（1ゲーム=1 item・単一テーブル・PK のみ）**:
  `pk="GAME#<ulid>"` / `ownerSub`（GET/POST 認可）/ `version`（**キーではない属性**）/ `status` /
  `state`(GameState) / `rules`(RulesConfig) / `seed` / `humanSeats:[0]` / `createdAt·updatedAt` / `ttl`。
  ※ `rules` は必ず保存し **毎 `reduce` に同一値**を渡す（`game.ts` の `playerCount !== players.length` ガード対策・再現性）。
- **楽観ロック**: リクエスト body `{ action, expectedVersion }`。`UpdateCommand` に
  `ConditionExpression: "version = :expected"`、`version` は **+1** のみ。`ConditionalCheckFailedException` → **409** →
  クライアントは `GET /games/{id}` で再同期。
- **PlayerView**: `toAiView`/`toVisibleCards` に倣った **同名フィールドの redaction**（他家は `handCount`、山札は `wallCount`）。
  `wall` 中身・他家 `hand` を **絶対に含めない**。純関数 `src/engine/playerView.ts`（新規）に置き、engine テストで単体検証。
- **CPU 手番はサーバー側**: 人間 Action 適用後、`state.phase !== 'gameOver'` かつ保留判断が CPU 席の間ループして解決し、
  **人間（席0）に判断が回った瞬間に PlayerView を返す**。判断関数は engine に純関数 `nextCpuAction(state, rules, ai, humanSeats)`
  として切り出し（現状 `src/ui/hooks/autoAction.ts`）、**サーバーとローカル transport で共有**する。
- **バンドル**: `esbuild`（bundle / platform=node / target=node22 / format=esm / minify / `external:["@aws-sdk/*"]`）。
  ARM64 は Terraform 側 `architectures=["arm64"]`。

### フロント変更（UI フォークなし・transport seam）

現在 `reduce` と CPU/claim タイマーを駆動している `src/ui/hooks/useGameLoop.ts` + `loopReducer.ts` の境界に seam を置く。

```ts
// src/net/transport.ts（新規）
export interface GameTransport {
  create(opts: CreateGameOptions): Promise<GameSnapshot>          // GameSnapshot = { view: PlayerView; events }
  apply(action: Action, expectedVersion: number): Promise<GameSnapshot>
  get(): Promise<GameSnapshot>
}
```

- `src/net/localTransport.ts`（新規）: 全 `GameState` を保持し `reduce` + 共有 `nextCpuAction` + `toPlayerView`。
  **今日の挙動そのまま＝ Pages/オフラインは完全クライアントサイドを維持**。
- `src/net/remoteTransport.ts`（新規）: `apply` = `POST /games/{id}/actions`、409 は `GET` で再取得。CPU タイマーは持たない。
- `useGameLoop` を **一度だけ**リファクタし、生の `GameState` ではなく **`PlayerView` から表示値を導出**し、注入された
  `GameTransport` 経由で dispatch する。単プレイは既に他家を伏せ札（`handCount` のみ）で描くため PlayerView で足りる。
  presentational コンポーネント（`src/ui/components/**` 約37）は導出済み props を受けるので **変更不要**。
- **transport 選択**は `deployConfig.transport`（`aws`→remote / それ以外→local）で行う。
- **財布（anti-cheat 対象）**: AWS 版は BET 差引・精算加算を **サーバー側**（`USER#<sub>` item + `computePayout`）へ移し、
  クライアントは API から wallet を読む。Pages 版は現状（`appReducer` + `prefs.ts`）のまま。`computePayout` は共有なので精算は同一。

### 変更/新規ファイル

- 新規: `backend/**`、`src/net/{transport,localTransport,remoteTransport}.ts`、`src/engine/playerView.ts`、
  `src/engine/`（`nextCpuAction` 抽出）、`infra/modules/{game-api,dynamodb}/**`。
- 変更: `src/ui/hooks/useGameLoop.ts`（PlayerView + transport seam）、`src/ui/appReducer.ts`（wallet の出所分岐）、
  `src/main.tsx`/`App.tsx`（transport 注入）、`deploy-aws.yml`（backend esbuild + Lambda deploy 追加）。

### 完了基準

- ローカル: `backend` の `tsc --noEmit` と engine 新規テスト（`playerView`/`nextCpuAction`）が通る。**既存 100 局テスト・
  全 gate は無変更で通る**。
- AWS dev: ブラウザから `POST /games` → 手札タップでツモ/捨て/ロンが `POST /actions` を叩き、サーバー算出の
  PlayerView が反映される。他家手札・山札中身が **レスポンスに一切含まれない**（redaction 確認）。同一 `expectedVersion`
  の二重送信の一方が 409。財布が AWS ではサーバー値で増減し、`localStorage` 改竄が精算に効かない。

---

## 段階分割（`/add-feature` 6 ステップ）

Phase 1〜3 を、単独でレビュー・マージ可能な **6 つの `/add-feature` ステップ**へ分解する（依存は前→後の一方向）。
コマンド文字列・ファイル単位の詳細・動作確認・ロールバックは
[cc-pokajan-aws-deployment-plan-revised-add-feature-commands.md](cc-pokajan-aws-deployment-plan-revised-add-feature-commands.md) に記載。

| Step | 内容 | 対応 Phase | 依存 |
| ---- | ---- | ---------- | ---- |
| 1 | monorepo 土台 + Vite base 切替（`workspaces`・`deploy.ts`・`VITE_DEPLOY_TARGET`） | Phase 1(app) | なし（起点） |
| 2 | engine 純粋ロジック抽出（`src/engine/playerView.ts` + `nextCpuAction` 抽出 + テスト） | Phase 3(基盤) | なし（Step 1 と独立） |
| 3 | Terraform 静的配信 + OIDC CI/CD（bootstrap・frontend module・`deploy-aws.yml`） | Phase 1(infra) | Step 1 |
| 4 | Cognito 認証（cognito module + AuthGate + apiClient + aws-amplify） | Phase 2 | Step 1, 3 |
| 5 | backend サーバー権威コア（Lambda + DynamoDB + 楽観ロック + game-api module） | Phase 3(server) | Step 2, 3, 4 |
| 6 | フロント transport seam + remote 化 + wallet サーバー権威 | Phase 3(front) | Step 2, 4, 5 |

- **Step 1・2 は AWS に触れない純コード変更**で、既定 `github-pages` のまま挙動不変（既存 100 局テスト・E2E が砦）。
  先にここを固めてから AWS 実体（Step 3〜）へ進む。
- **Step 5 が「サーバー側の修正対応」の本体**（`src/engine` を Lambda 上で共有し GameState を DynamoDB 権威化）。
- **Step 6 完了で Phase 3 完成**（AWS 版はサーバー権威、Pages 版はローカル完結の二系統が同一 UI で両立）。

---

## Phase 4〜8 ロードマップ（今回対象外・参照計画書 §26 準拠）

| Phase | 内容 | 主な追加 |
| ----- | ---- | -------- |
| 4 | AppSync Events でリアルタイム更新 | 2ブラウザで同一 Game 同期（通知のみ、真実は DynamoDB） |
| 5 | 4人マルチプレイ | Lobby/Join/Ready/Start、private channel、reconnect |
| 6 | 画像共有 | Presigned Upload → S3 → CloudFront、Avatar/Roster、GameRosterSnapshot |
| 7 | Observability | CloudWatch 構造化ログ、Metrics/Alarm、GameEvent ログ |
| 8 | 分析基盤 | Game Events → Firehose → S3 → Athena |

---

## 重要リスク / 落とし穴（実装時に必ず意識）

1. **tsconfig の `composite`/`noEmit` 衝突**: backend の tsconfig を root `references` に入れない。共有 engine を
   composite 参照化しない。backend 型検査は独立 `tsc --noEmit`。フロントの `tsc -b` グラフは触らない。
2. **PlayerView と full-GameState の形状差**: 素朴な remote view は `wallCount` を `wall.length===0` にしたり他家手札を
   空で送ってしまう。**同名フィールドの redaction** に統一し、local/remote の両モードで UI が同じ PlayerView を消費する。
3. **多段 CPU 解決に対する単一 version**: 1回の `POST /actions` で人間 Action + CPU 複数手を **メモリ内で解決し切ってから
   1回だけ**条件付き書込み（version は +1）。中間 CPU 状態を保存すると version が膨れ、以後 human action が必ず 409 になる。
4. **JSON 往復と rules 保存**: `claims` の数値キーは JSON/DynamoDB で文字列化される（engine は `Number(key)` で吸収済み。
   新規サーバーコードも数値キー前提にしない）。`rules` を毎回同一で渡し再現性を保つ。
5. **CloudFront + private S3**: OAC を使う（OAI 不使用）。403/404 → `/index.html` の SPA rewrite を必ず入れる。
   カスタムドメイン導入時は ACM が **us-east-1** 必須。

---

## 検証方法（エンドツーエンド）

- **各 Phase 共通**: `terraform fmt -check && terraform validate` と、既存ゲート
  `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` を通す（CLAUDE.md の検証ゲート）。
- **Phase 1**: dev へ apply → CloudFront 既定ドメインで対局画面表示・リロードで 404 しないこと。
- **Phase 2**: 未ログイン遮断／サインアップ→検証→ログイン到達。Pages 版は無認証のまま。
- **Phase 3**: backend 単体テスト（PlayerView redaction・楽観ロック 409・CPU 解決の version=+1）＋ 実 API に対する手動対局。
  engine 新規純関数は既存エンジンテスト同様「わざと壊して落ちる」ことを確認。

## 実装の進め方（steering）

各 Phase 着手時に `.steering/[YYYYMMDD]-aws-phaseN-xxx/`（requirements/design/tasklist）を `steering` スキルで作成し、
実装前レビュー → 実装 → 振り返りを回す（CLAUDE.md のスペック駆動フロー）。Phase 境界ごとに `wc -l` でファイルサイズを機械測定。
