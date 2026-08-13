/**
 * snapshot 応答の共通経路。「wallet を読む → humanSeat 視点の snapshot を組む → json で返す」を4ルートで共有する
 * （createGame / applyAction 正常系 / stale・競合 409 / getGame）。組み立てを1箇所に集約して直し忘れを防ぐ。
 */
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import type { GameEvent, GameState } from '@engine/types'

import type { RouteContext } from './dto'
import { HUMAN_SEAT, RULES } from './gameConfig'
import { buildSnapshot } from './gameFlow'
import { json } from './http'
import { getWallet } from './repo/userRepo'

export interface SnapshotResponseParams {
  readonly id: string
  readonly version: number
  readonly state: GameState
  readonly events: readonly GameEvent[]
  readonly bet: number
}

export async function respondSnapshot(
  ctx: RouteContext,
  sub: string,
  statusCode: number,
  params: SnapshotResponseParams,
): Promise<APIGatewayProxyStructuredResultV2> {
  const wallet = await getWallet(ctx.doc, ctx.table, sub)
  return json(
    statusCode,
    buildSnapshot({
      id: params.id,
      version: params.version,
      state: params.state,
      events: params.events,
      seat: HUMAN_SEAT,
      wallet,
      bet: params.bet,
      rules: RULES,
    }),
  )
}
