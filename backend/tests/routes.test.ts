import { describe, expect, it } from 'vitest'

import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import { createGame } from '@engine/game'

import { createHandler } from '../src/app'
import type { ClientAction, GameItem, GameSnapshot } from '../src/dto'
import { ROSTER, RULES } from '../src/gameConfig'
import { createFakeDoc } from './helpers/fakeDoc'
import { makeEvent } from './helpers/event'

const bodyOf = (res: APIGatewayProxyStructuredResultV2): GameSnapshot =>
  JSON.parse(res.body ?? '{}') as GameSnapshot

/** 初期 snapshot の局面から、常に合法な次の手を選ぶ（selfDeclare→SKIP、discard→先頭を捨てる）。 */
const nextLegalAction = (snapshot: GameSnapshot): ClientAction =>
  snapshot.view.phase === 'discard'
    ? { type: 'DISCARD', uid: snapshot.view.hand[0].uid }
    : { type: 'SKIP_DECLARE' }

describe('routes — 正常系（create → apply）', () => {
  it('POST /games: BET をサーバーで引き、初期 snapshot を version=1 で返す', async () => {
    const { client, store } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    const res = await handler(
      makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 1000 } }),
    )

    expect(res.statusCode).toBe(201)
    const snap = bodyOf(res)
    expect(snap.version).toBe(1)
    expect(snap.wallet).toBe(9000) // 10000 初期 - 1000 BET
    expect(snap.outcome).toBeNull()
    expect(store.get('USER#u1')?.coins).toBe(9000)
  })

  it('redaction: view に seed/wall/他家 hand を含めない（初期 snapshot）', async () => {
    const { client } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    const snap = bodyOf(
      await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 1000 } })),
    )

    expect('seed' in snap.view).toBe(false)
    expect('wall' in snap.view).toBe(false)
    for (const player of snap.view.players) {
      if (player.id !== 0) {
        expect('hand' in player).toBe(false)
      }
    }
  })

  /**
   * CPU の手が絡む局面（人間が捨てた後）で redaction を検査する。捨てた後は必ず CPU の引き札(CardDrawn)/
   * 補充(Refilled)が events に生じるため、redact が外れれば他家カードが漏れる。fake store の完全な state を
   * オラクルにして、他家手札・山札の uid が snapshot 全体（view + events）に出ないことを固定する。
   */
  it('redaction: 人間が捨てた後の snapshot に他家手札・山札 uid・他家引き札が現れない', async () => {
    const { client, store } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    const created = bodyOf(
      await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 1000 } })),
    )

    // selfDeclare なら先に SKIP して discard 局面へ進める（seed に依らず必ず「捨てる」まで到達させる）。
    let current = created
    if (current.view.phase === 'selfDeclare') {
      current = bodyOf(
        await handler(
          makeEvent({
            routeKey: 'POST /games/{id}/actions',
            sub: 'u1',
            id: created.id,
            body: { action: { type: 'SKIP_DECLARE' }, expectedVersion: current.version },
          }),
        ),
      )
    }
    expect(current.view.phase).toBe('discard')

    const afterDiscard = bodyOf(
      await handler(
        makeEvent({
          routeKey: 'POST /games/{id}/actions',
          sub: 'u1',
          id: created.id,
          body: {
            action: { type: 'DISCARD', uid: current.view.hand[0].uid },
            expectedVersion: current.version,
          },
        }),
      ),
    )

    // events に他家 CardDrawn/Refilled が混ざらない。
    expect(
      afterDiscard.events.some(
        (event) =>
          (event.type === 'CardDrawn' || event.type === 'Refilled') && event.playerId !== 0,
      ),
    ).toBe(false)

    // leak オラクル: fake store の真の state から他家手札・山札 uid を集め、snapshot JSON に出ないことを確認。
    const full = store.get(`GAME#${created.id}`)?.state as
      { players: { id: number; hand: { uid: number }[] }[]; wall: { uid: number }[] } | undefined
    expect(full).toBeDefined()
    const secretUids = [
      ...(full?.wall ?? []).map((card) => card.uid),
      ...(full?.players ?? [])
        .filter((player) => player.id !== 0)
        .flatMap((player) => player.hand.map((card) => card.uid)),
    ]
    const json = JSON.stringify(afterDiscard)
    for (const uid of secretUids) {
      expect(json.includes(`"uid":${uid},`)).toBe(false)
    }
  })

  it('POST /actions: 人間 Action を適用すると version が +1 になる', async () => {
    const { client } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    const created = bodyOf(
      await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 1000 } })),
    )
    const res = await handler(
      makeEvent({
        routeKey: 'POST /games/{id}/actions',
        sub: 'u1',
        id: created.id,
        body: { action: nextLegalAction(created), expectedVersion: 1 },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(bodyOf(res).version).toBe(2)
  })
})

