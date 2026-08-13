/**
 * deployConfig から transport（local/remote）を選ぶ純関数。
 *
 * 選択ロジックをコンポーネントの外へ出すことで、`deployConfig.transport==='remote'` のとき remote が選ばれることを
 * 単体テストで固定できる（このプロジェクトの「判断を純関数へ出す」流儀＝`decideAutoAction`/`interactionGate` と同型）。
 */

import type { DeployConfig } from '../../config/deploy'
import type { AiConfig } from '../../engine/ai'
import type { PlayerId, Roster, RulesConfig } from '../../engine/types'
import { createLocalTransport } from './localTransport'
import { createRemoteTransport } from './remoteTransport'
import type { GameTransport } from './transport'

export interface CreateTransportOptions {
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly seed: number
  /** この対局の BET。remote は createGame に送る。 */
  readonly bet: number
  readonly humanSeat: PlayerId
  readonly fast?: boolean
  readonly ai?: AiConfig
}

/**
 * `config.transport` で local/remote を選ぶ。remote は BET だけを必要とし（対局は id で辿る）、local は
 * roster/rules/seed からブラウザ内で対局を作る。
 */
export function createTransportFor(
  config: Pick<DeployConfig, 'transport'>,
  options: CreateTransportOptions,
): GameTransport {
  if (config.transport === 'remote') {
    return createRemoteTransport({ bet: options.bet })
  }
  return createLocalTransport({
    roster: options.roster,
    rules: options.rules,
    seed: options.seed,
    humanSeat: options.humanSeat,
    fast: options.fast,
    ai: options.ai,
  })
}
