# 設計

## 全体方針

Step 3 までで「ゲームロジックは正しい」ことが自動テストで証明されている。
本ステップの設計上の目標は、**その正しさを UI 側で壊さないこと**に尽きる。

具体的には次の3点を守る。

| 守ること                       | 手段                                                             |
| ------------------------------ | ---------------------------------------------------------------- |
| エンジンを UI の都合で歪めない | `src/engine/` に一切変更を加えない。ラッパー状態は UI 層に置く    |
| UI がルールを再実装しない      | 成立判定・合法性の判断は必ずエンジンの関数を呼ぶ                 |
| 不正な操作を発生させない       | 押せるボタンを、その時点でエンジンが受け付けるアクションに限定する |

## エンジンと React の接続

Step 3 で決定済みの方式（UI 層のラッパー状態 + `useReducer`）を実装する。

### `LoopState` と `createLoopReducer`

```ts
/** UI 層だけが持つ状態。エンジンの GameState は純粋なまま保つ。 */
interface LoopState {
  readonly game: GameState
  /** 演出待ちのイベントキュー。UI が再生し終えたら削る。 */
  readonly pending: readonly GameEvent[]
}

/** ドメインのアクションと UI 専用のアクションを別 union に保つ。 */
type LoopAction =
  | { readonly type: 'ENGINE'; readonly action: Action }
  | { readonly type: 'EVENTS_CONSUMED'; readonly count: number }

function createLoopReducer(rules: RulesConfig): (s: LoopState, a: LoopAction) => LoopState
```

**リデューサは純粋関数のまま保つ。** イベントの消費（アニメーション再生）は
リデューサの中ではなく、`pending` を見る `useEffect` 側で行う。
リデューサ内で副作用を起こすと、`useState` 案を却下した理由
（StrictMode の二重実行で演出が2回走る）をそのまま再現してしまう。

`createLoopReducer` は `useMemo(() => createLoopReducer(rules), [rules])` で1回だけ作る。

### 自動進行の駆動

エンジンは「次に誰が何をするか」を教えてくれるが、**いつ**やるかは UI が決める。
フェーズごとに「自動で進めるアクション」と「人間の入力を待つ状態」を切り分ける。

```
decideAutoAction(game, rules, ai, humanSeat): { action, delayMs } | null
                                               ↑ null = 人間の入力待ち
```

**「誰を見るか」はフェーズによって違う。** `selfDeclare` は `declarer`、
`draw` / `discard` は `turn` を対象とする。ロンによる連続宣言中は両者が食い違うため、
`selfDeclare` の分岐で `turn` を見ると誤ったプレイヤーを操作対象にしてしまう。

| フェーズ       | 対象      | CPU のとき            | 人間のとき                                        |
| -------------- | --------- | --------------------- | ------------------------------------------------- |
| `draw`         | `turn`    | 自動 `DRAW`           | **自動 `DRAW`**（引くのは選択ではない）           |
| `selfDeclare`  | `declarer`| AI の判断             | 役があれば入力待ち / **なければ自動 `SKIP_DECLARE`** |
| `discard`      | `turn`    | AI が選ぶ             | 入力待ち（手札クリック）                          |
| `claimWindow`  | 下記参照  | 未表明の CPU を1人ずつ処理 | 役があれば入力待ち / **なければ自動 `PASS`**   |
| `gameOver`     | —         | 何もしない（`null`）  | 何もしない（`null`）                              |

**`draw` を人間の手番でも自動にする理由**: 原作でも「引く」は選択ではなく、
引いた後の宣言と捨て札だけが判断である。ボタンを押させると1手ごとに余計な操作が増える。

**役がないときに宣言フェーズを自動通過させる理由**: エンジンは「宣言できるかどうか」に
関わらずこのフェーズを通す。役が0件のときに「見送る」ボタンを押させるのは無意味な操作になる。
**この扱いは `selfDeclare` と `claimWindow` で対称にする。** 割り込める役がないのに
受付時間いっぱい待たされるのは、`selfDeclare` を自動通過させる理由と同じ理屈で不合理である。

