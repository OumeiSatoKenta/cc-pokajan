# Step 9-2 河の直近5枚固定とヘッダー — design

## D. 河の直近5枚固定（`src/ui/components/DiscardPile.tsx`）

- 定数 `MAX_RIVER = 5`。表示は `cards.slice(-MAX_RIVER)`。`key` は `card.uid` のまま一意。
- **件数ラベル** `.river__count` を `<ul>` の前に置く（`<span>`。見出し=`<h*>` は増やさない）。
  文言: `cards.length <= MAX_RIVER ? "{N}枚" : "直近5枚 / 計{N}"`。空(0)でも「0枚」を出して
  レイアウトを安定させる（要素の出現/消失による段ズレを避ける）。
- **直前札の強調**: props `highlightLast?: boolean`（既定 false）。true のとき、slice 後の
  **最後の1枚**に `CardView isLast` を渡す。ron 対象＝最新の捨て札の意。
- `CardView` に `isLast?: boolean` を追加 → クラス `card--last` を積む。**面の色クラスは残す**
  （`card--waiting` と同じ設計。強調は枠・グローのみ、持ち上げなし＝河の小カードなので）。
- `残N` への影響なし: `unseen.ts` は `state` の全 `discards` を数える。表示の slice とは別経路。

## D. 直前席の特定（`TableScreen` → `PlayerSeat`/`DiscardPile`）

- ron 対象は `state.lastDiscard` / `state.lastDiscardBy`。
  **重要（レビューで判明した誤りの訂正）**: `lastDiscardBy` は**ロン成立では消えない**。
  `win.ts` の `consumeAndRefill` は `lastDiscard = null` だけを設定し、`lastDiscardBy` は
  `advanceTurn`（`turnFlow.ts`）まで残す。よって `lastDiscardBy === 席` だけで判定すると、
  ロン後の連続宣言中に「消費済みの古い札」を誤って光らせる。
  **`lastDiscard !== null`（ロン消費と同時に null になる）で受付中に限定する。**
- `PlayerSeat` に `highlightLast: boolean` を足し、`DiscardPile` へ素通しする。
- `TableScreen`:
  - 他家席: `highlightLast={state.lastDiscard !== null && state.lastDiscardBy === player.id}`
  - **自分の河: 強調しない**（自分の捨て札は自分のロン対象ではない。一次資料も自席の河は
    強調していない）。`highlightLast` を渡さず既定の false にする。

## E. ヘッダー（`src/ui/components/TableHeader.tsx` 新規）

- props: `chainCount: number`, `maxChain: number`, `bet: number`。
- 描画:
  - タイトル「ポカジャン」＋サブ「CARD MAHJONG」
  - 連続和了: `Array.from({length: maxChain}, (_, i) => i < chainCount)` でピップ列。
    ラベル「連続和了 {chainCount} / {maxChain}」。平常時は全ピップ暗 + 0/8（実データなので正しい）。
  - BET: 「BET {bet.toLocaleString('ja-JP')}」
- `data-testid="table-header"`、BET は `data-testid="bet-amount"`、ピップに `data-lit` を付けて
  テストが点灯数を数えられるようにする。
- スタイルは `table.css` に `.table__header` / `.streak` / `.streak__pip(.--lit)` / `.bet` を追加。
  木縁（`--rim` の上）に載るので、`--slot` の窪みやテキストは `--text`/`--muted`/`--accent` を使う。

## E. 配線（`src/App.tsx` / `TableScreen`）

- `TableScreenProps` に `readonly bet: number` を追加（必須）。
- `App.tsx`: `{state.screen === 'table' && state.bet !== null && (<TableScreen bet={state.bet} … />)}`
  に変更（`state.bet` を number に narrow。`ResultScreen` の `outcome !== null` と同じ作法）。
- `TableScreen`: `<TableHeader chainCount={state.chainCount} maxChain={rules.maxChainDeclare} bet={bet} />`
  を `.table` の最初の子（`.table__felt` の前）に置く。

## テスト

- `tests/ui/discardPile.test.tsx`（新規、または `cardVisual.test.tsx` に追加）:
  - 6枚以上 → `river-card` は5枚だけ / ラベル「直近5枚 / 計6」。**わざと slice を外すと落ちる**。
  - 5枚以下 → 全部描画 / ラベル「{N}枚」。
  - `highlightLast` → 最後の1枚に `card--last`、他には付かない。false なら誰にも付かない。
- `tests/ui/tableHeader.test.tsx`（新規）:
  - BET 額が出る（`data-testid="bet-amount"`）。
  - ピップが maxChain 個、うち chainCount 個が点灯（`data-lit`）。
  - chainCount=0 で全消灯、chainCount=maxChain で全点灯。
- E2E: 既存の河系（`my-river` 0→1、4人全員が河、座標）が維持される。
  ヘッダーの BET 表示は `startGame` が bet を経由するか次第で1件足す（helpers を確認して判断）。

## リスク

- **件数ラベルを常時出すことが 4 河でノイズにならないか**。`.river__count` を小さく `--muted` に
  して密度を抑える（board.css に定義）。
- **自席の河は強調しない**（レビュー反映）。他家のロン対象のみ #ffe58a の枠＋グロー。持ち上げは無し。
- **既存 E2E `河が捨てた絵札で並ぶ`** は `my-river` の river-card を数える。5枚上限に触れない
  （0→1 のみ）ので影響なし。件数ラベルは別要素。
