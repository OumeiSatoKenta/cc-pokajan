# Step 9-3 横向きレイアウトと待ちチップ — design

## 分割: `board.css` → `center.css`

- `center.css`（新規）へ移す: 卓中央の情報集約
  `.board`(appearance) / `.board__stats` / `.board__stat dt,dd` / `.board__bonus` /
  `.board__groups` / `.board__group(-head,-name,-count,--done)` /
  `.board__members` / `.board__member(--held,-bonus)` と、その `@media (max-width:30rem)` 調整。
- `board.css` に残す: `.table`(rim) / `.table__felt` / `.table__board`(grid) /
  席配置（`.seat--top/left/right`, `.board { grid-area: center }`, `.table__mine { grid-area }`）/
  `.seat*` / `.river*` / 席まわりの `@media (max-width:30rem)` 調整。
- **`.board` は2箇所に分かれる**: 配置（`grid-area: center`）は board.css、見た目（flex/背景）は center.css。
  プロパティが重ならないので順序非依存だが、center.css は board.css の後に import する。
- import 順（`TableScreen.tsx`）: `board.css → center.css → table.css → win.css → hints.css → landscape.css`。
  landscape.css は**最後**（メディアクエリの上書きを確実に後勝ちさせる）。

## G. 待ちチップ（`hints.css` のみ）

- `.wait__list` を `display: grid` → **`display: flex; flex-wrap: wrap; gap`**（チップの並び）。
- `.wait__row` を grid 行 → **丸チップ**: `display: inline-flex; align-items: center; gap; padding;
  border-radius: 999px; border: 1px solid var(--gold-soft); background: var(--slot)`。
- 色ドットは既存の `.wait__card::before`（そのまま流用）。
- 残0: `.wait__row--dead` は既存（opacity + line-through）。design の 42% に合わせ `opacity: 0.42`。
- クラス名・DOM は不変（`WaitPanel.tsx` は触らない）。

## F. 横向き（`landscape.css`・新規）

`@media (orientation: landscape) and (max-height: 480px)`（横持ちスマホ）:

- 全体を詰める: `.table { max-width:100%; margin:.25rem auto; padding:.4rem; }`、
  `.table__felt { padding:.35rem; }`、`.table__board { gap:.35rem; }`。
- 手札を小さく: `.hand { padding-top:.6rem; }`、`.hand .card { height:3.4rem; font-size:.55rem; }`。
- 下段を2カラム化（待ち｜手札）:
  ```
  .table__mine {
    display: grid;
    grid-template-columns: minmax(0, 13rem) 1fr;
    grid-template-areas: 'head head' 'wait hand' 'river hand';
    align-items: end;
  }
  .table__mine-head { grid-area: head; }
  .wait { grid-area: wait; }
  .table__mine .river { grid-area: river; }
  .hand { grid-area: hand; }
  ```
  操作バー（`.actions`）は felt の外・下のまま compact に（`min-height` を詰める）。
  ※ 完全1レール（待ち｜手札｜操作）は DOM 再構成が要るため非対象（requirements 参照）。
- グループをドット化: `.board__member { width:.55rem; height:.55rem; padding:0; font-size:0;
  border-radius:50%; overflow:hidden; }`（名前テキストは視覚的に隠れる＝ドット。所持は既存の金背景）。
  `.board__groups`/`.board__group` は横に詰める。
- 待ちの役名列を落とす: `.wait__yaku { display:none; }`（mobile と同じ方針）。
- ヘッダーを詰める: `.table__header { padding:.1rem .3rem .3rem; }`、タイトル小さめ。

## テスト

- E2E は `tests/e2e/table.spec.ts` に追記（新規ファイルにせず `startGame`/`url`/`CLAIM_SEED` を再利用）:
  viewport 844×390 で起動し、**横スクロールが出ない**（`scrollWidth <= clientWidth`）＋
  `.table__mine` が横向きだけ 2 カラム grid になる（media query が届いた証拠）＋盤面が見えること。
  縦は**完全 fit を達成できなかった**（実測 約540px）ため、E2E は縦あふれの**回帰ガード**
  （`vOverflow <= 200`）に留める。完全 fit は横向き専用の再設計が必要（requirements 参照）。
  ※ orientation メディアクエリは viewport 比率で発火するので emulate 不要（viewport で確実に効く）。
- 分割は移設なので既存の単体・E2E がそのまま通ることが回帰の砦（`tableLayout` 等）。
- G は CSS のみ。`waitPanel.test.tsx` はクラス/挙動を見るので不変で通る。

## リスク

- **横向きの細部は目視できない**（スクショ不可）。E2E は「横スクロールなし」までしか担保しない。
  2カラム mine・ドット化の見栄えは人の確認が要る（報告で明記）。
- **分割で cascade がずれる**恐れ。プロパティが重ならない移設に留め、import 順を固定。既存 E2E で担保。
- `font-size:0` でドット化する手は、名前テキストを DOM に残す（a11y 可）。★（bonus）も隠れるが密度優先で許容。
