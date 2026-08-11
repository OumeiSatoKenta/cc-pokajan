# 設計: 絵札選択UI・ロン（Step 3）

## 全体像

Step 2 で `selfDeclare`（ツモ）に入れた「手札タップ → 選択 → `candidateFromSelection` で再導出 →
プレビュー → 確定」を、`claimWindow`（ロン）へ広げる。ロン特有の要件は**捨て札の固定**だけ:

- ロンの役は `[...自分の手札, 捨て札]` から `required = 捨て札` で再導出する（Step 1・`game.ts` の CLAIM と同一）。
- **捨て札は手札に無い**ので手札選択（`selectedUids`）には入れない。プレイヤーは手札だけをタップし、
  確定時に `lastDiscard.uid` を固定要素として合流させる。捨て札は他家の河で強調済み（`highlightLast`）。

Step 2 の振り返りが予告したとおり、`TableScreen` は 393 行で Step 3 の追加で 400 を超える。選択の配線
（状態・`composed`・リセット・確定・プレフィル）を**新フック `useSelection`** に抜き、ツモ／ロンを1箇所に集約する。
これは structural [推奨]（`canDiscard` と `canSelect` の非対称の解消）も兼ねる。

## A. 選択フックの抽出（新規 `src/ui/hooks/useSelection.ts`）

`TableScreen` に散っていた選択ロジックを、`loop` と `rules` を受け取る1フックに集約する。**ツモとロンの
差分は「対象の手札」「固定の捨て札」「確定先（declare/claim）」「確定ボタンの種別」の4点だけ**で、残りは共通。

```ts
export interface HandSelection {
  readonly interaction: 'discard' | 'select' | 'none' // Hand に渡すタップの意味
  readonly selectedSet: ReadonlySet<number>           // Hand のハイライト（手札 uid のみ）
  readonly selectedCount: number                      // data-selected-count（観測フック・手札の選択数）
                                                      // ★ロンは捨て札を含まないため役の構成枚数より常に 1 小さい
                                                      //   （例: triple ロンは手札2枚＝count 2／`.card--selected` も2枚。
                                                      //   `data-selected-count === candidate.cards.length` を前提にしないこと）
  readonly selection: SelectionPreviewProps | null    // ActionBar に渡すプレビュー＋確定（非選択時は null）
  readonly onSelect: (uid: number) => void            // 手札タップのトグル
  readonly onPrefill: (candidate: YakuCandidate) => void // おまかせ（捨て札を除いて手札 uid だけ入れる）
}

export function useSelection(loop: GameLoop, rules: RulesConfig): HandSelection
```

内部:

```ts
const { state } = loop
const me = state.players[loop.humanSeat]
const lastDiscard = state.lastDiscard

// ツモ: 自分の宣言番。ロン: 割り込める役を持つ受付中。どちらも演出中は不可（pendingWin===null）。
const canDeclare =
  state.phase === 'selfDeclare' && state.declarer === loop.humanSeat && loop.pendingWin === null
const canClaim =
  loop.isClaimWindowOpen && loop.claimable.length > 0 && lastDiscard !== null && loop.pendingWin === null
const canSelect = canDeclare || canClaim

const [selectedUids, setSelectedUids] = useState<readonly number[]>([])
const selectedSet = useMemo(() => new Set(selectedUids), [selectedUids])

// プレビューと確定活性の単一の真実。無効なら null。
const composed = useMemo(() => {
  if (canDeclare) {
    return candidateFromSelection(me.hand, selectedUids, yakuContextOf(state, rules))
  }
  if (canClaim && lastDiscard !== null) {
    // 捨て札を固定要素として合流。required=捨て札 で「反手内成立でロン不可」も課す。
    return candidateFromSelection(
      [...me.hand, lastDiscard],
      [...selectedUids, lastDiscard.uid],
      yakuContextOf(state, rules),
      lastDiscard,
    )
  }
  return null
}, [canDeclare, canClaim, me.hand, lastDiscard, selectedUids, state, rules])

// 局面が変わった瞬間に選択を空へ（Step 2 と同一。ツモ／ロンで共通）。
useEffect(() => {
  setSelectedUids([])
}, [state.phase, state.turn, state.declarer, state.chainCount])

const interaction = loop.canDiscard ? 'discard' : canSelect ? 'select' : 'none'
const onSelect = (uid: number) => setSelectedUids((current) => toggleUid(current, uid))

// おまかせ: 候補の cards から手札 uid を入れる。ロンの候補 cards は捨て札を含むため除外する
// （選択状態には手札のみ。捨て札は composed 側で固定合流するので二重に持たせない＝重複 uid で null になるのを防ぐ）。
const onPrefill = (candidate: YakuCandidate) => {
  const fixed = canClaim && lastDiscard !== null ? lastDiscard.uid : null
  setSelectedUids(candidate.cards.map((c) => c.uid).filter((uid) => uid !== fixed))
}

const selection: SelectionPreviewProps | null = canSelect
  ? {
      composed,
      selectionCount: selectedUids.length,
      kind: canClaim ? 'ron' : 'tsumo',
      onConfirm: () => {
        if (composed === null) return
        if (canClaim) loop.claim(composed)
        else loop.declare(composed)
      },
    }
  : null

return { interaction, selectedSet, selectedCount: selectedUids.length, selection, onSelect, onPrefill }
```

