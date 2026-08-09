# Step 5: カジノメタ — 設計

## 全体方針

対局そのものには手を触れない。**エンジンに足すのは精算計算だけ**で、
残りは画面遷移と永続化という UI 層の仕事になる。

層の追加は1つ: `src/storage/`。**エンジンからは参照しない**（依存の向きは UI → storage）。

```
App（画面ステートマシン + ウォレット）
 ├─ storage/prefs.ts     所持コインの永続化
 ├─ engine/payout.ts     精算計算（純粋・rules 注入）
 └─ ui/screens/          Title / Bet / Table / Result
```

---

## R1: 精算計算（`src/engine/payout.ts`）

### 決定1: 順位はエンジンが確定した値だけを使う

現在の `TableScreen` は終局時の順位を**点数から組み直している**。

```tsx
// 現状（Step 4）— これを廃止する
const ranking = [...state.players].sort((a, b) => b.score - a.score || a.id - b.id)
```

エンジンの `finishGame` も同じ式を持っており、**同じ方針が2箇所にある**。
Step 4b で `gameOverReason` に対して同じ問題を直したのと同型で、
今回はこの順位が**そのまま金額になる**ため、食い違いが金銭的な誤りになる。

`LoopState` に `ranking` を追加し、`GameOver` イベントの値を写し取る。
`gameOverReason` と完全に同じ扱いにする（イベントは表示後に捨てられるため）。

### 決定2: 精算式と丸め

```
BET倍率   = bet / min(options)          // 1000→1倍, 2000→2倍
gross     = floor(最終点数 × BET倍率 × 順位倍率)
net       = gross − bet
```

**`Math.floor` を使う。** 順位倍率 2.5 / 1.5 は端数を生む（点数が奇数のとき .5）。
切り上げでも四捨五入でもなく切り捨てにするのは、
**払い出しが厳密値を超えないことを保証する**ため（カジノの慣習にも合う）。

> 浮動小数の誤差について: 順位倍率が **0.5 の倍数である限り**、
> `整数 × 0.5k` は二進浮動小数で厳密に表現でき、`floor` の結果に誤差が出ない。
> この前提を `tests/config/rules.test.ts` の不変条件として固定する。
> 将来 1.1 のような値を設定すると誤差が入りうるため、そのときは丸め方を見直す。

`bet` は `min(options)` で割るので、選択肢の並び順に依存しない。

### 実測: この式は大きくプレイヤー有利になる

自動対局200局（全員 CPU、プレイヤー0を人間とみなす）で式を適用した結果:

| 指標                       | 実測値                       |
| -------------------------- | ---------------------------- |
| 順位分布                   | 54 / 55 / 49 / 42（ほぼ均等） |
| 最終点の平均               | 1,051（初期点 1,000）        |
| 最終点の min / max         | 0 / 3,360                    |
| **1局あたり収支（BET1000）** | **+1,017**                   |

**1局あたり約 +100% で、所持コインは増え続ける。**
順位倍率の平均が `(2.5 + 1.5 + 1 + 1) / 4 = 1.5` である以上、
最終点が初期点と同水準なら収支は必ずプラスになる（`1000 × 1.5 − 1000 = +500`）。

計画書の調査結果どおりに実装するが、**この非対称性は記録に残す**。
`startingScore` と同じく `TODO(要実機確認)` を付け、
実機では順位倍率か BET の扱いが異なる可能性を明示する。
バランス調整は Step 6 のルール設定画面から行えるようにする。

> 副次的な帰結: 所持コインが尽きる状況はほぼ起こらない。
> それでも R4 の補充導線は残す。**滅多に起きないことと起きないことは別**で、
> 実際に起きたときに回復できないのは欠陥である。

### 端数は既定ルールでは発生しない（が、テストする）

同じ200局で **`最終点 × 2.5` が端数になった局は0件**だった。
役の点数（120 / 180 / 300 / 480 / 840 / 1800）とボーナス加点（90）が
すべて偶数で、ツモの 1/3 分配後も偶数のままなので、
**最終点が常に偶数になり、2.5 倍しても整数になる**。

つまり `floor` は既定ルールでは一度も働かない。
**「たまたま端数が出ないから正しく見える」状態**なので、
丸めの検証は既定ルールの対局に頼らず、
奇数の点数を直接与える単体テストで行う（`bonusPerCard` を奇数にすれば実際に到達する）。

### 決定3: 不正な入力は例外にする

`bet` が選択肢にない / `rank` が範囲外の場合、**黙って何かを返さない**。
金額を扱う関数が誤った値を返すと、その誤りは所持コインに永続化されて残る。

```ts
export function computePayout(
  finalScore: number,
  bet: number,
  rank: number, // 1始まり
  rules: RulesConfig,
): PayoutBreakdown
```

戻り値は内訳をすべて含む。リザルト画面が同じ計算を再実装しないで済むようにする。

