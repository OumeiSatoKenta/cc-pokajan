# 要求: 絵札選択エンジン（Step 1 / エンジン層のみ）

## 背景

参照: [docs/ideas/pokajan-yaku-card-selection-plan.md](../../docs/ideas/pokajan-yaku-card-selection-plan.md)

ポカジャンの宣言（ツモ）／割り込み（ロン）は現在、`YakuCandidate` を `reduce` に渡し、
`verifyCandidate`（`src/engine/claims.ts`）が **`findYaku` の列挙候補と uid 集合が完全一致**する
かで受理を決める。`findYaku` はカードを決定的に自動選択（triple は `slice(0,3)`、group は各メンバー
先頭一致）するため、**正準の uid 組み合わせ以外は弾かれる**。結果、プレイヤーが「どの色の絵札を
何枚使い、何を手札に残すか」を選べない。

本ステップ（Step 1）は 3 段階計画の第1段で、**エンジン層だけ**を対象とする。UI は一切変更しない。

## スコープ（今回やること）

1. `src/engine/yaku.ts` に純関数 `candidateFromSelection` を追加する。
   - 選択された uid 集合（＋ロンでは必須の捨て札 `required`）から、役種・同色・ボーナス・点数を
     **再導出**する。列挙（`findYaku`）ではなく、プレイヤーが選んだカードそのものから役を決める。
2. DECLARE / CLAIM の検証を「`findYaku` 列挙との uid 一致」から「**選択カードからの再計算**」へ差し替える。
   - 単一検証点として `verifyCandidate`（`src/engine/claims.ts`）を再計算式へ統一する（計画の推奨 (i)）。
   - `applyDeclare`（`src/engine/win.ts`）と `case 'CLAIM'`（`src/engine/game.ts`）の呼び出しを更新する。
3. `findYaku` / `bestYaku` / `computeWaits` は**列挙用として維持**（AI・待ち計算・おまかせ候補が使う）。

## スコープ外（今回やらないこと）

- UI（`Hand.tsx` / `CardView.tsx` / `TableScreen.tsx` / `ActionBar.tsx` / CSS）— Step 2・3 で扱う。
- 新しい型の追加（`YakuCandidate` をそのまま使う）。
- 永続化（選択は一時的な UI 状態。エンジンは純関数追加のみ）。
- `SelectionPreview.tsx` などの新規 UI ファイル（Step 2）。

## 受け入れ基準

### 機能

- [ ] `candidateFromSelection(hand, selectedUids, ctx)` が有効な triple / groupN の選択で
      正しい `YakuCandidate` を返す。
- [ ] **正準以外の合法選択**（同一メンバー4枚のうち別の3枚など）を受理する
      （＝「絵札を選べない」の根本原因の解消）。
- [ ] 色の取り方で役種・同色・点数がライブに変わる（混色 → 同色で点数が上がる）。
- [ ] 未所持 uid・枚数過不足・重複 uid・役にならない組み合わせは `null`。
- [ ] ロン（`required` あり）: 選択に `required` を含み、かつ同シグネチャの役が
      `hand \ {required}` では成立しない場合のみ有効。それ以外は `null`。
- [ ] DECLARE / CLAIM が選択の再導出で検証され、非正準の合法選択も通る。

### 安全性（既存と同値を維持）

- [ ] 点数偽装不可（再計算した点数を採用する）。
- [ ] **役種・同色可否の偽装不可**（`cards` の uid 集合以外の全フィールド＝`kind`/`sameColor`/
      `bonusCount`/`score` は無視し再計算する）。※レビュー [推奨] で明文化。
- [ ] 未所持カードでの宣言不可（uid 解決が `null`）。
- [ ] 不要牌ロン不可（`required` 規則）。`required` が `hand` に無い誤用は `RangeError`（`findYaku` と対称）。
- [ ] 役の形をしていない入力は `IllegalActionError`（素の `TypeError` にしない）。

### 不変条件（壊さない）

- [ ] `tests/engine/autoplay.test.ts`（100 局・点数保存則・カード保存則・手札枚数）が不変。
- [ ] AI が渡す候補（`bestYaku(findYaku(...))`）はすべて合法選択なので従来どおり受理される。
- [ ] エンジンは `Math.random` / `Date` / React / `src/config/` に依存しない（`npm run lint` が検知）。

### 検証ゲート

- [ ] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が全通過。
- [ ] 新規回帰テストはミューテーション（実装をわざと壊す）で「落ちること」を確認する。
