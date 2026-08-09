# Step 10-1 待ちのホバー/タップ展開 — design

## 全体像

`WaitPanel` を「トリガ＋フロー外オーバーレイ」の**自己完結型**に作り替え、
`.table__mine-head`（常時存在する行）へ置く。手札の上のフロー配置はやめる。

```
.table__mine
  header.table__mine-head        ← 常に存在（title / hint / 待ちトリガ）
    span.table__mine-title
    span.table__hint
    WaitPanel  → div.wait (position: relative)   ← ここに移す
                   button.wait__trigger  「待ち N件」 aria-expanded
                   div.wait__overlay (position: absolute)  ← フロー外
                     ul.wait__list > li.wait__row ...
                     p.wait__more 「他N件」
  DiscardPile (.river)           ← 位置固定（上に待ちが無くなる）
  Hand (.hand-area > .hand)      ← 位置固定
```

## なぜ自己完結（トリガに紐づくオーバーレイ）か

plan は「`.hand-area` か `.table__mine` を基準に絶対配置」を挙げるが、
**`.wait` 自身を `position: relative` の基準にしてオーバーレイを直下に開く**方式を採る。理由:

- `.table__mine` を基準に「手札のすぐ上」へ出すには `bottom` を手札高さから逆算する必要があり、
  手札高さは可変（引いた札・折り返し）で**脆い**。
- トリガ直下に開く popover は標準的で、ホバー対象と表示内容が近く分かりやすい。
- `WaitPanel` が配置場所（header か否か）に依存しなくなり、10-3 の landscape 再設計でも動く。

オーバーレイはトリガの左端そろえで**下方向**に開く（河・手札の上に重なる。フロー外なので押し出さない）。

## ちらつきをゼロにする二重の保証

1. **オーバーレイは `position: absolute`** ＝フローを占有しない（一覧の出入りで河・手札は動かない）。
2. **`.table__mine-head` に `min-height`** を与える。トリガ（テンパイ時のみ出る）の有無で
   ヘッダー行の高さが変わらないようにする。デスクトップ幅では title がヘッダー高を決めるため
   トリガを足しても実質不変だが、`min-height` で明示的に固定して座標検査を確実に通す。

## 開閉の仕組み

`WaitPanel` に `useState<boolean>` の `pinned` を持たせる。

- **覗き見**: CSS `.wait:hover .wait__overlay` で可視化（React state 不要）。
- **ピン留め**: `wait__trigger` の `onClick` で `pinned` をトグル。
  `.wait__overlay[data-open='true']` で可視化。touch はホバーが無いのでこれが主経路。
- **閉じる**: `pinned === true` のときだけ `document` に `keydown`(Escape) と
  `pointerdown`(外側) のリスナを張る（`useEffect`。クリーンアップ必須）。
  トリガ自身と `.wait` 内のクリックは外側扱いにしない（`ref.contains` で判定）。
- **`aria-expanded`** は `pinned` を反映（明示操作の状態。ホバー覗き見は反映しない
  ＝キーボード/SR 利用者の経路はクリックトグルで、そこが `aria-expanded` に対応する）。

### CSS の可視制御

```css
.wait__overlay { display: none; position: absolute; ... }
.wait:hover .wait__overlay,
.wait__overlay[data-open='true'] { display: block; }
```

**`display: none` を使う（`visibility: hidden` にしない）。** 絶対配置でも
`visibility: hidden` はレイアウトに残り、幅の広いオーバーレイが**横スクロール域**を広げて
横向き E2E の `hOverflow <= 1` を壊しうる。`display: none` はレイアウトから外れるので安全で、
Playwright の `toBeVisible()` にも一致する（none↔block で判定が反転する）。
親 `.wait` の `:hover` は常時描かれるトリガに乗るので覗き見は成立する。

## z-index

- `.card-counts`（残枚数ツールチップ）は `z-index: 5`、手札の上に**上方向**へ出る。
- `.wait__overlay` はヘッダー直下から**下方向**へ出る。領域が異なり通常は重ならないが、
  同時表示に備え `.wait__overlay` は `z-index: 6`（ツールチップより前面）にする。
  どちらも `pointer-events` を持つのは可視時のみ。

## 不変ロジック（触らない）

`sortRows`（生存優先→点数降順・安定）/ `maxRows`（既定6）/ `hidden`（他N件）/
残0 判定（`unseenOf` → `remaining === 0` → `wait__row--dead` ＋ `data-unseen`）は現状のまま。
オーバーレイの中身は現在の `ul.wait__list` をそっくり移すだけ。

