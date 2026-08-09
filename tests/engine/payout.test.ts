import { describe, expect, it } from 'vitest'

import { canAfford, computePayout, rankOf } from '../../src/engine/payout'
import { IllegalActionError } from '../../src/engine/errors'
import { DEFAULT_RULES } from '../../src/config/rules'
import { testRules } from '../helpers/game'

const rules = DEFAULT_RULES

describe('rankOf', () => {
  it('順位表の位置を1始まりで返す', () => {
    expect(rankOf([2, 0, 3, 1], 2)).toBe(1)
    expect(rankOf([2, 0, 3, 1], 0)).toBe(2)
    expect(rankOf([2, 0, 3, 1], 1)).toBe(4)
  })

  it('順位表にいないプレイヤーは例外', () => {
    expect(() => rankOf([0, 1, 2], 3)).toThrow(IllegalActionError)
  })

  it('空の順位表でも黙って0を返さない', () => {
    expect(() => rankOf([], 0)).toThrow(IllegalActionError)
  })
})

describe('computePayout — 基本', () => {
  it('1位は順位倍率 2.5 が掛かる', () => {
    const result = computePayout(1200, 1000, 1, rules)

    expect(result.rankMultiplier).toBe(2.5)
    expect(result.gross).toBe(3000)
    expect(result.net).toBe(2000)
  })

  it('2位は 1.5', () => {
    expect(computePayout(1200, 1000, 2, rules).gross).toBe(1800)
  })

  it('3位・4位は等倍', () => {
    expect(computePayout(1200, 1000, 3, rules).gross).toBe(1200)
    expect(computePayout(1200, 1000, 4, rules).gross).toBe(1200)
  })

  it('等倍のときは最終点数と BET 額の差がそのまま増減になる', () => {
    expect(computePayout(800, 1000, 4, rules).net).toBe(-200)
    expect(computePayout(1400, 1000, 3, rules).net).toBe(400)
  })

  it('破産して0点なら BET 額をまるごと失う', () => {
    const result = computePayout(0, 1000, 4, rules)

    expect(result.gross).toBe(0)
    expect(result.net).toBe(-1000)
  })
})

describe('computePayout — BET 倍率', () => {
  it('BET 2000 は BET 1000 のちょうど2倍の払い戻しになる', () => {
    const small = computePayout(1200, 1000, 1, rules)
    const large = computePayout(1200, 2000, 1, rules)

    expect(large.betMultiplier).toBe(2)
    expect(large.gross).toBe(small.gross * 2)
  })

  it('BET 額が増えると差し引きの増減も倍になる', () => {
    expect(computePayout(1200, 1000, 1, rules).net).toBe(2000)
    expect(computePayout(1200, 2000, 1, rules).net).toBe(4000)
  })

  /** 先頭ではなく最小値を基準にするので、並び順を変えても倍率は変わらない。 */
  it('BET 選択肢の並び順に依存しない', () => {
    const reversed = testRules({ bet: { ...rules.bet, options: [2000, 1000] } })

    expect(computePayout(1200, 2000, 1, reversed).betMultiplier).toBe(2)
    expect(computePayout(1200, 1000, 1, reversed).betMultiplier).toBe(1)
  })
})

describe('computePayout — 丸め', () => {
  /**
   * 既定ルールでは役の点数もボーナス加点もすべて偶数なので最終点は常に偶数になり、
   * 2.5 倍しても端数が出ない。**切り捨てが働かないことに正しさを預けない**ため、
   * 端数になる点数を直接与えて検証する。
   */
  it('端数は切り捨てる', () => {
    // 1201 × 2.5 = 3002.5
    expect(computePayout(1201, 1000, 1, rules).gross).toBe(3002)
    // 1201 × 1.5 = 1801.5
    expect(computePayout(1201, 1000, 2, rules).gross).toBe(1801)
  })

  it('切り上げでも四捨五入でもない', () => {
    // 四捨五入なら 3003、切り上げなら 3003 になる点数で確かめる
    expect(computePayout(1201, 1000, 1, rules).gross).not.toBe(3003)
  })

  it('BET 倍率が掛かっても端数の扱いは変わらない', () => {
    // 1201 × 2 × 2.5 = 6005（端数なし）
    expect(computePayout(1201, 2000, 1, rules).gross).toBe(6005)
  })

  it('順位倍率が 0.5 の倍数なら誤差なく計算できる', () => {
    // 大きめの点数でも厳密に一致すること（浮動小数の誤差が入らない）
    for (const score of [3360, 2468, 9999, 12345]) {
      expect(computePayout(score, 1000, 1, rules).gross).toBe(Math.floor(score * 2.5))
      expect(computePayout(score, 1000, 2, rules).gross).toBe(Math.floor(score * 1.5))
    }
  })
})

describe('computePayout — 素朴な別実装との突き合わせ', () => {
  /**
   * 構造テストだけでは「式そのものの取り違え」を検出できない。
   * 独立に書いた素朴な実装と全組み合わせで突き合わせる。
   */
  it('全 BET × 全順位 × 幅広い点数で素朴な実装と一致する', () => {
    const naive = (score: number, bet: number, rank: number): number =>
      Math.floor(score * (bet / 1000) * [2.5, 1.5, 1, 1][rank - 1]) - bet

    for (const bet of [1000, 2000]) {
      for (let rank = 1; rank <= 4; rank++) {
        for (let score = 0; score <= 3000; score += 7) {
          expect(computePayout(score, bet, rank, rules).net).toBe(naive(score, bet, rank))
        }
      }
    }
  })
})

describe('computePayout — 不正な入力', () => {
  it('選択肢にない BET 額は例外', () => {
    expect(() => computePayout(1000, 1500, 1, rules)).toThrow(IllegalActionError)
    expect(() => computePayout(1000, 0, 1, rules)).toThrow(IllegalActionError)
  })

  it('範囲外の順位は例外', () => {
    expect(() => computePayout(1000, 1000, 0, rules)).toThrow(IllegalActionError)
    expect(() => computePayout(1000, 1000, 5, rules)).toThrow(IllegalActionError)
  })

  it('整数でない順位は例外', () => {
    expect(() => computePayout(1000, 1000, 1.5, rules)).toThrow(IllegalActionError)
  })

  it('負の点数・有限でない点数は例外', () => {
    expect(() => computePayout(-1, 1000, 1, rules)).toThrow(IllegalActionError)
    expect(() => computePayout(Number.NaN, 1000, 1, rules)).toThrow(IllegalActionError)
    expect(() => computePayout(Number.POSITIVE_INFINITY, 1000, 1, rules)).toThrow(
      IllegalActionError,
    )
  })

  it('BET の選択肢が空なら例外', () => {
    const broken = testRules({ bet: { ...rules.bet, options: [] } })

    expect(() => computePayout(1000, 1000, 1, broken)).toThrow(IllegalActionError)
  })
})

describe('canAfford', () => {
  it('所持コインが BET 額以上なら出せる', () => {
    expect(canAfford(1000, 1000)).toBe(true)
    expect(canAfford(1001, 1000)).toBe(true)
  })

  it('1コインでも足りなければ出せない', () => {
    expect(canAfford(999, 1000)).toBe(false)
    expect(canAfford(0, 1000)).toBe(false)
  })
})