### `claimWindow` の処理順序

**このフェーズだけは、未表明者が同時に複数存在しうる。**
既存の `autoplay.ts` の `nextAction` は「最初に見つかった未表明者」を処理するが、
これを UI にそのまま持ち込んではいけない。

`claims` のキーは `PlayerId`（数値）であり、`Object.entries` は整数キーを昇順で返す。
既定の人間席は 0 番なので、**「最初の未表明者」は捨て手番でない限り常に人間**になる。
その実装では人間が決めるまで CPU の意思表示が一切発行されず、
受け入れ条件「CPU の割り込み判断は AI が行い、人間の入力を待たない」に反する。

正しい順序:

```
1. humanSeat 以外で claims[id] === null な CPU を昇順で探し、いれば その1人を処理する
2. CPU が全員表明済みで、人間だけが未表明なら:
   - 人間に割り込める役がなければ 自動 PASS
   - あれば null（入力待ち。受付時間の経過で自動パスされる）
```

CPU を先に処理し切ることで、人間が考えている間も他家の判断が進む。

### 遅延の設計

CPU の思考時間はエンジンに存在しないため、UI が作る。

| アクション            | 遅延    | 意図                                     |
| --------------------- | ------- | ---------------------------------------- |
| `DRAW`                | 420ms   | カードが飛ぶアニメーションの尺           |
| `DISCARD`（CPU）      | 620ms   | 「考えている」間                         |
| `DECLARE`             | 900ms   | 役の成立を認識できる間                   |
| `SKIP_DECLARE`        | 0ms     | 見送りは演出不要                         |
| `CLAIM` / `PASS`（CPU）| 260ms  | 割り込み判断は速いほうが自然             |

**遅延の合計が体感速度を決める。** 全員 CPU で1巡すると
`(420 + 620 + 260×3) × 4 ≈ 7.3秒`。

**ただしこれは CPU だけの試算である。** 実プレイでは人間が捨て札を選ぶ時間と、
割り込みを迷う時間（最大 `claimWindowMs` = 4000ms が1巡に最大3回）が上乗せされる。
PRD の「1局3〜7分」に収まるかは実測で確認する。

### 乱数シードの決定

| 場面           | シード                                                    |
| -------------- | --------------------------------------------------------- |
| 初回           | `?seed=` があればその値、なければ `Date.now()`             |
| `restart()`    | 直前のシード + 1（毎回異なる配牌になれば十分）             |
| E2E            | **`?seed=` で固定する**                                    |

エンジンは決定的だが UI 層はそうである必要がない。
`?seed=` を用意するのは、**E2E の安定性のため**である。
「待ちがある手札で黄色枠が出る」ようなテストは配牌に依存するため、
シードを固定しないと「たまたま黄色枠が出ない配牌」で落ちる不安定なテストになる。

### タイマー効果の分離

3つの独立した `useEffect` で駆動する。

#### (1) 自動進行 — 依存はアクションの同一性キーにする

素朴に `loop.game` を依存に置くと、**別の効果が状態を変えるたびに予約中のタイマーが
破棄・再予約される**。これは次の実害を生む。

> `claimWindow` 中、受付タイマーが `TICK` を送るたびに `loop.game` が変わる。
> すると CPU の割り込み判断のために予約した 260ms のタイマーが、
> 260ms 経つ前に毎回キャンセルされる。`TICK` の間隔が 260ms より短ければ
> **CPU の意思表示は永久に発火せず、受付時間切れで強制パスにされる**。
> 「CPU がロンできたはずの局面で必ず見逃す」というゲームの正しさに関わるバグになる。

対策として、効果の依存を **`loop.game` ではなく「決定したアクションの同一性」** にする。

