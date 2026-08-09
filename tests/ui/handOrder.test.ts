import { describe, expect, it } from 'vitest'

import { sortHand } from '../../src/ui/handOrder'
import { COLOR_IDS, type Card, type Group } from '../../src/engine/types'
import { TEST_GROUPS, hand } from '../helpers/cards'

/**
 * 手札の並べ替え。
 *
 * 目的は「揃いかけの組を目で追えること」なので、検証も
 * **同じメンバー・同じグループのカードが隣接するか**という性質で書く。
 * 期待する配列を丸ごと書き下すと、色順を変えただけで無関係に落ちる脆いテストになる。
 */

const GROUPS: readonly Group[] = [TEST_GROUPS.trio, TEST_GROUPS.quartet, TEST_GROUPS.quintet]

function sorted(spec: string, drawnUid: number | null = null): readonly Card[] {
  return sortHand(hand(spec), { activeGroups: GROUPS, colors: COLOR_IDS, drawnUid })
}

function ids(cards: readonly Card[]): string[] {
  return cards.map((c) => c.memberId)
}

/** 同じ値が2つ以上の塊に分かれていないか（＝隣接しているか）。 */
function isContiguous(values: readonly string[]): boolean {
  const seen = new Set<string>()

  for (let i = 0; i < values.length; i++) {
    if (values[i] !== values[i - 1]) {
      if (seen.has(values[i])) {
        return false
      }
      seen.add(values[i])
    }
  }
  return true
}

describe('sortHand', () => {
  it('同じメンバーのカードが必ず隣接する', () => {
    // わざとバラバラの順で与える
    const result = sorted('c1:pink a1:blue c1:orange b2:pink a1:pink c1:blue')

    expect(isContiguous(ids(result))).toBe(true)
  })

  it('同じグループのカードがまとまる', () => {
    const result = sorted('c1:pink a1:pink b2:pink a3:pink c5:pink b1:pink')
    const groupOf = result.map((c) => c.memberId[0])

    expect(isContiguous(groupOf)).toBe(true)
  })

  it('グループは activeGroups の順に並ぶ', () => {
    const result = sorted('c1:pink b1:pink a1:pink')

    expect(ids(result)).toEqual(['a1', 'b1', 'c1'])
  })

  it('グループ内はメンバーの定義順に並ぶ', () => {
    const result = sorted('c5:pink c1:pink c3:pink')

    expect(ids(result)).toEqual(['c1', 'c3', 'c5'])
  })

  it('同じメンバーの中では色の定義順に並ぶ', () => {
    const result = sorted('a1:orange a1:blue a1:pink')

    expect(result.map((c) => c.color)).toEqual([...COLOR_IDS])
  })

  /**
   * 色順まで同じカードが uid 未指定のまま残ると、framer-motion の layout が
   * レンダーのたびに位置を入れ替えて手札が揺れる。
   */
  it('全ての条件が同じでも uid で決定的に並ぶ', () => {
    const cards = hand('a1:pink a1:pink a1:pink')
    const forward = sortHand(cards, { activeGroups: GROUPS, colors: COLOR_IDS, drawnUid: null })
    const reversed = sortHand([...cards].reverse(), {
      activeGroups: GROUPS,
      colors: COLOR_IDS,
      drawnUid: null,
    })

    expect(forward.map((c) => c.uid)).toEqual(reversed.map((c) => c.uid))
  })

  it('入力の配列を破壊しない', () => {
    const cards = hand('c1:pink a1:pink b1:pink')
    const snapshot = [...cards]

    sortHand(cards, { activeGroups: GROUPS, colors: COLOR_IDS, drawnUid: null })

    expect(cards).toEqual(snapshot)
  })

  it('枚数と中身は変わらない', () => {
    const cards = hand('c1:pink a1:blue b2:orange a1:pink')
    const result = sortHand(cards, { activeGroups: GROUPS, colors: COLOR_IDS, drawnUid: null })

    expect([...result].sort((a, b) => a.uid - b.uid)).toEqual(
      [...cards].sort((a, b) => a.uid - b.uid),
    )
  })
})

describe('sortHand — 引いた1枚', () => {
  /**
   * 整列に混ぜると「今引いた1枚」が手札に紛れ、
   * ツモ切りするかどうかの判断ができなくなる。
   */
  it('引いた1枚は並べ替えに混ぜず末尾に置く', () => {
    // uid 0 は a1 なので、本来なら先頭に来るはずのカード
    const result = sorted('a1:pink c1:pink b1:pink', 0)

    expect(result.at(-1)?.uid).toBe(0)
    expect(ids(result)).toEqual(['b1', 'c1', 'a1'])
  })

  it('引いた1枚が手札にない場合は何も固定しない', () => {
    const result = sorted('c1:pink a1:pink', 999)

    expect(ids(result)).toEqual(['a1', 'c1'])
  })

  it('引いた1枚を除いた残りは通常どおり整列する', () => {
    const result = sorted('c1:pink a1:blue a1:pink', 0)

    expect(ids(result)).toEqual(['a1', 'a1', 'c1'])
  })
})

describe('sortHand — 端条件', () => {
  it('空の手札を返す', () => {
    expect(sorted('')).toEqual([])
  })

  it('1枚だけでも落ちない', () => {
    expect(ids(sorted('a1:pink'))).toEqual(['a1'])
  })

  /**
   * 山札は activeGroups の構成メンバーからしか作られないため実際には起こらないが、
   * 起こったときに落ちるべきなのは対局であって並べ替えではない。
   */
  it('どのグループにも属さないメンバーは例外を投げず末尾に送る', () => {
    const result = sorted('z9:pink a1:pink')

    expect(ids(result)).toEqual(['a1', 'z9'])
  })

  it('未知の色でも落ちない', () => {
    const cards = [{ uid: 0, memberId: 'a1', color: 'gold' } as unknown as Card, ...hand('a1:pink')]

    expect(() =>
      sortHand(cards, { activeGroups: GROUPS, colors: COLOR_IDS, drawnUid: null }),
    ).not.toThrow()
  })

  it('登場グループが空でも落ちない', () => {
    expect(() =>
      sortHand(hand('a1:pink'), { activeGroups: [], colors: COLOR_IDS, drawnUid: null }),
    ).not.toThrow()
  })
})
