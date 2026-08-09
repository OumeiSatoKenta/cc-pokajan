import { describe, expect, it } from 'vitest'

import { groupSymbolOf, groupSymbolsByMember, seatName, seatOrientation } from '../../src/ui/labels'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import type { Group } from '../../src/engine/types'

function group(overrides: Partial<Group> = {}): Group {
  return { id: 'g1', name: 'ステラ組', memberIds: ['m1', 'm2'], ...overrides }
}

describe('groupSymbolOf', () => {
  it('未設定なら名前の1文字目を使う', () => {
    expect(groupSymbolOf(group())).toBe('ス')
  })

  it('設定されていればそちらを使う', () => {
    expect(groupSymbolOf(group({ symbol: '★' }))).toBe('★')
  })

  it('2文字の記号も使える', () => {
    expect(groupSymbolOf(group({ symbol: 'ST' }))).toBe('ST')
  })

  /** 空文字を保存してしまった場合も、名前から導出して空欄にしない。 */
  it('空文字や空白だけなら名前から導出する', () => {
    expect(groupSymbolOf(group({ symbol: '' }))).toBe('ス')
    expect(groupSymbolOf(group({ symbol: '   ' }))).toBe('ス')
  })

  it('名前の前後の空白を無視する', () => {
    expect(groupSymbolOf(group({ name: '  マリン組' }))).toBe('マ')
  })

  /**
   * `slice(0, 1)` だとサロゲートペアの片側だけを切り出し、文字化けした記号になる。
   * 利用者が絵文字をグループ名に使うことは十分ありうる。
   */
  it('絵文字の1文字目を壊さない', () => {
    expect(groupSymbolOf(group({ name: '🐙たこ組' }))).toBe('🐙')
    expect(groupSymbolOf(group({ symbol: '🎴' }))).toBe('🎴')
  })

  it('名前が空でも落ちない', () => {
    expect(groupSymbolOf(group({ name: '' }))).toBe('?')
  })
})

describe('groupSymbolsByMember', () => {
  it('所属メンバー全員に同じ記号を割り当てる', () => {
    const symbols = groupSymbolsByMember([group()])

    expect(symbols.get('m1')).toBe('ス')
    expect(symbols.get('m2')).toBe('ス')
  })

  it('グループごとに違う記号になる', () => {
    const symbols = groupSymbolsByMember([
      group({ id: 'g1', name: 'ステラ組', memberIds: ['m1'] }),
      group({ id: 'g2', name: 'マリン組', memberIds: ['m2'] }),
    ])

    expect(symbols.get('m1')).toBe('ス')
    expect(symbols.get('m2')).toBe('マ')
  })

  it('所属していないメンバーは含まれない', () => {
    expect(groupSymbolsByMember([group()]).get('m9')).toBeUndefined()
  })

  it('空の配列でも落ちない', () => {
    expect(groupSymbolsByMember([]).size).toBe(0)
  })

  /** 同梱ロスターの記号が重複していると、カードの角でグループを区別できない。 */
  it('同梱ロスターの記号が全て異なる', () => {
    const symbols = DEFAULT_ROSTER.groups.map(groupSymbolOf)

    expect(new Set(symbols).size).toBe(symbols.length)
  })
})

describe('seatOrientation', () => {
  it('自分は self、下家は右、対面は上、上家は左', () => {
    expect(seatOrientation(0, 0, 4)).toBe('self')
    expect(seatOrientation(1, 0, 4)).toBe('right')
    expect(seatOrientation(2, 0, 4)).toBe('top')
    expect(seatOrientation(3, 0, 4)).toBe('left')
  })

  /**
   * **卓が回らないことの検査。** `playerId` から直接引く実装だと、
   * `humanSeat` を変えたときに呼び名と置き場所が食い違う。
   * どの席を人間にしても「あなた=self / 下家=right / 対面=top / 上家=left」が保たれること。
   */
  it('humanSeat を変えても呼び名と置き場所の対応が変わらない', () => {
    const expected: Record<string, string> = {
      あなた: 'self',
      下家: 'right',
      対面: 'top',
      上家: 'left',
    }

    for (let humanSeat = 0; humanSeat < 4; humanSeat++) {
      for (let playerId = 0; playerId < 4; playerId++) {
        const name = seatName(playerId, humanSeat, 4)

        expect(seatOrientation(playerId, humanSeat, 4), `human=${humanSeat} p=${playerId}`).toBe(
          expected[name],
        )
      }
    }
  })

  /**
   * 4人以外でも落ちない。5人目以降は対応する向きが無いので上段に積む。
   * （3人なら 0/1/2 が全て対応表に載るため、そのまま self/right/top になる。）
   */
  it('対応する向きが無い席は top に落ちる', () => {
    expect(seatOrientation(4, 0, 5)).toBe('top')
    expect(seatOrientation(0, 1, 5)).toBe('top')

    expect(seatOrientation(0, 0, 3)).toBe('self')
    expect(seatOrientation(1, 0, 3)).toBe('right')
  })
})