```ts
const auto = useMemo(() => decideAutoAction(loop.game, rules, ai, humanSeat), [...])

/** アクションの同一性。これが変わらなければ予約中のタイマーを維持する。 */
const autoKey = auto === null ? null : autoActionKey(loop.game, auto.action)

// 依存配列に載せずに最新の値を読むための正式な仕組み（React 19 で安定）。
const fireAutoAction = useEffectEvent(() => {
  if (auto !== null) dispatch({ type: 'ENGINE', action: auto.action })
})

useEffect(() => {
  if (autoKey === null || auto === null) return
  const id = setTimeout(fireAutoAction, auto.delayMs)
  return () => clearTimeout(id)
}, [autoKey])
```

`autoActionKey` はフェーズ・`turn`・`declarer`・アクション種別・対象（`uid` や
候補の消費カード uid 列）を連結した文字列とする。**決定が実質的に変わったときだけ**
キーが変わり、タイマーが張り直される。

`useEffectEvent` を挟むのは、キーが同じでもタイマー発火時に最新の決定を使うため
（古いクロージャの値を dispatch しない）。当初は ref をレンダー中に書き換える
自前実装を想定していたが、React 公式が「レンダー中の ref 書き込みは避ける」としており、
まさにこの用途のための API が用意されているためそちらを使う。

> **注意**: `useEffectEvent` が返す関数は**同一コンポーネント内の効果からしか呼べない**。
> 他のコンポーネントへ渡したり、フックの戻り値として公開したりはできない
> （`react-hooks/rules-of-hooks` が検出する）。`restart` のように外へ渡すものは
> `useCallback` を使う。

**StrictMode について**: 初回マウント時の「効果 → クリーンアップ → 効果」は同期的に行われ、
`setTimeout` の発火より必ず先にクリーンアップが走るため、同じアクションが2回
dispatch されることはない。**ただしこの保護が効くのは初回マウント時の二重実行に対してだけ**で、
通常の再レンダーで守ってくれるわけではない。上記のキー設計はそちらを担う。

#### (2) 宣言受付の時間切れ — 繰り返し `TICK` を送らない

受付の残り時間は **CSS アニメーションで描画し、React の状態を毎フレーム更新しない。**
エンジンへは**時間切れの1回だけ** `TICK` を送る。

```ts
const isHumanPending = game.phase === 'claimWindow' && game.claims[humanSeat] === null

useEffect(() => {
  if (!isHumanPending) return
  const id = setTimeout(
    () => dispatch({ type: 'ENGINE', action: { type: 'TICK', deltaMs: rules.claimWindowMs } }),
    rules.claimWindowMs,
  )
  return () => clearTimeout(id)
}, [isHumanPending, rules.claimWindowMs, dispatch])
```

**永続ドキュメントからの意図的な変更**: `docs/functional-design.md` と
`docs/ideas/pokajan-plan.md` は `requestAnimationFrame` で `TICK` を送り
`claimTimerMs` を減算する設計だった。これを1回の `setTimeout` に変える理由は3つ:

1. **上記(1)の競合の原因そのものを取り除ける**（状態を毎フレーム変えない）
2. **バーの描画が滑らかになる**。60fps の React 再レンダーより CSS アニメーションの方が軽い
3. **バックグラウンドタブでの間引きの影響が小さい**（Step 3 からの申し送り事項）。
   長い `setTimeout` 1本なら、間引かれても「実時間より少し遅れて時間切れになる」だけで済む

`claimTimerMs` は受付中に実時間を反映しなくなるが、この値を必要とするのはバーの表示だけで、
それは CSS が担う。時間切れの判定（`applyTick` が0で未表明者をパス扱いにする）は変わらず機能する。

実装後に `docs/functional-design.md` を更新してこの差分を解消する。

#### (3) イベントキューの排出

```ts
const hasPending = loop.pending.length > 0

const drainEvents = useEffectEvent(() => {
  dispatch({ type: 'EVENTS_CONSUMED', count: loop.pending.length })
})

useEffect(() => {
  if (!hasPending) return
  const id = setTimeout(drainEvents, EVENT_HOLD_MS)
  return () => clearTimeout(id)
}, [hasPending])
```

