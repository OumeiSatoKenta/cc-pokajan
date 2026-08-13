/**
 * 内部ルーター。API Gateway HTTP API の `routeKey`（例 `"POST /games"`）で分岐する。
 *
 * `routeKey` は生の string なので、既知ルートの union `KnownRoute` へ絞ってから switch し、
 * `never` default で網羅性を型に守らせる（未知ルートは 404）。
 */
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import type { RouteContext } from './dto'
import { NotFoundError } from './errors'
import { applyActionRoute } from './routes/applyAction'
import { createGameRoute } from './routes/createGame'
import { getGameRoute } from './routes/getGame'

const KNOWN_ROUTES = ['POST /games', 'POST /games/{id}/actions', 'GET /games/{id}'] as const
type KnownRoute = (typeof KNOWN_ROUTES)[number]

function isKnownRoute(routeKey: string): routeKey is KnownRoute {
  return (KNOWN_ROUTES as readonly string[]).includes(routeKey)
}

export async function route(ctx: RouteContext): Promise<APIGatewayProxyStructuredResultV2> {
  const routeKey = ctx.event.routeKey
  if (!isKnownRoute(routeKey)) {
    throw new NotFoundError(`未知のルートです: ${routeKey}`)
  }

  switch (routeKey) {
    case 'POST /games':
      return createGameRoute(ctx)
    case 'POST /games/{id}/actions':
      return applyActionRoute(ctx)
    case 'GET /games/{id}':
      return getGameRoute(ctx)
    default: {
      const exhaustive: never = routeKey
      throw new NotFoundError(`未対応のルートです: ${String(exhaustive)}`)
    }
  }
}
