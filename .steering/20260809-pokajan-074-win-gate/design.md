# Step 7-4: 和了の確認ゲート — 設計

## 1. 和了は**キュー**で持つ

```ts
export interface WinPresentation {
  readonly playerId: PlayerId
  readonly candidate: YakuCandidate
  readonly winKind: WinKind
  readonly payments: readonly Payment[]
  /** 和了を適用する**前**の全員の点数。7-5 の得点移動が始点に使う。 */
  readonly scoresBefore: readonly number[]
  readonly scoresAfter: readonly number[]
}

readonly pendingWins: readonly WinPresentation[]
```

計画は `pendingWin: WinPresentation | null` だったが、**配列にする**。

`reduce` は今のところ1回につき最大1つしか `Declared` を出さない
（`applyWin` の呼び出しは `applyDeclare` と `resolveClaims` の2経路で、
どちらも1回だけ。連続宣言は次の `DECLARE` アクションを待つ）。
しかし単数で持つと、**将来2つ出るようになった瞬間に片方が黙って消える**。
和了が消えるということは「点数が動いたのに演出が出ない」ことで、
プレイヤーからは点数バグに見える。

配列なら「1回の和了につき1回確認する」という要件がそのまま表現でき、
`reduce` の出力が変わっても壊れない。**先頭要素が「今見せている和了」**になる。

### 適用前後の点数の作り方

イベント列を**順に畳む**。`Paid` は `settleWin` からしか出ないため、
直前の `Declared` に属すると確定できる。

```
scores = 適用前の点数
for event of events:
  Declared → 新しい演出を開始（scoresBefore = 現在の scores）
  Paid     → scores を更新し、その演出の payments に足す
```

各演出の `scoresAfter` は、その和了ぶんの支払いを反映した時点の `scores`。
**`reduce` 後の `game.players[].score` を使わない。** 1回の `reduce` で
複数の和了が起きたとき、全部が同じ「最終点数」になってしまう。

## 2. 停止は3つの効果すべてに入れる

```ts
const isPaused = loop.pendingWins.length > 0
```

| 効果 | 依存 | 止め忘れたときの症状 |
| ---- | ---- | ---- |
| 自動進行 | `[autoKey]` → `[autoKey, isPaused]` | CPU が確認を待たずに打ち続ける |
| **持ち時間の時間切れ** | `[timerKey, timeLimitMs]` → `+ isPaused` | **演出を読んでいる間にツモ切りされる**。しかも持ち時間まで減る |
| イベントの排出 | `[hasPending]` → `+ isPaused` | 演出の元データが確認前に捨てられる |

**依存配列に足すだけでは足りない。** 効果の本体でも早期 return する
（依存が変わっただけでは既に予約済みのタイマーは止まらないが、
`isPaused` を依存に足せばクリーンアップが走って `clearTimeout` される。
本体の早期 return は、その後の再予約を防ぐ）。

### どれが実際に効いているか（実装後に確認した）

停止は**2層**になっている。役割を取り違えないように書き留めておく。

| 層 | 効くもの | 外すとどうなるか |
| -- | -------- | ---------------- |
| リデューサ（3節） | 自動進行・持ち時間 | **対局が進む。** E2E で山札が5秒間に10枚減ることを確認した |
| 効果の `isPaused` | **イベントの排出** | 確認前に `pending` が捨てられ、7-5 の演出が元データを失う |

自動進行と持ち時間については、効果を止めなくてもリデューサが弾くので進まない
（タイマーが1回発火して却下されるだけで、状態が変わらないため再予約もされない）。
一方 `EVENTS_CONSUMED` は**意図的に弾かない**ので、効果側で止めなければ排出される。

効果側の停止は残す。無駄なタイマー発火を減らすうえ、
「止まっているときは何も動かない」が1箇所を読めば分かるほうが安全。

## 3. 停止中はエンジンへのアクションを受理しない

