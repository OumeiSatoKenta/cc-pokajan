# Step 4b: プレイテスト反映 — 設計

## 全体方針

3件の要求のうち **R1（可視化）と R3（整列）は表示層に閉じる**。
`GameState` にも `RulesConfig` にも触れない。

**R2（持ち時間）だけが層をまたぐ。** 数値はルール値なので `RulesConfig` に置く必要があり、
計測は「エンジンは時計を持たない」原則により UI 層に置く必要がある。
この2つを両立させる境界の引き方が本設計の中心。

---

## R2: 持ち時間

### 決定1: `claimWindowMs` を `turnTimer` に置き換える（残さない）

```ts
// src/engine/types.ts
export interface TurnTimerConfig {
  readonly initialMs: number
  readonly decrementMs: number
  readonly minMs: number
}

export interface RulesConfig {
  // ...
  readonly turnTimer: TurnTimerConfig // claimWindowMs を置き換える
}
```

```ts
// src/config/rules.ts
turnTimer: { initialMs: 20_000, decrementMs: 5_000, minMs: 5_000 },
```

**なぜ残さないか**: `claimWindowMs` と `turnTimer.initialMs` はどちらも
「割り込みの受付が開いている長さ」を表す。両方を持たせると、Step 6 の設定画面で
片方だけ変更されたときに静かに食い違う。**同じ概念に2つの真実を置かない。**

エンジン側の変更は `applyDiscard` の1行だけ。

```ts
draft.claimTimerMs = rules.turnTimer.initialMs // 旧: rules.claimWindowMs
```

ロジックは変わらない（機械的な参照先の付け替え）。

### 決定2: 残り持ち時間は `LoopState` が持つ

```ts
export interface LoopState {
  readonly game: GameState
  readonly pending: readonly GameEvent[]
  readonly gameOverReason: GameOverReason | null
  /** 人間の現在の持ち時間（ミリ秒）。時間切れのたびに減る。 */
  readonly timeLimitMs: number
  /** 人間が今引いたカードの uid。ツモ切りの対象。 */
  readonly drawnUid: number | null
}
```

`GameState` に入れない理由は3つ。

1. エンジンが時計を持たない原則に反する
2. 対局の再現性（シード + アクション列）に無関係な値が混ざる
3. `tests/engine/autoplay.test.ts` の不変条件検査の対象が増える

**CPU は持ち時間を持たない**（即決するため）。したがってプレイヤーごとの配列ではなく
人間1人分のスカラーで足りる。将来 `humanSeats` が複数になったら配列化する。

### 決定3: 「時間切れのときだけ減る」を専用のアクション種別で表す

```ts
export type LoopAction =
  | { readonly type: 'ENGINE'; readonly action: Action }
  | { readonly type: 'TIMEOUT'; readonly action: Action } // ★追加
  | { readonly type: 'EVENTS_CONSUMED'; readonly count: number }
  | { readonly type: 'RESTART'; readonly state: LoopState }
```

`ENGINE` に `timedOut?: boolean` を足す形にしない。判別共用体の枝として分けておけば、
`switch` の網羅性検査が「時間切れ経路の扱いを書き忘れる」ことを防ぐ。

**減算するのは、エンジンのアクションが実際に成功したときだけ。**

```ts
case 'TIMEOUT': {
  const next = applyEngine(state, action.action) // 失敗時は state をそのまま返す
  if (next === state) {
    return state // 競合で無効だった = プレイヤーは時間内に打っていた。減らさない
  }
  return { ...next, timeLimitMs: nextTimeLimitMs(state.timeLimitMs, rules) }
}
```

これは競合の扱いとして正しい。時間切れの発火とプレイヤーのクリックは互いに無関係な
タイミングで起こるため、「押した瞬間に時間切れが走った」場合に
**プレイヤーは時間内に打っているのに持ち時間を失う**という理不尽が起こりうる。
アクションが `IllegalActionError` で弾かれたということは、
先にプレイヤーの操作が通っていたということなので、減算しないのが筋が通る。

### 決定4: 減算式

```ts
export function nextTimeLimitMs(current: number, rules: RulesConfig): number {
  return Math.max(rules.turnTimer.minMs, current - rules.turnTimer.decrementMs)
}
```

