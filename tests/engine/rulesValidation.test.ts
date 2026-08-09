import { describe, expect, it } from 'vitest'

import { canStartGame, validateRules } from '../../src/engine/rulesValidation'
import { DEFAULT_RULES } from '../../src/config/rules'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import type { RulesConfig } from '../../src/engine/types'

function withRules(overrides: Partial<RulesConfig>): RulesConfig {
  return { ...DEFAULT_RULES, ...overrides }
}

/** 検証が落とす理由を1つに絞れているか確かめる（無関係な項目まで落としていないか）。 */
function errorsOf(overrides: Partial<RulesConfig>): readonly string[] {
  return validateRules(withRules(overrides)).errors
}

describe('validateRules — 既定値', () => {
  it('同梱の既定ルールは検証を通る', () => {
    const result = validateRules(DEFAULT_RULES)

    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('既定ルールでは警告も出ない', () => {
    expect(validateRules(DEFAULT_RULES).warnings).toEqual([])
  })
})

describe('validateRules — 人数と枚数', () => {
  /**
   * `createGame` では例外にならず「始まるが進まない対局」を作る値。
   * 例外にならないぶんフォールバックが働かないので、ここで必ず捕まえる。
   */
  it('handSize が0以下だと誤りになる（createGame は例外にしない）', () => {
    expect(errorsOf({ handSize: 0 }).length).toBeGreaterThan(0)
    expect(errorsOf({ handSize: -1 }).length).toBeGreaterThan(0)
  })

  it('playerCount が2未満だと誤りになる（createGame は例外にしない）', () => {
    expect(errorsOf({ playerCount: 0 }).length).toBeGreaterThan(0)
    expect(errorsOf({ playerCount: 1 }).length).toBeGreaterThan(0)
  })

  it('小数や NaN を整数として通さない', () => {
    expect(errorsOf({ handSize: 7.5 }).length).toBeGreaterThan(0)
    expect(errorsOf({ handSize: Number.NaN }).length).toBeGreaterThan(0)
    expect(errorsOf({ deckSize: Number.POSITIVE_INFINITY }).length).toBeGreaterThan(0)
  })

  it('山札が配牌以下だと誤りになる', () => {
    // 4人 × 7枚 = 28枚
    expect(errorsOf({ deckSize: 28 }).length).toBeGreaterThan(0)
    expect(errorsOf({ deckSize: 29 })).toEqual([])
  })

  it('色が空・重複だと誤りになる', () => {
    expect(errorsOf({ colors: [] }).length).toBeGreaterThan(0)
    expect(errorsOf({ colors: ['pink', 'pink', 'blue'] }).length).toBeGreaterThan(0)
  })

  it('ボーナスメンバー数は0を許す（ボーナスなしで遊べる）', () => {
    expect(errorsOf({ bonusMemberCount: 0 })).toEqual([])
    expect(errorsOf({ bonusMemberCount: -1 }).length).toBeGreaterThan(0)
  })

  it('初期点が0以下だと誤りになる', () => {
    expect(errorsOf({ startingScore: 0 }).length).toBeGreaterThan(0)
  })
})

describe('validateRules — グループ人数', () => {
  it('役判定が対応する3〜5人の範囲を外れると誤りになる', () => {
    expect(errorsOf({ minGroupSize: 2 }).length).toBeGreaterThan(0)
    expect(errorsOf({ maxGroupSize: 6 }).length).toBeGreaterThan(0)
  })

  it('下限が上限を超えると誤りになる', () => {
    expect(errorsOf({ minGroupSize: 5, maxGroupSize: 3 }).length).toBeGreaterThan(0)
  })

  it('3〜5 の内側なら通る', () => {
    expect(errorsOf({ minGroupSize: 3, maxGroupSize: 4 })).toEqual([])
    expect(errorsOf({ minGroupSize: 4, maxGroupSize: 4 })).toEqual([])
  })
})

describe('validateRules — 点数', () => {
  it('負の点数は誤りになる', () => {
    const scores = { ...DEFAULT_RULES.scores, triple: { base: -1, sameColor: 840 } }

    expect(errorsOf({ scores }).length).toBeGreaterThan(0)
  })

  it('0点は許す（役を無効化する使い方ができる）', () => {
    const scores = { ...DEFAULT_RULES.scores, triple: { base: 0, sameColor: 0 } }

    expect(errorsOf({ scores })).toEqual([])
  })

  it('小数の点数は誤りになる', () => {
    const scores = { ...DEFAULT_RULES.scores, group3: { base: 180.5, sameColor: 540 } }

    expect(errorsOf({ scores }).length).toBeGreaterThan(0)
  })

  /**
   * 3で割り切れない点数はツモの分配で端数が切り捨てられるだけで、
   * 点数保存則は保たれる（各人が同額を払い、勝者がその合計を得る）。
   * 遊べなくなるわけではないので誤りにしない。
   */
  it('3で割り切れない点数は誤りではなく警告になる', () => {
    const scores = { ...DEFAULT_RULES.scores, triple: { base: 100, sameColor: 840 } }
    const result = validateRules(withRules({ scores }))

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('ボーナス加点が3で割り切れない場合も警告になる', () => {
    const result = validateRules(withRules({ bonusPerCard: 91 }))

    expect(result.ok).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('validateRules — 持ち時間', () => {
  /** 初期値が下限を下回ると、時間切れのたびに持ち時間が伸びる。 */
  it('初期値が下限を下回ると誤りになる', () => {
    const turnTimer = { initialMs: 3_000, decrementMs: 5_000, minMs: 5_000 }

    expect(errorsOf({ turnTimer }).length).toBeGreaterThan(0)
  })

  it('初期値と下限が同じなら通る', () => {
    const turnTimer = { initialMs: 5_000, decrementMs: 5_000, minMs: 5_000 }

    expect(errorsOf({ turnTimer })).toEqual([])
  })

  it('減少幅0は許す（持ち時間が減らない設定）', () => {
    const turnTimer = { initialMs: 20_000, decrementMs: 0, minMs: 5_000 }

    expect(errorsOf({ turnTimer })).toEqual([])
  })

  it('下限0以下は誤りになる', () => {
    expect(
      errorsOf({ turnTimer: { initialMs: 20_000, decrementMs: 5_000, minMs: 0 } }).length,
    ).toBeGreaterThan(0)
  })
})

describe('validateRules — BET と精算', () => {
  it('BET の選択肢が空だと誤りになる', () => {
    expect(errorsOf({ bet: { ...DEFAULT_RULES.bet, options: [] } }).length).toBeGreaterThan(0)
  })

  it('BET 額が0以下だと誤りになる', () => {
    expect(errorsOf({ bet: { ...DEFAULT_RULES.bet, options: [0, 1000] } }).length).toBeGreaterThan(
      0,
    )
  })

  it('順位倍率の数がプレイヤー数と合わないと誤りになる', () => {
    const bet = { ...DEFAULT_RULES.bet, rankMultiplier: [2.5, 1.5, 1] }

    expect(errorsOf({ bet }).length).toBeGreaterThan(0)
  })

  /** 0.5 の倍数でないと `整数 × 倍率` に浮動小数の誤差が入り、精算が1ずれうる。 */
  it('順位倍率が 0.5 の倍数でないと誤りになる', () => {
    const bet = { ...DEFAULT_RULES.bet, rankMultiplier: [2.5, 1.1, 1, 1] }

    expect(errorsOf({ bet }).length).toBeGreaterThan(0)
  })

  it('順位倍率が0以下だと誤りになる', () => {
    const bet = { ...DEFAULT_RULES.bet, rankMultiplier: [2.5, 1.5, 1, 0] }

    expect(errorsOf({ bet }).length).toBeGreaterThan(0)
  })

  it('初期コインが最低 BET を下回ると誤りになる（1局も始められない）', () => {
    const bet = { ...DEFAULT_RULES.bet, initialWallet: 500 }

    expect(errorsOf({ bet }).length).toBeGreaterThan(0)
  })

  it('初期コインが最低 BET ちょうどなら通る', () => {
    const bet = { ...DEFAULT_RULES.bet, initialWallet: 1000 }

    expect(errorsOf({ bet })).toEqual([])
  })
})

describe('canStartGame', () => {
  it('既定の組み合わせで対局を作れる', () => {
    expect(canStartGame(DEFAULT_ROSTER, DEFAULT_RULES)).toBe(true)
  })

  /**
   * ルール単体では判定できず、**ロスターとの組み合わせでのみ壊れる**項目。
   * 検査項目の列挙では捕まえられないため、実際に作れるかで判定する。
   */
  it('ボーナスメンバー数がロスターの人数を超えると作れない', () => {
    const rules = withRules({ bonusMemberCount: 99 })

    // 構造的な検査は通ってしまう
    expect(validateRules(rules).ok).toBe(true)
    // 実際に作ろうとすると失敗する
    expect(canStartGame(DEFAULT_ROSTER, rules)).toBe(false)
  })

  it('登場グループ数がロスターのグループ数を超えると作れない', () => {
    expect(canStartGame(DEFAULT_ROSTER, withRules({ groupsPerGame: 99 }))).toBe(false)
  })

  it('山札がプールを超えると作れない', () => {
    expect(canStartGame(DEFAULT_ROSTER, withRules({ deckSize: 100_000 }))).toBe(false)
  })

  it('例外を投げず true/false で返す', () => {
    expect(() => canStartGame(DEFAULT_ROSTER, withRules({ deckSize: 5 }))).not.toThrow()
  })

  it('空のロスターでも例外にならない', () => {
    const empty = { version: 1, members: [], groups: [] }

    expect(canStartGame(empty, DEFAULT_RULES)).toBe(false)
  })

  /** 何度呼んでも同じ結果になる（固定シードで副作用がない）。 */
  it('繰り返し呼んでも結果が変わらない', () => {
    expect(canStartGame(DEFAULT_ROSTER, DEFAULT_RULES)).toBe(true)
    expect(canStartGame(DEFAULT_ROSTER, DEFAULT_RULES)).toBe(true)
  })
})