**なぜ捨て札を選択状態に入れないか**: `candidateFromSelection` の `resolveSelection` は重複 uid を `null` にする。
選択に捨て札を入れ、`composed` でも合流させると uid が重複して常に `null` になる。かつ捨て札は `me.hand` に
無いので `Hand` はハイライトできない（`cards` を map するため素通り）。よって**選択＝手札のみ／捨て札＝固定合流**に統一する。

**リセット依存が claimWindow を跨ぐ根拠**: `claimWindow` では `state.turn` = 捨てた本人（`types.ts` の注記）。
別の捨て札＝別の `turn` なので、受付が移るたびに `[phase, turn, ...]` が変わり選択が空へ戻る。同一受付中は
`turn` 不変なので構成中に消えない。Step 2 と同一依存で足りる（`lastDiscard.uid` の追加は不要＝過剰）。

## B. `SelectionPreview` に確定種別 `kind` を追加

現状はツモ固定（緑「ツモ」・`declare-confirm`）。ロン用に**確定ボタンの3属性（色・testid・ラベル）**を
`kind: 'tsumo' | 'ron'` で切り替える。案内文とプレビュー本文（`describeYaku`）は共有（役名＋同色＋点数は同じ）。

```ts
export interface SelectionPreviewProps {
  readonly composed: YakuCandidate | null
  readonly selectionCount: number
  readonly onConfirm: () => void
  readonly kind: 'tsumo' | 'ron' // NEW（既定運用はツモ。呼び出しは必ず渡す）
}

const confirm =
  kind === 'ron'
    ? { className: 'button button--ron', testId: 'claim-confirm', label: 'ロン' }
    : { className: 'button button--tsumo', testId: 'declare-confirm', label: 'ツモ' }
```

- 案内文（`composed===null` のとき）はツモ／ロン共通: `selectionCount>0` → 「この組み合わせでは役になりません」／
  `0` → 「手札をタップして役を作る」。ロンでも「手札を」タップするのは正しい（捨て札は固定）。文言分岐を増やさない。
- `button--ron` は既に `table.css` にあり（Step 10-2、複合 `.button.button--ron` で詳細度確保済み）**CSS 追加なし**。
- `aria-live="polite"` / `data-valid` は不変。

## C. `ActionBar` の claim 候補をおまかせプレフィル化

declare と claim を**対称**にする。両方とも金 `button--primary`・`おまかせ ${役名}`・押下で `onPrefill(candidate)`。
即時の `onClaim` は廃止（確定は `SelectionPreview` の赤ロンが担う）。

- `onClaim` prop を**削除**（`TableScreen` は `loop.claim` を `useSelection` の確定へ配線する）。
- `isDeclare` 分岐が消え、declare/claim は同一描画（金プレフィル）に単純化。testid は `declare-button`/`claim-button` を維持。
- `pass` ボタン（ゴースト「見送る」）は不変。
- `SelectionPreview` は `selection` prop 経由で `kind` も受け取り、`.actions` 内に描く（横向き高さ保護に相乗り・Step 2 の配置不変）。
  `ActionBar` 内の JSX は `kind` の受け渡しを**明示**して追加する（付け忘れは型エラーで即検出されるが、他差分と揃えて記す）:

  ```tsx
  <SelectionPreview
    composed={selection.composed}
    selectionCount={selection.selectionCount}
    onConfirm={selection.onConfirm}
    kind={selection.kind} // NEW（ツモ/ロンの確定ボタン出し分け）
  />
  ```

