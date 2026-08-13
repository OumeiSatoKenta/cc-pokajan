# タスクリスト: AWS デプロイ Step 2 — engine 純粋ロジック抽出

## 事前

- [x] ベースライン確認: `npm test`=45 files/840 tests、`npx playwright test`=90 passed

## 実装

- [x] T1: `src/engine/playerView.ts`（`PlayerSummary`/`PlayerView`/`ClaimStatus` 型・`toPlayerView(state, seat)`。seed/rngState/wall/他家 hand 除外・claims を ClaimStatus に redact・範囲外 seat で RangeError）
- [x] T2: `src/engine/autoAction.ts`（`CpuAction`・`claimableFor`/`declarableFor`/`pendingCpuClaimIds`/`nextCpuAction`。UI から逐語移設＋humanSeats 一般化）
- [x] T3: `src/ui/hooks/autoAction.ts` 改修（decideAutoAction→nextCpuAction 委譲＋delayFor、claimableFor/declarableFor を re-export、countPendingCpuClaims を委譲。autoActionKey/Delays/DELAYS/NO_DELAYS/EVENT_HOLD_MS 維持）
- [x] T4: `tests/engine/playerView.test.ts`（redaction 構造・初期局面 leak オラクル・claimWindow CLAIM leak オラクル・RangeError）
- [x] T5: `tests/engine/nextCpuAction.test.ts`（全 CPU 差分オラクル=autoplay 一致・人間経路[0]・複数人間[0,1]）
- [x] T6: 型で TICK 除外（`CpuAction`）・claims を `ClaimStatus` に redact・両 autoAction ファイル冒頭に相互参照/役割コメント
- [x] T7: 計画コマンド doc の Step 2 を `toPlayerView(state,seat)`＋claims redact に更新

## 検証

- [x] V1: 既存 `tests/ui/autoAction.test.ts` が無改修で緑（decideAutoAction 等の挙動不変・25 tests）
- [x] V2: 既存 `tests/engine/autoplay.test.ts`（100 局不変条件）が無改修で緑
- [x] V3: `npm run lint && npm run typecheck && npm test（47 files/853）&& npm run build && npm run format:check` PASS
- [x] V3b: `wc -l`＝playerView 125 / engine autoAction 152 / ui autoAction 156（いずれも 400 行未満）
- [x] V4: `npx playwright test` 緑（90 passed・ローカル挙動不変）
- [x] V5: ミューテーション確認（view.hand に全員の手札を混ぜると leak オラクルが3件 fail / `!includes`→`includes` 反転で差分オラクル+既存 autoAction が5件 fail→revert 済み）

## レビュー反映タスク（実装後 3軸+validator+doc-reviewer）

- [x] R1: [必須] `toPlayerView` の seat 検証を `Number.isInteger` 明示検証に統一（プロトタイプキー/文字列添字の穴）＋回帰テスト（ミューテーション実測）
- [x] R2: [推奨] `toClaimStatus` に `satisfies YakuCandidate` の網羅性ガード（redaction 境界を型で守る）
- [x] R3: [中] `claimableFor` の暗黙依存（undefined=捨て札本人 / 表明済み 両方弾く）にコメント
- [x] R4: [推奨] テストを `tests/engine/autoAction.test.ts` に改名し claimableFor/declarableFor/pendingCpuClaimIds を engine 直接検査＋複数人間「役あり→null」追加
- [x] R5: [推奨] 計画コマンド doc L89 の `toPlayerView(state,seat,rules)` → `(state,seat)`
- [x] R6: [推奨] `docs/repository-structure.md`（engine 一覧に playerView/autoAction）・`docs/architecture.md`（情報遮断パターンに PlayerView 追記）

## 振り返り（実装完了: 2026-08-12）

**計画と実績の差分**:

- 計画どおり engine 純ロジックの追加/抽出で完結。既定 `github-pages` の対局挙動は不変（既存 `autoAction.test.ts`・
  100 局不変条件・E2E 90 が無改修で緑）。
- 最終ゲート: lint / typecheck / **test 47 files・860**（起点 840 から +20）/ build / format:check / **E2E 90** すべて緑。
- 実装後レビューで **1件の [必須]**（`toPlayerView` の暗黙 seat 検証がプロトタイプ由来キーを素通り）を検出・是正。
  事前の doc-review でも **1件の [必須]**（`claims` 経由の他家カード漏洩）を実装前に是正しており、redaction の穴を
  2段階（設計時＋実装後）で塞いだ。

**学んだこと**:

- **型で redaction したつもりでも実行時境界は別**。`toPlayerView` の `seat` は Step 5 でネットワークから来るため、
  「TypeScript の number 型」に頼った暗黙 index 判定はプロトタイプキーを通す。境界検証は `toAiView` と同じ明示検証に揃える。
- **差分オラクルは独立参照が命**。`autoplay.ts` の `nextAction` を「あえて共通化せず別実装のまま」残したことで、
  `nextCpuAction` の全 CPU 一致検査が空虚な自己比較にならず、別実装どうしの突き合わせとして機能した。
- **redaction 境界の網羅性は型で固定**（`ClaimStatus` 変換に `satisfies`、`CpuAction` で TICK 除外）。将来の変種追加を compile で捕まえる。

**次回への申し送り**（design.md 末尾に詳細）:

- Step 6: `PlayerView.claims` は `ClaimStatus`（null なし）。`GameState.claims === null` 判定の載せ替えには専用純関数が要る。
- Step 5: `humanSeats` と `players[].isCpu` の整合を境界で assert。シリアライズ前に共有配列の freeze/コピーを検討。
- **未コミット**: Step 1 と Step 2 の変更が同一作業ブランチ（`feature/20260811-aws-step1-base-switch`）に**スタック**している。
  PR は Step 単位で分けたい場合、ship-pr でコミットを分割すること。
