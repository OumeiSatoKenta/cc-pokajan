/**
 * エンジン／サーバーと React の接続点。
 *
 * Step 6 で、対局の状態遷移は注入された `GameTransport`（local=engine `reduce` / remote=HTTP）が持ち、
 * このフックは **`PlayerView` を描画し、タイマーで transport を駆動する**ことだけを担う。
 * - CPU の逐次進行（local のみ）: `transport.nextAuto()` をタイマーで駆動 → `apply`。
 * - 人間の持ち時間: `decideTimeoutFromView` → 時間切れで `apply`。
 * - 演出イベントの排出: `pending` を一定時間後に掃く。
 *
 * 判断そのものは engine の純関数（`nextCpuAction`/`decideTimeoutFromView`/`viewDerive`）に委ね、ここは
 * 「その判断をタイマーで駆動し、transport の snapshot を UI 状態へ折り込む（`loopReducer`）」だけの薄い層にする。
 */

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'

import type { PlayerView } from '../../engine/playerView'
import type {
  Action,
  GameEvent,
  GameOverReason,
  PlayerId,
  RulesConfig,
  YakuCandidate,
} from '../../engine/types'
import type { UnseenCounts } from '../../engine/unseen'
import type { WaitInfo } from '../../engine/yaku'
import {
  canDiscardFromView,
  claimableFromView,
  declarableFromView,
  isClaimWindowOpenFromView,
  pendingCpuClaimsFromView,
  unseenFromView,
  waitsFromView,
} from '../../engine/viewDerive'
import type { GameTransport, OutcomeSummary } from '../transport/transport'
import { EVENT_HOLD_MS } from './autoAction'
import { createInitialLoopState, createLoopReducer, type WinPresentation } from './loopReducer'
import { decideTimeoutFromView, type TimedDecision } from './turnTimer'

export interface UseGameLoopOptions {
  /** 状態遷移の担い手（local/remote）。生成は呼び出し側（TableScreen）が deployConfig で分岐する。 */
  readonly transport: GameTransport
  readonly rules: RulesConfig
}

export interface GameLoop {
  /** 描画する公開ビュー。`null` は create 未完（remote の初回のみ。local は seed 済みで常に非 null）。 */
  readonly view: PlayerView | null
  /** 演出待ちのイベント。表示し終えると自動で捨てられる。 */
  readonly events: readonly GameEvent[]
  readonly waits: WaitInfo
  /** メンバー × 色ごとの、まだ見えていない枚数（上限であって確定値ではない）。 */
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
  /** 現在の持ち時間。 */
  readonly timeLimitMs: number
  /** タイマーの再生をやり直す境界。 */
  readonly timerKey: string | null
  /** 今引いているカード。手札の中で区別して見せるために公開する。 */
  readonly drawnUid: number | null
  /** 終局理由（エンジンが確定させた値）。 */
  readonly gameOverReason: GameOverReason | null
  /** 終局時の順位（エンジンが確定させた値。精算の順位倍率になる）。 */
  readonly ranking: readonly PlayerId[] | null
  /** まだ意思表示していない CPU の数。 */
  readonly pendingCpuClaims: number
  /** 演出待ちの和了。**`null` でない間、対局は一切進まない**。 */
  readonly pendingWin: WinPresentation | null
  /** サーバー権威の財布（server モードで App へ同期）。local はダミー。 */
  readonly wallet: number
  /** サーバー精算（server モードの settle 用）。local は null。 */
  readonly outcome: OutcomeSummary | null
  discard: (uid: number) => void
  declare: (candidate: YakuCandidate) => void
  claim: (candidate: YakuCandidate) => void
  /** 宣言しない意思表示。フェーズに応じて送るアクションが変わる。 */
  pass: () => void
  /** 和了演出を閉じて進行を再開する（鍵で照合）。 */
  dismissWin: (key: string) => void
}

/**
 * 人間が座る席の既定値。席の呼び名・置き場所・アバター設定がそれぞれ独立に `0` を仮定して散らないよう、
 * この定数を通す。
 */
export const DEFAULT_HUMAN_SEAT: PlayerId = 0

const EMPTY_WAITS: WaitInfo = { waits: [], contributingUids: new Set() }
const EMPTY_UNSEEN: UnseenCounts = new Map()

