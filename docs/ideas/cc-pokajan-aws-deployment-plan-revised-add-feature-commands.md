# cc-pokajan AWS デプロイ（Phase 1〜3）— `/add-feature` 実行コマンド一覧

本書は [cc-pokajan-aws-deployment-plan-revised.md](cc-pokajan-aws-deployment-plan-revised.md) の実装を
**6 つの独立した `/add-feature` コマンド**に分割したものである。
各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

**重要**: 各 `/add-feature` コマンドのプロンプトには
「参照ドキュメント: `docs/ideas/cc-pokajan-aws-deployment-plan-revised.md`」が含まれており、
実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**:

- スコープは Phase 1〜3（静的配信 + Cognito 認証 + サーバー権威型シングルプレイ）。Phase 4〜8 は対象外。
- **リポジトリは cc-pokajan 内の monorepo**（`infra/` + `backend/` 同居、`src/engine` を Lambda と共有）。
- **GitHub Pages は併存**。既存 `.github/workflows/deploy.yml` は温存し、`VITE_DEPLOY_TARGET` で base を切替。
- **新規 npm 依存（承認済み）**: 認証 = `aws-amplify`（`aws-amplify/auth` v6）／backend = `@aws-sdk/client-dynamodb`
  ・`@aws-sdk/lib-dynamodb`・`ulid`／dev = `esbuild`・`@types/aws-lambda`。フロント本体（Pages 版）の実行時依存は増やさない。
- **engine 共有は「据え置き（option b）」**。`src/engine` を物理移動せず、backend が esbuild + `@engine/*` エイリアスで取り込む。
  root の `tsc -b` グラフ・`.oxlintrc.json`・`src/**`・`tests/**` は原則不変。
- 着手前に `npm test`（ユニット）と `npx playwright test`（E2E）で現件数を控える（Step 1・2・6 の受け入れに緑が要る）。
- AWS 実体（Step 3〜）は実 AWS 認証情報・アカウントが必要。Terraform state 用の bootstrap を最初に一度だけ apply する。

## 実行順の全体像

```
Step 1: monorepo 土台 + Vite base 切替（app-side・AWS 非依存）
   ↓   ← ★ VITE_DEPLOY_TARGET=aws で '/' ビルド、既定は '/cc-pokajan/' のまま。挙動不変
Step 2: engine 純粋ロジック抽出（playerView / nextCpuAction）
   ↓   ← ★ サーバー/ローカル両方の基盤。ローカル挙動不変（100 局テストが砦）
Step 3: Terraform 静的配信 + OIDC CI/CD
   ↓   ← ★ AWS(S3+CloudFront) で静的公開。Phase 1 完成
Step 4: Cognito 認証
   ↓   ← ★ ログイン必須ゲート（AWS 版のみ）。Phase 2 完成
Step 5: backend サーバー権威コア（Lambda + DynamoDB）
   ↓   ← ★ API 単体で対局が回る（curl/コンソール）。サーバー権威検証
Step 6: フロント transport seam + remote 化 + wallet サーバー権威
       ← ★ AWS 版はサーバー権威 / Pages 版はローカル完結が同一 UI で両立。Phase 3 完成
```

**ポイント**:

- **Step 1・2 は AWS に一切触れない純コード変更**。既定 `github-pages` のまま挙動不変で、先にここを固めてから AWS 実体へ進む。
  切り戻しコストが最も低い基盤づくり。
- **Step 5 が「サーバー側の修正対応」の本体**。`src/engine` を Lambda で共有し、GameState を DynamoDB 権威化・楽観ロック化する。
- **依存は一方向**（1→3→4→5→6、2→5・6）。Step 2 は Step 1 と独立だが番号順に進める。
- 各ステップ後に
  `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`（＋UI に触れる Step は `npx playwright test`）、
  AWS 実体を含む Step は `terraform fmt -check && terraform validate` を PASS ゲートとする。

---

## Step 1: monorepo 土台 + Vite base 切替