## D. `TableScreen` の配線を `useSelection` に置換（純減）

- インライン選択ロジック（`canSelect`・`selectedUids`・`selectedSet`・`composed`・リセット `useEffect`）を削除し
  `const sel = useSelection(loop, rules)` に置換。`useState`/`useEffect` と `candidateFromSelection`/`yakuContextOf`/
  `toggleUid` の import が `TableScreen` から消える（フックへ移動）。
- `data-selected-count={sel.selectedCount}`。
- `Hand`: `interaction={sel.interaction} selectedUids={sel.selectedSet} onSelect={sel.onSelect}`（`onDiscard={loop.discard}` は不変）。
- `ActionBar`: `selection={sel.selection} onPrefill={sel.onPrefill}`（`onClaim` を渡さない）。
- 期待行数: 現 393 − 約 35（選択ブロック）＋数行 ≈ 360 前後。**400 未満を確保**。

## E. CSS

**追加なし**。`.card--selected`（App.css・シアンのリング）と `button--ron`/`button--tsumo`（table.css・複合クラス）を
そのまま再利用。ロンの手札選択はツモと同一の見た目。`selection.css`（36 行）不変。

## F. 変更ファイル

| ファイル | 変更 |
| --- | --- |
| `src/ui/hooks/useSelection.ts`（新規） | ツモ／ロン共通の選択状態・`composed`・リセット・確定・プレフィル |
| `src/ui/components/SelectionPreview.tsx` | `kind: 'tsumo' \| 'ron'` で確定ボタンの色・testid・ラベルを出し分け |
| `src/ui/components/ActionBar.tsx` | claim 候補をおまかせプレフィル化・`onClaim` 削除・`selection.kind` を透過 |
| `src/ui/screens/TableScreen.tsx` | 選択配線を `useSelection` へ置換（純減・400 未満） |
| `src/ui/components/SelectionPreview.tsx` の props 型 | `ActionBar`/`useSelection` が共有（`kind` 追加） |

## G. テスト設計

### 単体（`renderToStaticMarkup`）

- `tests/ui/selectionPreview.test.tsx`（更新）: 全 render に `kind` を渡す。`kind='ron'` で赤 `button--ron`・
  `claim-confirm`・「ロン」ラベル／`kind='tsumo'`（既定運用）で緑・`declare-confirm`・「ツモ」。案内文・活性条件は不変。
- `tests/ui/actionBar.test.tsx`（更新）: claim 候補が**おまかせ（金 `button--primary`・`おまかせ ${役名}`）**で出る
  （赤即時ではない）・`onClaim` prop 廃止・`selection.kind='ron'` を渡すと `.actions` に赤ロン確定（`claim-confirm`）が出る。

### E2E（`tests/e2e/table.spec.ts` 追記、helper 追加）

- **helper**: `playUntilHumanClaim(page)` を `helpers/table.ts` に追加（`playUntilHumanDeclare` と対称だが
  **見送りの振る舞いは逆**）。`claim-button`（おまかせロン）が出たら true。**`claimWindow` では絶対に見送らない**
  （見送ると受付を通り過ぎる。`playUntilHumanDeclare` は claimWindow でも pass を押す＝ロン機会を素通りする設計なので**流用不可**。
  同様に汎用 `advanceOneStep`/`playUntil` は `passInClaimWindow: true` を渡すため**流用不可**）。到達手順は helper に一本化
  （7-4 の「写しを2箇所直す」轍を回避）。最小疑似コード:

  ```ts
  export async function playUntilHumanClaim(page: Page, deadlineMs = 90_000): Promise<boolean> {
    const deadline = Date.now() + deadlineMs
    while (Date.now() < deadline) {
      // ★毎周「先に」claim-button を見る。claimWindow が開いた同じ周回で pass しないため。
      if (await page.getByTestId('claim-button').first().isVisible()) return true
      if (await page.getByTestId('result-overlay').isVisible()) return false
      if (await dismissWinIfAny(page)) continue

      const phase = await screen(page).getAttribute('data-phase')
      if (phase === 'discard') {
        await discardFirst(page).catch(() => undefined)
      } else if (phase === 'selfDeclare' && (await page.getByTestId('pass-button').isVisible())) {
        // ★pass を押すのは selfDeclare のときだけ（claimWindow では押さない＝ロン機会を通り過ぎない）。
        await pass(page).catch(() => undefined)
      } else {
        await page.waitForTimeout(80)
      }
    }
    return false
  }
  ```
