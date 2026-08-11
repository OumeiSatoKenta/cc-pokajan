# 設計: 絵札選択UI・ツモ（Step 2）

## レビュー反映（Step 4.5・doc-reviewer 3.6/5）

初稿は「`SelectionPreview` を `.table__mine` 内・ヘッダーの下に置く」だったが、doc-reviewer が
**[必須]**「横向き `landscape.css` の `.table__mine` は `display:grid`（`head head / river hand`）で、
兄弟要素として挿入すると grid-area の無い暗黙配置に落ち 844×390 の縦 fit を壊す」を指摘。是正:

- **配置変更**: `SelectionPreview`（プレビュー文言＋緑のツモ確定）を **`ActionBar` の中（`.actions`）** に置く。
  `.actions` は横向きで `max-height: 6.5rem; overflow-y: auto` の高さ保護を持つため、そこへ相乗りする。
  `.table__mine` の grid は**一切増やさない**（[必須] 問題1 解消）。`TableScreen` は `canSelect` のとき
  `selection={{ composed, selectionCount, onConfirm }}` を `ActionBar` に渡すだけ（問題4 の配置決定）。
- **おまかせボタンは新 `.button--auto` を作らず既存 `.button--primary`（金）を流用**（[必須] 問題2・[中] 問題6 を
  同時に回避＝新規ボタン CSS 不要・`table.css` 不変。`table.css` は 395 行のまま）。確定は既存の複合クラス
  `.button.button--tsumo`（詳細度 0,2,0 で `.button` ベースに勝つ）を流用する。
- **横向き E2E に `canSelect` 実マウント状態を追加**（[高] 問題3）: `.actions` に SelectionPreview 相当を
  注入して 844×390 の `vOverflow<=1` を実測する。
- **`aria-pressed`** を選択モードのカードに付与（[低] 問題7）。
- `counts.spec.ts`（[中] 問題5）は「discard 直後は select 状態を経由しない」ことを E2E 実行で確認する。

以下は初稿。配置に関する記述（C・D・F）は上記の是正が優先する。

## 全体像

`selfDeclare`（人間が宣言権者）で、手札タップ → 選択トグル → `candidateFromSelection` で役を再導出 →
プレビュー表示 → 有効なら緑のツモで確定、という流れを作る。選択状態は `TableScreen` のローカル
`useState`。エンジンは Step 1 のまま（純関数 `candidateFromSelection` を呼ぶだけ）。

## A. インタラクションモード（`Hand.tsx` / `CardView.tsx`）

- `Hand` に `interaction: 'discard' | 'select' | 'none'` を導入し、`selectedUids: ReadonlySet<number>` と
  `onSelect: (uid) => void` を追加する。
  - `discard`: タップで捨てる（**現状維持**）。`onClick={onDiscard}`・活性。
  - `select`: タップで選択トグル。`onClick={onSelect}`・活性・`isSelected` を渡す。
  - `none`: `disabled` の `<button>`（現状の非 discard と同じ）。無効ボタンにはマウスが来ないため、
    残枚数ホバーの受け口は従来どおり `<li>` に残す。
- `CardView` に `isSelected?: boolean`（→ `.card--selected`）と `actionKind?: 'discard' | 'select'` を追加。
  aria-label を「…を捨てる」/「…を選ぶ」に出し分ける（ハードコードをやめる）。**面の色クラスは残す**
  （`.card--selected` は面色を置き換えず追加する。`isWaiting` と同じ DOM 不変条件）。

## B. CSS（`src/App.css`）— 詳細度・import 順の罠（9-1/10-2 と同型）

- `.card--selected` と複合 `.card--clickable.card--selected` を **`App.css`** に置く（`App.tsx` が `App.css` を
  import リストの**最後**に読むため後勝ちする。`.card--waiting` と同じ配置）。
- 選択は**リング＋持ち上げ**で表す（面の色は塗らない）。`card--waiting`（白熱色 `#ffe58a`）と区別できる
  **クールな色**（例 `#5cc8e6`）を使う。`.card--clickable.card--selected:hover`(0,3,0) で
  `.card--clickable:hover` の translateY(-6px) に勝ち、hover でも持ち上げ（リング）を維持する。
- 待ち札かつ選択という重なりに備え、`.card--selected` 系は App.css 内で `.card--waiting` 系の**後**に置く
  （ユーザーの能動的選択を優先表示）。

## C. ライブプレビュー（新規 `src/ui/components/SelectionPreview.tsx`）

- 純表示＋確定ボタンのコンポーネント（`renderToStaticMarkup` でテスト可能）。props:
  `{ composed: YakuCandidate | null; selectionCount: number; onConfirm: () => void }`。
- 表示規則:
  - `composed !== null`: 役名（＋`（同色）`）＋`点数`。緑のツモ確定ボタン（`button--tsumo`・活性・`declare-confirm`）。
  - `selectionCount > 0 && composed === null`: 「この組み合わせでは役になりません」。確定ボタンは不活性。
  - `selectionCount === 0`: 「手札をタップして役を作る」。確定ボタンは不活性。
- 文言は `YAKU_LABELS` / `COLOR_LABELS` を流用（`actionBarItems.ts` の `describe` と同じ体裁）。
- **`.table__mine` 内・`.table__mine-head` の下**に置く。**`canSelect`（`selfDeclare` かつ人間が宣言権者）の
  ときだけ `TableScreen` が描画する**（discard/claim 等では非表示＝高さ0。375px/横向きの fit を守る）。

## D. おまかせプレフィル（`ActionBar.tsx`）

- `selfDeclare` の候補ボタンを「即 `onDeclare`」から「`onPrefill(candidate)` で選択欄へプレフィル」に変更。
  即確定しない・上書き可。`onDeclare` prop を `onPrefill` に置き換える。
