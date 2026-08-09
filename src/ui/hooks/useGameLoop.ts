/**
 * エンジンと React の接続点。
 *
 * エンジンは時計を持たないため、CPU の思考時間と宣言の受付時間はここが供給する。
 * 判断そのものは `loopReducer.ts` の純粋関数に委ね、このフックは
 * 「その判断をタイマーで駆動する」ことだけを担う。
 */

import { useCallback, useEffect, useEffectEvent, useMemo, useReducer } from 'react'

import { DEFAULT_AI_CONFIG, type AiConfig } from '../../engine/ai'
import { yakuContextOf } from '../../engine/gameSelectors'
import { countUnseen, toVisibleCards, type UnseenCounts } from '../../engine/unseen'
import { computeWaits, type WaitInfo } from '../../engine/yaku'
import type {
  GameEvent,
  GameOverReason,
  GameState,
  PlayerId,
  Roster,
  RulesConfig,
  YakuCandidate,
} from '../../engine/types'
import {
  DELAYS,
  EVENT_HOLD_MS,
  NO_DELAYS,
  autoActionKey,
  claimableFor,
  countPendingCpuClaims,
  declarableFor,
  decideAutoAction,
  type Delays,
} from './autoAction'
import { createInitialLoopState, createLoopReducer, type WinPresentation } from './loopReducer'
import { decideTimeout, type TimedDecision } from './turnTimer'

export interface UseGameLoopOptions {
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly seed: number
  readonly humanSeat?: PlayerId
  readonly ai?: AiConfig
  /** 演出の待ち時間を消す。E2E 用で、ルール値には影響しない。 */
  readonly fast?: boolean
}

export interface GameLoop {
  readonly state: GameState
  /** 演出待ちのイベント。表示し終えると自動で捨てられる。 */
  readonly events: readonly GameEvent[]
  readonly waits: WaitInfo
  /**
   * メンバー × 色ごとの、まだ見えていない枚数。
   *
   * **上限であって確定値ではない**（他家の手札と、山札に入らなかった分を含む）。
   */
  readonly unseen: UnseenCounts
  /** 自分の手番で宣言できる役（ツモ）。 */
  readonly declarable: readonly YakuCandidate[]
  /** 他家の捨て札に割り込める役（ロン）。 */
  readonly claimable: readonly YakuCandidate[]
  readonly humanSeat: PlayerId
  /** 手札をクリックして捨てられる状態か。 */
  readonly canDiscard: boolean
  /** 宣言の受付が開いていて、自分がまだ表明していないか。 */
  readonly isClaimWindowOpen: boolean
  /** 今どの判断で持ち時間を使っているか。`null` なら計時していない。 */
  readonly timerKind: TimedDecision | null
  /** 現在の持ち時間。時間切れのたびに減り、下限で止まる。 */
  readonly timeLimitMs: number
  /** タイマーの再生をやり直す境界。判断が変わったときだけ変化する。 */
  readonly timerKey: string | null
  /** 今引いているカード。手札の中で区別して見せるために公開する。 */
  readonly drawnUid: number | null
  /** 終局理由。エンジンが確定させた値をそのまま返す（画面側で導出し直さない）。 */
  readonly gameOverReason: GameOverReason | null
  /** 終局時の順位。同じくエンジンが確定させた値。精算の順位倍率はこれで決まる。 */
  readonly ranking: readonly PlayerId[] | null
  /** まだ意思表示していない CPU の数。「CPU は人間を待たない」ことの観測用。 */
  readonly pendingCpuClaims: number
  /**
   * 演出待ちの和了。**`null` でない間、対局は一切進まない**
   * （自動進行・持ち時間・イベントの排出がすべて止まる）。
   */
  readonly pendingWin: WinPresentation | null
  discard: (uid: number) => void
  declare: (candidate: YakuCandidate) => void
  claim: (candidate: YakuCandidate) => void
  /** 宣言しない意思表示。フェーズに応じて送るアクションが変わる。 */
  pass: () => void
  /**
   * 和了演出を閉じて進行を再開する。
   *
   * **鍵を受け取る。** 閉じる操作は自動クローズ・クリック・Escape の3経路から来るため、
   * 二重に走りうる。鍵で照合することで、今見せている和了以外は落ちない。
   */
  dismissWin: (key: string) => void
}