```
/add-feature cc-pokajan AWS Step1 base切替: package.json に workspaces:["backend"] を足し、src/config/deploy.ts を新規作成して import.meta.env.VITE_DEPLOY_TARGET('github-pages'|'aws', 既定 github-pages) から deployConfig{isAuthEnabled,transport,walletSource,apiBaseUrl} を導出する。vite.config.ts の resolveBase を target 対応にし aws→'/'・それ以外→'/cc-pokajan/' とし、tests/config/viteBase.test.ts に aws ケースを追加する。VITE_DEPLOY_TARGET=aws npm run build で '/' 起点、既定 npm run build で '/cc-pokajan/' 起点になること・npm run dev と npx playwright test が緑のままを確認する。参照ドキュメント: docs/ideas/cc-pokajan-aws-deployment-plan-revised.md (Step 1 範囲のみ実装)
```

**実装内容**:

- 修正: `package.json`（`"workspaces": ["backend"]` を追加）＋ 新規 `backend/package.json`（workspace を実在させる最小
  プレースホルダ。無いと `npm ci` が **黙ってスキップ**する）。`npm install` で `package-lock.json` を同期。
- 新規: `src/config/deploy.ts`
  - `import.meta.env.VITE_DEPLOY_TARGET`（`'github-pages' | 'aws'`、既定 `'github-pages'`）と `VITE_API_BASE_URL` を読み、
    `deployConfig = { target, isAuthEnabled, transport: 'local'|'remote', walletSource: 'local'|'server', apiBaseUrl }` を公開。
  - `aws` のとき `isAuthEnabled=true / transport='remote' / walletSource='server'`、それ以外は `false/'local'/'local'`。
    apiBaseUrl は aws かつ非空のときだけ採用（空文字・Pages 版は null）。
- 新規: `src/vite-env.d.ts`
  - `ViteTypeOptions.strictImportMetaEnv` + `ImportMetaEnv` を宣言し、`VITE_` 変数名のタイポを compile エラーにする。
- 修正: `vite.config.ts`
  - `resolveBase` を target 対応に拡張（`process.env.VITE_DEPLOY_TARGET === 'aws'` → `'/'`、それ以外は既存の
    `command==='build' || isPreview` 分岐で `'/cc-pokajan/'`）。**base 解決は純関数のまま**を保つ（テスト可能性）。
- 新規/修正テスト: `tests/config/viteBase.test.ts`（aws + 大文字/空白ゆらぎのケース追加）・`tests/config/deploy.test.ts`
  （`deriveDeployConfig` 単体）・`tests/config/workspaces.test.ts`（backend workspace の実在ガード）。
- 触らない: 既存 `src/**`（新規 `deploy.ts`/`vite-env.d.ts` 以外）・`playwright.config.ts`・`.oxlintrc.json`・既存 `deploy.yml`。

**動作確認**:

- 自動ゲート一式 PASS（`npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`）＋ `npx playwright test` 緑。
- `VITE_DEPLOY_TARGET=aws npm run build` → `dist/index.html` のアセットが `/assets/...`（`/` 起点）。
- 既定 `npm run build` → 従来どおり `/cc-pokajan/assets/...`。`npm run dev` はルート `/` のまま。

**依存**: なし（起点）

---

## Step 2: engine 純粋ロジック抽出（playerView / nextCpuAction）

```
/add-feature cc-pokajan AWS Step2 engine抽出: src/engine/playerView.ts を新規作成し toPlayerView(state,seat):PlayerView（toAiView/toVisibleCards に倣い他家は handCount・山札は wallCount のみ、wall 中身・他家 hand・seed を絶対含めない redaction。claims は ClaimStatus に redact）を実装する。src/ui/hooks/autoAction.ts の CPU 判断を engine の純関数 nextCpuAction(state,rules,ai,humanSeats) として切り出し autoAction は委譲に変える（ローカル挙動不変）。tests/engine に playerView と nextCpuAction のユニットテスト（redaction 不変条件・既存挙動との差分オラクル）を追加し、わざと壊して落ちることを確認する。参照ドキュメント: docs/ideas/cc-pokajan-aws-deployment-plan-revised.md (Step 2 範囲のみ実装)
```

**実装内容**:

- 新規: `src/engine/playerView.ts`
  - `toPlayerView(state, seat): PlayerView`（rules は不要＝`noUnusedParameters`）。`PlayerView` は UI が読む値のみ
    （phase/turn/declarer/自分の hand/per-player `{id,isCpu,score,handCount,discards,declared}`/wallCount/lastDiscard(By)/
    claims/activeGroups/activeMembers/bonusMemberIds/claimTimerMs/chainCount）。
    **`wall` 中身・他家 `hand`・`seed`/`rngState` を含めない**（seed は山札を再現でき漏洩になる）。**`claims` は
    `ClaimStatus`（'pending'|'passed'|'claimed'）に redact**（`ClaimDecision` は CLAIM 時に実カードを含むため）。
    `version` は含めない（engine の GameState に無く Step 5 の DynamoDB 層が付ける）。`toAiView`/`toVisibleCards` の射影に倣う。
- 修正/抽出: engine への `nextCpuAction(state, rules, ai, humanSeats)` 追加（現状 `src/ui/hooks/autoAction.ts` のロジック）。
  - `src/engine/autoplay.ts` の `nextAction`（`toAiView` + `decideDeclare`/`chooseDiscard`/`decideClaim`）と整合させ、**人間席以外**の手番を返す純関数にする。
  - `src/ui/hooks/autoAction.ts` は新 `nextCpuAction` に委譲（UI 側の観測挙動は不変）。
- 新規テスト: `tests/engine/playerView.test.ts`（redaction 不変条件＝他家 hand 非露出・wallCount 一致）、
  `tests/engine/nextCpuAction.test.ts`（既存 CPU 挙動との差分オラクル、seed 複数）。
- 触らない: `.oxlintrc.json`（engine glob 不変・React/config 非依存を保つ）・tsconfig グラフ。

**動作確認**:

- 自動ゲート一式 PASS。**既存 100 局テスト（`tests/engine/autoplay.test.ts`）が無変更で緑**（挙動不変の砦）。
- 新規テストを一度わざと壊し（例: PlayerView に他家 hand を混ぜる）落ちることを確認してから戻す。
- `npx playwright test` 緑（UI 挙動不変）。

**依存**: なし（Step 1 と独立・番号順に進める）

---

## Step 3: Terraform 静的配信 + OIDC CI/CD

```
/add-feature cc-pokajan AWS Step3 静的配信: infra/bootstrap（remote state 用 S3 + DynamoDB ロック + GitHub OIDC プロバイダ & デプロイロール）と infra/modules/frontend（プライベート S3 + CloudFront + OAC + 403/404→/index.html の SPA rewrite）と infra/environments/{dev,prod}（ap-northeast-1、CloudFront ACM 用 us-east-1 プロバイダ alias、frontend module 配線）を作成する。.github/workflows/deploy-aws.yml を新規作成し OIDC で configure-aws-credentials → VITE_DEPLOY_TARGET=aws npm run build → aws s3 sync dist/ → CloudFront invalidation を行う（既存 deploy.yml は無変更で Pages 併存）。terraform fmt -check && terraform validate と dev への apply、CloudFront 既定ドメインで表示・リロード 404 なしを確認する。参照ドキュメント: docs/ideas/cc-pokajan-aws-deployment-plan-revised.md (Step 3 範囲のみ実装、Step 1 完了前提)
```

**実装内容**:

- 新規: `infra/bootstrap/**`
  - `main.tf`: remote state 用 S3 バケット + DynamoDB ロックテーブル。`oidc.tf`: GitHub OIDC プロバイダ + デプロイ IAM ロール
    （信頼 `repo:OumeiSatoKenta/cc-pokajan:*`、S3 sync・CloudFront invalidation・後続 Lambda 更新・`terraform apply` 権限）。
  - bootstrap 自身の state はローカル/コミット管理（鶏卵回避）。**一度だけ apply**。
- 新規: `infra/modules/frontend/**`
  - プライベート S3（public access 全ブロック）+ CloudFront + **OAC**（レガシー OAI 不使用）+ SPA rewrite（403/404 → `/index.html`、
    CloudFront Function か custom error responses）。カスタムドメインは Phase 1 では省略し既定 `*.cloudfront.net`。
- 新規: `infra/environments/{dev,prod}/**`
  - `backend.tf`（S3 backend + DynamoDB lock, key で環境分離）、`providers.tf`（`aws` = ap-northeast-1 + `aws.us_east_1` alias）、
    `main.tf`（frontend module 配線）、`variables.tf`/`outputs.tf`/`terraform.tfvars`。