```ts
export interface PayoutBreakdown {
  readonly finalScore: number
  readonly bet: number
  readonly betMultiplier: number
  readonly rank: number
  readonly rankMultiplier: number
  readonly gross: number
  readonly net: number
}
```

### 決定4: 順位の取り出しも `payout.ts` に置く

```ts
export function rankOf(ranking: readonly PlayerId[], playerId: PlayerId): number
```

`indexOf + 1`。見つからなければ例外。画面側で `indexOf` を書くと
0 始まりと1始まりを取り違える余地が残る。

---

## R2: 永続化（`src/storage/prefs.ts`）

### 決定5: 保存するのは残高だけ。精算額は保存しない

保存するのは **所持コインの残高** と **次のシード** のみ。
精算額や順位を保存すると、localStorage を書き換えるだけで
所持コインを増やせる経路が増える。計算はその都度エンジンが行う。

```ts
export interface Prefs {
  readonly version: number
  readonly wallet: number
  readonly lastSeed: number
}
```

### 決定6: 壊れた保存データでも落ちない

localStorage は**外部入力として扱う**。ユーザーが直接編集でき、
別バージョンの本アプリが書いた値が残っていることもある。

- JSON パース失敗 → 既定値
- 型が違う / 有限でない数 / 負のウォレット → 既定値
- `version` が未知 → 既定値（移行は必要になった時点で足す）
- `localStorage` 自体が使えない（プライベートモード等）→ 既定値。**例外を投げない**

読み書きの両方を `try/catch` で包む。書き込みも失敗しうる（容量超過）。

### 決定7: 初期コインは `RulesConfig` に置く

`BetConfig` に `initialWallet` を追加する。ゲームバランスの数値なので
`src/config/rules.ts` に集約するという既存の原則に従う。
Step 6 のルール設定画面からも編集できるようになる。

```ts
bet: {
  options: [1000, 2000],
  rankMultiplier: [2.5, 1.5, 1, 1],
  initialWallet: 10_000,  // TODO(要実機確認)
}
```

10,000 は BET 1000〜2000 に対して 5〜10 局分の余裕になる。実機の値は不明。

---

## R3・R4: 画面遷移とウォレット（`src/App.tsx` + `src/ui/appReducer.ts`）

### 決定8: 画面遷移は `rules` を束縛したリデューサにする

`createLoopReducer(rules, humanSeat)` と同じ形にそろえる。
精算計算に `rules` が要るため、素の `useReducer` では毎回引数を渡すことになる。

```ts
export type Screen = 'title' | 'bet' | 'table' | 'result'

export interface AppState {
  readonly screen: Screen
  readonly wallet: number
  /** 次の対局に使うシード。局ごとに +1 する。 */
  readonly seed: number
  /** 進行中の対局の BET 額。対局していなければ `null`。 */
  readonly bet: number | null
  /** 直近の精算結果。 */
  readonly outcome: Outcome | null
}

export type AppAction =
  | { readonly type: 'GO_BET' }
  | { readonly type: 'PLACE_BET'; readonly amount: number }
  | { readonly type: 'FINISH'; readonly ranking: readonly PlayerId[]; readonly scores: readonly number[] }
  | { readonly type: 'GO_TITLE' }
  | { readonly type: 'TOP_UP' }
```

`Outcome` は `PayoutBreakdown` に順位表示用の情報を添えたもの。

### 決定9: BET はその場でウォレットから引く

`PLACE_BET` の時点で `wallet -= amount` し、精算時に `wallet += gross` する。
最終的な増減は `net` と一致するが、**対局を中断したら BET は戻らない**という
カジノとして自然な挙動になる。精算時にまとめて `net` を足す方式だと、
タブを閉じるだけで負けを帳消しにできてしまう。

不足時は `PLACE_BET` を受け付けない（リデューサ側でも弾き、画面側でもボタンを無効化する）。
**ガードを画面だけに置かない。** 画面の無効化は見た目の話で、状態の正しさを保証しない。

### 決定10: 「BET を経由せずに対局を始める経路」を消す

現在 `useGameLoop` は `restart()` を返し、`ResultOverlay` の「もう1局」がそれを呼ぶ。
このまま残すと、**BET を払わずに次の対局を始められる**。

`restart` を `useGameLoop` から削除し、対局の開始は App だけが行う。
`TableScreen` は `key={seed}` で再マウントされ、新しい対局が始まる。
**同じことをする経路を2つ持たない**（Step 4b の `claimWindowMs` と同じ判断）。

### 決定11: `ResultOverlay` は「対局の結果」、`ResultScreen` は「精算」

役割を分ける。重複した表示を2画面に置かない。

| 画面            | 見せるもの                                     |
| --------------- | ---------------------------------------------- |
| `ResultOverlay` | 終局理由・4人の順位と最終点数・「精算へ」ボタン |
| `ResultScreen`  | 自分の順位・BET・倍率・払い戻し・コインの増減   |

`ResultOverlay` の `onRestart` を `onSettle` に変える。

