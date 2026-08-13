/**
 * 自動進行の1手を「演出のための遅延つき」で返す UI アダプタ。
 *
 * 判断そのもの（誰が次に何をするか）は engine の純関数 `nextCpuAction`（`src/engine/autoAction.ts`）へ委譲し、
 * ここでは決まった action の種別から演出遅延を付けるだけ。候補列挙 `claimableFor` / `declarableFor` は
 * engine 側に置き、消費側の import パスを保つためここから re-export する。
 */

import type { AiConfig } from '../../engine/ai'
import { nextCpuAction, pendingCpuClaimIds, type CpuAction } from '../../engine/autoAction'
import type { Action, GameState, PlayerId, RulesConfig, YakuCandidate } from '../../engine/types'

export { claimableFor, declarableFor } from '../../engine/autoAction'

/** 自動進行の1手。`delayMs` は演出のための待ち時間で、エンジンには渡らない。 */
export interface AutoStep {
  readonly action: Action
  readonly delayMs: number
}

// --- 演出のための遅延 ---------------------------------------------------------

/** アクション種別ごとの演出待ち時間。 */
export interface Delays {
  readonly draw: number
  readonly discard: number
  readonly declare: number
  readonly skipDeclare: number
  readonly claim: number
}

/**
 * 既定の遅延。エンジンは時間を持たないため、ここが体感速度を決める。
 * 全員 CPU で1巡すると `(420 + 620 + 260×3) × 4 ≈ 7.3秒`。
 */
export const DELAYS: Delays = {
  draw: 420,
  discard: 620,
  declare: 900,
  skipDeclare: 0,
  claim: 260,
}

/** 高速モード（E2E 用）。演出の待ち時間だけを消し、ルール値には触れない。 */
export const NO_DELAYS: Delays = {
  draw: 0,
  discard: 0,
  declare: 0,
  skipDeclare: 0,
  claim: 0,
}

/** 役成立のトーストを表示しておく時間。 */
export const EVENT_HOLD_MS = 1600

// --- 自動進行の判断（engine へ委譲） -----------------------------------------

/**
 * 決まった action の種別に対応する演出遅延。元の `decideAutoAction` 各分岐の遅延と1:1で対応する。
 * `nextCpuAction` は TICK を返さない（型 `CpuAction` で保証）ので、TICK のケースは書かず `never` で網羅する。
 */
function delayFor(action: CpuAction, delays: Delays): number {
  switch (action.type) {
    case 'DRAW':
      return delays.draw
    case 'DISCARD':
      return delays.discard
    case 'DECLARE':
      return delays.declare
    case 'SKIP_DECLARE':
      return delays.skipDeclare
    case 'CLAIM':
    case 'PASS':
      return delays.claim
    default: {
      const exhaustive: never = action
      throw new Error(`未知のアクション種別です: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * まだ意思表示していない CPU の数。
 *
 * 「CPU は人間の入力を待たない」という性質を画面から観測できるようにするために公開している
 * （`claims` の内部構造の知識を画面側に持たせない）。判断は engine の `pendingCpuClaimIds` に委譲する。
 */
export function countPendingCpuClaims(game: GameState, humanSeat: PlayerId): number {
  return pendingCpuClaimIds(game, [humanSeat]).length
}

/**
 * 次に自動で進めるべき1手を、演出遅延つきで返す。`null` なら人間の入力待ち。
 *
 * 判断は engine の `nextCpuAction` に委譲し、ここでは種別に応じた遅延を付けるだけ。
 */
export function decideAutoAction(
  game: GameState,
  rules: RulesConfig,
  ai: AiConfig,
  humanSeat: PlayerId,
  delays: Delays = DELAYS,
): AutoStep | null {
  const action = nextCpuAction(game, rules, ai, [humanSeat])
  return action === null ? null : { action, delayMs: delayFor(action, delays) }
}

/**
 * 決定したアクションの同一性を表す文字列。
 *
 * 自動進行の `useEffect` はこれを依存に取る。`GameState` を丸ごと依存にすると、
 * **別の効果が状態を変えるたびに予約中のタイマーが破棄・再予約される**。
 * 例えば受付時間の経過処理が状態を変えると、CPU の割り込み判断のために予約した
 * タイマーが発火前に毎回キャンセルされ、CPU が永久にロンできなくなる。
 *
 * 決定が実質的に変わったときだけキーが変わるようにして、この競合を構造的に防ぐ。
 */
export function autoActionKey(game: GameState, action: Action): string {
  const head = `${game.phase}:${game.turn}:${game.declarer}:${action.type}`

  switch (action.type) {
    case 'DISCARD':
      return `${head}:${action.uid}`
    case 'DECLARE':
    case 'CLAIM':
      return `${head}:${action.playerId}:${candidateKey(action.candidate)}`
    case 'PASS':
      return `${head}:${action.playerId}`

    // パラメータを持たないアクション。head だけで同一性を表せる。
    case 'DRAW':
    case 'SKIP_DECLARE':
    case 'TICK':
      return head

    default: {
      // 新しい Action 種別を足したときに、ここの更新漏れをコンパイル時に検出する。
      // 取りこぼすと「決定の同一性」が粗くなり、タイマー競合が別の形で再発する。
      const exhaustive: never = action
      throw new Error(`未知のアクション種別です: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function candidateKey(candidate: YakuCandidate): string {
  const uids = candidate.cards
    .map((card) => card.uid)
    .sort((a, b) => a - b)
    .join('-')

  return `${candidate.kind}:${candidate.sameColor ? 'same' : 'mixed'}:${uids}`
}
