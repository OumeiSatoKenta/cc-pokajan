/**
 * 対局ループの状態とリデューサ。
 *
 * React に触れない部分を純粋関数として切り出し、`useGameLoop` は
 * 「これらをタイマーで駆動する」だけの薄い層にする。
 * こうすることで、UI の振る舞いの大半を jsdom なしで単体テストできる。
 *
 * 判断のロジックは責務ごとに分けている。
 * - `autoAction.ts`: 次に自動で進める1手（CPU の思考・自動通過）
 * - `turnTimer.ts`: 人間の持ち時間と時間切れの判断
 */

import { IllegalActionError, createGame, reduce } from '../../engine/game'
import { nextTimeLimitMs } from './turnTimer'
import type {
  Action,
  GameEvent,
  GameOverReason,
  GameState,
  Payment,
  PlayerId,
  Roster,
  RulesConfig,
  WinKind,
  YakuCandidate,
} from '../../engine/types'

/**
 * 和了1回分の演出データ。
 *
 * **適用前後の点数を両方持つ**のが要点。得点移動は「いくらからいくらへ」を
 * 描くため、片方だけでは足りない。`reduce` 後の `game.players[].score` から
 * 逆算する手もあるが、1回の `reduce` で複数の和了が起きたときに
 * 全部が同じ最終点数になってしまう。
 *
 * **支払い明細（`Paid` の一覧）は持たない。** 画面に出す増減は
 * `scoresAfter - scoresBefore` から作る（表示している点数そのものなので、
 * 集計の書き方でずれる余地がない）。明細が必要になったら、
 * `pending` に残る `Paid` イベントから作り直せる。
 */
export interface WinPresentation {
  readonly playerId: PlayerId
  readonly candidate: YakuCandidate
  readonly winKind: WinKind
  readonly scoresBefore: readonly number[]
  readonly scoresAfter: readonly number[]
}

/**
 * 和了1回分を一意に決める鍵。
 *
 * 構成カードは成立した時点で場から取り除かれ、**二度と場に戻らない**ため、
 * 「誰が・どのカードで」の組は1局のうちに重複しない。
 *
 * 用途は2つある。
 *
 * 1. `DISMISS_WIN` の照合。オーバーレイ全体をクリックで進めるので、
 *    パネル内のボタンの click は**オーバーレイまで泡立つ**。素直に書くと
 *    閉じる処理が2回走り、`pendingWins` が2件落ちて連続和了の2件目が黙って消える。
 *    `stopPropagation` でも塞げるが、それは「今の DOM 構造ではたまたま漏れない」形の
 *    正しさになる。鍵で照合すれば、二重クリック・泡立ち・タイマーとの競合が
 *    すべて同じ1つの規則で無効になる
 * 2. `WinOverlay` の React の `key`。鍵が同じだと、段が進んだ状態のまま
 *    2件目が表示される（カットインが飛ぶ）
 */
export function winKey(win: WinPresentation): string {
  const uids = win.candidate.cards.map((card) => card.uid).sort((a, b) => a - b)
  return `${win.playerId}:${uids.join('-')}`
}

/**
 * UI 層だけが持つ状態。
 *
 * エンジンの `GameState` は純粋なドメインスナップショットのまま保ち、
 * 演出用のイベントキューはこのラッパーが持つ。
 */
export interface LoopState {
  readonly game: GameState
  /** 演出待ちのイベント。UI が再生し終えたら `EVENTS_CONSUMED` で削る。 */
  readonly pending: readonly GameEvent[]
  /**
   * 終局理由。**エンジンが `GameOver` イベントで確定させた値をそのまま保持する。**
   *
   * 点数から UI 側で導出し直さない。エンジンは「破産と山切れが同時に成立したら破産を優先する」
   * というポリシー判断をしており、それを画面側で再現すると、理由が3つ目に増えた瞬間に
   * 静かに食い違う。イベントは表示後に捨てられるため、ここへ写し取っておく。
   */
  readonly gameOverReason: GameOverReason | null
  /**
   * 終局時の順位。**エンジンが `GameOver` イベントで確定させた値をそのまま保持する。**
   *
   * 点数から並べ直さない。エンジンは「点数降順・同点はプレイヤー ID 昇順」という
   * 方針を持っており、画面側で再現すると同点の扱いが変わった瞬間に静かに食い違う。
   * この順位はそのまま順位倍率、つまり**精算額**になるため、食い違いは金額の誤りになる。
   */
  readonly ranking: readonly PlayerId[] | null
  /**
   * 人間の残り持ち時間。**エンジンではなくここが時間の権威**。
   *
   * CPU は即決するため持ち時間を持たない。よってプレイヤーごとの配列ではなく
   * 人間1人分のスカラーで足りる（`humanSeats` が複数になったら配列化する）。
   */
  readonly timeLimitMs: number
  /**
   * 人間が今引いているカードの uid。時間切れのツモ切りで捨てる対象。
   *
   * 「手札の末尾が引いたカード」に依存しない。連続宣言で補充が入ると末尾は補充カードになり、
   * 引いたカードは手札の途中に残るため、末尾を見ると別のカードを捨ててしまう。
   */
  readonly drawnUid: number | null
  /**
   * 演出待ちの和了。**空でない間、対局は進まない。**
   *
   * 単数（`WinPresentation | null`）ではなく配列にしている。今の `reduce` は
   * 1回につき最大1つしか `Declared` を出さない（`applyWin` の呼び出しは
   * `applyDeclare` と `resolveClaims` の2経路で、連続宣言は次のアクションを待つ）が、
   * **単数で持つと将来2つ出るようになった瞬間に片方が黙って消える**。
   * 和了が消えることは「点数が動いたのに演出が出ない」ことで、
   * プレイヤーからは点数バグに見える。
   *
   * 先頭が「今見せている和了」。`DISMISS_WIN` で1つずつ落とす。
   */
  readonly pendingWins: readonly WinPresentation[]
}