export function useGameLoop(options: UseGameLoopOptions): GameLoop {
  const { transport, rules } = options

  const loopReducer = useMemo(() => createLoopReducer(rules), [rules])
  const [loop, dispatch] = useReducer(loopReducer, null, () => {
    // local は transport.current() の view を同期で seed（初回から loading 無し）。remote は null で、
    // 下の create 効果が埋める。current() の events は空（local は create で進めない）なので view/version だけ入れる。
    const base = createInitialLoopState(rules)
    const initial = transport.current()
    return initial === null
      ? base
      : { ...base, view: initial.view, version: initial.version, wallet: initial.wallet }
  })

  const view = loop.view
  const humanSeat = view?.selfId ?? DEFAULT_HUMAN_SEAT

  const pendingWin = loop.pendingWins[0] ?? null
  const isPaused = pendingWin !== null

  // --- transport への apply（人間操作・時間切れ・CPU 手の共通経路） ---------------

  // 最新の version / 停止フラグを（安定参照の）callback から読むための ref。
  // **書き込みは render 本体でなく effect で行う**（render 中の ref 書き換えは React の禁則＝並行/StrictMode で
  // 破棄されうるレンダーの値が混ざる）。読むのは後続の非同期 callback だけなので commit 後反映で機能は変わらない。
  const versionRef = useRef(loop.version)
  const pausedRef = useRef(isPaused)
  const applyingRef = useRef(false)
  useEffect(() => {
    versionRef.current = loop.version
    pausedRef.current = isPaused
  })

  // apply の失敗（remote の HTTP エラー等）は render 時に投げて ErrorBoundary に受けさせる。
  const [applyError, setApplyError] = useState<Error | null>(null)
  if (applyError !== null) {
    throw applyError
  }

  const fail = useCallback((error: unknown) => {
    applyingRef.current = false
    setApplyError(error instanceof Error ? error : new Error(String(error)))
  }, [])

  const dispatchApply = useCallback(
    (action: Action, isTimeout: boolean) => {
      // **演出中は進めない**（キーボード経路・E2E 直クリックも含め、apply を呼ぶ前で止める）。
      // apply 中の二重発火も抑止（remote の非同期で必須。local でも安全側）。
      if (pausedRef.current || applyingRef.current) {
        return
      }
      applyingRef.current = true
      transport
        .apply(action, versionRef.current)
        .then((result) => {
          applyingRef.current = false
          dispatch({
            type: 'INGEST',
            snapshot: result.snapshot,
            isTimeout,
            accepted: result.accepted,
          })
        })
        // `.then(ok).catch(fail)` にする（`.then(ok, fail)` だと ok 内の dispatch/ingest 例外が fail へ行かず
        // 握りつぶされる）。apply の reject も ingest の例外も同じ1経路で ErrorBoundary に届く。
        .catch(fail)
    },
    [transport, fail],
  )

  // --- create（remote のみ実質発火。local は seed 済みで view が非 null） -----------

  /*
   * **`createdRef` で create を1回に絞る。** 一般に「ref で effect の再発火を止める」のは React の推奨に反するが、
   * ここは購読ではなく **1回きりの非冪等 POST**（サーバーが createGameWithDebit で BET を差し引く）で、二重に走ると
   * 二重 BET になる。StrictMode（dev）は effect を2度呼ぶため、view=null のうちに2回 create() が飛びうる。cleanup で
   * 打ち消せる作業ではない（サーバー副作用は取り消せない）ので、ref で2回目の POST 自体を抑止する。対局ごとの
   * 再マウント（`key={seed}`）でインスタンスが変わるため購読の積み上がりは起きない。view が来たら以後は早期 return。
   */
  const createdRef = useRef(false)
  useEffect(() => {
    if (view !== null || createdRef.current) {
      return
    }
    createdRef.current = true
    transport.create().then((snapshot) => {
      dispatch({ type: 'INGEST', snapshot, isTimeout: false, accepted: true })
    }, fail)
  }, [transport, view, fail])

  // --- CPU の自動進行（local のみ。remote は nextAuto が null） --------------------

  /**
   * 次に自動で進める CPU 手＋演出遅延＋同一性キー。`view`/`isPaused` を依存にして、apply で view が変わった
   * ときだけ再計算する（transport の内部 state は view と同期して進む）。remote は常に null。
   */
  const auto = useMemo(
    () => (view === null || isPaused ? null : transport.nextAuto()),
    [view, isPaused, transport],
  )
  const autoKey = auto?.key ?? null

  const fireAuto = useEffectEvent(() => {
    if (auto !== null) {
      dispatchApply(auto.action, false)
    }
  })

  useEffect(() => {
    if (isPaused || autoKey === null) {
      return
    }
    // autoKey が非 null のとき auto も非 null（同じ計算由来）。delayMs は演出の待ち時間。
    const timer = setTimeout(fireAuto, auto?.delayMs ?? 0)
    return () => clearTimeout(timer)
    // 依存は決定の同一性と停止フラグのみ（view を載せるとタイマーが張り直される既知の轍）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoKey, isPaused])

  // --- 人間の持ち時間の時間切れ ---------------------------------------------------

  const timeout = useMemo(
    () => (view === null ? null : decideTimeoutFromView(view, humanSeat, loop.drawnUid, rules)),
    [view, humanSeat, loop.drawnUid, rules],
  )
  const timerKey = timeout?.key ?? null
  const timeLimitMs = loop.timeLimitMs

  const fireTimeout = useEffectEvent(() => {
    if (timeout !== null) {
      dispatchApply(timeout.action, true)
    }
  })

  useEffect(() => {
    if (isPaused || timerKey === null) {
      return
    }
    const timer = setTimeout(fireTimeout, timeLimitMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey, timeLimitMs, isPaused])

  // --- 演出イベントの排出 ---------------------------------------------------------

  const pending = loop.pending
  const hasPending = pending.length > 0

  const drainEvents = useEffectEvent(() => {
    dispatch({ type: 'EVENTS_CONSUMED', count: pending.length })
  })

  useEffect(() => {
    if (isPaused || !hasPending) {
      return
    }
    const timer = setTimeout(drainEvents, EVENT_HOLD_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending, isPaused])

  // --- 派生値（PlayerView から導出） ----------------------------------------------

  const waits = useMemo(
    () => (view === null ? EMPTY_WAITS : waitsFromView(view, rules)),
    [view, rules],
  )
  const unseen = useMemo(
    () => (view === null ? EMPTY_UNSEEN : unseenFromView(view, rules)),
    [view, rules],
  )
  const declarable = useMemo(
    () => (view === null ? [] : declarableFromView(view, rules)),
    [view, rules],
  )
  const claimable = useMemo(
    () => (view === null ? [] : claimableFromView(view, rules)),
    [view, rules],
  )
  const canDiscard = view !== null && canDiscardFromView(view)
  const isClaimWindowOpen = view !== null && isClaimWindowOpenFromView(view)
  const pendingCpuClaims = view === null ? 0 : pendingCpuClaimsFromView(view)

  // --- 操作 -----------------------------------------------------------------------

  const discard = useCallback(
    (uid: number) => dispatchApply({ type: 'DISCARD', uid }, false),
    [dispatchApply],
  )

  const declare = useCallback(
    (candidate: YakuCandidate) =>
      dispatchApply({ type: 'DECLARE', playerId: humanSeat, candidate }, false),
    [dispatchApply, humanSeat],
  )

  const claim = useCallback(
    (candidate: YakuCandidate) =>
      dispatchApply({ type: 'CLAIM', playerId: humanSeat, candidate }, false),
    [dispatchApply, humanSeat],
  )

  const dismissWin = useCallback((key: string) => {
    dispatch({ type: 'DISMISS_WIN', key })
  }, [])

  /** プレイヤーにとってはどちらも「宣言しない」なので1つの操作にまとめる。 */
  const pass = useCallback(() => {
    if (view?.phase === 'selfDeclare') {
      dispatchApply({ type: 'SKIP_DECLARE' }, false)
      return
    }
    dispatchApply({ type: 'PASS', playerId: humanSeat }, false)
  }, [dispatchApply, view?.phase, humanSeat])

  /*
   * 対局のやり直しはこのフックが持たない。対局の生成は `App` に一本化し、`TableScreen` は
   * `key={seed}` で作り直される（BET を経由せずに次の対局を始められる経路を作らない）。
   */

  return {
    view,
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
    wallet: loop.wallet,
    outcome: loop.outcome,
    discard,
    declare,
    claim,
    pass,
    dismissWin,
  }
}
