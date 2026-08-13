/**
 * サーバー権威のゲーム進行（純関数・DynamoDB に触れない）。engine を再実装せず共有する。
 *
 * - `advanceToHuman`: `nextCpuAction` が null（人間の判断待ち）を返すか gameOver まで CPU を解決し切る。
 *   中間状態は保存しない（repo 層が最終状態で 1 回だけ version+1）。
 * - `applyHumanThenAdvance`: 人間 Action を適用してから `advanceToHuman`。不正 Action は engine の
 *   `IllegalActionError`（→400）が飛ぶ。
 * - `normalizeHumanAction`: クライアント Action を engine Action へ。`playerId` は humanSeat を強制（なりすまし防止）。
 * - `buildSnapshot`: `view`（`toPlayerView`）と `events`（**必ず `redactEvents` 経由**）を組む。gameOver なら outcome。
 */
import { reduce } from '@engine/game'
import { nextCpuAction } from '@engine/autoAction'
import { computeRanking } from '@engine/gameSelectors'
import { redactEvents, toPlayerView } from '@engine/playerView'
import { computePayout, rankOf } from '@engine/payout'
import type { AiConfig } from '@engine/ai'
import type { Action, GameEvent, GameState, PlayerId, RulesConfig } from '@engine/types'

import type { ClientAction, GameSnapshot, OutcomeSummary } from './dto'
import { BadRequestError } from './errors'

export interface Advanced {
  readonly state: GameState
  readonly events: readonly GameEvent[]
}

/** 人間に判断が回るか gameOver まで CPU の手を解決し切る。収束しなければ例外（→500）。 */
export function advanceToHuman(
  state: GameState,
  rules: RulesConfig,
  ai: AiConfig,
  humanSeats: readonly PlayerId[],
  maxSteps: number,
): Advanced {
  let current = state
  const events: GameEvent[] = []

  for (let step = 0; step < maxSteps; step++) {
    if (current.phase === 'gameOver') {
      return { state: current, events }
    }
    const action = nextCpuAction(current, rules, ai, humanSeats)
    if (action === null) {
      // 人間の入力待ち（人間に選ぶ余地がある局面）。
      return { state: current, events }
    }
    const result = reduce(current, action, rules)
    current = result.state
    events.push(...result.events)
  }

  // engine のバグ（無限ループ）を黙って中途半端な state で保存/返却しない。
  throw new Error(
    `advanceToHuman が ${maxSteps} 手で収束しませんでした（engine の無限ループの可能性）`,
  )
}

/** 人間 Action を適用してから CPU を解決する。events は人間分 → CPU 分の順で連結する。 */
export function applyHumanThenAdvance(
  state: GameState,
  action: Action,
  rules: RulesConfig,
  ai: AiConfig,
  humanSeats: readonly PlayerId[],
  maxSteps: number,
): Advanced {
  const first = reduce(state, action, rules)
  const rest = advanceToHuman(first.state, rules, ai, humanSeats, maxSteps)
  return { state: rest.state, events: [...first.events, ...rest.events] }
}

/**
 * クライアント Action → engine Action。`DECLARE`/`CLAIM`/`PASS` の `playerId` は必ず humanSeat（他席として打たせない）。
 *
 * `DISCARD`/`SKIP_DECLARE` は engine の `Action` 型自体が `playerId` を持たず、常に `state.turn`/`declarer` に適用される。
 * 安全性は **`nextCpuAction` が「human の決定点でのみ null を返す」不変条件**に依る＝サーバーが書込みを待つ局面では
 * 必ず `turn`/`declarer` が当該 human 席なので、他席の手番中に人間の Action を差し込む窓は無い。
 * これは `HUMAN_SEATS=[0]`（単一人間席）前提。将来 human を複数席へ拡張するときは本不変条件の再検証が要る。
 */
export function normalizeHumanAction(action: ClientAction, humanSeat: PlayerId): Action {
  switch (action.type) {
    case 'DISCARD':
      return { type: 'DISCARD', uid: action.uid }
    case 'SKIP_DECLARE':
      return { type: 'SKIP_DECLARE' }
    case 'DECLARE':
      return { type: 'DECLARE', playerId: humanSeat, candidate: action.candidate }
    case 'CLAIM':
      return { type: 'CLAIM', playerId: humanSeat, candidate: action.candidate }
    case 'PASS':
      return { type: 'PASS', playerId: humanSeat }
    default: {
      const exhaustive: never = action
      throw new BadRequestError(`未対応のアクションです: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/** 終局時の精算内訳。engine の `computeRanking`/`rankOf`/`computePayout` を共有して算出する。 */
export function buildOutcome(
  state: GameState,
  seat: PlayerId,
  bet: number,
  rules: RulesConfig,
): OutcomeSummary {
  const ranking = computeRanking(state.players)
  const rank = rankOf(ranking, seat)
  const finalScore = state.players[seat].score
  const payout = computePayout(finalScore, bet, rank, rules)
  return { payout, ranking, scores: state.players.map((player) => player.score) }
}

export interface SnapshotInput {
  readonly id: string
  readonly version: number
  readonly state: GameState
  readonly events: readonly GameEvent[]
  readonly seat: PlayerId
  readonly wallet: number
  readonly bet: number
  readonly rules: RulesConfig
}

/** クライアントへ返す snapshot。`view`・`events` の両方を redact する（他家手札を漏らさない）。 */
export function buildSnapshot(input: SnapshotInput): GameSnapshot {
  const outcome =
    input.state.phase === 'gameOver'
      ? buildOutcome(input.state, input.seat, input.bet, input.rules)
      : null
  return {
    id: input.id,
    version: input.version,
    view: toPlayerView(input.state, input.seat),
    events: redactEvents(input.events, input.seat),
    wallet: input.wallet,
    outcome,
  }
}