/** ドメインのアクションと UI 専用のアクションを別々に保つ。 */
export type LoopAction =
  | { readonly type: 'ENGINE'; readonly action: Action }
  /**
   * 持ち時間を使い切ったことによる自動実行。`ENGINE` にフラグを足すのではなく
   * 別の枝にすることで、`switch` の網羅性検査が時間切れ経路の書き忘れを捕まえる。
   */
  | { readonly type: 'TIMEOUT'; readonly action: Action }
  | { readonly type: 'EVENTS_CONSUMED'; readonly count: number }
  /**
   * 和了演出を閉じて進行を再開させる。
   *
   * **鍵を必ず添える。** 鍵なしで「先頭を1件落とす」と、閉じる操作が二重に走ったときに
   * 2件落ちる（`winKey` の説明を参照）。
   */
  | { readonly type: 'DISMISS_WIN'; readonly key: string }
  | { readonly type: 'RESTART'; readonly state: LoopState }

// --- リデューサ ---------------------------------------------------------------

/**
 * `rules` を束縛したリデューサを作る。
 *
 * **純粋関数のまま保つこと。** イベントの消費（アニメーション再生）はリデューサ内ではなく、
 * `pending` を見る `useEffect` 側で行う。リデューサ内で副作用を起こすと、
 * StrictMode の二重実行で演出が2回走る。
 */