describe('routes — 異常系', () => {
  it('stale な expectedVersion は 409 で書き込まない', async () => {
    const { client } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    const created = bodyOf(
      await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 1000 } })),
    )
    await handler(
      makeEvent({
        routeKey: 'POST /games/{id}/actions',
        sub: 'u1',
        id: created.id,
        body: { action: nextLegalAction(created), expectedVersion: 1 },
      }),
    ) // version は 2 になる

    const stale = await handler(
      makeEvent({
        routeKey: 'POST /games/{id}/actions',
        sub: 'u1',
        id: created.id,
        body: { action: { type: 'SKIP_DECLARE' }, expectedVersion: 1 },
      }),
    )
    expect(stale.statusCode).toBe(409)
    expect(bodyOf(stale).version).toBe(2) // 現状を返す
  })

  it('他人の対局・存在しない対局はどちらも 404（区別しない）', async () => {
    const { client } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    const created = bodyOf(
      await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 1000 } })),
    )

    const otherOwner = await handler(
      makeEvent({ routeKey: 'GET /games/{id}', sub: 'attacker', id: created.id }),
    )
    const missing = await handler(
      makeEvent({ routeKey: 'GET /games/{id}', sub: 'u1', id: 'DOES-NOT-EXIST' }),
    )

    expect(otherOwner.statusCode).toBe(404)
    expect(missing.statusCode).toBe(404)
  })

  it('残高不足で POST /games は 402', async () => {
    const poor = createFakeDoc({ 'USER#p1': { pk: 'USER#p1', coins: 500 } })
    const handler = createHandler({ doc: poor.client, table: 'T' })

    const res = await handler(
      makeEvent({ routeKey: 'POST /games', sub: 'p1', body: { bet: 1000 } }),
    )
    expect(res.statusCode).toBe(402)
  })

  it('未知ルートは 404、不正ボディ/不正 BET は 400', async () => {
    const { client } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    expect((await handler(makeEvent({ routeKey: 'DELETE /games', sub: 'u1' }))).statusCode).toBe(
      404,
    )
    expect(
      (await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: {} }))).statusCode,
    ).toBe(400)
    expect(
      (await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 777 } })))
        .statusCode,
    ).toBe(400)
  })

  it('手札に無い uid で DISCARD すると engine の IllegalActionError → 400', async () => {
    const { client } = createFakeDoc()
    const handler = createHandler({ doc: client, table: 'T' })

    const created = bodyOf(
      await handler(makeEvent({ routeKey: 'POST /games', sub: 'u1', body: { bet: 1000 } })),
    )
    const res = await handler(
      makeEvent({
        routeKey: 'POST /games/{id}/actions',
        sub: 'u1',
        id: created.id,
        body: { action: { type: 'DISCARD', uid: 999_999 }, expectedVersion: 1 },
      }),
    )
    expect(res.statusCode).toBe(400) // DTO 起因ではなく engine 起因の 400
  })
})

/**
 * settled/gameOver な対局への POST /actions は「書き込まず現状を返す」早期ガード（applyAction.ts）を直接検査する。
 * fake store に該当 item を直接シードし、DynamoDB への書き込みコマンドが1つも出ないこと・version 不変を固定する。
 */
describe('routes — gameOver/settled ガード（書き込まない）', () => {
  const seededItem = (overrides: Partial<GameItem>): GameItem => ({
    pk: 'GAME#g1',
    ownerSub: 'u1',
    version: 5,
    status: 'active',
    state: createGame(ROSTER, RULES, 7, { humanSeats: [0] }),
    rules: RULES,
    seed: 7,
    bet: 1000,
    humanSeats: [0],
    createdAt: 'x',
    updatedAt: 'x',
    ttl: 0,
    ...overrides,
  })

  it('gameOver な対局へ送っても 200・version 不変・書き込みなし・outcome 付き', async () => {
    const base = createGame(ROSTER, RULES, 7, { humanSeats: [0] })
    const item = seededItem({ state: { ...base, phase: 'gameOver' } })
    const fake = createFakeDoc({ 'GAME#g1': item, 'USER#u1': { pk: 'USER#u1', coins: 8000 } })
    const handler = createHandler({ doc: fake.client, table: 'T' })

    const res = await handler(
      makeEvent({
        routeKey: 'POST /games/{id}/actions',
        sub: 'u1',
        id: 'g1',
        body: { action: { type: 'SKIP_DECLARE' }, expectedVersion: 5 },
      }),
    )

    expect(res.statusCode).toBe(200)
    const snap = bodyOf(res)
    expect(snap.version).toBe(5) // 不変
    expect(snap.outcome).not.toBeNull() // gameOver → 精算内訳が付く
    expect(fake.calls).not.toContain('PutCommand')
    expect(fake.calls).not.toContain('TransactWriteCommand')
    expect(fake.store.get('GAME#g1')?.version).toBe(5) // DB も不変
  })

  it('status=settled な対局へ送っても 200・version 不変・書き込みなし', async () => {
    const item = seededItem({ pk: 'GAME#g2', version: 9, status: 'settled' })
    const fake = createFakeDoc({ 'GAME#g2': item, 'USER#u1': { pk: 'USER#u1', coins: 8000 } })
    const handler = createHandler({ doc: fake.client, table: 'T' })

    const res = await handler(
      makeEvent({
        routeKey: 'POST /games/{id}/actions',
        sub: 'u1',
        id: 'g2',
        body: { action: { type: 'SKIP_DECLARE' }, expectedVersion: 9 },
      }),
    )

    expect(res.statusCode).toBe(200)
    expect(bodyOf(res).version).toBe(9)
    expect(fake.calls).not.toContain('PutCommand')
    expect(fake.calls).not.toContain('TransactWriteCommand')
  })
})