**依存は「キューが空でないか」の真偽値にする。** ここも (1) とまったく同じ理屈で、
`pending` 配列そのものを依存にすると `ENGINE` のたびに新しい配列参照になり、
タイマーが毎回張り直される。演出の間隔（260〜900ms）は保持時間（1600ms）より短いため、
**CPU が続けて打っている間はキューが一度も掃けず、トーストが消えなくなる。**

> (1) で「配列やオブジェクトを依存にすると別経路の変化でタイマーが潰れる」という
> 教訓を得たのに、同じ形の効果がもう1つあることを見落としていた。
> **同種の穴が隣に残っていないかを、対策を入れた直後に確認すること。**

**自動進行をイベントの排出でブロックしない。** ブロックすると
`CardDrawn` のような些細なイベントのたびに待つことになり体感が遅くなる。
代わりに (1) の per-action 遅延で間を作り、イベントは演出の表示時間だけ保持して独立に捨てる。

**`EVENT_HOLD_MS = 1600`** とする。`DECLARE` の遅延（900ms）より長いため、
連続宣言では**前のトーストが消える前に次の `Declared` が積まれる**。
そのため `YakuToast` は **`pending` 内の `Declared` を最新1件だけ表示する**（積み上げない）。

この設計では、進行を止めない代償として
**トーストの内容（過去の出来事）と盤面（既に先へ進んでいる）が一時的にズレうる。**
トーストには**宣言したプレイヤー名を必ず含める**ことで、
「今まさに起きたこと」ではなく「直前に起きたこと」として読めるようにする。

### 公開するインターフェース

```ts
interface GameLoop {
  readonly state: GameState
  readonly events: readonly GameEvent[]
  readonly waits: WaitInfo
  /** 自分の手番で宣言できる役（selfDeclare 中のみ非空）。 */
  readonly declarable: readonly YakuCandidate[]
  /** 他家の捨て札に割り込める役（claimWindow 中のみ非空）。 */
  readonly claimable: readonly YakuCandidate[]
  readonly humanSeat: PlayerId
  readonly canDiscard: boolean
  discard: (uid: number) => void
  declare: (candidate: YakuCandidate) => void
  claim: (candidate: YakuCandidate) => void
  pass: () => void
  restart: () => void
}
```

**`declarable` / `claimable` / `canDiscard` を UI に渡す理由**:
UI 側で「今このボタンを押せるか」を再判定させない。
エンジンが受け付けるアクションと画面上の操作可能性を1箇所で対応させる。

**候補の算出には `src/engine/yaku` の `findYaku` を直接使う。**
`ai.ts` の `decideDeclare` / `decideClaim` は `bestYaku` で最良の1つに絞ってしまうため、
人間に選ばせる用途には使えない。`game.ts` は `findYaku` を再エクスポートしていないので、
`import { findYaku, computeWaits } from '../../engine/yaku'` の形で取る
（既存の `App.tsx` と同じ経路）。

```ts
declarable = phase === 'selfDeclare' && declarer === humanSeat
  ? findYaku(hand, ctx)                                  // ツモ
  : []
claimable  = phase === 'claimWindow' && claims[humanSeat] === null && lastDiscard !== null
  ? findYaku([...hand, lastDiscard], ctx, lastDiscard)   // ロン
  : []
```

**`pass()` は1つの関数でフェーズに応じて発行するアクションを切り替える。**

| フェーズ      | 発行するアクション    | ボタンの表記 |
| ------------- | --------------------- | ------------ |
| `selfDeclare` | `SKIP_DECLARE`        | **見送る**   |
| `claimWindow` | `PASS(humanSeat)`     | **見送る**   |

表記を「見送る」に統一する。プレイヤーにとってはどちらも「宣言しない」という同じ判断であり、
内部のアクション名の違いを見せる必要がない。

