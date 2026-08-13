/** POST /games — 新規対局。BET を差引き、CPU を人間の番まで解決した初期 snapshot を返す。 */
import { randomInt } from 'node:crypto'

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'
import { ulid } from 'ulid'

import { createGame } from '@engine/game'

import { requireSub } from '../auth'
import { isCreateGameRequest, type GameItem, type RouteContext } from '../dto'
import { BadRequestError } from '../errors'
import {
  AI,
  HUMAN_SEATS,
  INITIAL_WALLET,
  MAX_ADVANCE_STEPS,
  ROSTER,
  RULES,
  TTL_DAYS,
} from '../gameConfig'
import { advanceToHuman } from '../gameFlow'
import { readJsonBody } from '../http'
import { gamePk } from '../keys'
import { createGameWithDebit } from '../repo/gameRepo'
import { ensureWallet } from '../repo/userRepo'
import { respondSnapshot } from '../respond'

const SECONDS_PER_DAY = 86_400

export async function createGameRoute(
  ctx: RouteContext,
): Promise<APIGatewayProxyStructuredResultV2> {
  const sub = requireSub(ctx.event)

  const body = readJsonBody(ctx.event)
  if (!isCreateGameRequest(body)) {
    throw new BadRequestError('bet(number) が必要です')
  }
  const bet = body.bet
  if (!RULES.bet.options.includes(bet)) {
    throw new BadRequestError(`bet は ${RULES.bet.options.join(' / ')} のいずれかです`)
  }

  await ensureWallet(ctx.doc, ctx.table, sub, INITIAL_WALLET)

  // seed は山札の並びを決める。デッキ生成アルゴリズムは公開されており、クライアントは自分の初期手札を観測できるため、
  // 予測可能な PRNG（Math.random）だと seed を逆算され山札を読まれる（＝この Step が防ぐべきカンニング）。
  // Lambda は engine ではないので、CSPRNG（node:crypto.randomInt）で予測不能な seed を作る。以後の進行は seed から決定的。
  const seed = randomInt(0x7fff_ffff)
  const initial = createGame(ROSTER, RULES, seed, { humanSeats: HUMAN_SEATS })
  const advanced = advanceToHuman(initial, RULES, AI, HUMAN_SEATS, MAX_ADVANCE_STEPS)

  // 生成直後の gameOver は現行仕様（席0が初回に必ず判断する・山札が十分）では到達不能。
  // 「たまたま成り立つ条件」に正しさを預けず、万一到達したら fail-fast（500）にする（この経路には精算が無く、
  //  status:'active' のまま固定されて払い戻し漏れになるのを黙って通さない）。
  if (advanced.state.phase === 'gameOver') {
    throw new Error('createGame 直後に gameOver へ到達しました（想定外・精算経路が無いため中断）')
  }

  const id = ulid()
  const now = new Date().toISOString()
  const item: GameItem = {
    pk: gamePk(id),
    ownerSub: sub,
    version: 1,
    status: 'active',
    state: advanced.state,
    rules: RULES,
    seed,
    bet,
    humanSeats: HUMAN_SEATS,
    createdAt: now,
    updatedAt: now,
    ttl: Math.floor(Date.now() / 1000) + TTL_DAYS * SECONDS_PER_DAY,
  }
  await createGameWithDebit(ctx.doc, ctx.table, item, sub, bet)

  return respondSnapshot(ctx, sub, 201, {
    id,
    version: 1,
    state: advanced.state,
    events: advanced.events,
    bet,
  })
}