export function createLoopReducer(
  rules: RulesConfig,
  humanSeat: PlayerId,
): (state: LoopState, action: LoopAction) => LoopState {
  return (state, action) => {
    switch (action.type) {
      case 'ENGINE':
        /*
         * **演出待ちの間はエンジンへ通さない。**
         *
         * `useGameLoop` はタイマーを止めるが、それは自動進行を止めるだけで、
         * 人間のクリックまでは止まらない（オーバーレイの外側・キーボード操作・
         * E2E からの直接クリック）。`PLACE_BET` で「画面の無効化だけに頼らない」と
         * したのと同じ理由で、状態の側でも受け付けない。
         */
        if (isPaused(state)) {
          return state
        }
        return applyEngine(state, action.action, rules, humanSeat).next

      case 'TIMEOUT': {
        // 止まっている間は持ち時間も進まない。ここを通すと、演出を読んでいる間に
        // ツモ切りされたうえ、次の手番の持ち時間まで削られる。
        if (isPaused(state)) {
          return state
        }

        const { next, accepted } = applyEngine(state, action.action, rules, humanSeat)

        // **受理されたときだけ持ち時間を減らす。**
        // 時間切れの発火とプレイヤーのクリックは互いに無関係なタイミングで起こるため、
        // 「押した直後に時間切れが走った」という競合が構造上ありうる。弾かれたのは
        // 先にプレイヤーの操作が通っていたからであり、それは時間内に打てたということ。
        // ここで減らすと、間に合ったプレイヤーから持ち時間を奪うことになる。
        if (!accepted) {
          return next
        }

        return { ...next, timeLimitMs: nextTimeLimitMs(state.timeLimitMs, rules) }
      }

      case 'EVENTS_CONSUMED':
        return { ...state, pending: state.pending.slice(action.count) }

      case 'DISMISS_WIN': {
        const head = state.pendingWins[0]

        /*
         * **鍵が合わなければ何もしない。** 今見せている和了以外は絶対に落とさない。
         * これで二重クリック・イベントの泡立ち・自動クローズとクリックの競合が
         * すべて無効になる。空のときに例外にしないのも同じ枝で済む。
         */
        if (head === undefined || winKey(head) !== action.key) {
          return state
        }
        return { ...state, pendingWins: state.pendingWins.slice(1) }
      }

      case 'RESTART':
        return action.state

      default: {
        const exhaustive: never = action
        throw new Error(`未知のループアクションです: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
}

/**
 * エンジンへ1手渡し、受理されたかどうかを添えて返す。
 *
 * 受理の可否を**戻り値として明示する**。呼び出し側が「状態オブジェクトの参照が
 * 変わったか」で判定すると、リデューサの内部実装（新しいオブジェクトを常に作るか否か）に
 * 正しさが依存してしまう。
 */
function applyEngine(
  state: LoopState,
  action: Action,
  rules: RulesConfig,
  humanSeat: PlayerId,
): { next: LoopState; accepted: boolean } {
  let result
  try {
    result = reduce(state.game, action, rules)
  } catch (error) {
    // 受付時間の経過とプレイヤーのクリックは互いに無関係なタイミングで発火するため、
    // 「押した瞬間に受付が閉じていた」という競合が構造上起こりうる。
    // その場合アクションが無効になるのは正常な帰結であり、状態を変えずに見送る。
    // エンジンの契約違反（それ以外の例外）は握りつぶさず伝播させる。
    if (error instanceof IllegalActionError) {
      console.warn('[pokajan] 受け付けられないアクションを見送りました:', error.message)
      return { next: state, accepted: false }
    }
    throw error
  }

  const gameOver = result.events.find((event) => event.type === 'GameOver')

  return {
    next: {
      game: result.state,
      pending: [...state.pending, ...result.events],
      gameOverReason: gameOver?.reason ?? state.gameOverReason,
      ranking: gameOver?.ranking ?? state.ranking,
      timeLimitMs: state.timeLimitMs,
      drawnUid: trackDrawnUid(state.drawnUid, result.events, humanSeat),
      // **点数は適用前のものを渡す。** `result.state` からでは、1回の `reduce` で
      // 複数の和了が起きたときに全部が同じ最終点数になる。
      pendingWins: [
        ...state.pendingWins,
        ...collectWins(
          result.events,
          state.game.players.map((player) => player.score),
        ),
      ],
    },
    accepted: true,
  }
}

/** 演出待ちの和了が残っているか。残っている間は対局を進めない。 */
function isPaused(state: LoopState): boolean {
  return state.pendingWins.length > 0
}

/**
 * イベント列を畳んで和了の演出データを組み立てる。
 *
 * `Paid` は `settleWin` からしか出ないため、**直前の `Declared` に属すると確定できる**。
 * 順に走査して、`Declared` で新しい演出を開始し、`Paid` で点数を進める。
 *
 * `scoresBefore` に「その和了の直前の点数」を入れるには、この走査で点数を
 * 持ち回るしかない。イベントを種別ごとにまとめて拾うと、複数の和了があったときに
 * どの支払いがどの和了のものか分からなくなる。
 */
function collectWins(
  events: readonly GameEvent[],
  scoresBeforeAll: readonly number[],
): WinPresentation[] {
  const wins: WinPresentation[] = []
  let scores = [...scoresBeforeAll]

  for (const event of events) {
    if (event.type === 'Declared') {
      wins.push({
        playerId: event.playerId,
        candidate: event.candidate,
        winKind: event.winKind,
        scoresBefore: [...scores],
        scoresAfter: [...scores],
      })
      continue
    }

    if (event.type !== 'Paid') {
      continue
    }

    const current = wins[wins.length - 1]
    if (current === undefined) {
      // `Paid` が `Declared` より先に来ることは今の実装では起こらない。
      // それでも黙って捨てず、点数だけは進めておく（後続の演出の始点が狂わない）。
      scores = applyPayment(scores, event)
      continue
    }

    scores = applyPayment(scores, event)
    wins[wins.length - 1] = { ...current, scoresAfter: [...scores] }
  }

  return wins
}

function applyPayment(scores: readonly number[], payment: Payment): number[] {
  const next = [...scores]
  next[payment.from] = (next[payment.from] ?? 0) - payment.amount
  next[payment.to] = (next[payment.to] ?? 0) + payment.amount
  return next
}

/**
 * 人間が引いているカードを追跡する。引いたら覚え、捨てたら忘れる。
 *
 * **`playerId` で人間の席に限定するのが要点。** 席を見ずに「直近に誰かが引いたカード」を
 * 覚える実装でも、引くと捨てるが厳密に交互に来るため人間の打牌フェーズでは結果的に
 * 正しい値になる。しかしそれは進行順序という別の性質にツモ切りの正しさを預けることであり、
 * 連続宣言やロンの割り込みで順序が変わった瞬間に静かに壊れる。
 */
function trackDrawnUid(
  current: number | null,
  events: readonly GameEvent[],
  humanSeat: PlayerId,
): number | null {
  let drawn = current

  for (const event of events) {
    if (event.type === 'CardDrawn' && event.playerId === humanSeat) {
      drawn = event.card.uid
    } else if (event.type === 'Discarded' && event.playerId === humanSeat) {
      drawn = null
    }
  }

  return drawn
}

export interface CreateLoopStateOptions {
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly seed: number
  readonly humanSeat: PlayerId
}

export function createInitialLoopState(options: CreateLoopStateOptions): LoopState {
  return {
    game: createGame(options.roster, options.rules, options.seed, {
      humanSeats: [options.humanSeat],
    }),
    pending: [],
    gameOverReason: null,
    ranking: null,
    // 持ち時間は対局ごとにリセットする。前局の消耗を持ち越さない。
    timeLimitMs: options.rules.turnTimer.initialMs,
    drawnUid: null,
    pendingWins: [],
  }
}