- 新規: `.github/workflows/deploy-aws.yml`
  - `aws-actions/configure-aws-credentials`（OIDC・固定キー無し）→ `VITE_DEPLOY_TARGET=aws npm run build` →
    `aws s3 sync dist/ s3://...` → CloudFront invalidation。トリガーは当面 `workflow_dispatch`（誤爆防止）。
- 触らない: 既存 `.github/workflows/deploy.yml`（Pages・無変更）。

**動作確認**:

- `terraform fmt -check && terraform validate` 通過。既存フロントゲート一式 PASS。
- bootstrap → dev を apply → CloudFront 既定ドメインで対局画面表示。リロード/ディープリンクで **404 しない**（SPA rewrite）。
- Console/Network に 404 なし（`/` 起点アセットが正しく解決）。

**依存**: Step 1（`VITE_DEPLOY_TARGET=aws` で `/` 起点ビルドが出せること。base が誤ると全アセット 404）

---

## Step 4: Cognito 認証

```
/add-feature cc-pokajan AWS Step4 Cognito認証: infra/modules/cognito（User Pool + public app client(no secret) + email/password + email verification + パスワードポリシー）を作成し environments へ配線する。aws-amplify を追加し src/ui/auth/AuthGate.tsx（deployConfig.isAuthEnabled が真のときだけログイン要求、github-pages は素通し）で App を包み src/main.tsx で Amplify を VITE_COGNITO_* から設定する。src/net/apiClient.ts に fetchAuthSession() で Authorization: Bearer idToken を付与する土台を作る。未ログイン遮断→サインアップ→検証→ログイン到達、Pages ビルドは無認証を確認する。参照ドキュメント: docs/ideas/cc-pokajan-aws-deployment-plan-revised.md (Step 4 範囲のみ実装、Step 1・3 完了前提)
```

**実装内容**:

- 新規: `infra/modules/cognito/**`
  - User Pool + アプリクライアント（**SPA/public・シークレット無し**）+ email/password + email verification + パスワードポリシー。
    出力に User Pool ID / App Client ID（フロント env と後続 authorizer が参照）。
  - `infra/environments/{dev,prod}/main.tf` に cognito module を配線、`outputs.tf` に ID を露出。
- 依存追加: `aws-amplify`（`package.json` dependencies）。
- 新規: `src/ui/auth/AuthGate.tsx`
  - `deployConfig.isAuthEnabled` が真のときのみ Amplify Authenticator 等でログインを要求。`github-pages` では children を素通し
    （オフライン/無認証ビルドを保全）。
- 修正: `src/main.tsx`
  - `deployConfig.isAuthEnabled` のとき `Amplify.configure(...)`（`import.meta.env.VITE_COGNITO_USER_POOL_ID` / `..._APP_CLIENT_ID`）し、
    `<AuthGate><App/></AuthGate>` でマウント。
- 新規: `src/net/apiClient.ts`
  - `fetchAuthSession()` で idToken を取得し `Authorization: Bearer <idToken>` を付与する薄い fetch ラッパ（`deployConfig.apiBaseUrl` 起点）。
    トークンがネットワークに触れる唯一の場所。Step 6 で本格利用。
- `deploy-aws.yml`: build 時に `VITE_COGNITO_*` を環境から注入。

**動作確認**:

- `terraform fmt -check && terraform validate` 通過。フロントゲート一式 PASS ＋ `npx playwright test` 緑
  （E2E は既定 `github-pages` なので認証は無効＝挙動不変）。
- AWS ビルド（`VITE_DEPLOY_TARGET=aws`）で未ログインはログイン画面に留まり、サインアップ→メール検証→ログイン後に対局画面へ到達。
- Pages ビルドはログイン要求が出ない。

**依存**: Step 1（`deployConfig`）, Step 3（environments/ 基盤・OIDC・デプロイ経路）

---

## Step 5: backend サーバー権威コア（Lambda + DynamoDB）

