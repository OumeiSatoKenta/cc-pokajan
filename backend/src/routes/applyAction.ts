/**
 * POST /games/{id}/actions — 人間 Action を適用し CPU を解決して楽観ロックで保存する。
 *
 * 進行・精算に使う rules は**サーバー権威（gameConfig.RULES）**（保存 item.rules は監査用スナップショット）。
 * gameOver に遷移したら `settleGame` で一度だけ精算する。既に settled/gameOver の対局は書き込まず現状を返す。
 * 409（stale もしくは実書き込み時の競合）は body に現在の snapshot を載せて再同期を促す。
 */
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import { requireSub } from '../auth'
import { isApplyActionRequest, type GameItem, type RouteContext } from '../dto'
import { BadRequestError, VersionConflictError } from '../errors'
import { AI, HUMAN_SEAT, HUMAN_SEATS, MAX_ADVANCE_STEPS, RULES } from '../gameConfig'
import { applyHumanThenAdvance, buildOutcome, normalizeHumanAction } from '../gameFlow'
import { readJsonBody, requireGameId } from '../http'
import { getGame, settleGame, updateGameVersioned } from '../repo/gameRepo'
import { respondSnapshot } from '../respond'

export async function applyActionRoute(
  ctx: RouteContext,
): Promise<APIGatewayProxyStructuredResultV2> {
  const sub = requireSub(ctx.event)
  const id = requireGameId(ctx.event)

  const body = readJsonBody(ctx.event)
  if (!isApplyActionRequest(body)) {
    throw new BadRequestError('action と expectedVersion(number) が必要です')
  }

  const item = await getGame(ctx.doc, ctx.table, id, sub)

  // stale なクライアント（既に version が進んでいる）は 409 で現状を返して再同期させる。
  if (item.version !== body.expectedVersion) {
    return currentSnapshot(ctx, sub, id, item, 409)
  }

  // 既に精算済み/終局: 書き込まず現状を返す（二重精算・version 膨張を防ぐ）。
  if (item.status === 'settled' || item.state.phase === 'gameOver') {
    return currentSnapshot(ctx, sub, id, item, 200)
  }

  const engineAction = normalizeHumanAction(body.action, HUMAN_SEAT)
  const advanced = applyHumanThenAdvance(
    item.state,
    engineAction,
    RULES,
    AI,
    HUMAN_SEATS,
    MAX_ADVANCE_STEPS,
  )

  const nextVersion = body.expectedVersion + 1
  const now = new Date().toISOString()
  const nextItem: GameItem = {
    ...item,
    version: nextVersion,
    state: advanced.state,
    updatedAt: now,
  }

  try {
    if (advanced.state.phase === 'gameOver') {
      // 精算（原子的・一度だけ）。BET は作成時に差引済みなので加算は gross（appReducer の FINISH と同一会計）。
      const outcome = buildOutcome(advanced.state, HUMAN_SEAT, item.bet, RULES)
      const settledItem: GameItem = { ...nextItem, status: 'settled' }
      await settleGame(
        ctx.doc,
        ctx.table,
        settledItem,
        body.expectedVersion,
        sub,
        outcome.payout.gross,
      )
    } else {
      await updateGameVersioned(ctx.doc, ctx.table, nextItem, body.expectedVersion)
    }
  } catch (err) {
    // 事前チェックを抜けた後の真の競合（同一 expectedVersion の同時到達で条件付き書込みが片方だけ失敗）。
    // 最新を読み直して snapshot 付き 409 を返す（事前チェックの 409 と同じ再同期 UX に揃える）。
    if (err instanceof VersionConflictError) {
      const fresh = await getGame(ctx.doc, ctx.table, id, sub)
      return currentSnapshot(ctx, sub, id, fresh, 409)
    }
    throw err
  }

  return respondSnapshot(ctx, sub, 200, {
    id,
    version: nextVersion,
    state: advanced.state,
    events: advanced.events,
    bet: item.bet,
  })
}

/** 書き込みを伴わない現状 snapshot 応答（stale/競合 409・settled 素通し 200）。events は空。 */
function currentSnapshot(
  ctx: RouteContext,
  sub: string,
  id: string,
  item: GameItem,
  statusCode: number,
): Promise<APIGatewayProxyStructuredResultV2> {
  return respondSnapshot(ctx, sub, statusCode, {
    id,
    version: item.version,
    state: item.state,
    events: [],
    bet: item.bet,
  })
}