## 変更ファイル

- `src/ui/components/WaitPanel.tsx`
  - 返り値をトリガ＋オーバーレイ構造に。`useState`/`useRef`/`useEffect` を追加。
  - `data-testid`: 既存 `wait-panel` は `.wait` ルートに維持。
    追加で `wait-trigger`（button）/ `wait-overlay`（div）。`wait-row` / `wait-more` は不変。
  - オーバーレイ id を `aria-controls` と結ぶ（`WAIT_OVERLAY_ID`）。
- `src/ui/screens/TableScreen.tsx`
  - `<WaitPanel>` を `.table__mine-head` 内（hint の後）へ移動。head と river の間の常時配置を削除。
- `src/ui/hints.css`
  - `.wait` を relative 基準の inline 要素に。`.wait__trigger`（金枠チップ）・
    `.wait__overlay`（絶対配置の器）を追加。既存 `.wait__row` 系（丸チップ・残0）は流用。
  - 旧 `.wait { margin-bottom; padding; border; background }`（フロー内パネルの見た目）を
    トリガ/オーバーレイ側へ再配分。
- `src/ui/table.css`
  - `.table__mine-head { min-height }` を追加（ちらつき保証）。
- `src/ui/landscape.css`
  - `.table__mine .wait { grid-area: wait }` は `.wait` が head 配下へ移り**直接の grid item で
    なくなる**ため無効化される。grid の `wait` 行を撤去し `'head head' / 'river hand'` に。
    待ちオーバーレイの `.wait__list { nowrap; overflow-x }` は残す（オーバーレイ内で有効）。
- `tests/ui/waitPanel.test.tsx`
  - 新構造に追随。**不変条件（並び・残0・6件上限・出す条件）は引き続き検査**。
    追加で「トリガが出る」「`aria-expanded='false'` の初期状態」「オーバーレイ内に一覧がある」を固定。
    ※ 開閉/ホバー/Escape は DOM イベントが要るため E2E で担保（node 環境・jsdom 無し）。
- `tests/e2e/table.spec.ts`
  - テンパイ到達（`playUntil` で `wait-trigger` 可視を待つ）→
    (a) テンパイ前後で手札の Y が不変、(b) トリガ click で `wait-overlay` が可視、
    (c) Escape で閉じる、を1〜2件追加。

## 付随

- `tmp-design.zip` を削除（`rm`）。

## テスト戦略（「壊したら落ちる」を作る）

- **手札位置不変**: テンパイ前の手札 top を記録 → テンパイ到達後の top と比較（差 ≤ 1px）。
  もし待ちをフロー内に戻す（＝バグ再発）と top が下がって落ちる。
- **開閉**: overlay の可視は `display: none ↔ block` で制御するため、Playwright の `toBeVisible()`
  が使える（`display: none` の要素は `getClientRects()` が空になり不可視と判定される）。
  click → visible、Escape → hidden。
- **展開中の横あふれ**: 開いた状態で `document.documentElement.scrollWidth - clientWidth <= 1` を実測。
  オーバーレイの幅指定ミス（`min-width: max-content` が `max-width` に勝つ等）を捕まえる。

## Escape とホバー覗き見の関係（仕様）

Escape はピン留め（`pinned`）だけを解除する。**マウスがトリガ/オーバーレイに乗ったままなら
CSS の `:hover` 覗き見が続くため、見た目は開いたまま**になる（`data-open` は false、
`aria-expanded` も false）。これは覗き見がポインタに追従する正しい挙動で、ポインタを外せば閉じる。
E2E はこの現実的な流れに合わせ、Escape の前にマウスを外す。

## リスク

- **ヘッダー折り返し（狭幅）**: 375px でトリガを足すと head が 2 行に折れ得る。ちらつき検査は
  デスクトップ幅（既定 1280×720・折り返し無し）で行う。狭幅の完全固定は 10-3 の範囲。
- **landscape の `wait` セル撤去**が横向き E2E（`hOverflow ≤ 1` / `.table__mine` grid / `vOverflow ≤ 200`）
  を壊さないこと。待ちがフロー外になる分 vOverflow は下がる方向。E2E で確認。
- **ピン留めの局またぎ残留**: `WaitPanel` は局をまたいで同一インスタンスで使い回されるため、
  テンパイ崩れ（`waits.length === 0`）で `pinned` を明示リセットしないと、再テンパイで
  無操作のままオーバーレイが開いて復活する。`useEffect([waits.length])` で解除する。
