import { describe, expect, it } from 'vitest'

import { isApplyActionRequest, isCreateGameRequest } from '../src/dto'

describe('isCreateGameRequest', () => {
  it('bet が数値なら受理、欠落・非数値・非オブジェクトは拒否', () => {
    expect(isCreateGameRequest({ bet: 1000 })).toBe(true)
    expect(isCreateGameRequest({})).toBe(false)
    expect(isCreateGameRequest({ bet: '1000' })).toBe(false)
    expect(isCreateGameRequest(null)).toBe(false)
    expect(isCreateGameRequest('x')).toBe(false)
  })
})

describe('isApplyActionRequest', () => {
  it('既知の ClientAction と数値 expectedVersion を受理する', () => {
    expect(isApplyActionRequest({ action: { type: 'SKIP_DECLARE' }, expectedVersion: 1 })).toBe(
      true,
    )
    expect(isApplyActionRequest({ action: { type: 'DISCARD', uid: 3 }, expectedVersion: 2 })).toBe(
      true,
    )
    expect(isApplyActionRequest({ action: { type: 'PASS' }, expectedVersion: 0 })).toBe(true)
    expect(
      isApplyActionRequest({ action: { type: 'DECLARE', candidate: {} }, expectedVersion: 5 }),
    ).toBe(true)
  })

  it('サーバー内部専用の DRAW / TICK はクライアントから受理しない', () => {
    expect(isApplyActionRequest({ action: { type: 'DRAW' }, expectedVersion: 1 })).toBe(false)
    expect(
      isApplyActionRequest({ action: { type: 'TICK', deltaMs: 100 }, expectedVersion: 1 }),
    ).toBe(false)
  })

  it('expectedVersion 欠落・action 欠落・不正 type は拒否', () => {
    expect(isApplyActionRequest({ action: { type: 'PASS' } })).toBe(false)
    expect(isApplyActionRequest({ expectedVersion: 1 })).toBe(false)
    expect(isApplyActionRequest({ action: { type: 'NOPE' }, expectedVersion: 1 })).toBe(false)
    expect(isApplyActionRequest({ action: { type: 'DISCARD' }, expectedVersion: 1 })).toBe(false) // uid 欠落
  })
})