`20000 → 15000 → 10000 → 5000 → 5000 → …`。下限で飽和する。

### 決定5: 人間が時計に乗っている状態を1つの純粋関数で決める

```ts
export type TimedDecision = 'claim' | 'discard' | 'declare'

export interface HumanTimeout {
  readonly kind: TimedDecision
  readonly action: Action
  /** タイマーを張り直すべき境界を表すキー。`useEffect` の依存に使う。 */
  readonly key: string
}

export function decideTimeout(
  game: GameState,
  humanSeat: PlayerId,
  drawnUid: number | null,
  rules: RulesConfig,
): HumanTimeout | null
```

| フェーズ      | 条件                              | 時間切れ時のアクション                | キー                            |
| ------------- | --------------------------------- | ------------------------------------- | ------------------------------- |
| `claimWindow` | `claims[humanSeat] === null`      | `TICK(turnTimer.initialMs)`           | `claim:<lastDiscard.uid>`       |
| `discard`     | `turn === humanSeat`              | `DISCARD(ツモ切り対象の uid)`         | `discard:<turn>:<chainCount>`   |
| `selfDeclare` | `declarer === humanSeat`          | `SKIP_DECLARE`                        | `declare:<declarer>:<chainCount>` |
| その他        | —                                 | `null`                                | —                               |

**`selfDeclare` を含める理由**（要求には「ロンと打牌」としか書かれていない）:
このフェーズも人間の入力を無期限に待つ状態であり、放置すると対局が永久に止まる。
R2 の目的が「放置しても進行が止まらないこと」である以上、
ここだけ無制限にすると同じ欠陥が残る。仕組みは他の2つと完全に共通なので追加コストはない。
なお**フリテンがない**ため、自動見送りされても次巡で同じ役を宣言し直せる（回復可能）。

### 決定6: `TICK` には経過時間ではなく上限値を送る（重要な罠）

エンジンの `claimTimerMs` は `rules.turnTimer.initialMs` で初期化される。
一方 UI の持ち時間は摩耗して 5 秒まで減りうる。

ここで「実際に待った時間」= `timeLimitMs` を `TICK(deltaMs)` に渡すと、
`claimTimerMs` が 0 にならず**自動パスが発火せずに対局が固まる**。

```ts
// 正: 受付が終わったことを伝えるので、上限値を送って必ず0にする
{ type: 'TICK', deltaMs: rules.turnTimer.initialMs }
```

UI が時間の権威であり、エンジンのカウンタは「窓を閉じるためのスイッチ」でしかない。

### 決定7: ツモ切りの対象は `CardDrawn` イベントから特定する

「手札の末尾が引いたカード」に依存しない。
連続宣言で補充が入ると末尾は補充カードになり、**引いたカードが手札の途中に残る**。

```
DRAW(X) → hand = [..., X]
DECLARE(X を含まない役) → 3枚消費
補充 → hand = [..., X, r1, r2, r3]   ← 末尾は r3 だが、ツモ切り対象は X
```

`CardDrawn` イベント（`playerId === humanSeat`）で `drawnUid` を記録し、
`Discarded`（`playerId === humanSeat`）で `null` に戻す。

使用時は**手札に残っているかを必ず確認する**。引いたカードが役で消費された場合は
「引いたカード」が存在しないため、手札の末尾（＝最後に加わったカード）を対象にする。

```ts
export function autoDiscardUid(hand, drawnUid): number | null {
  if (drawnUid !== null && hand.some((c) => c.uid === drawnUid)) return drawnUid
  return hand.at(-1)?.uid ?? null
}
```

### 決定8: タイマーのキーに `claims` を含めない（既存の競合対策の維持）

Step 4 で作り込んだ「自動進行の `useEffect` は決定の同一性だけを依存に取る」構造と対になる。

人間が `claimWindow` で考えている間、CPU の意思表示が次々と `game` を書き換える。
タイマーの依存に `game` や `claims` を含めると、**CPU が1人表明するたびに
人間の持ち時間タイマーが破棄・再予約され、いつまでも時間切れにならない**。

`key` を上表のとおり「フェーズ + 対象者 + 局面の識別子」だけで構成することで、
CPU の表明では key が変わらず、タイマーが張り直されない。

