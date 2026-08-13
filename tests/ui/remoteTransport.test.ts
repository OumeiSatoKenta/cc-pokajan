import { describe, expect, it } from 'vitest'

import {
  RemoteTransportError,
  createRemoteTransport,
  parseSnapshot,
  toClientAction,
  type FetchImpl,
} from '../../src/ui/transport/remoteTransport'
import type { YakuCandidate } from '../../src/engine/types'

/**
 * remoteTransport の HTTP プロトコルを、aws-amplify も実ネットワークも介さず fake fetch で固定する。
 * 特に **409 はレスポンス本体の snapshot をそのまま使う（追加 GET をしない）** ことと、engine `Action` →
 * `ClientAction` 変換（`TICK→PASS`・`DRAW` 例外・`playerId` 除去）を検査する。
 */

/** parseSnapshot を通る最小の snapshot JSON。 */
function snap(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'g1',
    version: 2,
    view: { selfId: 0 },
    events: [],
    wallet: 100,
    outcome: null,
    ...overrides,
  }
}

/** 順に返す fake fetch。呼び出しを記録する。 */
function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ path: string; init?: RequestInit }> = []
  let index = 0
  const impl: FetchImpl = async (path, init) => {
    calls.push({ path, init })
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return new Response(JSON.stringify(response.body), {
      status: response.status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { impl, calls }
}

function bodyOf(init?: RequestInit): unknown {
  return init?.body === undefined ? undefined : JSON.parse(String(init.body))
}

describe('toClientAction', () => {
  const candidate = { kind: 'triple' } as unknown as YakuCandidate

  it('DISCARD / SKIP_DECLARE はそのまま', () => {
    expect(toClientAction({ type: 'DISCARD', uid: 7 })).toEqual({ type: 'DISCARD', uid: 7 })
    expect(toClientAction({ type: 'SKIP_DECLARE' })).toEqual({ type: 'SKIP_DECLARE' })
  })

  it('DECLARE / CLAIM / PASS は playerId を落とす（サーバーが humanSeat を強制）', () => {
    expect(toClientAction({ type: 'DECLARE', playerId: 0, candidate })).toEqual({
      type: 'DECLARE',
      candidate,
    })
    expect(toClientAction({ type: 'CLAIM', playerId: 0, candidate })).toEqual({
      type: 'CLAIM',
      candidate,
    })
    expect(toClientAction({ type: 'PASS', playerId: 0 })).toEqual({ type: 'PASS' })
  })

  it('TICK（claim 時間切れ）は PASS に落とす', () => {
    expect(toClientAction({ type: 'TICK', deltaMs: 20_000 })).toEqual({ type: 'PASS' })
  })

  it('DRAW はクライアントから送れない（例外）', () => {
    expect(() => toClientAction({ type: 'DRAW' })).toThrow(/DRAW/)
  })
})

describe('parseSnapshot', () => {
  it('妥当な snapshot を通す', () => {
    expect(parseSnapshot(snap({ id: 'x', version: 5 })).id).toBe('x')
  })

  it('object でない・必須欠けは例外', () => {
    expect(() => parseSnapshot(null)).toThrow()
    expect(() => parseSnapshot(snap({ version: 'nope' }))).toThrow()
    expect(() => parseSnapshot(snap({ view: 42 }))).toThrow()
    expect(() => parseSnapshot(snap({ events: 'no' }))).toThrow()
    expect(() => parseSnapshot(snap({ wallet: null }))).toThrow()
  })
})

describe('createRemoteTransport', () => {
  it('create は POST /games に bet を送り、id を確定する', async () => {
    const { impl, calls } = fakeFetch([{ status: 201, body: snap({ id: 'game-1' }) }])
    const transport = createRemoteTransport({ bet: 1000, fetchImpl: impl })

    const snapshot = await transport.create()

    expect(snapshot.id).toBe('game-1')
    expect(calls[0].path).toBe('/games')
    expect(calls[0].init?.method).toBe('POST')
    expect(bodyOf(calls[0].init)).toEqual({ bet: 1000 })
  })

  it('current() は create 前は null、create 後は最新 snapshot', async () => {
    const { impl } = fakeFetch([{ status: 201, body: snap({ id: 'g', version: 1 }) }])
    const transport = createRemoteTransport({ bet: 1000, fetchImpl: impl })

    expect(transport.current()).toBeNull()
    await transport.create()
    expect(transport.current()?.version).toBe(1)
  })

  it('apply(200) は action を変換して送り accepted:true', async () => {
    const { impl, calls } = fakeFetch([
      { status: 201, body: snap({ id: 'g' }) },
      { status: 200, body: snap({ id: 'g', version: 3 }) },
    ])
    const transport = createRemoteTransport({ bet: 1000, fetchImpl: impl })
    await transport.create()

    const result = await transport.apply({ type: 'DISCARD', uid: 5 }, 2)

    expect(result.accepted).toBe(true)
    expect(result.snapshot.version).toBe(3)
    expect(calls[1].path).toBe('/games/g/actions')
    expect(bodyOf(calls[1].init)).toEqual({
      action: { type: 'DISCARD', uid: 5 },
      expectedVersion: 2,
    })
  })

  it('apply(409) は本体の snapshot をそのまま使い、追加 GET をしない', async () => {
    const { impl, calls } = fakeFetch([
      { status: 201, body: snap({ id: 'g', version: 2 }) },
      { status: 409, body: snap({ id: 'g', version: 9 }) },
    ])
    const transport = createRemoteTransport({ bet: 1000, fetchImpl: impl })
    await transport.create()

    const result = await transport.apply({ type: 'PASS', playerId: 0 }, 2)

    expect(result.accepted).toBe(false)
    expect(result.snapshot.version).toBe(9) // 再同期された最新
    expect(calls).toHaveLength(2) // create + apply のみ（GET 無し）
  })

  it('402/404/500 は status 付きの例外に変換する', async () => {
    for (const status of [402, 404, 500]) {
      const { impl } = fakeFetch([
        { status: 201, body: snap({ id: 'g' }) },
        { status, body: { message: `err ${status}` } },
      ])
      const transport = createRemoteTransport({ bet: 1000, fetchImpl: impl })
      await transport.create()

      await expect(transport.apply({ type: 'SKIP_DECLARE' }, 2)).rejects.toMatchObject({
        name: 'RemoteTransportError',
        statusCode: status,
      })
    }
  })

  it('get は GET /games/{id} を叩く', async () => {
    const { impl, calls } = fakeFetch([
      { status: 201, body: snap({ id: 'g' }) },
      { status: 200, body: snap({ id: 'g', version: 4 }) },
    ])
    const transport = createRemoteTransport({ bet: 1000, fetchImpl: impl })
    await transport.create()

    const snapshot = await transport.get()

    expect(snapshot.version).toBe(4)
    expect(calls[1].path).toBe('/games/g')
    expect(calls[1].init?.method).toBe('GET')
  })

  it('create 前に apply すると例外（誤用の早期検知）', async () => {
    const { impl } = fakeFetch([{ status: 200, body: snap() }])
    const transport = createRemoteTransport({ bet: 1000, fetchImpl: impl })

    await expect(transport.apply({ type: 'SKIP_DECLARE' }, 1)).rejects.toThrow(/create/)
  })

  it('nextAuto は常に null（CPU 進行はサーバー）', () => {
    const { impl } = fakeFetch([{ status: 201, body: snap() }])
    expect(createRemoteTransport({ bet: 1000, fetchImpl: impl }).nextAuto()).toBeNull()
  })
})

describe('RemoteTransportError', () => {
  it('status を持つ', () => {
    const error = new RemoteTransportError(404, '見つかりません')
    expect(error.statusCode).toBe(404)
    expect(error).toBeInstanceOf(Error)
  })
})