## 画面構成

### コンポーネント階層

```
App                        画面ステートマシン（本 Step では table のみ）
└─ TableScreen             useGameLoop を呼ぶ唯一の場所
   ├─ PlayerSeat × 3       他家（対面・左・右）
   ├─ BoardInfo            山札残り・ボーナス・今局のグループ
   ├─ DiscardPile          自分の河
   ├─ Hand                 自分の手札
   │  └─ CardView × N
   ├─ ActionBar            宣言ボタン / 見送りボタン / TimerBar
   ├─ YakuToast            役成立の演出
   └─ ResultOverlay        終局時の順位表示
```

**`useGameLoop` を呼ぶのは `TableScreen` だけ**にする。
複数箇所で呼ぶと別々のゲームが走ってしまうため、状態は props で配る。

### レイアウト

```
┌────────────────────────────────────┐
│           対面（プレイヤー2）        │
├──────┬──────────────────┬──────────┤
│ 左   │  山札 43 / ボーナス │ 右       │
│ (P1) │  今局のグループ一覧  │ (P3)     │
├──────┴──────────────────┴──────────┤
│ 自分の河                            │
├────────────────────────────────────┤
│ 手札  □ □ ▣ □ ▣ □ □   ▣=待ち       │
├────────────────────────────────────┤
│ [宣言] [見送る]   ████░░ 2.4秒      │
└────────────────────────────────────┘
```

**375px 対応**（実装時に方式を変更）: 当初は CSS Grid の `grid-template-areas` と
`min()` によるカード幅の指定を想定していたが、**flexbox で等分する方式に変更した。**

ビューポート単位（`vw`）でカード幅を決め打ちすると、コンテナの padding を差し引いた
実際の利用可能幅と一致せず端末幅ごとに溢れる（375px で実際に溢れた）。
手札は `flex: 1 1 0` で等分し `max-width` だけを与える形にして、
利用可能幅がいくつであっても8枚が必ず1行に収まるようにしている。

### アニメーション（framer-motion 13）

インストールしたのは **framer-motion 13.0.0**。`motion` と `AnimatePresence` は
パッケージのルート（`from 'framer-motion'`）から import する。
`motion/react` は別パッケージ `motion` のパスであり、本プロジェクトには存在しない。

| 対象           | 実装                                                     |
| -------------- | -------------------------------------------------------- |
| 手札の出入り   | `AnimatePresence` + `initial/animate/exit`（uid を key に）|
| 手札の並び替え | `layout` プロップ                                        |
| 役成立トースト | `AnimatePresence` でフェード + スライド                   |
| 待ちの黄色枠   | CSS（アニメーションではなく状態表現なので framer 不要）   |

**`prefers-reduced-motion` への対応**: `useReducedMotion()` が `true` のとき、
トランジションの `duration` を 0 にする。要素の出入り自体は行うが動きを消す。

**import を対局画面配下に限定する。** `App.tsx` や将来の Title / Bet / Result には
持ち込まない（PRD のバンドルサイズ要件）。

## テスト戦略

### 環境を `node` のまま維持する

jsdom と `@testing-library/react` は**導入しない**。理由は次のとおり。

| 検証したいもの           | 手段                                        |
| ------------------------ | ------------------------------------------- |
| ラッパー状態の遷移       | `createLoopReducer` を**純粋関数として**直接テスト |
| 自動進行の判断           | `decideAutoAction` を**純粋関数として**直接テスト |
| コンポーネントが壊れない | `renderToStaticMarkup`（既存の方式）         |
| 実際の操作と時間の経過   | **Playwright**（本物のブラウザ）             |

**設計を素直にテストできる形にしたので、DOM のシミュレーションが要らない。**
リデューサと判断ロジックを純粋関数として切り出したことで、
タイマーとレンダリングを伴う部分だけが Playwright の担当になる。