```
/add-feature cc-pokajan AWS Step5 サーバー権威: backend ワークスペース（@pokajan/game-api、@aws-sdk/client-dynamodb・lib-dynamodb・ulid、dev esbuild・@types/aws-lambda、独立 tsconfig で paths @engine/*→../src/engine/*、esbuild で node22/esm/arm 向け単一バンドル）を作り、単一 HTTP API Lambda に POST /games・POST /games/{id}/actions・GET /games/{id} を内部ルーティングで実装する。src/engine を @engine/* で共有し（Step2 の playerView/nextCpuAction 含む）、1ゲーム=1item の DynamoDB に version 楽観ロック（ConditionExpression version=:expected、人間 Action + CPU 複数手をメモリ内解決してから 1 回だけ +1 書込み）で保存し PlayerView を返す。wallet は USER#sub item にサーバー権威化（BET 差引・computePayout 精算）。infra/modules/{dynamodb,game-api}（HTTP API + Cognito JWT authorizer + Lambda(node22/arm64) + IAM + CloudWatch retention）を作成し deploy-aws.yml に backend esbuild + Lambda デプロイを足す。backend の tsc --noEmit とユニットテスト（409・version=+1・redaction）、dev へ apply し JWT 付き curl で対局が回ることを確認する。参照ドキュメント: docs/ideas/cc-pokajan-aws-deployment-plan-revised.md (Step 5 範囲のみ実装、Step 2・3・4 完了前提)
```

**実装内容**:

- 新規: `backend/package.json`（workspace member `@pokajan/game-api`）、`backend/tsconfig.json`（**root -b グラフに入れない**独立設定、
  `moduleResolution:"bundler"`・`noEmit`・`paths {"@engine/*":["../src/engine/*"]}`）、`backend/esbuild.config.mjs`
  （bundle / platform=node / target=node22 / format=esm / minify / `external:["@aws-sdk/*"]`）、`backend/package.json` に
  `typecheck: tsc --noEmit` と `build: node esbuild.config.mjs`。
- 新規: `backend/src/**`
  - `index.ts`（`APIGatewayProxyHandlerV2` → router）、`router.ts`（method+path 分岐・`default` で 404・網羅は switch+never を踏襲）、
    `http.ts`（`IllegalActionError`→400 / `ConditionalCheckFailed`→409）、`auth.ts`（`event.requestContext.authorizer.jwt.claims.sub`）。
  - `routes/createGame.ts`（`POST /games`：BET 差引 → `createGame` → CPU を人間手番まで解決 → 保存 → PlayerView）、
    `routes/applyAction.ts`（`POST /games/{id}/actions`：`{action,expectedVersion}` → `reduce` → `nextCpuAction` ループ → 楽観ロック +1 書込み）、
    `routes/getGame.ts`（`GET /games/{id}`：再同期用 PlayerView）。
  - `cpu.ts`（`@engine` の `nextCpuAction` を使い人間席まで解決）、`view/playerView.ts`（`@engine/playerView` の薄いアダプタ）、
    `repo/gameRepo.ts`（item ⇄ GameState・`putWithVersion`）、`repo/userRepo.ts`（`USER#<sub>` の wallet get/debit/credit、`computePayout` 精算）。
  - engine 再利用は `@engine/game`（`reduce`/`createGame`）・`@engine/ai`・`@engine/payout` と Step 2 の `@engine/playerView`。
- 新規: `infra/modules/dynamodb/**`（単一テーブル・`PAY_PER_REQUEST`・PK `pk`・`ttl` TTL・`version` は素の属性）。
- 新規: `infra/modules/game-api/**`（apigatewayv2 HTTP API + **JWT authorizer**〔issuer=Step 4 User Pool・audience=App Client〕 +
  Lambda〔node22・arm64〕 + IAM〔DynamoDB CRUD + logs〕 + CloudWatch log group〔`retention_in_days`〕 + 3 ルート）。
- 修正: `.github/workflows/deploy-aws.yml`（backend の esbuild → Lambda 更新ステップ追加）、`infra/environments/*`（両 module 配線・API URL 出力）。
- **DynamoDB item**: `pk="GAME#<ulid>"` / `ownerSub` / `version`（キーではない）/ `status` / `state`(GameState) / `rules` / `seed` /
  `humanSeats:[0]` / `createdAt·updatedAt` / `ttl`。`rules` は必ず保存し毎 `reduce` に同一値を渡す（再現性・`playerCount` ガード）。

**動作確認**:

- `backend` の `tsc --noEmit` 通過、`npm run build`（esbuild）で単一バンドル生成。**フロントの `tsc -b`・既存 100 局テストは無変更で緑**。
- backend ユニットテスト: ①同一 `expectedVersion` 二重送信の一方が **409** ②人間 Action + CPU 複数手で **version は +1 のみ**
  ③レスポンス PlayerView に **他家 hand・wall 中身が含まれない**。
- `terraform fmt -check && terraform validate` 通過 → dev へ apply → **JWT 付き curl/コンソール**で `POST /games` → `POST /actions` →
  `GET` が回り、サーバー算出の PlayerView が返る。`localStorage` 改竄が精算に効かない（wallet はサーバー値）。

**依存**: Step 2（`@engine/playerView`・`nextCpuAction`）, Step 3（infra 基盤・OIDC・CI）, Step 4（Cognito issuer/audience）

---

## Step 6: フロント transport seam + remote 化 + wallet サーバー権威

```
/add-feature cc-pokajan AWS Step6 remote化: src/net/transport.ts に GameTransport(create/apply/get) と GameSnapshot を定義し、localTransport（全 GameState を保持し reduce + nextCpuAction + toPlayerView＝今日の挙動、Pages/オフライン用）と remoteTransport（apply=POST actions、409→GET 再同期、apiClient 経由）を実装する。src/ui/hooks/useGameLoop.ts を一度だけリファクタして生の GameState でなく PlayerView から表示値を導出し注入された GameTransport 経由で dispatch する。src/ui/appReducer.ts の wallet を deployConfig.walletSource で分岐（aws=API/それ以外=prefs）。transport 選択は deployConfig.transport。既定 github-pages でローカル挙動不変（gate + playwright 緑）、aws ビルドでサーバー権威対局・redaction・409 再同期・wallet サーバー化を確認する。参照ドキュメント: docs/ideas/cc-pokajan-aws-deployment-plan-revised.md (Step 6 範囲のみ実装、Step 2・4・5 完了前提)
```

**実装内容**:

- 新規: `src/net/transport.ts`
  - `interface GameTransport { create(opts): Promise<GameSnapshot>; apply(action, expectedVersion): Promise<GameSnapshot>; get(): Promise<GameSnapshot> }`、
    `GameSnapshot = { view: PlayerView; events }`。
- 新規: `src/net/localTransport.ts`
  - 全 `GameState` を保持し `reduce` + 共有 `nextCpuAction` + `toPlayerView`。**今日の `useGameLoop`/`loopReducer` 挙動そのまま**
    ＝ Pages/オフラインは完全クライアントサイドを維持。
- 新規: `src/net/remoteTransport.ts`
  - `apply` = `POST /games/{id}/actions`（`{action,expectedVersion}`）、409 は `GET /games/{id}` で再取得。CPU タイマーは持たない。`apiClient`（Step 4）経由。
- 修正: `src/ui/hooks/useGameLoop.ts`
  - 生の `GameState` ではなく **`PlayerView` から表示値を導出**し、注入された `GameTransport` 経由で dispatch する形に一度だけリファクタ。
    presentational コンポーネント（`src/ui/components/**`）は導出済み props を受けるため**変更不要**。
- 修正: `src/ui/appReducer.ts`
  - wallet の出所を `deployConfig.walletSource` で分岐（`server`=API 値／`local`=従来の `prefs`）。`computePayout` は共有なので精算は同一。
- 修正: `src/main.tsx`/`App.tsx`
  - `deployConfig.transport`（`aws`→remote / それ以外→local）で transport を選択・注入。

**動作確認**:

- 自動ゲート一式 PASS ＋ `npx playwright test` 緑（既定 `github-pages`＝local transport で**ローカル挙動不変**）。
- AWS ビルド E2E（手動）:
  1. ログイン → `POST /games` → 手札タップでツモ/捨て/ロンが `POST /actions` を叩き、サーバー算出 PlayerView が反映。
  2. レスポンスに他家手札・山札中身が**一切含まれない**（DevTools Network で確認）。
  3. 同一 `expectedVersion` の二重操作の一方が 409 → 自動 `GET` 再同期で復帰。
  4. wallet が AWS ではサーバー値で増減し、`localStorage` 改竄が精算に効かない。
