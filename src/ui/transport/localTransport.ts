/**
 * ブラウザ内エンジンで完結する transport（Pages/オフライン・**今日の挙動そのまま**）。
 *
 * 全 `GameState` を内部（閉包）に保持し、`reduce` で1手ずつ進める。CPU の1手は full state からしか決まらない
 * （`toAiView` で他家の手札を読む）ため、その判断（`decideAutoAction`）を transport が持つ＝`nextAuto()`。
 * `useGameLoop` はこの `nextAuto()` をタイマーで駆動し、`apply()` で確定する（今日の自動進行と同じ 1手ずつの逐次）。
 *
 * snapshot は `toPlayerView` + `redactEvents` を通す（remote と描画パスを一致させ、他家手札を UI に渡さない）。
 * wallet は appReducer（`computePayout`）が権威なので snapshot ではダミー、outcome も持たない（`walletSource==='local'`）。
 */

import { DEFAULT_AI_CONFIG, type AiConfig } from '../../engine/ai'
import { IllegalActionError, createGame, reduce } from '../../engine/game'
import { redactEvents, toPlayerView } from '../../engine/playerView'
import type { GameEvent, GameState, PlayerId, Roster, RulesConfig } from '../../engine/types'
import {
  DELAYS,
  NO_DELAYS,
  autoActionKey,
  decideAutoAction,
  type Delays,
} from '../hooks/autoAction'
import type { ApplyResult, GameSnapshot, GameTransport } from './transport'

export interface LocalTransportOptions {
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly seed: number
  readonly humanSeat: PlayerId
  readonly ai?: AiConfig
  /** 演出の待ち時間を消す（E2E 用）。ルール値には影響しない。 */
  readonly fast?: boolean
}

/** local には対局 id が無い（DynamoDB のキーはサーバー専用）。形を揃えるための定数。 */
const LOCAL_GAME_ID = 'local'

export function createLocalTransport(options: LocalTransportOptions): GameTransport {
  const { roster, rules, seed, humanSeat } = options
  const ai = options.ai ?? DEFAULT_AI_CONFIG
  const delays: Delays = options.fast === true ? NO_DELAYS : DELAYS

  let state: GameState = createGame(roster, rules, seed, { humanSeats: [humanSeat] })
  let version = 1

  const snapshotOf = (events: readonly GameEvent[]): GameSnapshot => ({
    id: LOCAL_GAME_ID,
    version,
    view: toPlayerView(state, humanSeat),
    events: redactEvents(events, humanSeat),
    // local の財布・精算は appReducer（prefs + computePayout）が権威。snapshot では使わない。
    wallet: 0,
    outcome: null,
  })

  return {
    current(): GameSnapshot {
      // local は factory で createGame 済み＝常に現在の view を同期で返せる（useGameLoop の初期 seed）。
      return snapshotOf([])
    },

    create(): Promise<GameSnapshot> {
      // **create では進めない。** 今日の `createInitialLoopState` は createGame のみで、
      // 最初の DRAW から `nextAuto` の逐次で進む。ここで advance すると local 挙動が変わる。
      return Promise.resolve(snapshotOf([]))
    },

    // **`async` にするのが要点。** engine の契約違反（`IllegalActionError` 以外の例外）は `throw` するが、
    // 同期関数だと呼び出し側の `apply(...).then(_, fail)` に届かず（`.then` 到達前に投げる）、`onClick`/`setTimeout`
    // まで伝播して ErrorBoundary にも `fail` にも渡らない＝`applyingRef` が立ったまま対局が無言でフリーズする。
    // `async` なら `throw` は自動で reject され、`useGameLoop` の `fail`（→ render 時 throw → ErrorBoundary）に届く。
    async apply(action, _expectedVersion): Promise<ApplyResult> {
      // local は単一クライアントなので expectedVersion は無視（409 を出さない）。
      let result
      try {
        result = reduce(state, action, rules)
      } catch (error) {
        // 受付時間の経過と操作の競合で「押した瞬間に受付が閉じていた」場合は無効化が正常な帰結。
        // 状態を変えずに見送る（現行 loopReducer の applyEngine と同じ）。契約違反はそのまま投げる（reject される）。
        if (error instanceof IllegalActionError) {
          console.warn('[pokajan] 受け付けられないアクションを見送りました:', error.message)
          return { snapshot: snapshotOf([]), accepted: false }
        }
        throw error
      }
      state = result.state
      version += 1
      return { snapshot: snapshotOf(result.events), accepted: true }
    },

    get(): Promise<GameSnapshot> {
      return Promise.resolve(snapshotOf([]))
    },

    nextAuto() {
      const step = decideAutoAction(state, rules, ai, humanSeat, delays)
      if (step === null) {
        return null
      }
      return { action: step.action, delayMs: step.delayMs, key: autoActionKey(state, step.action) }
    },
  }
}