効果を止めても、**人間はまだクリックできる**（オーバーレイの外側や、
キーボード操作、E2E からの直接クリック）。`PLACE_BET` で
「画面の無効化だけに頼らない」としたのと同じ理由で、
リデューサ側でも `ENGINE` と `TIMEOUT` を弾く。

```ts
case 'ENGINE':
  if (state.pendingWins.length > 0) return state
```

`EVENTS_CONSUMED` と `RESTART` は弾かない。前者は表示済みイベントを削るだけ、
後者は対局そのものの差し替えで、どちらもゲートの意味を壊さない。

> **この判断が E2E の失敗の形を決める。** 弾かれることで
> `playToEnd` は「押しているのに進まない」状態になり、タイムアウトする。
> 弾かないと**確認せずに進んでしまい**、テストは通るが機能は壊れている。
> 落ちるほうを選ぶ。

## 4. `CONFIRM_WIN`

```ts
| { readonly type: 'CONFIRM_WIN' }
```

先頭を1つ落とす。空のときに来ても状態を変えない（二重クリック対策）。
`switch` の網羅性検査があるので、枝の追加漏れは型エラーになる。

## 5. `WinOverlay`（最小限）

誰が・何の役で（同色か）・ツモ/ロン・何点、と確認ボタンだけ。
`ResultOverlay` と同じ `.overlay` のスタイルを使う。

**`ResultOverlay` より優先して出す。** 和了で終局した場合、
確認を押す前に結果画面が出ると、最後の和了を読まずに対局が終わる。

```tsx
{loop.pendingWin !== null && <WinOverlay … />}
{state.phase === 'gameOver' && loop.pendingWin === null && <ResultOverlay … />}
```

## 6. `YakuToast` の廃止

役割が `WinOverlay` と完全に重複する。**残すと同じ情報が2箇所に出る**うえ、
トーストは「進行が先へ行っている」前提で書かれた部品なので、
止まるようになった今は前提が成立しない（コメントごと嘘になる）。

- `src/ui/components/YakuToast.tsx` を削除
- `src/ui/table.css` の `.toast*` を削除
- E2E「役成立のトーストは一定時間で消える」を
  **「和了で進行が止まり、確認を押すと再開する」**に置き換える
  （元のテストが守っていた「トーストが消えない」欠陥は、仕組みごと無くなる）

`GameLoop.events` は残す。7-5 の演出が使うほか、`pending` の排出は
`WinOverlay` とは別の関心（`CardDrawn` などの演出）を持つ。

## 7. 変更するファイル

**新規**
- `src/ui/components/WinOverlay.tsx`

**修正**
- `src/ui/hooks/loopReducer.ts` — `WinPresentation` / `pendingWins` / `CONFIRM_WIN`
- `src/ui/hooks/useGameLoop.ts` — 3つの効果の停止・`pendingWin` / `confirmWin` の公開
- `src/ui/screens/TableScreen.tsx` — `WinOverlay` の描画と優先順位
- `src/ui/table.css` — `.toast*` を削除し `.win-overlay*` を足す

**削除**
- `src/ui/components/YakuToast.tsx`

**テスト**
- `tests/ui/loopReducer.test.ts` — 積まれる／解除される／停止中は受理されない／点数の前後
- `tests/e2e/table.spec.ts` — 進行ヘルパ3つに確認クリックを足す・トーストのテストを置換
- `tests/e2e/casino.spec.ts` — `playToEnd` に確認クリックを足す

`src/ui/hooks/loopReducer.ts` は 213 行。`WinPresentation` の組み立てを足すと
280 行前後になる見込みで基準内だが、**フェーズ終わりに実測する**。

## 8. 検証

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

**必ず確かめること**:
- 停止中に持ち時間が減らないこと（**単体テストで固定する**。
  `TIMEOUT` を送っても `timeLimitMs` が変わらないことで観測できる）
- E2E で1局を最後まで進められること（確認クリックを挟んで）
- ブラウザで CPU 同士の和了でも止まること