- **ロンおまかせ→確定**: `CLAIM_SEED` で `playUntilHumanClaim` → `claim-button` クリック（プレフィル）→
  `data-selected-count>0`（手札のみ・捨て札は含まない）→ `claim-confirm`（赤ロン）活性 → クリック → `win-overlay`。
- **ロンのタップ再構成**: プレフィル後、選択カードを1枚タップで外す → `claim-confirm` 不活性 → 戻すと活性
  （タップ駆動の再導出をロンでも確認）。
- **捨て札固定の観測**: プレフィル後の `.card--selected` 枚数 = `data-selected-count`（捨て札は手札選択に入らない＝
  河の強調カードは `.card--selected` を持たない）。
- **ロンの色バリエーションで点数が変わる**（doc-reviewer [高]・ツモとの対称）: 複数のおまかせ claim 候補
  （`claimableFor` は混色/同色を別候補で列挙し点数が異なる）を順にプレフィルし、プレビュー本文（`.selection-preview__text`）の
  点数がおまかせラベルと一致することを実測する（Step 2 のツモ版「おまかせ候補ごとに点数が切り替わる」と同型）。
  これは `useSelection` のロン分岐（`[...selectedUids, lastDiscard.uid]` 合流＋`required`）が UI 結線経由でも点数を
  正しく再計算することを、エンジン単体テスト（差分オラクル）とは別に担保する。候補が1つしか出ないシードでは
  「点数がラベルと一致」までを固定する（複数取れれば色差も観測できる）。
- **横向き 844×390**: `.actions` にロンのプレビュー相当（赤 `claim-confirm`）を注入して縦 fit（`vOverflow<=1`）を実測
  （Step 2 のツモ注入テストと同型・`kind=ron` 版）。座標・375px は既存テスト不変。

### ミューテーション（CLAUDE.md 規約）

- `composed` のロン分岐で `lastDiscard.uid` の合流を外す → ロンが構成できず `claim-confirm` が永久に不活性 → E2E 落ちる。
- `onPrefill` の捨て札除外（`.filter`）を外す → プレフィル時に捨て札 uid が選択に入り、`composed` で重複 → `null` →
  `claim-confirm` 不活性 → E2E 落ちる。
- `SelectionPreview` の `kind` 出し分けを固定（常にツモ）にする → ロンの単体テスト（赤・`claim-confirm`）が落ちる。

## H. リスクと対応

| リスク | 対応 |
| --- | --- |
| **捨て札の二重計上**（選択にも入れると重複 uid で常に `null`） | 選択＝手札のみ／捨て札＝`composed` で固定合流。`onPrefill` も除外。ミューテーションで担保 |
| **claimWindow を見送って通り過ぎる E2E** | `playUntilHumanClaim` は `claim-button` を先に見て、`pass` は `selfDeclare` に限定 |
| **`onClaim` 削除の波及** | 参照は `ActionBar`/`TableScreen`/`actionBar.test` の3箇所のみ（grep 済み）。`loop.claim` はフックが使う |
| **`TableScreen` 400 行超**（Step 3 の教訓の再演） | `useSelection` 抽出で純減。フェーズ区切りで `wc -l` |
| **ツモ経路の退行**（`kind` 追加・フック抽出の巻き添え） | `kind` 既定運用＝ツモは不変。Step 2 の E2E（ツモ選択・プレフィル・844×390）を回帰ガードとして維持 |
| **横向き 844×390 の縦 fit 崩れ** | ロン確定も `.actions` 内（同じ高さ保護）。ロン版の注入 E2E で縦 fit を実測 |
| **和了演出中のキーボード裏書き** | `canClaim` に `pendingWin === null`（7-4 の「効果とクリックの両層」に揃える。ツモと同一） |
| **捨て札とプレビューが画面上で離れる**（河の強調＋手札選択＋操作バーの3箇所を目で追う） | **意図的な簡略化**。捨て札の提示は既存 `highlightLast`（他家の河の強調）に委ね、Step 3 では追加の視覚的関連付けを入れない（文言分岐を増やさない）。UX 改善は今後の課題として記録に残す（「見落とし」ではなく「意図的な見送り」） |
