import { describe, expect, it } from 'vitest'

import { actionBarItems, hintFor } from '../../src/ui/components/actionBarItems'
import type { YakuCandidate } from '../../src/engine/types'
import { card } from '../helpers/cards'

/**
 * 「どのボタンを出すか」を純粋関数として検証する。
 *
 * `renderToStaticMarkup` は `useEffect` を実行せず、E2E は遅くて粒度が粗い。
 * 判断そのものを切り出しておくことで、その隙間を jsdom なしで埋められる。
 */

function candidate(overrides: Partial<YakuCandidate> = {}): YakuCandidate {
  return {
    kind: 'triple',
    sameColor: false,
    cards: [card('a1:pink', 1), card('a1:blue', 2), card('a1:orange', 3)],
    bonusCount: 0,
    score: 120,
    ...overrides,
  }
}

describe('actionBarItems', () => {
  it('宣言できる役がなければ何も出さない', () => {
    expect(actionBarItems({ phase: 'selfDeclare', declarable: [], claimable: [] })).toEqual([])
  })

  it('割り込める役がなければ何も出さない', () => {
    expect(actionBarItems({ phase: 'claimWindow', declarable: [], claimable: [] })).toEqual([])
  })

  it('関係のないフェーズでは何も出さない', () => {
    const items = actionBarItems({
      phase: 'discard',
      declarable: [candidate()],
      claimable: [candidate()],
    })

    expect(items).toEqual([])
  })

  it('宣言フェーズでは役ごとのボタンと見送るボタンを出す', () => {
    const items = actionBarItems({
      phase: 'selfDeclare',
      declarable: [candidate()],
      claimable: [],
    })

    expect(items.map((item) => item.kind)).toEqual(['declare', 'pass'])
    expect(items[0].label).toContain('3カード')
    expect(items[0].label).toContain('120点')
    expect(items[1].label).toBe('見送る')
  })

  it('割り込み受付では claim ボタンを出す', () => {
    const items = actionBarItems({
      phase: 'claimWindow',
      declarable: [],
      claimable: [candidate()],
    })

    expect(items.map((item) => item.kind)).toEqual(['claim', 'pass'])
  })

  it('宣言フェーズでは claimable を無視する', () => {
    const items = actionBarItems({
      phase: 'selfDeclare',
      declarable: [candidate()],
      claimable: [candidate({ score: 9999 })],
    })

    expect(items.filter((item) => item.kind === 'claim')).toEqual([])
  })

  it('点数の高い役を先に並べる', () => {
    const low = candidate({ score: 120 })
    const high = candidate({ kind: 'group4', score: 300 })

    const items = actionBarItems({ phase: 'selfDeclare', declarable: [low, high], claimable: [] })

    expect(items[0].candidate?.score).toBe(300)
    expect(items[1].candidate?.score).toBe(120)
  })

  it('同点なら消費枚数の少ない方を先に並べる', () => {
    const many = candidate({
      kind: 'group4',
      score: 300,
      cards: [card('b1:pink', 1), card('b2:pink', 2), card('b3:pink', 3), card('b4:pink', 4)],
    })
    const few = candidate({ score: 300 })

    const items = actionBarItems({ phase: 'selfDeclare', declarable: [many, few], claimable: [] })

    expect(items[0].candidate?.cards).toHaveLength(3)
  })

  it('同色の役には同色であることが表示される', () => {
    const items = actionBarItems({
      phase: 'selfDeclare',
      declarable: [candidate({ sameColor: true, score: 840 })],
      claimable: [],
    })

    expect(items[0].label).toContain('同色')
  })

  it('見送るボタンは候補を持たない', () => {
    const items = actionBarItems({
      phase: 'selfDeclare',
      declarable: [candidate()],
      claimable: [],
    })

    expect(items.at(-1)?.candidate).toBeUndefined()
  })

  it('入力の配列を破壊しない（並べ替えが副作用にならない）', () => {
    const low = candidate({ score: 120 })
    const high = candidate({ kind: 'group4', score: 300 })
    const declarable = [low, high]

    actionBarItems({ phase: 'selfDeclare', declarable, claimable: [] })

    expect(declarable[0]).toBe(low)
  })
})

describe('hintFor', () => {
  const none = { declarable: [], claimable: [] } as const

  it('捨てられるときは捨て札を促す', () => {
    expect(hintFor({ phase: 'discard', ...none, canDiscard: true })).toBe(
      '捨てるカードを選んでください',
    )
  })

  /** ボタンが出ているのに「待て」と言う矛盾を防ぐ。 */
  it('宣言できる役があるときは相手の手番と表示しない', () => {
    expect(
      hintFor({
        phase: 'selfDeclare',
        declarable: [candidate()],
        claimable: [],
        canDiscard: false,
      }),
    ).toBe('役が成立しています')
  })

  it('割り込める役があるときは割り込めると表示する', () => {
    expect(
      hintFor({
        phase: 'claimWindow',
        declarable: [],
        claimable: [candidate()],
        canDiscard: false,
      }),
    ).toBe('割り込めます')
  })

  it('終局していればそう伝える', () => {
    expect(hintFor({ phase: 'gameOver', ...none, canDiscard: false })).toBe('対局終了')
  })

  it('何も求められていなければ相手の手番と表示する', () => {
    expect(hintFor({ phase: 'draw', ...none, canDiscard: false })).toBe('相手の手番です')
  })

  it('フェーズが合わない候補は無視する', () => {
    // claimWindow でない場面で claimable が残っていても「割り込めます」とは出さない
    expect(
      hintFor({ phase: 'discard', declarable: [], claimable: [candidate()], canDiscard: false }),
    ).toBe('相手の手番です')
  })
})