- Pages ビルド: 従来どおりローカル完結で対局が最後まで回る。

**依存**: Step 2（`toPlayerView`/`nextCpuAction` を local transport が共有）, Step 4（`apiClient`/認証）, Step 5（remote API）

---

## 参考: 各ステップ完了時点で何が動くか

| Step   | 動く状態 |
| ------ | -------- |
| 1 完了 | `VITE_DEPLOY_TARGET=aws` で `/` 起点ビルドが出せる。既定は `/cc-pokajan/` のまま・挙動不変 |
| 2 完了 | engine に `toPlayerView`/`nextCpuAction` が生え単体検証済み。ローカル対局は不変 |
| 3 完了 | ★ AWS(S3+CloudFront) で静的公開。リロード 404 なし（**Phase 1 完成**） |
| 4 完了 | ★ AWS 版はログイン必須ゲート。Pages 版は無認証のまま（**Phase 2 完成**） |
| 5 完了 | ★ API 単体（JWT 付き curl/コンソール）でサーバー権威対局が回る。楽観ロック・redaction 検証済み |
| 6 完了 | ★ AWS 版=サーバー権威 / Pages 版=ローカル完結が同一 UI で両立（**Phase 3 完成**） |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、原則は該当ステップの PR を revert すれば回復する。ただし:

- **Step 1 を revert すると `VITE_DEPLOY_TARGET` 分岐が消える**。Step 3 以降が残っていると AWS ビルドが `/cc-pokajan/` 起点になり
  CloudFront で全アセット 404。逆順 revert はしない（Step 3 以降を先に戻す）。
- **Step 3〜5 は AWS 実体を伴う**。PR revert だけでは AWS 上の資源は消えない。撤去は `terraform destroy`（環境単位）で行う。
  bootstrap（state バケット・OIDC）は最後に手動撤去。
- **Step 5 を revert してもデプロイ済み Lambda/DynamoDB は残る**。API を止めるなら Terraform 側で destroy、
  データを消すなら DynamoDB テーブルの削除（TTL 任せでも可）。
- **Step 4/6 の revert 単独**は、AWS 版のみ影響（Pages 版は `deployConfig` 分岐で常に無認証・local のため無傷）。
- **新規依存の後始末**: Step 4 で `aws-amplify`、Step 5 で backend 依存を追加。ステップを戻すなら該当 `package.json` から削除。

## 参考: Step 1 着手前の事前確認

- **新規依存追加（承認済み）**: `aws-amplify`（Step 4）／backend の `@aws-sdk/*`・`ulid`・`esbuild`・`@types/aws-lambda`（Step 5）。合意済み。
- **AWS アカウント/権限**: Step 3 の bootstrap 実行に管理者相当が必要。以降の CI は OIDC ロールで固定キーを持たない。
- **リージョン**: アプリ資源は ap-northeast-1（東京）。CloudFront 用 ACM のみ us-east-1（カスタムドメイン導入時）。
- **engine 共有は据え置き（option b）**: `src/engine` を移動しない。backend の tsconfig を root `references` に入れない
  （全 `noEmit`・非 `composite` の tsconfig グラフとの衝突＝TS6306/TS6310 を避ける）。
- **既存テストの状態**: 着手前に `npm test`（ユニット）と `npx playwright test`（E2E）で現件数を控える。
- **GitHub Pages は温存**: `.github/workflows/deploy.yml` は無変更。`main` push で本番 Pages が更新される点は従来どおり。

## 参考: Phase 4 以降で検討する機能（今回スコープ外）

- **AppSync Events リアルタイム同期**（Phase 4）: 2 ブラウザで同一 Game を同期（通知のみ・真実は DynamoDB）。
- **4 人マルチプレイ**（Phase 5）: Lobby/Join/Ready/Start・private channel・reconnect。
- **画像共有**（Phase 6）: Presigned Upload → S3 → CloudFront、Avatar/Roster、GameRosterSnapshot。
- **Observability / 分析**（Phase 7-8）: CloudWatch 構造化ログ・Metrics/Alarm、Game Events → Firehose → S3 → Athena。
- **カスタムドメイン**（ACM us-east-1 + Route53）と `main` 連動の自動 AWS デプロイ（当面 `workflow_dispatch` 手動）。
