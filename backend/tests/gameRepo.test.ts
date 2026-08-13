import { describe, expect, it } from 'vitest'

import type { GameItem } from '../src/dto'
import { PaymentRequiredError, VersionConflictError } from '../src/errors'
import { createGameWithDebit, settleGame, updateGameVersioned } from '../src/repo/gameRepo'
import { createFakeDoc } from './helpers/fakeDoc'

function gameItem(overrides: Partial<GameItem>): GameItem {
  return {
    pk: 'GAME#g1',
    ownerSub: 'u1',
    version: 1,
    status: 'active',
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    ttl: 0,
    ...overrides,
  } as unknown as GameItem
}

describe('updateGameVersioned — 楽観ロック', () => {
  it('保存後の version がちょうど +1 になる（呼び出し側が渡した version をそのまま条件付きで書く）', async () => {
    const doc = createFakeDoc({ 'GAME#g1': gameItem({ version: 3 }) })

    await updateGameVersioned(doc.client, 'T', gameItem({ version: 4 }), 3)

    expect(doc.store.get('GAME#g1')?.version).toBe(4)
  })

  it('expectedVersion がずれていると 409（VersionConflictError）で書き込まない', async () => {
    const doc = createFakeDoc({ 'GAME#g1': gameItem({ version: 4 }) })

    await expect(
      updateGameVersioned(doc.client, 'T', gameItem({ version: 5 }), 2), // stale
    ).rejects.toBeInstanceOf(VersionConflictError)

    expect(doc.store.get('GAME#g1')?.version).toBe(4) // 不変
  })
})

describe('createGameWithDebit — BET 差引', () => {
  it('残高が足りれば作成し、コインを引く', async () => {
    const doc = createFakeDoc({ 'USER#u1': { pk: 'USER#u1', coins: 5000 } })

    await createGameWithDebit(doc.client, 'T', gameItem({ pk: 'GAME#g2' }), 'u1', 1000)

    expect(doc.store.has('GAME#g2')).toBe(true)
    expect(doc.store.get('USER#u1')?.coins).toBe(4000)
  })

  it('残高不足なら 402（PaymentRequiredError）で作成もコイン移動もしない', async () => {
    const doc = createFakeDoc({ 'USER#u1': { pk: 'USER#u1', coins: 500 } })

    await expect(
      createGameWithDebit(doc.client, 'T', gameItem({ pk: 'GAME#g2' }), 'u1', 1000),
    ).rejects.toBeInstanceOf(PaymentRequiredError)

    expect(doc.store.has('GAME#g2')).toBe(false)
    expect(doc.store.get('USER#u1')?.coins).toBe(500) // 不変
  })
})

describe('settleGame — 精算は一度だけ', () => {
  it('active な対局を settled にしてコインを gross 加算する', async () => {
    const doc = createFakeDoc({
      'GAME#g1': gameItem({ version: 5, status: 'active' }),
      'USER#u1': { pk: 'USER#u1', coins: 1000 },
    })

    await settleGame(doc.client, 'T', gameItem({ version: 6, status: 'settled' }), 5, 'u1', 500)

    expect(doc.store.get('GAME#g1')?.status).toBe('settled')
    expect(doc.store.get('GAME#g1')?.version).toBe(6)
    expect(doc.store.get('USER#u1')?.coins).toBe(1500)
  })

  it('既に settled なら二度目の精算は 409 でコインを二重加算しない', async () => {
    const doc = createFakeDoc({
      'GAME#g1': gameItem({ version: 5, status: 'active' }),
      'USER#u1': { pk: 'USER#u1', coins: 1000 },
    })

    await settleGame(doc.client, 'T', gameItem({ version: 6, status: 'settled' }), 5, 'u1', 500)
    // 同じ expectedVersion=5 での二度目（status は既に settled・version は 6）。
    await expect(
      settleGame(doc.client, 'T', gameItem({ version: 6, status: 'settled' }), 5, 'u1', 500),
    ).rejects.toBeInstanceOf(VersionConflictError)

    expect(doc.store.get('USER#u1')?.coins).toBe(1500) // 二重加算されない
  })
})
