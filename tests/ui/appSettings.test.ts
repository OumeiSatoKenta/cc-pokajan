import { describe, expect, it } from 'vitest'

import { resolveSettings } from '../../src/appSettings'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import type { Prefs } from '../../src/storage/prefs'

/**
 * localStorage とエンジンの境界。
 *
 * **保存値は外部入力**で、ユーザーが直接編集できる。`handSize: 0` のような値が
 * そのまま `createGame` に渡ると配牌の時点で例外になり、永続化されているため
 * リロードしても回復しない（＝タイトル画面すら出せなくなる）。
 * 採用の条件は「実際に対局を始められること」。
 */

const DEFAULTS = { roster: DEFAULT_ROSTER, rules: DEFAULT_RULES }

function prefs(overrides: Partial<Prefs> = {}): Prefs {
  return {
    version: 1,
    wallet: 10_000,
    lastSeed: 1,
    roster: null,
    avatars: null,
    rulesOverride: null,
    ...overrides,
  }
}

describe('保存値が無い場合', () => {
  it('既定値をそのまま使う', () => {
    const result = resolveSettings(prefs(), DEFAULTS)

    expect(result.roster).toBe(DEFAULT_ROSTER)
    expect(result.rules).toBe(DEFAULT_RULES)
    expect(result.fellBack).toBe(false)
  })
})

describe('妥当な保存値', () => {
  it('ルールの差分が既定値へマージされる', () => {
    const result = resolveSettings(prefs({ rulesOverride: { startingScore: 2000 } }), DEFAULTS)

    expect(result.rules.startingScore).toBe(2000)
    // 触っていない項目は既定値に追随する
    expect(result.rules.bonusPerCard).toBe(DEFAULT_RULES.bonusPerCard)
    expect(result.fellBack).toBe(false)
  })

  it('保存されたロスターが採用される', () => {
    const custom = { ...DEFAULT_ROSTER, version: 2 }
    const result = resolveSettings(prefs({ roster: custom }), DEFAULTS)

    expect(result.roster.version).toBe(2)
    expect(result.fellBack).toBe(false)
  })
})

describe('起動を壊す保存値', () => {
  function fallsBack(overrides: Partial<Prefs>): boolean {
    return resolveSettings(prefs(overrides), DEFAULTS).fellBack
  }

  /** createGame では例外にならず「始まるが進まない対局」を作る値。 */
  it('handSize 0 は採用しない', () => {
    expect(fallsBack({ rulesOverride: { handSize: 0 } })).toBe(true)
  })

  it('playerCount 0 は採用しない', () => {
    expect(fallsBack({ rulesOverride: { playerCount: 0 } })).toBe(true)
  })

  it('山札がプールを超える設定は採用しない', () => {
    expect(fallsBack({ rulesOverride: { deckSize: 100_000 } })).toBe(true)
  })

  /** ルール単体では妥当だが、ロスターとの組み合わせで壊れる例。 */
  it('ボーナス人数がロスターを超える設定は採用しない', () => {
    expect(fallsBack({ rulesOverride: { bonusMemberCount: 99 } })).toBe(true)
  })

  it('登場グループ数がロスターを超える設定は採用しない', () => {
    expect(fallsBack({ rulesOverride: { groupsPerGame: 99 } })).toBe(true)
  })

  it('倒したときは必ず既定値で起動する', () => {
    const result = resolveSettings(prefs({ rulesOverride: { handSize: 0 } }), DEFAULTS)

    expect(result.rules).toBe(DEFAULT_RULES)
    expect(result.roster).toBe(DEFAULT_ROSTER)
  })
})

describe('壊れたロスター', () => {
  it('形が違えば既定ロスターに倒す', () => {
    for (const roster of ['文字列', 42, [], { members: 'x' }, { groups: [] }]) {
      const result = resolveSettings(prefs({ roster }), DEFAULTS)
      expect(result.roster, JSON.stringify(roster)).toBe(DEFAULT_ROSTER)
    }
  })

  it('形は正しいが対局を組めないロスターは採用しない', () => {
    // グループが1つしかない（groupsPerGame は 4）
    const broken = {
      version: 1,
      members: [{ id: 'a', name: 'A' }],
      groups: [{ id: 'g', name: 'G', memberIds: ['a'] }],
    }

    expect(resolveSettings(prefs({ roster: broken }), DEFAULTS).fellBack).toBe(true)
  })

  it('存在しないメンバーを参照するロスターは採用しない', () => {
    const broken = {
      ...DEFAULT_ROSTER,
      groups: DEFAULT_ROSTER.groups.map((group) => ({ ...group, memberIds: ['nope'] })),
    }

    expect(resolveSettings(prefs({ roster: broken }), DEFAULTS).fellBack).toBe(true)
  })
})

describe('倒したことの通知', () => {
  it('保存値が無いときは通知しない（初回起動と区別する）', () => {
    expect(resolveSettings(prefs(), DEFAULTS).fellBack).toBe(false)
  })

  it('保存値があって採用できなかったときだけ通知する', () => {
    expect(resolveSettings(prefs({ rulesOverride: { handSize: 0 } }), DEFAULTS).fellBack).toBe(true)
  })
})

describe('例外を投げない', () => {
  it('どんな保存値でも例外にならない', () => {
    const values: unknown[] = [null, undefined, 0, '', [], { a: 1 }, { members: null }]

    for (const value of values) {
      expect(() =>
        resolveSettings(prefs({ roster: value, rulesOverride: { x: value } as never }), DEFAULTS),
      ).not.toThrow()
    }
  })
})
