# 要求: AWS デプロイ Step 5 — backend サーバー権威コア（Lambda + DynamoDB）

## 背景

Step 1〜4 で monorepo 土台・engine 純粋ロジック抽出（`toPlayerView` / `nextCpuAction`）・
静的配信（S3+CloudFront+OIDC）・Cognito 認証がそろった。現状 GameState はブラウザ内で完結している。

Step 5 は **GameState の真実を DynamoDB に移し、Lambda 上で `src/engine` を共有して対局を進める**
サーバー権威コアを作る。クライアントは Action だけを送り、サーバーは PlayerView（自分の手札＋公開情報）だけを返す。
これが「サーバー側の修正対応」の本体であり、`localStorage` 改竄では精算に影響できないことを担保する。

**参照計画**: [docs/ideas/cc-pokajan-aws-deployment-plan-revised.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised.md)
（Phase 3 = server 部分）。本 Step は **Step 2・3・4 完了前提**、範囲は **backend + infra + deploy 配線のみ**。
フロントの transport seam / remote 化 / wallet 読み出しは **Step 6**（本 Step では触らない）。

## スコープ（今回やること）

1. **backend ワークスペース `@pokajan/game-api`** を実体化する。
   - deps: `@aws-sdk/client-dynamodb` / `@aws-sdk/lib-dynamodb` / `ulid`、dev: `esbuild` / `@types/aws-lambda`。
   - 独立 `tsconfig.json`（root の `tsc -b` グラフに入れない）で `paths` を `@engine/* → ../src/engine/*`・
     `@config/* → ../src/config/*` に張る。
   - `esbuild` で node22 / esm / arm 向け **単一バンドル**（`external: ["@aws-sdk/*"]`＝Lambda ランタイム同梱）。
2. **単一 HTTP API Lambda に内部ルーティング**で3エンドポイントを実装する。
   - `POST /games`（新規対局・BET 差引）
   - `POST /games/{id}/actions`（人間 Action 適用 + CPU 解決 + 楽観ロック保存）
   - `GET /games/{id}`（現在の PlayerView 再取得＝409 後の再同期）
3. **`src/engine` を `@engine/*` で共有**する（Step 2 の `toPlayerView` / `nextCpuAction` を含む）。
   RNG を再実装せず、`createGame` / `reduce` / `nextCpuAction` / `computePayout` を **そのまま呼ぶ**。
4. **DynamoDB を GameState の真実**にする。1ゲーム=1item・単一テーブル（PK のみ）。
   - `version` 楽観ロック: `ConditionExpression version = :expected`、**人間 Action + CPU 複数手を
     メモリ内で解決し切ってから 1 回だけ +1 書込み**。競合は `ConditionalCheckFailed` → **409**。
   - 返すのは **PlayerView**（`wall` 中身・他家 `hand`・`seed`/`rngState` を含めない）。
5. **wallet を USER#sub item にサーバー権威化**する。
   - `POST /games` で BET を差引（残高不足は拒否）。
   - `gameOver` 遷移時に `computePayout` で精算し **gross を加算**（BET は差引済み）。二重精算は `status` で防ぐ。
6. **infra/modules/{dynamodb,game-api}** を作成し environments へ配線する。
   - `dynamodb`: PK `pk` の単一テーブル（オンデマンド課金・SSE・TTL 属性）。
   - `game-api`: HTTP API + **Cognito JWT authorizer**（issuer/audience は Step 4 の cognito outputs）+
     Lambda（node22 / **arm64**）+ 最小 IAM + CloudWatch Logs（保持期間）。
7. **`deploy-aws.yml` に backend esbuild + Lambda デプロイを追加**する。
   - build ジョブ（AWS クレデンシャル無し）で esbuild バンドル → zip → artifact。
   - deploy ジョブ（OIDC）で `aws lambda update-function-code`。bootstrap の deploy ロールに
     `lambda:UpdateFunctionCode`（当該関数のみ）を追記。

## 受け入れ基準

- **ローカル検証**（本 Step で機械的に担保する範囲）:
  - backend の `tsc --noEmit` が通る（独立 tsconfig・root グラフ不変）。
  - backend ユニットテスト: **(a) 楽観ロック競合が 409 になる**、**(b) 保存後の version がちょうど +1**、
    **(c) レスポンス（`view` **と** `events`）に他家手札・`wall` 中身・`seed` が一切含まれない（redaction）**、
    **(d) 残高不足で `POST /games` が 402**、**(e) 他人/不存在の対局が 404（区別しない）**、**(f) 未知ルートが 404**、
    **(g) 精算は一度だけ（二重 settle で coins が二重加算されない）**。いずれも「わざと壊すと落ちる」ことを確認する。
  - ※ **`events` の redaction は engine の純関数 `redactEvents`（`src/engine/playerView.ts` に追加）** が担う
    （`CardDrawn`/`Refilled` の他家分を除外）。engine への追加はこの1関数のみで既存は不変。
  - `terraform fmt -check` クリーン + 3 root（bootstrap/dev/prod）`validate` Success。
  - **既存フロントゲート一式（lint / typecheck / test / build / format:check）と E2E が無変更で緑**。
    engine・UI・既存 100 局テストは挙動不変（backend は別ワークスペースで隔離）。
- **AWS 実機検証**（ユーザー手作業・本 Step のコードで到達可能にする）:
  - dev へ apply 後、JWT 付き `curl` で `POST /games` → `POST /actions`（ツモ/捨て/ロン）→ サーバー算出の
    PlayerView が返り、同一 `expectedVersion` の二重送信の一方が 409。
  - レスポンスに他家手札・山札中身が含まれない。BET/精算がサーバー値で増減し、`localStorage` 改竄が効かない。

## やらないこと（スコープ外）

- フロントの `useGameLoop` / `appReducer` の transport 差し替え・remote 化・wallet 読み出し（**Step 6**）。
- マルチプレイ・リアルタイム（AppSync）・画像共有（Phase 4〜）。
- カスタムルール/ロスターのサーバー受け入れ（サーバーは**既定 rules/roster を権威**として使う。
  クライアント指定 rules は anti-cheat の観点で受け付けない）。
- `main` への push 連動 AWS 自動デプロイ（`deploy-aws.yml` は当面 `workflow_dispatch` のまま）。

## 制約（CLAUDE.md 由来・本 Step で必ず守る）

- **engine は無変更**（React/config/Date/Math.random 非依存を保つ）。backend は engine を**読むだけ**。
- **可変数値は RulesConfig 経由**。サーバーの精算も `computePayout(finalScore, bet, rank, rules)` を共有し再実装しない。
- **判別共用体は switch + never 網羅**（router の routeKey・action 種別・状態遷移）。
- **不正入力を黙って無視しない**（不正 Action → 400、未知ルート → 404、残高不足 → 402、競合 → 409）。
- **他家手札への到達経路を型として存在させない**（返却は `PlayerView` のみ。`GameState` を直接返さない）。
- **金額を黙って返さない**（`computePayout` は不正入力で例外。二重精算は `status` ガード）。
