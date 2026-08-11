# 要求: 絵札選択UI・ロン（Step 3 / UI 仕上げ）

## 背景

参照: [docs/ideas/pokajan-yaku-card-selection-plan.md](../../docs/ideas/pokajan-yaku-card-selection-plan.md)（全3ステップ・本 Step 3）
前提: **Step 1（エンジン）・Step 2（ツモ UI）完了**。`candidateFromSelection`（`src/engine/yakuSelection.ts`）が
選択 uid 集合から役を再導出し、DECLARE/CLAIM の検証がそれを使う。ツモ（`selfDeclare`）は
手札タップ→役構成→ライブプレビュー→緑のツモで確定できる。**ロン（`claimWindow`）はまだ即時ボタンのまま**。

現状、割り込み（`claimWindow`）では `ActionBar` の候補ボタンを押すと**即座にロン確定**し、
プレイヤーは「どの色の絵札を何枚使い、何を手札に残すか」を選べない。本 Step は**ロン経路**にも
カードタップによる役構成＋ライブプレビュー＋確定を導入し、絵札選択機能を完成させる。

## スコープ（今回やること）

1. **ロンの手札タップ構成**（`claimWindow`・人間が割り込める役を持つとき）: `Hand` の選択モードを
   ロンにも広げる。**捨て札（`lastDiscard`）を構成の固定要素**として扱い、残りを手札から組む。
   捨て札は他家の河で強調済み（`highlightLast`・不変）なので、手札選択には**捨て札を出さない**
   （選択状態には手札の uid だけを持ち、`lastDiscard.uid` は確定時に固定要素として合流させる）。
2. **ライブプレビュー**: 選択が作るロン役（役名＋同色＋点数）を即時表示。ツモと同じ `SelectionPreview` を共有。
3. **確定（ロン）**: 有効な役のときだけ活性化する**赤**ボタン（`button--ron`）。押下で `loop.claim(composed)`。
4. **おまかせプレフィル**: `ActionBar` の claim 候補ボタンを、押下で選択欄へ**プレフィル**（即確定しない・上書き可）に変更。
   ツモの declare と対称にする（金 `button--primary`・`おまかせ ${役名}`）。捨て札は固定要素なので選択には入れない。
5. **選択配線の `useSelection` フック抽出**（Step 2 振り返りの[推奨]）: ツモ／ロン共通の選択状態・
   `composed` 導出・リセット・確定・プレフィルを `src/ui/hooks/useSelection.ts` に集約。`TableScreen` を 400 行未満に保つ。

## スコープ外（今回やらないこと）

- エンジンの変更（Step 1 で完了。`candidateFromSelection` の `required` 規則をそのまま使う）。
- ツモ経路の挙動変更（Step 2 のまま。`SelectionPreview` に `kind` を足すのみで既定＝ツモは不変）。
- 永続化（選択は一局中の一時 UI 状態）。
- 手札タップ以外の新しい入力（ドラッグ・複数手一括など）。

## 受け入れ基準

### 機能

- [x] `claimWindow`（人間が割り込める役を持つ）で手札カードをタップすると選択がトグルし、`.card--selected` が付く。
- [x] 選択（＋固定の捨て札）が有効なロン役を作ると、プレビューに役名（＋同色）＋点数が出て、**赤のロンボタン**が活性化する。
- [x] 選択がロンにならない／空のときはロンボタンが不活性で、案内文が出る。
- [x] ロンボタン押下で `loop.claim(composed)` が呼ばれ、ロンで和了する。**選んだ手札＋捨て札そのものが消費される**
      （非正準の合法選択でロンできる＝Step 1 の再導出＋`required` 検証を通る）。
- [x] おまかせ claim 候補ボタンを押すと選択欄がプレフィルされ、そこから手動で上書きできる（即確定しない）。
      **捨て札は選択欄に入らない**（固定要素として確定時に合流する）。
- [x] `SelectionPreview` はツモ＝緑「ツモ」（`declare-confirm`）／ロン＝赤「ロン」（`claim-confirm`）を `kind` で出し分ける。

### 非破壊（既存の維持）

- [x] ツモ経路（Step 2）は不変: `selfDeclare` の選択・プレビュー・緑のツモ確定・おまかせプレフィルがそのまま動く。
- [x] `discard` フェーズのタップは従来どおり捨て札（`card` testid・`data-uid`・座標 E2E 不変）。
- [x] 375px で横スクロールが出ない・**横向き 844×390 の縦横 fit が保たれる**（ロンのプレビュー実マウント相当も検査）。
- [x] 操作ボタンの色分け（おまかせ=金／ツモ確定=緑／ロン確定=赤／見送る=ゴースト）の実描画が保たれる。
- [x] `.card--selected` は面の色クラス（`card--pink` 等）と**同時に**付く（面の色を殺さない）。ツモと同一の見た目。
- [x] 和了演出中は選択・確定できない（`canClaim` に `pendingWin === null` を含める＝キーボード経路も止める）。
- [x] `TableScreen` の抽出後も、`data-selected-count` / `data-phase` / `data-pending-claims` の観測フックが不変。

### 検証ゲート

- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` 全通過。
- [x] `npx playwright test` は直列（`--workers=1`）で全通過。フル並列は環境 flake（Step 2 T16 参照）。
- [x] 新規回帰はミューテーションで「落ちること」を確認（ロン確定活性・捨て札固定の合流・プレフィルの捨て札除外）。
- [x] `TableScreen.tsx` が 400 行未満（`useSelection` 抽出で純減）。
