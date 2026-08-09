import { describe, expect, it } from 'vitest'

import { DEFAULT_RULES } from '../../src/config/rules'
import { countBonusCards, scoreYaku } from '../../src/engine/score'
import type { YakuKind } from '../../src/engine/types'
import { hand } from '../helpers/cards'

const RULES = DEFAULT_RULES
const YAKU_KINDS: YakuKind[] = ['triple', 'group3', 'group4', 'group5']

describe('countBonusCards', () => {
  it('ボーナスメンバーがいなければ 0', () => {
    expect(countBonusCards(hand('a1:pink a2:blue a3:orange'), [])).toBe(0)
  })

  it('メンバーID基準で数える（色には依存しない）', () => {
    const cards = hand('a1:pink a1:blue a1:orange')
    expect(countBonusCards(cards, ['a1'])).toBe(3)
  })

  it('グループ役では該当メンバーの枚数だけ数える', () => {
    const cards = hand('a1:pink a2:blue a3:orange')
    expect(countBonusCards(cards, ['a2'])).toBe(1)
    expect(countBonusCards(cards, ['a1', 'a3'])).toBe(2)
  })

  it('役に含まれないメンバーがボーナスでも数に入らない', () => {
    expect(countBonusCards(hand('a1:pink a2:blue a3:orange'), ['b1'])).toBe(0)
  })

  it('空のカード列では 0', () => {
    expect(countBonusCards([], ['a1'])).toBe(0)
  })
})

describe('scoreYaku', () => {
  it.each(YAKU_KINDS)('通常の点数がルール設定の base と一致する（%s）', (kind) => {
    expect(scoreYaku(kind, false, 0, RULES)).toBe(RULES.scores[kind].base)
  })

  it.each(YAKU_KINDS)('同色の点数がルール設定の sameColor と一致する（%s）', (kind) => {
    expect(scoreYaku(kind, true, 0, RULES)).toBe(RULES.scores[kind].sameColor)
  })

  it('調査で判明した点数になる', () => {
    expect(scoreYaku('triple', false, 0, RULES)).toBe(120)
    expect(scoreYaku('triple', true, 0, RULES)).toBe(840)
    expect(scoreYaku('group3', false, 0, RULES)).toBe(180)
    expect(scoreYaku('group4', false, 0, RULES)).toBe(300)
    expect(scoreYaku('group4', true, 0, RULES)).toBe(840)
    expect(scoreYaku('group5', false, 0, RULES)).toBe(480)
    expect(scoreYaku('group5', true, 0, RULES)).toBe(1800)
  })

  it('ボーナス1枚につき bonusPerCard が加算される', () => {
    expect(scoreYaku('group4', false, 1, RULES)).toBe(300 + 90)
    expect(scoreYaku('group4', false, 2, RULES)).toBe(300 + 180)
  })

  it('3カードでボーナスメンバーを揃えると3枚分が加算される', () => {
    expect(scoreYaku('triple', false, 3, RULES)).toBe(120 + 270)
    expect(scoreYaku('triple', true, 3, RULES)).toBe(840 + 270)
  })

  it('ルール設定を差し替えると点数も変わる（値をハードコードしていない）', () => {
    const custom = {
      ...RULES,
      bonusPerCard: 30,
      scores: { ...RULES.scores, triple: { base: 999, sameColor: 1111 } },
    }

    expect(scoreYaku('triple', false, 0, custom)).toBe(999)
    expect(scoreYaku('triple', true, 0, custom)).toBe(1111)
    expect(scoreYaku('triple', false, 2, custom)).toBe(999 + 60)
  })

  it('未知の役種なら RangeError を投げる', () => {
    expect(() => scoreYaku('unknown' as YakuKind, false, 0, RULES)).toThrow(RangeError)
  })

  it('ボーナス枚数が負や非整数なら RangeError を投げる', () => {
    expect(() => scoreYaku('triple', false, -1, RULES)).toThrow(RangeError)
    expect(() => scoreYaku('triple', false, 1.5, RULES)).toThrow(RangeError)
  })
})
