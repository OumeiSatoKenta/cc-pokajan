# タスクリスト: AWS デプロイ Step 5 — backend サーバー権威コア（Lambda + DynamoDB）

## 事前

- [x] ベースライン確認: 既存フロントゲート緑（lint/typecheck/test 869/build/format）・terraform 3 root validate 緑・E2E 91（実装後に突合）
- [x] 実装前 doc-review 反映（doc-reviewer）: [必須]events redaction（redactEvents 新設）・[高]settled ガード/二重精算テスト/INITIAL_WALLET 一元化/エラー系テスト・[中]MAX_STEPS 例外/router KnownRoute/ボディ型ガード/CORS prod・[低]import 元/TTL 持ち越し を design.md へ反映（末尾「実装前 doc-review 反映」節）

## 実装（backend 土台）

- [x] T1: `backend/package.json` を実体化（deps: @aws-sdk/client-dynamodb 3.1108・lib-dynamodb 3.1108・ulid 2.4 / dev: esbuild 0.25・@types/aws-lambda 8.10 / scripts: typecheck・test・build）→ `npm install` で lock 同期
- [x] T2: `backend/tsconfig.json`（独立・noEmit・paths @engine/@config・types node/aws-lambda・include src/tests）
- [x] T3: `backend/esbuild.config.mjs`（node22/esm・external @aws-sdk/*・alias @engine/@config・dist/index.mjs）
- [x] T4: `backend/vitest.config.ts`（resolve.alias 正規表現形で @engine/@config）

## 実装（engine 追加・redaction）

- [x] T4b: [必須] `src/engine/playerView.ts` に純関数 `redactEvents(events, selfSeat)` を追加（他家 `CardDrawn`/`Refilled` を除外・switch+never）＋ `tests/engine/playerView.test.ts` に差分オラクル3件。既存 engine は不変（frontend test 869→872）

## 実装（backend コア）

- [x] T5: `backend/src/{env,ddb,keys,errors,http,auth,gameConfig,dto}.ts`（土台・型・DDB クライアント・エラー表・型ガード isCreateGameRequest/isApplyActionRequest）
- [x] T6: `backend/src/gameFlow.ts`（advanceToHuman〔MAX_STEPS 超過は例外〕/ applyHumanThenAdvance / normalizeHumanAction〔playerId 強制〕/ buildSnapshot〔redactEvents 経由〕/ buildOutcome。純粋）
- [x] T7: `backend/src/repo/userRepo.ts`（ensureWallet〔if_not_exists〕/ getWallet）
- [x] T8: `backend/src/repo/gameRepo.ts`（getGame〔404〕/ createGameWithDebit(Tx・402) / updateGameVersioned(条件付き・409) / settleGame(Tx・二重精算防止)）
- [x] T9: `backend/src/routes/{createGame,applyAction,getGame}.ts`（BET 差引・楽観ロック・精算・settled ガード・ownerSub 認可・404/402/409）
- [x] T10: `backend/src/{router,app,index}.ts`（routeKey→KnownRoute 絞り+switch+never・単一 catch で HttpError/IllegalActionError→レスポンス・createHandler で DI）

## 実装（root 配線）

- [x] T11: root `package.json` scripts を追加拡張（typecheck/test の末尾に `@pokajan/game-api` を連結）。build は frontend のみ。root vitest は `tests/**` のみ globし backend/tests と衝突しないことを確認

## 実装（infra）

- [x] T12: `infra/modules/dynamodb/**`（単一テーブル PK pk・オンデマンド・SSE・TTL・PITR / variables / outputs / versions）
- [x] T13: `infra/modules/game-api/**`（Lambda arm64 + placeholder + HTTP API + JWT authorizer + routes×3 + integration + stage + IAM 最小 + log group / variables / outputs / versions）。env は TABLE_NAME のみ（INITIAL_WALLET 一元化）
- [x] T14: `infra/environments/{dev,prod}/main.tf` に dynamodb/game_api module 配線（`outputs.tf` の game_api_endpoint / game_api_function_name は残タスク）
- [x] T15: `infra/bootstrap/oidc.tf` に `lambda:UpdateFunctionCode`（当該関数のみ）追記・`main.tf` に `game_api_function_prefix` local
- [x] T16: `infra/README.md` に Step 5 欄（AWS_LAMBDA_FUNCTION_NAME・apply 依存順・JWT curl 確認・単一テーブル・CORS prod ハードニング申し送り）

## 実装（CI）

- [x] T17: `.github/workflows/deploy-aws.yml` の build に backend esbuild + zip + `lambda-<env>` artifact、deploy に `aws lambda update-function-code`（+wait）を追加

## 検証（infra 早期）

- [x] terraform fmt -check クリーン + 3 root（bootstrap/dev/prod）validate Success・dev/prod lock に archive を multi-platform で追加

## 実装（テスト）

- [x] T18: `backend/tests/**`（fakeDoc インメモリ DDB + event helper。gameFlow/gameRepo/dto/routes の4スイート24件）: version=+1・409・redaction(view+events)・402・404・未知ルート・二重精算・normalize・型ガード

## 検証

- [x] V1: backend `tsc --noEmit` + backend vitest 緑（24 件・version=+1・409・redaction・402・404・二重精算）
- [x] V2: 既存フロントゲート一式（lint / typecheck frontend+backend / test 872+24 / build+postbuild / format:check）緑・**E2E 91 passed（挙動不変）**
- [x] V3: `terraform fmt -check` クリーン + 3 root（bootstrap/dev/prod）validate Success
- [x] V4: `wc -l` 全 backend .ts（最大 215=テスト・src 最大 176）/ 新規 .tf（最大 game-api main 167）が 400 行未満
- [x] V5: ミューテーション（redactEvents 漏洩・version+1→+2・402 マッピング削除・settle 条件削除）で該当テストが落ちることを実測→revert。backend redaction は初回テストが弱く post-discard snapshot で強化して再確認

## レビュー反映タスク（実装後 3軸 + validator。doc-reviewer は実装前）

### docs 軸（AWS API 準拠・全項目 公式で正と確認。IAM for TransactWriteItems=正）

- [x] R1: [中] `esbuild.config.mjs` の `external: ['@aws-sdk/*']` を外し AWS SDK をバンドル（39kb→550kb・external 参照0・実行時ドリフト回避）。design のバンドル記述も同期

### secondary 軸（総合 B・[必須]/[高] なし）

- [x] R2: [中] `environments/{dev,prod}` に `cors_allow_origins` var を追加し module へ配線（対称）。`prod/terraform.tfvars` に「CloudFront ドメインへ絞る」手順をコメント（実際に絞れる形に）
- [x] R3: [中] `createGame.ts` の生成直後 gameOver（現状到達不能）を明示アサーション（throw→500）で fail-fast 化
- [x] R4: [推奨/validator 中] `routes.test.ts` に gameOver/settled への `POST /actions` が 200・version 不変・書き込みなし・outcome を確認するテスト2件（ガード削除で2件落ちることを実測→revert）
- [x] R5: [提案] `getGame`/`getWallet` の `GetCommand` に `ConsistentRead: true`
- [x] R6: [提案] `game-api` stage に `default_route_settings`（burst 20 / rate 10・var 化）
- [x] R7: [質問] `normalizeHumanAction` の不変条件（`nextCpuAction` は human 決定点でのみ null・HUMAN_SEATS=[0] 前提）をコード comment に明記

### validator（総合 4.4/5 = A・本番投入可・[必須]/[高] なし。gate 独立再実行済み）

- [x] R8: [中] repo 層発の真の競合 409 にも snapshot を載せる。`applyActionRoute` で write を try/catch し `VersionConflictError` 時に `getGame` 再読込 → `currentSnapshot(409)`
- [x] R9: [中] `routes.test.ts` に engine 起因 400（手札に無い uid で DISCARD → `IllegalActionError` → 400）のルートテスト追加
- [x] R10: [低] `dto.ts` の `expectedVersion` を `Number.isInteger(x) && x >= 0` に強化
- [x] R11: [低] `design.md` の IAM 記述を実装に合わせて修正（`TransactWriteItems` は IAM 不要）＋ `PaymentRequiredError` 呼称に統一
- [~] R12: [提案・**Step 6 へ申し送り**] `GameSnapshot.events` を brand 型で redact 経由必須を compile error 化（今は buildSnapshot 単一経路で担保。Step 6 で構築経路が増える前に）

### structural 軸（総合 A・[必須]/[高] なし）

- [x] R13: [推奨] `getWallet→buildSnapshot→json` の4箇所重複を `respond.ts` の `respondSnapshot` に集約（DRY・直し忘れ防止）
- （[提案] prod CORS = R2 と統合済み。[質問] `PaymentRequiredError` 呼称 = R11 で design 同期済み）

### 自動セキュリティレビュー（plugin・実装後）

- [x] S1: [MEDIUM 弱い乱数] `createGame.ts` の seed を `Math.random` → **`node:crypto.randomInt`**（CSPRNG）に。デッキ生成が
  公開＋自手札観測で seed 逆算→山札読みが理論上可能なため、予測不能な seed で塞ぐ（この Step の anti-cheat と一致）。
- [x] S2: [MEDIUM CORS 設定] prod の `cors_allow_origins` 既定を `["*"]` → **`[]`（fail-closed）**に。未設定なら全オリジン拒否＝
  ブラウザからの他オリジン読み取りを塞ぐ。自ドメインは初回 apply 後に terraform.tfvars で明示設定（dev は `["*"]` 据え置き）。

## 実装後の振り返り（実装完了: 2026-08-12）

**計画と実績の差分**:

- Phase 3 の server 部分（backend workspace・単一 HTTP API Lambda・DynamoDB 楽観ロック・wallet サーバー権威化・
  infra/modules/{dynamodb,game-api}・deploy-aws.yml の Lambda 配線）を計画どおり実装。engine は `redactEvents` 1関数の
  追加のみで既存不変。フロント（App.tsx/useGameLoop/appReducer）は無変更＝Pages 版の挙動不変（E2E 91・frontend test 872）。
- **計画からの意図的な逸脱**:
  1. **IAM に `TransactWriteItems` を含めない**（design は含める記載）。AWS 公式で「トランザクションは内部の Put/Update の
     個別アクションで認可される」ことを確認し、最小権限に。docs 軸・validator・secondary の3レビューが公式で裏取りし一致。
  2. **AWS SDK をバンドルに含める**（当初 `external: ['@aws-sdk/*']`）。docs 軸レビューが AWS 公式「デプロイパッケージに
     同梱を strongly recommend」を引用。ランタイム同梱版のドリフトに正しさを預けない（CLAUDE.md 原則）ため bundle へ変更。
  3. **`InsufficientFundsError` → `PaymentRequiredError`**（他のエラークラスと HTTP ステータス名で統一）。
- **doc-review（実装前）の [必須] が本 Step 最大の学び**: `GameSnapshot.events` の生返却が他家手札の第2の漏洩経路だった。
  `redactEvents` で塞ぎ、engine/backend 両層の差分オラクルで固定。「view だけ守っても events で漏れる」。

**学んだこと**:

- **redaction は「唯一の出口関数を必ず通す」構造で守る**。view は `toPlayerView`、events は `redactEvents`、両方を
  `buildSnapshot` の単一経路に通す。テストは「redact しなければ本当に漏れる」を生 JSON 比較で証明し、通るだけの検査にしない。
- **ミューテーション検証で「弱いテスト」を1件捕まえた**。初回の backend redaction テストは createGame 直後の snapshot を見て
  いたが、そこには CPU の events がまだ無く、`redactEvents` を壊しても落ちなかった（engine 単体テストだけが落ちた）。
  **人間が捨てた後**の snapshot（CPU 手番が解決され CardDrawn が生じる局面）に変えて初めて load-bearing になった。
  7-5/8-1/8-2 と同じ「何も見ていないテスト」の轍。ミューテーションは「壊して落ちる局面」を先に1つ決めてから書く。
- **DynamoDB を実 AWS 無しでテストする**: repo が使う特定の ConditionExpression/UpdateExpression だけを評価する
  インメモリ偽クライアント（`fakeDoc`）で、409・402・二重精算・version+1 をルート結合まで検査できた。汎用パーサにせず
  「repo が式を変えたら未知式エラーで落ちる」形にして、テストが実装に追従するようにした。
- **anti-cheat は engine の既存資産を再利用して達成**: 点数/カード偽装は `verifyCandidate`（選択 uid から役を再導出）で
  既に塞がれており、backend は engine を呼ぶだけ。なりすましは `ClientAction` 型に `playerId` を持たせず `normalizeHumanAction`
  で humanSeat 強制。「型と構造で不正できなくする」を engine と同じ思想で backend にも通した。
- **「たまたま成り立つ条件」を明示アサーションに**: 生成直後 gameOver（現状到達不能）を `throw` で fail-fast 化。到達不能でも
  黙って status:'active' 固定＝精算漏れになる経路を残さない。
- **3点一致（tsconfig/esbuild/vitest の alias）**は「型は通るがバンドル/テストで壊れる」を防ぐ要。`baseUrl` は TS6 で非推奨に
  なっていたため paths のみで解決した（tsconfig の位置基準）。

**次回への申し送り**:

- **未コミット**: Step 1〜5 が作業ブランチ `feature/20260811-aws-step1-base-switch` にスタック。ship-pr で Step 単位に分割を。
  `backend/function.zip`・`backend/dist`・`infra/**/build` は gitignore 済み。`awscli-bundle*` はコミットしない。
- **実 apply / JWT curl 確認はユーザー作業**（実 Cognito+DynamoDB が要る）: `infra/README.md`「サーバー権威 API（Step 5）の
  手動確認」。GitHub の各 Environment に `AWS_LAMBDA_FUNCTION_NAME`（= `game_api_function_name`）を追加。
  **prod は初回 apply 後に `cors_allow_origins` を CloudFront ドメインへ絞る**（terraform.tfvars のコメント手順）。
- **Step 6（フロント remote 化）**: `VITE_API_BASE_URL`（= `game_api_endpoint`）を build に注入し `apiClient` を remote transport
  から使い始める。`GameSnapshot.events` を **brand 型**（`redactEvents` の戻り値だけが持つ型）にして「redact 経由し忘れ」を
  compile error 化する [提案・R12] を、GameSnapshot 構築経路が増える Step 6 の着手前に検討する（今は buildSnapshot 単一経路で担保）。
  ローカル transport でも `redactEvents` を通せば local/remote の event 整合が取れる。
- **HUMAN_SEATS=[0] 前提**: `normalizeHumanAction` の「サーバー待機時は必ず該当 human の手番」不変条件は単一 human 席前提。
  将来マルチプレイ（Phase 5）で複数 human 席にするときは本不変条件の再検証が要る（コメントに明記済み）。