これは「テストのために設計を歪める」のではなく、
**Step 3 までの純粋関数中心の設計を UI 層にも適用した結果**である。

### Playwright の構成

- `tests/e2e/table.spec.ts`
- `playwright.config.ts` に `webServer` を設定し、`npm run dev` を自動起動する
- Vitest とは拡張子（`.spec.ts` / `.test.ts`）で実行系を分離済み
- CI では `--reporter=list`、失敗時にスクリーンショットを保存

**検証シナリオ**:

1. 対局画面が表示され、手札が7枚ある
2. 自分の手番になったらカードをクリックして捨てられる
3. 待ちがある手札で黄色枠が表示される（**固定シードで再現性を担保**）
4. **宣言窓で何も操作しないと、時間切れで自動的にパスされ進行が続く**
5. **人間が宣言窓で迷っている間も、CPU の意思表示が先に処理される**
6. 1局を最後まで進めて終局に到達する（順位が表示される）

シナリオ 4・5 は、タイマーと `useEffect` に依存するため純粋関数テストでは検証できない。
**設計上もっともバグが起きやすい箇所**（上記の競合の指摘はまさにここだった）なので、
E2E に必ず含める。

**時間のかかるテストへの対処**: 1局は数分かかるため、E2E では
`?fast=1` のクエリパラメータで遅延を 0 にする開発用スイッチを設ける。
本番の体験を変えないよう、**遅延の値だけ**を差し替える
（受付時間 `claimWindowMs` はルール値なので変えない。シナリオ4はこれを待つ）。

### 配線の検証（純粋関数と E2E の中間）

`renderToStaticMarkup` は `useEffect` を実行しないため、
「ボタンが正しい条件で出るか」「クリックが正しい `uid` を渡すか」を検証できない。
一方 E2E は遅くて粒度が粗い。この隙間を埋めるため、
**表示部品を「状態 → 表示すべき内容」の純粋関数として切り出せる範囲で切り出し**、
その関数を直接テストする。

例: `ActionBar` が出すボタンの一覧を決める `actionBarItems(loop)` を純粋関数にし、
`declarable` が空／非空、`claimable` が空／非空の各ケースを直接検証する。
jsdom を使わずに配線の大部分を押さえられる。

## 影響範囲

| ファイル                          | 変更内容                                     |
| --------------------------------- | -------------------------------------------- |
| `src/ui/hooks/useGameLoop.ts`     | 新規                                         |
| `src/ui/hooks/loopReducer.ts`     | 新規（純粋なリデューサと自動進行の判断）     |
| `src/ui/screens/TableScreen.tsx`  | 新規                                         |
| `src/ui/components/*.tsx`         | 新規（9ファイル）                            |
| `src/ui/table.css`                | 新規                                         |
| `src/App.tsx`                     | 画面ステートマシンに差し替え                 |
| `src/App.css`                     | 動作確認画面用のスタイルを整理               |
| `tests/ui/loopReducer.test.ts`    | 新規                                         |
| `tests/ui/App.test.tsx`           | 対局画面のスモークテストに差し替え           |
| `tests/e2e/table.spec.ts`         | 新規                                         |
| `playwright.config.ts`            | 新規                                         |
| `package.json`                    | `test:e2e` スクリプトの追加                  |

**`src/engine/` は一切変更しない。**

## Step 5 へ申し送る設計課題

- `App.tsx` の画面ステートマシンは `table` のみ有効。Step 5 で `title` / `bet` / `result` を足す際、
  `TableScreen` のアンマウントでタイマーが確実に解除されることを確認すること
- `useGameLoop` は `rules` と `roster` を props で受け取る。Step 6 でユーザー編集の
  ロスターを渡すようになるため、`createGame` が投げる `RosterValidationError` の
  ハンドリング先を Step 5 の画面遷移で決める必要がある
- 終局後の `ResultOverlay` は Step 5 で `ResultScreen` に置き換わる。
  精算表示を足す場所として設計しておく