- プレフィルボタンは緑（確定）と役割が違うため**色を分ける**（新 `.button--auto` = おまかせの中立色）。
  ラベルは `おまかせ [役名 点数]`。testid は `declare-button` を維持（プレフィルの起点として E2E が使う）。
- `claimWindow`（ロン）の候補ボタンは**変更しない**（Step 3）。`onClaim` は即時のまま。

## E. ランタイム統合（`TableScreen.tsx`・`useGameLoop.ts` は最小変更）

```ts
const [selectedUids, setSelectedUids] = useState<readonly number[]>([])
const canSelect = state.phase === 'selfDeclare' && state.declarer === loop.humanSeat
const composed = useMemo(
  () => (canSelect ? candidateFromSelection(me.hand, selectedUids, yakuContextOf(state, rules)) : null),
  [canSelect, me.hand, selectedUids, state, rules],
)
```

- **選択リセット**: `useEffect(() => setSelectedUids([]), [state.phase, state.turn, state.declarer, state.chainCount])`。
  局面が変わる・連続宣言で1回宣言した瞬間に空へ（`WaitPanel` pinned 生存バグと同型。
  `chainCount` を入れるのは同一 `selfDeclare` 内での再宣言を拾うため）。消費済み uid は `me.hand` に
  無いため `Hand` はハイライトしない（`cards` を map するため）＋ `candidateFromSelection` が `null`。
- トグルは純ヘルパ（`toggleUid(list, uid)`）にして `TableScreen` から使う。
- `Hand` の `interaction` は `canDiscard ? 'discard' : canSelect ? 'select' : 'none'`。
- 確定は `SelectionPreview.onConfirm = () => composed && loop.declare(composed)`。
- おまかせは `onPrefill = (c) => setSelectedUids(c.cards.map((card) => card.uid))`。
- `useGameLoop` は既存の `declare` を流用。追加公開は不要（`yakuContextOf` は `gameSelectors` から直接 import）。

## F. 変更ファイル

| ファイル | 変更 |
| --- | --- |
| `src/ui/components/CardView.tsx` | `isSelected`・`actionKind`（aria 出し分け）・`.card--selected` |
| `src/ui/components/Hand.tsx` | `interaction`・`selectedUids`・`onSelect` |
| `src/ui/components/SelectionPreview.tsx`（新規） | 役ライブプレビュー＋緑ツモ確定 |
| `src/ui/components/ActionBar.tsx` | declare 候補を `onPrefill` 化・`.button--auto` |
| `src/ui/screens/TableScreen.tsx` | `selectedUids` 状態・`composed`・リセット・配線 |
| `src/ui/selection.ts`（新規・任意小ヘルパ） | `toggleUid` 純関数 |
| `src/App.css` | `.card--selected` / `.card--clickable.card--selected(:hover)` |
| `src/ui/table.css` | `.button--auto`（おまかせ） |
| `src/ui/labels.ts` | 必要なら選択用文言（大半は既存流用） |

## G. テスト設計

- `tests/ui/selectionPreview.test.tsx`（新規）: composed 有→役名＋点数＋確定活性 / 無効→案内＋確定不活性 /
  同色バッジ / 空→案内。ミューテーション: 確定の活性条件を反転すると落ちる。
- `tests/ui/actionBar.test.tsx`（更新）: declare 候補が `onPrefill` を呼ぶ・`.button--auto`・testid 維持。
  claim 側は従来どおり（`button--ron` 即時）。
- `tests/ui/cardVisual.test.tsx`（追記）: `isSelected` で `.card--selected` と面の色クラスが同時に付く /
  `actionKind='select'` で aria が「選ぶ」/ 既定は「捨てる」。
- `tests/ui/selection.test.ts`（新規）: `toggleUid` の追加・除去・重複なし。
- `tests/e2e/table.spec.ts`（追記）:
  - `selfDeclare` でカードをタップ→`.card--selected`→プレビュー更新→`declare-confirm` でツモ（win-overlay）。
  - **同色 triple と混色で点数が変わる**（プレビューの点数実測）。
  - おまかせプレフィル→選択が入る→確定できる。
  - `discard` フェーズのタップは従来どおり捨てる（既存テスト不変）／座標・375px 不変。
- `tests/e2e/winGate.spec.ts`（更新）: `playUntilHumanWin` を「declare-button（プレフィル）→ declare-confirm」に。
- ミューテーションで新規回帰が落ちることを確認（CLAUDE.md 規約）。

## H. リスクと対応

| リスク | 対応 |
| --- | --- |
| **タップの二役**（捨て vs 構成）取り違え | `interaction` を `Hand` の1箇所に集約。discard 座標/375px E2E を不変に保つ |
| **`.card--selected` の詳細度・import 順負け**（9-1/10-2） | 複合 `.card--clickable.card--selected` を App.css（後勝ち）に。E2E で選択見た目を実測 |
| **選択の一時状態が局をまたぐ**（WaitPanel pinned と同型） | `phase/turn/declarer/chainCount` でリセット |
| **横向き 844×390 の縦 fit 崩れ** | `SelectionPreview` は `canSelect` のときだけ描画（常時は高さ0）。E2E で縦 fit を回帰ガード |
| **無効ボタンにマウスが来ない** | 選択モードは対象カードを活性化。残枚数ホバーの `<li>` 受け口は維持 |
| **人間ツモ E2E の破壊** | `winGate` の人間和了経路をプレフィル→確定に更新（フローが実際に変わったため） |
| **CSS 肥大**（table.css 395 行・App.css 345 行） | 追加は数ルール。フェーズ区切りで `wc -l`。400 行超は分割検討 |
