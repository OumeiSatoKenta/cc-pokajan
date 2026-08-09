# Step 9-1 カジノ風テーマの全面刷新 — requirements

## 背景

外注デザインの第2稿（`ポカジャン 対局画面 第2稿.dc.html`）を反映する 3 段（9-1〜9-3）の
最初のステップ。全体計画は [docs/ideas/pokajan-casino-table-redesign-plan.md](../../docs/ideas/pokajan-casino-table-redesign-plan.md)、
コマンド分割は [docs/ideas/pokajan-casino-table-redesign-add-feature-commands.md](../../docs/ideas/pokajan-casino-table-redesign-add-feature-commands.md)。

本ステップ（9-1）は **A テーマ本体・B カード裏・C 待ち札強調** と、
その受け皿となる**木縁・羅紗のラッパ要素**の追加まで。河5枚（D）・ヘッダー（E）・
横向き（F）・待ちチップ（G）は 9-2 / 9-3 で扱う。

## 要求

1. **共通テーマ変数の差し替え（全画面）**: `src/index.css` の `:root` と
   `@media (prefers-color-scheme: light)` を、木縁＋羅紗＋金基調に差し替える。
   値は第2稿の `THEMES.dark` / `THEMES.light` を一次資料とする。
2. **卓を木縁＋羅紗に見せる**: `TableScreen` に木縁ラッパ（`.table`＝rim）と
   羅紗ラッパ（`.table__felt`）を用意し、盤面（`.table__board`）を羅紗の上に置く。
3. **カード裏を赤斜線に**（B）。
4. **待ち札の強調を白熱色（#ffe58a）＋外側グロー＋恒常的な持ち上げ**にする（C）。
   **カード面の色（桃/青/橙）は絶対に塗り替えない**（同色役の判定情報）。
5. **全画面波及**: `--accent`（ピンク→金）等の変更がタイトル/BET/精算/設定/精算にも及ぶ。
   他画面のパネルが読めなくならないこと。

## 受け入れ基準

- 卓が木縁＋羅紗＋金基調に見える。カード面の桃/青/橙が判別できる。
- 待ち札が白熱色＋グロー＋持ち上げで強調され、**面の色が残っている**。
- カード裏が赤斜線。
- タイトル/BET/精算/設定画面も金・羅紗基調に統一され、パネルとテキストが読める。
- ライトテーマでも破綻しない。
- 既存の自動ゲート（lint / typecheck / test / build / format:check）と E2E が通る。
  特に**4方向配置・河の座標検査**（`tests/e2e/table.spec.ts`）が維持される。

## 非対象（このステップでやらないこと）

- 河の直近5枚固定・件数ラベル・直前札の強調（→ 9-2）
- ヘッダーの連続和了ピップ・BET・`App.tsx` の `bet` 配線（→ 9-2）
- 横向きレイアウト・待ちチップの丸チップ化（→ 9-3）
- 手札を「羅紗ではなく木縁の上」に移す構造変更（→ 将来のpolish。9-1 では手札は羅紗上のまま）

## 制約

- **エンジン層（`src/engine/`）は触らない。** `.oxlintrc.json` の `no-restricted-imports` に触れる変更をしない。
- `Math.random()` / `Date` を使わない（本ステップは CSS/JSX のみなので該当なし）。
- 既存の `data-testid` / `aria-label` / `grid-template-areas` の名前と構造を壊さない。