### 決定9: `useGameLoop` の効果を1本にまとめる

既存の「宣言受付の時間切れ」効果（`isClaimWindowOpen` 依存）を置き換える。

```ts
const timeout = decideTimeout(game, humanSeat, loop.drawnUid, rules)
const timeoutKey = timeout?.key ?? null

const fireTimeout = useEffectEvent(() => {
  if (timeout !== null) dispatch({ type: 'TIMEOUT', action: timeout.action })
})

useEffect(() => {
  if (timeoutKey === null) return
  const timer = setTimeout(fireTimeout, timeLimitMs)
  return () => clearTimeout(timer)
}, [timeoutKey, timeLimitMs])
```

`timeLimitMs` を依存に含めてよい理由: この値が変わるのは時間切れが起きた直後だけで、
そのとき `timeoutKey` も必ず変わっている（フェーズか局面が進む）。
待機中に単独で変わることはない。

### 決定10: タイマーバーの表示範囲と E2E への影響

`TimerBar` は割り込み専用ではなくなるため、`data-testid` を
`claim-timer` → **`turn-timer`** に変更し、`data-timer-kind`（`claim` / `discard` / `declare`）を付ける。

**これは E2E の破壊的変更である。** `tests/e2e/table.spec.ts` の `playUntilClaimWindow` は
`claim-timer` の可視性で「割り込みの受付が開いた」ことを判定している。
バーが打牌フェーズでも出るようになると、この判定が打牌フェーズを割り込みと誤認し、
存在しない「見送る」ボタンを待って**デッドロックする**。
セレクタを `[data-testid="turn-timer"][data-timer-kind="claim"]` に変更する。

バーは `ActionBar` の内側にあるが、`actionBarItems` が空を返す場面（打牌フェーズなど）では
`actions--idle` が返されバーが描画されない。**バーの描画を items の有無から独立させる。**

### 決定11: E2E のために持ち時間を URL から上書きできるようにする

持ち時間が 20 秒になると、時間切れを検証する E2E が1件あたり 20 秒待つことになる。
`?fast=1` は「演出の待ち時間だけを消す。ルール値には影響しない」と定義済みで、
この定義は崩さない（ルール値を消すと検証したい対象そのものが消える）。

`?turnMs=<ミリ秒>` を追加し、`DEFAULT_RULES.turnTimer.initialMs` だけを上書きする。
`?seed=` と同じく、E2E の再現性のために存在するオプションとして扱う。

---

## R1: グループ構成メンバーの可視化

`BoardInfo` の各グループに構成メンバーを列挙する。

```
┌────────────────────────────┐
│ 星屑カルテット      2/4    │
│ [アオイ] [ヒナ] ミオ ルナ   │  ← [] = 所持済み
└────────────────────────────┘
```

- 所持: `board__member--held`（背景を塗る）
- 未所持: 既定（薄い文字）
- ボーナス: `board__member--bonus`（記号を添える）

グループのチップは `white-space: nowrap` の横並びから、
**メンバー行を持つブロック**に変わる。4グループ × 最大5人 = 最大20名。
375px 幅では `flex-wrap` で折り返し、グループ単位では折り返さないようにする。

`memberNameById` は既に props で渡っている。`bonusMemberIds` も同様。
**新しい props は追加しない。**

## R3: 手札の整列

### 新規: `src/ui/handOrder.ts`（純粋関数・React 非依存）

```ts
export interface HandOrderContext {
  readonly activeGroups: readonly Group[]
  readonly colors: readonly ColorId[]
  /** 今引いたカード。末尾に固定して他と区別する。 */
  readonly drawnUid: number | null
}

export function sortHand(cards: readonly Card[], ctx: HandOrderContext): readonly Card[]
```

**並び順**: グループ順 → グループ内のメンバー順 → 色順 → `uid`。

- グループ順・メンバー順は `activeGroups` の配列順をそのまま使う。
  ここは局ごとにシャッフルされた順序であり、**局を通じて安定している**
- 色順は `rules.colors` の順（ピンク → 青 → オレンジ）。
  `COLOR_IDS` 定数を直接使わず設定値を経由するのは、
  Step 6 で色構成が変わったときに追随させるため