### 決定12: 補充は「最低 BET を下回ったときだけ」現れる

R3 のガードだけだと所持コインが尽きた時点で詰む。localStorage に残るので
リロードしても回復しない。**遊べなくなる状態を作らない。**

`TOP_UP` は `wallet < min(options)` のときだけ受け付ける。
リデューサ側で条件を検査するので、画面のボタンを隠すだけの防御にしない。

補充額は `initialWallet` に戻す（増やすのではなく戻す）。

### 決定13: シードは**精算のたびに** +1 し、永続化する

`AppState.seed` は「次に始める対局のシード」。増やすのは `FINISH`（精算）のときだけ。

- `GO_BET` で増やすと、タイトルから初回に入るだけで `?seed=13` が 14 になってしまう
- `PLACE_BET` で増やすと、実際に遊ぶ対局のシードが指定値とずれる

`FINISH` で増やせば「1局目 = 13、2局目 = 14」になり、E2E で再現できる。
`lastSeed` を保存するのは、リロードしても同じ配牌を繰り返さないため。

URL に `seed` が指定されている場合は保存値より URL を優先する（E2E の再現性）。

### 決定14: 「終局したのに順位が無い」状態を握りつぶさない

`phase === 'gameOver'` なら `ranking` は必ず埋まっている（`finishGame` が
必ず `GameOver` イベントを出す）。この前提が崩れたときに
**点数から順位を作り直すフォールバックは置かない**。決定1で消したはずの
二重実装がフォールバックという名前で戻ってくるだけだからである。

`rankOf` は該当プレイヤーが `ranking` に無ければ例外にする。
前提そのものは単体テストで固定する（終局に至ると必ず `ranking` が埋まる）。

---

## ファイル別の変更一覧

| ファイル                             | 区分 | 内容                                          |
| ------------------------------------ | ---- | --------------------------------------------- |
| `src/engine/types.ts`                | 修正 | `BetConfig.initialWallet` を追加              |
| `src/engine/payout.ts`               | 新規 | `computePayout` / `rankOf`                    |
| `src/config/rules.ts`                | 修正 | `initialWallet` の既定値                      |
| `src/storage/prefs.ts`               | 新規 | localStorage ラッパー（防御的な読み書き）     |
| `src/ui/appReducer.ts`               | 新規 | 画面ステートマシン + ウォレット + 精算        |
| `src/ui/screens/TitleScreen.tsx`     | 新規 | 所持コイン表示・「遊ぶ」                      |
| `src/ui/screens/BetScreen.tsx`       | 新規 | BET 選択・不足時のガード・補充導線            |
| `src/ui/screens/ResultScreen.tsx`    | 新規 | 精算内訳・コイン増減・次の行動                |
| `src/ui/screens/TableScreen.tsx`     | 修正 | `onSettle` を受け取る／順位の再導出を廃止     |
| `src/ui/components/ResultOverlay.tsx`| 修正 | 「もう1局」→「精算へ」                        |
| `src/ui/hooks/loopReducer.ts`        | 修正 | `LoopState.ranking` を追加（`GameOver` から） |
| `src/ui/hooks/useGameLoop.ts`        | 修正 | `ranking` を公開・`restart` を削除            |
| `src/ui/casino.css`                  | 新規 | タイトル・BET・リザルトのスタイル             |
| `src/App.tsx`                        | 修正 | 画面ステートマシンの配線・永続化              |
| `tests/engine/payout.test.ts`        | 新規 | 精算計算                                      |
| `tests/storage/prefs.test.ts`        | 新規 | 保存・復元・破損データ・localStorage 不在     |
| `tests/ui/appReducer.test.ts`        | 新規 | 画面遷移・ウォレット増減・ガード              |
| `tests/config/rules.test.ts`         | 修正 | 順位倍率と初期コインの不変条件                |
| `tests/e2e/casino.spec.ts`           | 新規 | BET → 対局 → 精算 → 永続化                    |
| `tests/e2e/table.spec.ts`            | 修正 | BET 画面を経由する導線に追随                  |

## リスク

| リスク                                             | 対策                                                       |
| -------------------------------------------------- | ---------------------------------------------------------- |
| 順位の再導出とエンジンの方針が食い違い、金額が誤る | 決定1。`LoopState` に latch し、画面側の導出を消す          |
| BET を払わずに対局できる経路が残る                 | 決定10。`restart` を削除し、開始経路を App に一本化         |
| 所持コインが尽きて永久に遊べなくなる               | 決定12。リデューサ側で条件付きの補充を許可                  |
| localStorage の破損・不在でアプリが落ちる          | 決定6。読み書きとも `try/catch`、型検査つき                 |
| 端数処理の食い違いで1コインずれる                  | 決定2。`floor` を1箇所に閉じ、倍率の不変条件をテストで固定  |
| E2E が対局1局分の時間で長くなる                    | `?fast=1` と `?turnMs=` を使う（Step 4b で用意済み）        |
