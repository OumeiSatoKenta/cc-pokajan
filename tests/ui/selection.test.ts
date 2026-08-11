import { describe, expect, it } from 'vitest'

import {
  interactionGate,
  resetKeyOf,
  toggleUid,
  type InteractionGateInput,
} from '../../src/ui/selection'

describe('toggleUid', () => {
  it('未選択の uid は末尾に足す（選んだ順を保つ）', () => {
    expect(toggleUid([], 3)).toEqual([3])
    expect(toggleUid([3, 1], 5)).toEqual([3, 1, 5])
  })

  it('選択済みの uid は外す', () => {
    expect(toggleUid([3, 1, 5], 1)).toEqual([3, 5])
    expect(toggleUid([3], 3)).toEqual([])
  })

  it('同じ uid を二度足さない（トグルなので追加→除去に戻る）', () => {
    const once = toggleUid([], 7)
    expect(once).toEqual([7])
    expect(toggleUid(once, 7)).toEqual([])
  })

  it('元の配列を破壊しない', () => {
    const original = [1, 2]
    toggleUid(original, 3)
    toggleUid(original, 1)
    expect(original).toEqual([1, 2])
  })
})

/**
 * 手札操作のゲート判定。ツモ／ロンの選択可否と手札タップの意味を1箇所で決める純関数。
 * `useSelection`（`useState`/`useEffect` と絡む）に閉じ込めず、判断だけを直接検証する。
 */
describe('interactionGate', () => {
  // 既定＝ツモ機会（自分の宣言番・宣言権者が自分・演出なし・捨てない）。各テストで必要な軸だけ上書きする。
  function input(overrides: Partial<InteractionGateInput> = {}): InteractionGateInput {
    return {
      phase: 'selfDeclare',
      declarer: 0,
      humanSeat: 0,
      isPaused: false,
      isClaimWindowOpen: false,
      claimableCount: 0,
      hasLastDiscard: false,
      canDiscard: false,
      ...overrides,
    }
  }

  it('自分の宣言番はツモ構成できる（select）', () => {
    expect(interactionGate(input())).toEqual({
      canDeclare: true,
      canClaim: false,
      interaction: 'select',
    })
  })

  it('他家が宣言権者ならツモ構成できない', () => {
    expect(interactionGate(input({ declarer: 1 })).canDeclare).toBe(false)
  })

  it('割り込める役を持つ受付中はロン構成できる（select）', () => {
    const gate = interactionGate(
      input({
        phase: 'claimWindow',
        isClaimWindowOpen: true,
        claimableCount: 2,
        hasLastDiscard: true,
      }),
    )
    expect(gate).toEqual({ canDeclare: false, canClaim: true, interaction: 'select' })
  })

  it('割り込める役が0件ならロン構成できない', () => {
    const gate = interactionGate(
      input({
        phase: 'claimWindow',
        isClaimWindowOpen: true,
        claimableCount: 0,
        hasLastDiscard: true,
      }),
    )
    expect(gate.canClaim).toBe(false)
    expect(gate.interaction).toBe('none')
  })

  it('捨て札が無ければロン構成できない（受付は開いていても）', () => {
    const gate = interactionGate(
      input({
        phase: 'claimWindow',
        isClaimWindowOpen: true,
        claimableCount: 1,
        hasLastDiscard: false,
      }),
    )
    expect(gate.canClaim).toBe(false)
  })

  it('自分の打牌フェーズは discard（選択より優先）', () => {
    // canDiscard が真なら、ツモ構成条件が偽でも捨てる操作になる。
    expect(interactionGate(input({ phase: 'discard', canDiscard: true })).interaction).toBe(
      'discard',
    )
  })

  it('和了演出中（isPaused）は役があっても全操作を止める（両層停止の手札側）', () => {
    // ツモ機会でも演出中なら select にしない（キーボード経路の裏書きを塞ぐ）。
    expect(interactionGate(input({ isPaused: true }))).toEqual({
      canDeclare: false,
      canClaim: false,
      interaction: 'none',
    })
    // ロン機会でも同様。
    expect(
      interactionGate(
        input({
          phase: 'claimWindow',
          isPaused: true,
          isClaimWindowOpen: true,
          claimableCount: 3,
          hasLastDiscard: true,
        }),
      ).canClaim,
    ).toBe(false)
    // 打牌フェーズ（連続宣言の最終手で phase='discard' に進んだ演出裏）でも捨てさせない。
    expect(
      interactionGate(input({ isPaused: true, phase: 'discard', canDiscard: true })).interaction,
    ).toBe('none')
  })
})

/**
 * 選択リセットの境界を畳む鍵。局面が変わった瞬間に選択を空へ戻すために使う。
 * 4フィールドのいずれかが変われば鍵が変わり、同一局面では不変であることを固定する。
 */
describe('resetKeyOf', () => {
  const base = { phase: 'claimWindow', turn: 2, declarer: 0, chainCount: 0 } as const

  it('同じ局面では鍵が変わらない（構成中に選択が消えない）', () => {
    expect(resetKeyOf(base)).toBe(resetKeyOf({ ...base }))
  })

  it('turn が変わると鍵が変わる（別の捨て札＝別の受付でリセット）', () => {
    expect(resetKeyOf(base)).not.toBe(resetKeyOf({ ...base, turn: 3 }))
  })

  it('phase / declarer / chainCount のどれが変わっても鍵が変わる', () => {
    expect(resetKeyOf(base)).not.toBe(resetKeyOf({ ...base, phase: 'discard' }))
    expect(resetKeyOf(base)).not.toBe(resetKeyOf({ ...base, declarer: 1 }))
    expect(resetKeyOf(base)).not.toBe(resetKeyOf({ ...base, chainCount: 1 }))
  })
})