/**
 * 人間が座る席の既定値。
 *
 * **この定数を通す。** 対局は常にここから始まるので `0` を直接書いても動くが、
 * 席の呼び名（`seatName`）と置き場所（`seatOrientation`）と
 * アバターの設定画面がそれぞれ独立に `0` を仮定すると、
 * 「今はたまたま揃っている」状態が3箇所に散る。
 */
export const DEFAULT_HUMAN_SEAT: PlayerId = 0

export function useGameLoop(options: UseGameLoopOptions): GameLoop {
  const { roster, rules, seed } = options
  const humanSeat = options.humanSeat ?? DEFAULT_HUMAN_SEAT
  const ai = options.ai ?? DEFAULT_AI_CONFIG
  const delays: Delays = options.fast === true ? NO_DELAYS : DELAYS

  const loopReducer = useMemo(() => createLoopReducer(rules, humanSeat), [rules, humanSeat])
  const [loop, dispatch] = useReducer(
    loopReducer,
    { roster, rules, seed, humanSeat },
    createInitialLoopState,
  )

  const game = loop.game

  /**
   * 演出待ちの和了があるか。**3つの効果すべてがこれで止まる。**
   *
   * 1つでも止め忘れると、止めたつもりの裏で対局が進む。特に持ち時間を
   * 止め忘れると、演出を読んでいる間にツモ切りされたうえ持ち時間まで削られる。
   */
  const pendingWin = loop.pendingWins[0] ?? null
  const isPaused = pendingWin !== null

  // --- 自動進行 ---------------------------------------------------------------

  const auto = useMemo(
    () => decideAutoAction(game, rules, ai, humanSeat, delays),
    [game, rules, ai, humanSeat, delays],
  )

  /**
   * 依存に `game` を丸ごと置かず、決定の同一性だけを見る。
   *
   * `game` を依存にすると、別の効果が状態を変えるたびに予約中のタイマーが
   * 破棄・再予約される。受付時間の経過処理が状態を変える経路と組み合わさると、
   * CPU の割り込み判断が発火前に毎回キャンセルされ続けることになる。
   */
  const autoKey = auto === null ? null : autoActionKey(game, auto.action)

  /**
   * タイマー発火時に**最新の決定**を読む。
   *
   * `useEffectEvent` は依存配列に載せずに最新の値を参照するための正式な仕組みで、
   * 「ref をレンダー中に書き換えて最新値を持ち回る」自前実装を置き換えられる。
   */
  const fireAutoAction = useEffectEvent(() => {
    if (auto !== null) {
      dispatch({ type: 'ENGINE', action: auto.action })
    }
  })

  useEffect(() => {
    if (isPaused || autoKey === null || auto === null) {
      return
    }

    const timer = setTimeout(fireAutoAction, auto.delayMs)
    return () => clearTimeout(timer)
    // 依存は決定の同一性と停止フラグのみ。`auto` を載せると別経路の状態変化で
    // 再予約されてしまう。`isPaused` を載せることで、和了の瞬間に
    // クリーンアップが走って予約済みのタイマーが取り消される。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, isPaused])

  // --- 持ち時間の時間切れ -----------------------------------------------------

  const isClaimWindowOpen = game.phase === 'claimWindow' && game.claims[humanSeat] === null

  const timeout = useMemo(
    () => decideTimeout(game, humanSeat, loop.drawnUid, rules),
    [game, humanSeat, loop.drawnUid, rules],
  )
  const timerKey = timeout?.key ?? null
  const timeLimitMs = loop.timeLimitMs

  const fireTimeout = useEffectEvent(() => {
    if (timeout !== null) {
      dispatch({ type: 'TIMEOUT', action: timeout.action })
    }
  })

  /**
   * 残り時間は CSS アニメーションで描画し、React の状態を毎フレーム更新しない。
   * エンジンへ送るのは時間切れの1手だけ。
   *
   * 依存を `timeout` オブジェクトではなく `key` にするのが要点。人間が考えている間も
   * CPU の意思表示で `game` は変わり続けるため、`timeout` を依存にすると
   * **タイマーが毎回張り直されて永久に時間切れにならない**。
   * `timeLimitMs` を含めてよいのは、これが変わるのは時間切れの直後だけで、
   * そのときは `key` も必ず変わっている（フェーズか局面が進む）ため。
   */
  useEffect(() => {
    if (isPaused || timerKey === null) {
      return
    }

    const timer = setTimeout(fireTimeout, timeLimitMs)
    return () => clearTimeout(timer)
  }, [timerKey, timeLimitMs, isPaused])

  // --- 演出イベントの排出 -----------------------------------------------------

  const pending = loop.pending
  const hasPending = pending.length > 0

  const drainEvents = useEffectEvent(() => {
    dispatch({ type: 'EVENTS_CONSUMED', count: pending.length })
  })

  /**
   * 依存を「キューが空でないか」の真偽値にする。
   *
   * `pending` 配列そのものを依存にすると、`ENGINE` のたびに新しい配列参照になるため
   * タイマーが毎回張り直される。演出の間隔（260〜900ms）は保持時間（1600ms）より短いので、
   * CPU が続けて打っている間はキューが一度も掃けず、**トーストが消えなくなる**。
   */
  useEffect(() => {
    if (isPaused || !hasPending) {
      return
    }

    const timer = setTimeout(drainEvents, EVENT_HOLD_MS)
    return () => clearTimeout(timer)
  }, [hasPending, isPaused])

  // --- 派生値 -----------------------------------------------------------------

  const waits = useMemo(
    () => computeWaits(game.players[humanSeat].hand, yakuContextOf(game, rules)),
    [game, rules, humanSeat],
  )

  /*
   * 数える対象は `activeMembers`。**山札のプールを作ったのがこの集合**
   * （`deck.ts` の `collectMembers` → `buildCardPool`）なので、
   * `copiesPerMemberColor` が上限として意味を持つ範囲と完全に一致する。
   * `activeGroups` から導き直すと、同じ集合を2通りの方法で作ることになる。
   */
  const unseen = useMemo(
    () =>
      countUnseen(
        toVisibleCards(game, humanSeat),
        game.activeMembers.map((member) => member.id),
        rules,
      ),
    [game, rules, humanSeat],
  )

  const declarable = useMemo(() => declarableFor(game, rules, humanSeat), [game, rules, humanSeat])

  const claimable = useMemo(() => claimableFor(game, rules, humanSeat), [game, rules, humanSeat])

  const canDiscard = game.phase === 'discard' && game.turn === humanSeat
  const pendingCpuClaims = countPendingCpuClaims(game, humanSeat)

  // --- 操作 -------------------------------------------------------------------

  const discard = useCallback((uid: number) => {
    dispatch({ type: 'ENGINE', action: { type: 'DISCARD', uid } })
  }, [])

  const declare = useCallback(
    (candidate: YakuCandidate) => {
      dispatch({ type: 'ENGINE', action: { type: 'DECLARE', playerId: humanSeat, candidate } })
    },
    [humanSeat],
  )

  const claim = useCallback(
    (candidate: YakuCandidate) => {
      dispatch({ type: 'ENGINE', action: { type: 'CLAIM', playerId: humanSeat, candidate } })
    },
    [humanSeat],
  )

  const dismissWin = useCallback((key: string) => {
    dispatch({ type: 'DISMISS_WIN', key })
  }, [])

  /** プレイヤーにとってはどちらも「宣言しない」なので、1つの操作にまとめる。 */
  const pass = useCallback(() => {
    if (game.phase === 'selfDeclare') {
      dispatch({ type: 'ENGINE', action: { type: 'SKIP_DECLARE' } })
      return
    }
    dispatch({ type: 'ENGINE', action: { type: 'PASS', playerId: humanSeat } })
  }, [game.phase, humanSeat])

  /*
   * 対局のやり直しはこのフックが持たない。
   *
   * Step 5 で BET を導入したため、対局の開始は「BET を払う」ことと不可分になった。
   * ここに `restart()` を残すと **BET を経由せずに次の対局を始められる**。
   * 対局の生成は `App` に一本化し、`TableScreen` は `key={seed}` で作り直される。
   */

  return {
    state: game,
    events: pending,
    waits,
    unseen,
    declarable,
    claimable,
    humanSeat,
    canDiscard,
    isClaimWindowOpen,
    timerKind: timeout?.kind ?? null,
    timeLimitMs,
    timerKey,
    drawnUid: loop.drawnUid,
    gameOverReason: loop.gameOverReason,
    ranking: loop.ranking,
    pendingCpuClaims,
    pendingWin,
    discard,
    declare,
    claim,
    pass,
    dismissWin,
  }
}
