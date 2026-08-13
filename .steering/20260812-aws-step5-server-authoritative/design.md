# 設計: AWS デプロイ Step 5 — backend サーバー権威コア

## 方針

**engine を再実装しない。** backend は `src/engine` を `@engine/*` エイリアスで**共有**し、
`createGame` / `reduce` / `nextCpuAction` / `toPlayerView` / `computePayout` を **そのまま呼ぶ**。
RNG（mulberry32）も engine の `createGame` 経由でしか使わないため、決定的再現性は engine が担保する。
backend が新規に持つのは **「HTTP 境界・永続化・楽観ロック・wallet 権威」だけ**。

engine は `Date`/`Math.random` を使わないが、**backend（Lambda）はエンジン層ではない**ので
seed 生成・TTL 計算・タイムスタンプに `Math.random`/`Date` を使ってよい（境界の外）。

## engine 共有の実現（tsconfig / esbuild / vitest の三点一致）

`@engine/*`・`@config/*` を3箇所で同じに解決する。ズレると型は通るのにバンドルで壊れる/テストで解決できない。

| ツール | 解決方法 |
| --- | --- |
| `tsc --noEmit`（型検査） | `backend/tsconfig.json` の `paths`（`@engine/* → ../src/engine/*`、`@config/* → ../src/config/*`） |
| `esbuild`（バンドル） | `esbuild.config.mjs` の `alias`（同じ2エイリアスを絶対パスへ） |
| `vitest`（テスト） | `backend/vitest.config.ts` の `resolve.alias`（正規表現形で `@engine/(.*)`・`@config/(.*)`） |

- **root の `tsc -b` グラフには backend を入れない**（`tsconfig.app.json` は `src` のみ、`tsconfig.test.json` は
  `tests` のみ。backend は独立）。フロントの typecheck/build/test/lint は engine 共有の影響を受けない。
- backend の型検査・テストは **独立コマンド**で、root ゲートから**追加的に**呼ぶ（下記スクリプト）。
- engine は相対 import（`./x`）だけで閉じているので、`@engine/game` を入口にすれば esbuild が engine 全体を
  相対解決で取り込む。`@config/rules`（`../engine/types` を相対 import）も同様にクリーンに取り込める。

### バンドル

`esbuild`: `bundle` / `platform=node` / `target=node22` / `format=esm` / `outfile=dist/index.mjs` / `minify` / `sourcemap`。
**AWS SDK v3（`@aws-sdk/*`）もバンドルに含める**（`external` にしない）。AWS 公式が「デプロイパッケージに同梱する」ことを
strongly recommend しており、ランタイム同梱版のマイナー版ドリフトに正しさを預けないため（docs 軸レビュー [中] 反映）。`ulid` も同梱。
Lambda 側 `handler = "index.handler"`・`architectures = ["arm64"]`・`runtime = "nodejs22.x"`。

## backend/src ファイル構成（各ファイル小さく保つ）

```
backend/src/
  index.ts            APIGatewayProxyHandlerV2WithJWTAuthorizer → try/catch で HttpError→レスポンス → router
  router.ts           event.routeKey を switch（default 404・網羅は既知集合）で routes/* へ
  http.ts             json()/noContent()、parseJson()（不正 JSON→400）
  errors.ts           HttpError 基底 + NotFound/BadRequest/Unauthorized/Conflict/PaymentRequired。engine の IllegalActionError→400 の対応表
  auth.ts             requireSub(event)：jwt.claims.sub を取り出す（無ければ 401）
  env.ts              TABLE_NAME 等を process.env から検証付きで読む
  ddb.ts              DynamoDBDocumentClient を1つ生成（marshall オプション）
  keys.ts             gamePk(id)=`GAME#${id}` / userPk(sub)=`USER#${sub}`
  gameConfig.ts       サーバー権威の既定: RULES=DEFAULT_RULES / ROSTER=DEFAULT_ROSTER / AI=DEFAULT_AI_CONFIG / HUMAN_SEATS=[0] / TTL_DAYS / INITIAL_WALLET
  dto.ts              CreateGameRequest / ApplyActionRequest / GameSnapshot / OutcomeSummary（レスポンス型）
  gameFlow.ts         純粋: advanceToHuman() / applyHumanThenAdvance() / normalizeHumanAction() / buildSnapshot() / buildOutcome()
  repo/gameRepo.ts    getGame / createGameWithDebit(Tx) / updateGameVersioned(条件付き) / settleGame(Tx)
  repo/userRepo.ts    ensureWallet(if_not_exists) / getWallet
  routes/createGame.ts / routes/applyAction.ts / routes/getGame.ts
