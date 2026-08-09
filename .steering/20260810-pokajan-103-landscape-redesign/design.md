# Step 10-3 横向き専用レイアウト再設計 — design

## DOM 再構成（TableScreen）

`.table__mine`（手札ブロック）と `.actions`（操作バー）を **`.table__controls`** で包み、
それを `.table__board` の `bottom` グリッドエリアに置く。**`.actions` を felt の外から felt 内へ移す**
のが要点（第2稿も操作エリアは felt 内・手札の右）。

### before（現状）

```
.table (flex column)
  TableHeader
  .table__felt
    .table__board (grid: top / left|center|right / bottom)
      ...opponents, BoardCenter...
      .table__mine            ← grid-area: bottom
  .actions (ActionBar)        ← felt の外
  overlays
```

### after

```
.table (flex column)
  TableHeader
  .table__felt
    .table__board (grid: top / left|center|right / bottom)
      ...opponents, BoardCenter...
      .table__controls        ← grid-area: bottom（新ラッパ）
        .table__mine          （head / river / hand）
        .actions (ActionBar)
  overlays
```

- **`.table__mine` は位置も内部構造も変えない**（felt 内・opponents の下のまま）。座標 E2E は不変。
- **`.actions` だけが felt 外 → felt 内下段へ移動**（設計準拠。視覚変化は許容範囲）。
- 縦（portrait）: `.table__controls { display: flex; flex-direction: column }` で mine → actions の
  現状の積み順を保つ。
- 横（landscape）: `.table__controls { flex-direction: row }` で [mine | actions] のレール。

## CSS

### board.css

- `.table__mine { grid-area: bottom }` を **`.table__controls { grid-area: bottom }`** に置換。
- `.table__controls { display: flex; flex-direction: column; gap: 0.75rem; min-width: 0 }`（縦の既定）。
  ※ 現状 `.table` の gap（0.75rem）で felt と actions が離れていた分を、controls 内 gap で保つ。
- портrait mobile query（`max-width:30rem` portrait）の areas は `bottom` のまま（中身が controls に変わるだけ）。

### landscape.css（`@media (orientation: landscape) and (max-height: 480px)`）

1. **app__header を横向きの対局画面でだけ視覚的に畳む**（卓の外の約51px を回収）:
   `.app[data-screen='table'] .app__header { <sr-only> }`（`App.tsx` に `data-screen` を追加）。
   **`display: none` にしない・スコープする**（理由は下記「3軸レビューで直した点」）。
2. **下段レール**:
   ```
   .table__controls { flex-direction: row; align-items: flex-start; gap: 0.4rem; }
   .table__controls .table__mine { flex: 1 1 auto; min-width: 0; }
   .table__controls .actions { flex: 0 0 auto; width: 9.5rem; min-height: 0;
                               max-height: 6.5rem; overflow-y: auto; }
   ```
   `.table__mine` は 2 カラム（`'head head' / 'river hand'`）を維持（10-1 で `wait` セル撤去済み）。
   **`align-items: flex-start` ＋ actions の `max-height`＋スクロール**が要点（理由は下記）。
3. **他家席の簡略化**: 既存の縮小（伏せ札・河・ドット化）に加え、seat の padding/gap・手札カード高さを
   E2E 実測で削る（mine 117 / seatLeft 99 / seatTop 84 が主対象）。
4. `.actions` はレール右で縦にボタン＋タイマー。`.button.button--*` の compact 上書き（10-2 で複合クラス化）
   はそのまま効く。

### 高さの見積り（fit までの道筋）

現状 vOverflow 106。app__header 隠し（−約51）＋ actions を mine と同じ行に畳む（下段が
`mine + actions` 縦積み → `max(mine, actions)` へ、−約69）で合計 −約120。**理論上 fit（余裕約14px）**。
足りなければ seat/mine の padding・カード寸法を E2E 実測で削る。

## テスト

- **landscape E2E を fit に強化**（`tests/e2e/table.spec.ts`）:
  - 844×390 で `hOverflow <= 1` かつ **`vOverflow <= 1`**（9-3 の `<= 200` を fit に戻す）。
  - 横向きレイアウトが発火した証拠を **`.table__controls` が `flex-direction: row`** で確認
    （9-3 は `.table__mine` の grid だったが、判定対象を新ラッパに移す。media query 不達の偽陽性を防ぐ）。
  - app__header がレイアウト上の高さを持たない（`boundingBox().height <= 1`）＋ **heading が 0 件でない**
    （sr-only で残す）ことを確認。
  - **操作ボタンが多い局面の縦あふれ回帰ガード**: `.actions` にボタンを4個注入しても `vOverflow <= 1`。
- **他画面スコープ**: 横向きのタイトル画面で app__header が高さを保つ（畳み込みが対局画面限定であること）。
- **座標 E2E**（他家=上/左/右・自分=下）: `.table__mine` は bottom エリアのままなので不変。
- **375px E2E**: 1列積み・横スクロール無し・伏せ札横並び。`.table__controls` が bottom に入るだけなので不変。
- 実装は E2E の高さ実測ループ（一時計測 → 詰め → 本テスト）で進める（9-3 の手法）。

## 3軸レビューで直した点（全緑の裏の実バグ）

- **[必須] 宣言候補が多い局面（3〜4ボタン）で縦あふれ復活**: `.actions`（幅9.5rem）が縦に伸び、
  `align-items: stretch` が手札ブロックまで引き伸ばして行高＝操作バー高になっていた（seed により +19〜56px）。
  → `align-items: flex-start` にして行高は手札ブロックが決め、`.actions { max-height: 6.5rem; overflow-y: auto }`
  でバー内スクロール。ハーネスで controls=110（=mine）・actions=104・scrollHeight174 を確認。
- **[必須] app__header 隠しが全画面グローバルに漏れ**、横向きでタイトル画面の見出しが 0 件に（a11y）。
  → `.app[data-screen='table']` にスコープ＋`display:none` でなく **sr-only**（h1 を支援技術に残す）。
- **[必須] 強化 E2E が初期状態しか見ず多ボタンを検出できず** → ボタン注入の回帰ガードを追加。

## 既知の制限（正直に据え置き）

- **fit は 844×390 で担保**。より狭い横向き（iPhone SE 568×320 等）は seat 見出しの折り返し等で
  なお数十pxあふれる（要求は 844×390。全端末幅の完全対応は範囲外＝将来の per-width チューニング）。
- **`max-height: 480px` の帯の外**（横長・高さ 481px 以上）は横向き圧縮も縦積みも効かず無圧縮グリッド。
  横持ちスマホの想定外（デスクトップ縦縮め等）で、通常のページスクロールになる。
- 多ボタン時は操作バー内スクロール（価値の高い候補が先頭。見送るは末尾＋時間切れ自動見送りもある）。

## リスク（対応済み）

- DOM 再構成の portrait/デスクトップ影響 → 座標 E2E・375px で積み順を担保。視覚は第2稿準拠。最終目視はユーザー。
- landscape.css の後勝ち → `.seat`/`.button.button--x`/`.app[data-screen]` を挟む既存の手で回避。
