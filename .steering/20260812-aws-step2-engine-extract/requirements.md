# 要求: AWS デプロイ Step 2 — engine 純粋ロジック抽出（playerView / nextCpuAction）

## 背景

[cc-pokajan-aws-deployment-plan-revised.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised.md) の Step 2。
AWS には触れない **engine 層の純粋ロジック追加/抽出**で、Step 5（backend サーバー権威）と Step 6（フロント
transport seam）の**両方が共有する基盤**を用意する。**ローカル挙動は不変**（既定 `github-pages` の対局は一切変わらない）。

## スコープ（Step 2 範囲のみ）

1. **`src/engine/playerView.ts`（新規）**: `toPlayerView(state, seat): PlayerView` を実装する。
   `toAiView`（`ai.ts`）/`toVisibleCards`（`unseen.ts`）に倣い、**他家の手札・山札の中身・seed を絶対に含めない redaction**。
   他家は `handCount` のみ、山札は `wallCount` のみ。自分の手札だけ `hand` に入る。
2. **`src/engine/autoAction.ts`（新規・engine）**: UI の `decideAutoAction` の**判断ロジック**を純関数
   `nextCpuAction(state, rules, ai, humanSeats): Action | null` として engine に切り出す。あわせて、判断に必要で
   純粋な `claimableFor` / `declarableFor` / `pendingCpuClaimIds` も engine に移す。
3. **`src/ui/hooks/autoAction.ts`（改修）**: `decideAutoAction` は engine の `nextCpuAction` に**委譲**し、演出遅延
   （`delayMs`）だけを付ける薄いアダプタにする。`claimableFor`/`declarableFor` は engine から re-export、
   `countPendingCpuClaims` は engine の `pendingCpuClaimIds` に委譲。**公開シンボルとその型は現状維持**（消費側は無改修）。
4. **テスト（新規）**: `tests/engine/playerView.test.ts`（redaction 不変条件・leak オラクル）、
   `tests/engine/nextCpuAction.test.ts`（全 CPU 差分オラクル＝autoplay との一致・人間経路の分岐）。**わざと壊して落ちる**ことを確認。

## 受け入れ基準

- `toPlayerView(state, seat)` は自分の手札のみを含み、**他家の手札 uid・山札 uid・seed が JSON に一切現れない**。
- `nextCpuAction(state, rules, ai, [])`（全 CPU）が、既存 `autoplay.ts` の `playGameToEnd` の**アクション列と完全一致**する
  （seed 0〜N の差分オラクル）。
- 既存 `tests/ui/autoAction.test.ts`（decideAutoAction/claimableFor/declarableFor/countPendingCpuClaims/autoActionKey）が
  **無改修で緑**。既存 100 局不変条件テスト（`autoplay.test.ts`）も無改修で緑（＝ローカル挙動不変）。
- 検証ゲート `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` PASS ＋ `npx playwright test` 緑。

## 非スコープ（後続ステップ）

- `useGameLoop` を PlayerView から駆動する改修・transport seam は **Step 6**。
- backend / DynamoDB / 楽観ロックは **Step 5**。
- `autoplay.ts` の private `nextAction` は**触らない**（`nextCpuAction` の差分オラクルの**独立参照実装**として温存する）。

## 制約

- **engine 層は React/config/storage/ui を import しない**（`.oxlintrc.json` が機械強制）。移す関数はすべて engine import のみ。
- **`autoAction` の公開 API（シンボル名・シグネチャ）を壊さない**（`useGameLoop.ts` と `tests/ui/autoAction.test.ts` が依存）。
- **`GameState` に `version` は無い**（version は Step 5 の DynamoDB 側で付ける）。engine の `PlayerView` に version は含めない。