```

## HTTP 境界

- **ルーティング**: HTTP API payload v2 の `event.routeKey`（例 `"POST /games"`）で分岐。
  `event.pathParameters.id` で対局 ID。未知ルートは 404。
- **認可**: JWT authorizer が検証済み。`sub = event.requestContext.authorizer.jwt.claims.sub`。
  対局は `ownerSub === sub` のときだけ読める/進められる。**不一致・不在はどちらも 404**（存在を漏らさない）。
- **エラー対応表**（`index.ts` の単一 catch）:
  - engine `IllegalActionError`（不正 Action・不正 seat・不正 BET・精算入力）→ **400**
  - `VersionConflictError`（`ConditionalCheckFailed`）→ **409**（body に現在の snapshot を載せ再同期を促す）
  - `PaymentRequiredError` → **402**、`NotFoundError` → **404**、`UnauthorizedError` → **401**
  - それ以外 → **500**（詳細はログのみ・body は中立文言。内部情報を漏らさない）
- **クライアント Action の正規化**（なりすまし防止）: 受理するのは `DISCARD`/`DECLARE`/`SKIP_DECLARE`/`CLAIM`/`PASS` のみ。
  `DRAW`/`TICK` はサーバー内部専用なので 400 で拒否。`DECLARE`/`CLAIM`/`PASS` の `playerId` は
  **クライアント値を無視して humanSeat(0) を強制**する（他席として打てない）。

## サーバー権威ループ（gameFlow.ts）

engine の `nextCpuAction` は「人間に判断が回ったら null」を返す純関数。これを使い、**人間に決定を求める点まで
CPU を解決し切る**。中間状態は保存しない（version は最終状態で 1 回だけ +1）。

```
advanceToHuman(state, rules, ai, humanSeats):
  events = []
  for guard in 0..MAX_STEPS:          // 暴走検知（engine の maxChainDeclare の外側の保険）
    if state.phase === 'gameOver': break
    action = nextCpuAction(state, rules, ai, humanSeats)
    if action === null: break         // 人間の入力待ち
    { state, events: e } = reduce(state, action, rules); events.push(...e)
  return { state, events }

applyHumanThenAdvance(state, humanAction, rules, ai, humanSeats):
  { state, events } = reduce(state, normalizeHumanAction(humanAction), rules)   // 不正は IllegalActionError→400
  next = advanceToHuman(state, rules, ai, humanSeats)
  return { state: next.state, events: [...events, ...next.events] }