- 最後に `uid` で決定的に整列させる。同着を残すと framer-motion の
  `layout` アニメーションが毎レンダーで揺れる
- どのグループにも属さないメンバー（理論上は起こらない）は末尾に置く。
  例外を投げない — 表示のためのソートが対局を落とす理由にはならない

### 決定: 引いた1枚は末尾に固定する

整列に混ぜると「今引いた1枚」が手札に紛れ、ツモ切りの判断ができなくなる。
麻雀 UI と同じく右端に離して置き、`hand__drawn` で間隔を空ける。

### 決定: 並べ替えは表示層だけで行う

`sortHand` を呼ぶのは `TableScreen`（`useMemo`）。
`Hand` は受け取った順に描画するだけの素直なコンポーネントのまま保つ。

**エンジンの `hand` 配列は絶対に並べ替えない。** `GameState` の順序を変えると
カード保存則の検査（`tests/engine/autoplay.test.ts`）とリプレイの再現性に影響する。
`AnimatePresence` の `key` は `card.uid` なので、
表示順が変わっても `layout` アニメーションが位置を補間する。

---

## ファイル別の変更一覧

| ファイル                            | 区分 | 内容                                                    |
| ----------------------------------- | ---- | ------------------------------------------------------- |
| `src/engine/types.ts`               | 修正 | `TurnTimerConfig` 追加、`claimWindowMs` を `turnTimer` へ |
| `src/engine/game.ts`                | 修正 | `applyDiscard` の参照先を付け替え（1行）                |
| `src/config/rules.ts`               | 修正 | `turnTimer` の既定値                                    |
| `src/ui/handOrder.ts`               | 新規 | `sortHand`                                              |
| `src/ui/hooks/loopReducer.ts`       | 修正 | `timeLimitMs` / `drawnUid` / `TIMEOUT` / `decideTimeout` |
| `src/ui/hooks/useGameLoop.ts`       | 修正 | 持ち時間タイマーの効果、`timeLimitMs` / `drawnUid` の公開 |
| `src/ui/components/BoardInfo.tsx`   | 修正 | 構成メンバーの列挙                                      |
| `src/ui/components/TimerBar.tsx`    | 修正 | `turn-timer` へ改名、`data-timer-kind`                  |
| `src/ui/components/ActionBar.tsx`   | 修正 | バーの描画を items から独立させる                       |
| `src/ui/components/Hand.tsx`        | 修正 | 引いた1枚の見た目                                       |
| `src/ui/screens/TableScreen.tsx`    | 修正 | `sortHand` の適用、タイマー props                       |
| `src/ui/table.css`                  | 修正 | メンバー一覧・ツモ牌・タイマーのスタイル                |
| `src/App.tsx`                       | 修正 | `?turnMs=` の読み取り                                   |
| `tests/ui/handOrder.test.ts`        | 新規 | 整列の検証                                              |
| `tests/ui/loopReducer.test.ts`      | 修正 | 持ち時間の検証                                          |
| `tests/ui/App.test.tsx`             | 修正 | `claimWindowMs` 参照の追随                              |
| `tests/config/rules.test.ts`        | 修正 | `turnTimer` の検証                                      |
| `tests/e2e/table.spec.ts`           | 修正 | セレクタ変更 + 時間切れの検証追加                       |

## リスク

| リスク                                                       | 対策                                                              |
| ------------------------------------------------------------ | ----------------------------------------------------------------- |
| タイマーの依存に `game` が紛れ込み、CPU のロンが発火しなくなる | `decideTimeout` の `key` を純粋関数として切り出し単体テストで固定  |
| E2E `playUntilClaimWindow` が打牌フェーズを誤認しデッドロック | `data-timer-kind="claim"` で限定。決定10 に記載                    |
| `TICK` に経過時間を送って対局が固まる                        | 決定6。`decideTimeout` が上限値を組み立てるので呼び出し側は選べない |
| 20 秒待機で E2E が長時間化                                   | 決定11 の `?turnMs=`                                              |
| ツモ切りが連続宣言後に誤ったカードを捨てる                   | 決定7。`drawnUid` の在籍確認 + 単体テスト                          |
| グループ一覧が 375px で溢れる                                | メンバー行を `flex-wrap`。E2E は既存のスクリーンショットで確認     |
