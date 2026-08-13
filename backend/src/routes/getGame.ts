/** GET /games/{id} — 現在の PlayerView を返す（409 後の再同期に使う）。書き込みはしない。 */
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import { requireSub } from '../auth'
import type { RouteContext } from '../dto'
import { requireGameId } from '../http'
import { getGame } from '../repo/gameRepo'
import { respondSnapshot } from '../respond'

export async function getGameRoute(ctx: RouteContext): Promise<APIGatewayProxyStructuredResultV2> {
  const sub = requireSub(ctx.event)
  const id = requireGameId(ctx.event)

  const item = await getGame(ctx.doc, ctx.table, id, sub)

  return respondSnapshot(ctx, sub, 200, {
    id,
    version: item.version,
    state: item.state,
    events: [],
    bet: item.bet,
  })
}