```

- `createGame` 直後も `advanceToHuman` を通す（draw→selfDeclare→役0なら自動 skip→discard で人間の番）。
- **RNG は `reduce` を進めても消費されない**（`rngState` は `createGame` 時のスナップショット）。よって
  「人間 Action + CPU 複数手」をメモリ内で解決しても山札は決定的。保存は最終 state 1 回。

## 永続化（DynamoDB 単一テーブル・PK `pk`）

| item | 主なフィールド |
| --- | --- |
| GAME | `pk="GAME#<ulid>"`、`ownerSub`、`version`(属性)、`status:'active'|'settled'`、`state`(GameState 丸ごと)、`rules`、`seed`、`bet`、`humanSeats:[0]`、`createdAt`/`updatedAt`、`ttl` |
| USER | `pk="USER#<sub>"`、`coins`(number) |

- **GameState は完全 JSON 直列化可能**（primitive/array/Record/null のみ）。`state` にそのまま入れる。
  `claims` の数値キーは JSON/DDB で文字列化されるが engine は `Number(key)` で吸収済み（新規コードも数値キー前提にしない）。
- `rules` を item に保存し**毎 `reduce` に同一値**を渡す（`game.ts` の `playerCount !== players.length` ガード・再現性）。
  ただし精算・再開に使う rules は**サーバー権威（`gameConfig.RULES`）**とし、保存 `rules` は監査用スナップショット。
  ※ 本 Step は常に既定 rules なので両者は一致する。将来カスタム rules を許すときの拡張点をコメントで明示する。

### 楽観ロック（putWithVersion 相当）

- **通常更新**（`updateGameVersioned`）: `PutCommand` で item 全体を書き、
  `ConditionExpression = "version = :expected"`、新 item の `version = expected + 1`。
  `ConditionalCheckFailedException` → `VersionConflictError`（→409）。
  ※ 1ゲーム=1item なので**全 item 置換（Put＋条件）**が最も素直（Update の部分 SET で属性を取りこぼす事故を避ける）。
    メモリ内に読んだ item の全フィールドを保持してから書くので取りこぼさない。
- **新規作成 + BET 差引**（`createGameWithDebit`）: `TransactWriteItems` で
  ① GAME を `Put`（`attribute_not_exists(pk)`＝ULID 衝突防止）② USER を `Update`
  `SET coins = coins - :bet` `ConditionExpression = "coins >= :bet"`。**原子的**。
  取消理由が USER 条件 → `PaymentRequiredError`(402)、GAME 条件 → `VersionConflictError`(409・再試行)。
- **精算（gameOver 遷移）**（`settleGame`）: `TransactWriteItems` で
  ① GAME を `Put`（`ConditionExpression = "version = :expected AND #status = :active"`、
  新 `version=expected+1`・`status='settled'`）② USER を `Update` `SET coins = coins + :gross`。**原子的・一度だけ**。
- 二重精算防止は **status 条件**（`active` のときだけ settle 遷移が成立）＋ `phase==='gameOver'` の item には
  以後の action を**書き込まない**（現 snapshot を返すだけ）。

## wallet（サーバー権威）

- `ensureWallet(sub)`: `UpdateCommand` `SET coins = if_not_exists(coins, :initial)`（条件なし・冪等）。初回のみ
  `INITIAL_WALLET`(=`rules.bet.initialWallet`=10000) を付与。
- `POST /games`: `bet ∈ rules.bet.options` を検証（外れは 400）→ `ensureWallet` → `createGameWithDebit`（条件付き差引）。
- `gameOver` 時: `rank = rankOf(computeRanking(players), humanSeat)`、`finalScore = players[humanSeat].score`、
  `payout = computePayout(finalScore, bet, rank, rules)` → `settleGame` で `coins += payout.gross`。
  **BET は作成時に差引済みなので加算は gross**（appReducer の `FINISH` と同一会計）。
- snapshot には常に **現在の wallet（`getWallet`）** を載せる（curl / Step 6 の読み出し用）。

## レスポンス（GameSnapshot）

```ts
interface GameSnapshot {
  id: string            // ULID（URL 用。pk の "GAME#" 接頭辞は外して返す）
  version: number
  view: PlayerView      // @engine/playerView。wall 中身・他家 hand・seed を含まない
  events: GameEvent[]   // 直近の遷移の演出用（Step 6 の UI で使用）
  wallet: number        // サーバー権威の残高
  outcome: OutcomeSummary | null   // gameOver のときだけ（payout/ranking/scores）
}
```

`view` は `toPlayerView(state, humanSeat)`。**redaction は engine 側で担保済み**（Step 2）。backend は
`GameState` を**返さない**（型として `GameSnapshot.view: PlayerView` しか公開経路が無い）。

## infra

### modules/dynamodb

- `aws_dynamodb_table`: `hash_key="pk"`（S）、`billing_mode="PAY_PER_REQUEST"`、`ttl { attribute_name="ttl", enabled=true }`、
  `server_side_encryption { enabled=true }`、`point_in_time_recovery`（var・既定 true）。
- variables: `name`、`tags`、`point_in_time_recovery`。outputs: `table_name`、`table_arn`。

### modules/game-api

- `aws_cloudwatch_log_group`（`/aws/lambda/<fn>`・`retention_in_days` var 既定 14）。
- Lambda 実行ロール（`lambda.amazonaws.com` 信頼）+ インライン最小ポリシー:
  ログ（当該 log group のみ）+ DynamoDB（`GetItem`/`PutItem`/`UpdateItem` を **table_arn のみ**）。
  ※ **`TransactWriteItems` は IAM アクションとして不要**（トランザクションは内部の Put/Update の個別アクションで認可される。
  AWS 公式 `transaction-apis-iam.html` 確認済み）。ConditionCheck 型アイテムは使わないので `ConditionCheckItem` も不要。
- `aws_lambda_function`: `runtime="nodejs22.x"`、`architectures=["arm64"]`、`handler="index.handler"`、
  `filename`＝`archive_file`（`placeholder/index.mjs` を zip）、`source_code_hash`、`memory_size`/`timeout` var、
  `environment { TABLE_NAME, INITIAL_WALLET }`、
  `lifecycle { ignore_changes = [filename, source_code_hash] }`（**CI の update-function-code を上書きしない**）。
- `aws_apigatewayv2_api`（HTTP・`cors_configuration` var 既定 `allow_origins=["*"]`/`authorization,content-type`/`GET,POST,OPTIONS`）、
  `aws_apigatewayv2_authorizer`（JWT・`identity_source=$request.header.Authorization`・`audience=[app_client_id]`・`issuer`）、
  `aws_apigatewayv2_integration`（AWS_PROXY・payload 2.0）、`aws_apigatewayv2_route` ×3（`authorization_type="JWT"`）、
  `aws_apigatewayv2_stage`（`$default`・`auto_deploy=true`）、`aws_lambda_permission`（apigw invoke・`source_arn=${execution_arn}/*/*`）。
- variables: `project`/`environment`/`table_name`/`table_arn`/`cognito_issuer`/`cognito_app_client_id`/
  `lambda_memory_mb`/`lambda_timeout_s`/`log_retention_days`/`cors_allow_origins`/`initial_wallet`/`tags`。
  outputs: `function_name`、`function_arn`、`api_endpoint`（`aws_apigatewayv2_api.api_endpoint`）、`api_id`。
- **placeholder**: `placeholder/index.mjs`（`503 not yet deployed` を返す ESM ハンドラ）。CI が本体へ差し替える。

### environments/{dev,prod}

- `main.tf` に `module "dynamodb"`（`name="${project}-${environment}"`・`Component=data`）と
  `module "game_api"`（`table_name`/`table_arn`=dynamodb outputs、`cognito_issuer`/`cognito_app_client_id`=cognito outputs、
  `Component=api`）を追加。
- `outputs.tf` に `game_api_endpoint`（VITE_API_BASE_URL 用・Step 6）と `game_api_function_name`
  （GitHub Environment 変数 `AWS_LAMBDA_FUNCTION_NAME` 用）を追加。

### bootstrap/oidc.tf

- deploy ポリシーに `lambda:UpdateFunctionCode` を **当該環境の関数のみ**へ追加:
  `arn:aws:lambda:${var.aws_region}:${acct}:function:${var.project}-game-api-${each.key}`。
  `local.game_api_function_prefix` を `main.tf` に置き2箇所同期を避ける（frontend_bucket_prefix と同型）。

## deploy-aws.yml

- **build ジョブ**（AWS クレデンシャル無し）: 既存の lint/typecheck/test/build（frontend）に加え、
  `npm run -w @pokajan/game-api build`（esbuild）→ `backend/dist` を zip（`function.zip`）→ `lambda-<env>` artifact に upload。
  ※ `npm test`/`npm run typecheck` は backend も含む（root スクリプトを追加的に拡張）ので、ここで backend も検査される。
- **deploy ジョブ**（OIDC）: 既存の s3 sync + invalidation に加え、`lambda-<env>` を download し
  `aws lambda update-function-code --function-name ${{ vars.AWS_LAMBDA_FUNCTION_NAME }} --zip-file fileb://function.zip`
  → `aws lambda wait function-updated`。

## root スクリプトの追加的拡張（backend をゲートに含める）

CLAUDE.md の検証ゲート `npm test` / `npm run typecheck` が backend も見るよう**追加的に**拡張する
（フロント検査は不変・後ろに backend を連結するだけ）:

- `typecheck`: `tsc -b && npm run --workspace @pokajan/game-api typecheck`
- `test`: `vitest run && npm run --workspace @pokajan/game-api test`
- `build` は frontend のみ（backend の bundle は deploy 用で CI が個別に叩く）。

backend の package.json scripts: `typecheck`（`tsc --noEmit -p tsconfig.json`）/ `test`（`vitest run`）/
`build`（`node esbuild.config.mjs`）。

## テスト（backend・独立 vitest）

`backend/tests/**`（backend tsconfig 配下・root の `tsc -b` は見ない）。DynamoDB は**注入した偽 doc クライアント**
（`{ send(cmd) }`）でモックし、実 AWS を叩かない。

1. **version=+1**: `updateGameVersioned` が新 item.version = expected+1 の `PutCommand` を、
   `ConditionExpression "version = :expected"` 付きで発行することを検査。
2. **409**: 偽クライアントが `ConditionalCheckFailedException` を投げると `VersionConflictError` に変換されることを検査。
3. **redaction**: `createGame` → `advanceToHuman` → `buildSnapshot` の `view` に他家 hand・`wall` 中身・`seed` が
   無い（`JSON.stringify(view)` に他家手札 uid・seed が出ない）ことを差分で検査。
4. **CPU 解決 / 会計の健全性**: `advanceToHuman` が人間の判断点で止まる（`nextCpuAction` が null を返す局面）ことと、
   `applyHumanThenAdvance` が version を 1 進める前提（gameFlow は状態のみ・書込みは repo）を確認。
5. **正規化**: `normalizeHumanAction` が `DRAW`/`TICK` を弾き、`DECLARE`/`CLAIM`/`PASS` の playerId を humanSeat に強制することを検査。

各テストは **わざと実装を壊すと落ちる**ことを1回確認する（CLAUDE.md「通ることしかできない検査を作らない」）。

## 実装前 doc-review 反映（2026-08-12・doc-reviewer）

以下は実装前レビューの指摘を設計へ確定したもの。先行する本文より**こちらを優先**する。

- **[必須] `events` も redaction する（他家手札の第2の漏洩経路を塞ぐ）。** `GameEvent` のうち
  `CardDrawn`（`game.ts:114`・手番が CPU でも引いた実カードを持つ）と `Refilled`（`win.ts:72`・
  勝者が CPU でも補充した実カードを持つ）は**他家のカードを含む**。`GameSnapshot.events` に生で載せると
  `view` を redact した意味が無い。engine の redaction 境界（`src/engine/playerView.ts`）に純関数
  **`redactEvents(events, selfSeat): readonly GameEvent[]`** を新設し、`playerId !== selfSeat` の
  `CardDrawn` / `Refilled` を**除外**（型は `GameEvent[]` のまま＝フィルタ）。`Discarded`（河＝公開）/
  `Declared`（成立役は勝利時に公開・`PlayerSummary.declared` と一致）/ `Paid` / `TurnChanged` / `GameOver` は通す。
  `gameFlow.buildSnapshot` は**必ず `redactEvents` を通した events だけ**を積む。`tests/engine/playerView.test.ts` に
  差分オラクル（他家 `CardDrawn`/`Refilled` を混ぜて**落ちる**ことを確認・自席のものは残る）を追加する。
  ※ これに伴い「engine 無変更」は**「engine への追加は redaction 純関数 `redactEvents` の1つだけ（既存は不変）」**に更新。
  Step 6 のローカル transport でも同関数を通せば local/remote の event 整合が取れる（UI パリティは Step 6 の責務）。
- **[高] `settled`/`gameOver` な対局への `POST /actions` は書き込まない。** `applyAction` ルートは
  読んだ item の `status === 'settled'`（＝精算済み）を検出したら **DynamoDB へ書かず現在の snapshot を返す**
  （version を進めない）。二重精算は `settleGame` の `status='active'` 条件でも防ぐが、ルート側でも早期に弾く。
  テストに **「settle を2回呼んでも2回目は coins を変えない」** を追加（`settleGame` 冪等性）。
- **[高] `INITIAL_WALLET` は単一の真実 `RULES.bet.initialWallet`。** Lambda 環境変数では渡さない
  （game-api module の env は `TABLE_NAME` のみ・`initial_wallet` 変数は作らない）。`gameConfig.INITIAL_WALLET` は
  `@config/rules` の `DEFAULT_RULES.bet.initialWallet` から導出（`可変数値は RulesConfig に集約` を守る）。
- **[高] エラー系テストを追加**: ④残高不足で `createGameWithDebit` → `PaymentRequiredError`(402)、
  ⑤`ownerSub` 不一致・存在しない `pk` の**両方**で `NotFoundError`(404)（区別しないことも確認）、⑥未知 `routeKey` → 404。
- **[中] `advanceToHuman` の `MAX_STEPS` 超過は例外**（→500・ログに残す）。engine のバグを黙って
  不完全な state で保存/返却しない。`MAX_STEPS` は `maxChainDeclare`（既定8）× 人数 × 局数の上限を十分に超える
  定数（例: 10_000）＝正常時は絶対に到達しない保険。
- **[中] `POST /games` の冪等性は本 Step ではスコープ外**（UI の二重送信防止は Step 6 の責務）。サーバーは
  `coins >= bet` の原子的チェックで**残高超過の引き落としは防ぐ**が、別 ULID の重複作成は弾かない。設計判断として明記。
- **[中] router の網羅性**: `type KnownRoute = 'POST /games' | 'POST /games/{id}/actions' | 'GET /games/{id}'` を定義し、
  `isKnownRoute(routeKey)` で絞り込んでから `switch (route)` を `never` default 付きで書く（未知は 404）。
- **[中] ボディ検証の置き場所**: `dto.ts` に型ガード `isCreateGameRequest` / `isApplyActionRequest`
  （`expectedVersion` が数値・`action` がオブジェクトで既知 `type`）を置き、各 `routes/*.ts` の冒頭で検証。
  不正は `BadRequestError`(400)。`parseJson` は構文（valid JSON）だけを見る。
- **[中] CORS**: dev は `["*"]` 既定のまま。`environments/prod/terraform.tfvars` に「CloudFront ドメインへ絞る」旨を
  コメントで明記（ドメインは初回 apply 後に確定するため申し送り）。
- **[低] `gameConfig` の import 元**: `RULES=@config/rules`・`ROSTER=@config/defaultRoster`・**`AI=@engine/ai`**
  （`DEFAULT_AI_CONFIG` は engine 側）。import 元が非対称な旨をコメントで残す。
- **[低] TTL**: item を毎回全置換で書くため `ttl` は書込みのたび**そのまま持ち越す**（精算後も原値を維持）。
  `TTL_DAYS` は対局が収まる十分長い値（例: 30 日）＝精算前失効を起こさない。

## リスク / 落とし穴

1. **tsconfig の composite/noEmit 衝突**: backend を root グラフに入れない（独立 `tsc --noEmit`）。
2. **PlayerView と full-GameState の形状差**: `toPlayerView` に一本化（Step 2 で担保）。backend は GameState を返さない。
3. **多段 CPU 解決 × 単一 version**: メモリ内解決 → 最終 state で 1 回だけ +1。中間保存は version 膨張の原因。
4. **JSON 往復と rules 保存**: `claims` の数値キー文字列化を前提にしない。`rules` は毎回同一を渡す。
5. **CI が Lambda コードを上書き**: `ignore_changes=[filename,source_code_hash]` で apply が CI を戻さない。
6. **ファイルサイズ**: フェーズ境界で `wc -l`。各 backend ファイル・tf を 400 行未満に保つ。
