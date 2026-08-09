import { describe, expect, it } from 'vitest'

import {
  settleRon,
  settleTsumo,
  toPaidEvents,
  type SettlementResult,
} from '../../src/engine/settle'

const START = [1000, 1000, 1000, 1000]

function total(scores: readonly number[]): number {
  return scores.reduce((sum, score) => sum + score, 0)
}

function paidTotal(result: SettlementResult): number {
  return result.payments.reduce((sum, payment) => sum + payment.amount, 0)
}

describe('settleTsumo', () => {
  it('自分以外の全員が等分を支払う', () => {
    const result = settleTsumo(START, 0, 300)

    expect(result.scores).toEqual([1300, 900, 900, 900])
    expect(result.payments).toHaveLength(3)
    for (const payment of result.payments) {
      expect(payment.amount).toBe(100)
      expect(payment.to).toBe(0)
    }
  })

  it('和了者以外の3人が支払い元になる', () => {
    const result = settleTsumo(START, 2, 180)
    expect(result.payments.map((payment) => payment.from).sort()).toEqual([0, 1, 3])
  })

  it('入力の点数配列を破壊しない', () => {
    const scores = [...START]
    settleTsumo(scores, 0, 300)
    expect(scores).toEqual(START)
  })

  it('和了者の増分が実際に徴収できた合計と一致する', () => {
    const result = settleTsumo(START, 1, 480)
    expect(result.scores[1] - START[1]).toBe(paidTotal(result))
  })

  it('割り切れない金額は切り捨てて分配する', () => {
    // 100 / 3 = 33.33... → 1人33、合計99。端数1点は誰からも徴収しない。
    const result = settleTsumo(START, 0, 100)
    expect(result.scores).toEqual([1099, 967, 967, 967])
    expect(total(result.scores)).toBe(total(START))
  })

  it('金額 0 なら誰も支払わない', () => {
    const result = settleTsumo(START, 0, 0)
    expect(result.scores).toEqual(START)
    expect(result.payments).toEqual([])
  })

  it('不正な引数なら RangeError を投げる', () => {
    expect(() => settleTsumo(START, -1, 300)).toThrow(RangeError)
    expect(() => settleTsumo(START, 4, 300)).toThrow(RangeError)
    expect(() => settleTsumo(START, 0, -1)).toThrow(RangeError)
    expect(() => settleTsumo([1000], 0, 300)).toThrow(RangeError)
  })
})

describe('settleRon', () => {
  it('放銃者だけが全額を支払う', () => {
    const result = settleRon(START, 0, 2, 840)

    expect(result.scores).toEqual([1840, 1000, 160, 1000])
    expect(result.payments).toEqual([{ from: 2, to: 0, amount: 840 }])
  })

  it('入力の点数配列を破壊しない', () => {
    const scores = [...START]
    settleRon(scores, 0, 1, 480)
    expect(scores).toEqual(START)
  })

  it('自分の捨て札でロンはできない', () => {
    expect(() => settleRon(START, 1, 1, 300)).toThrow(RangeError)
  })

  it('不正な引数なら RangeError を投げる', () => {
    expect(() => settleRon(START, 0, 9, 300)).toThrow(RangeError)
    expect(() => settleRon(START, 0, 1, Number.NaN)).toThrow(RangeError)
  })
})

describe('0 クランプ', () => {
  it('残高不足なら残高分だけを徴収する（ロン）', () => {
    const scores = [1000, 500, 1000, 1000]
    const result = settleRon(scores, 0, 1, 1800)

    expect(result.scores[1]).toBe(0)
    expect(result.scores[0]).toBe(1500)
    expect(result.payments).toEqual([{ from: 1, to: 0, amount: 500 }])
  })

  it('残高不足なら残高分だけを徴収する（ツモ）', () => {
    const scores = [1000, 50, 1000, 1000]
    const result = settleTsumo(scores, 0, 300)

    expect(result.scores[1]).toBe(0)
    expect(result.scores[2]).toBe(900)
    expect(result.scores[3]).toBe(900)
    // 50 + 100 + 100 = 250 しか集まらない
    expect(result.scores[0]).toBe(1250)
  })

  it('残高 0 の相手からは徴収しない', () => {
    const scores = [1000, 0, 1000, 1000]
    const result = settleRon(scores, 0, 1, 300)

    expect(result.scores).toEqual(scores)
    expect(result.payments).toEqual([])
  })

  it('誰の点数も負にならない', () => {
    const scores = [10, 20, 30, 40]
    for (const winner of [0, 1, 2, 3]) {
      const tsumo = settleTsumo(scores, winner, 1800)
      for (const score of tsumo.scores) {
        expect(score).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('点数保存則', () => {
  it('ツモでクランプが起きても総和が変わらない', () => {
    const patterns: number[][] = [
      [1000, 1000, 1000, 1000],
      [1000, 50, 1000, 1000],
      [10, 20, 30, 40],
      [0, 0, 0, 4000],
      [5, 5, 5, 5],
    ]

    for (const scores of patterns) {
      for (const winner of [0, 1, 2, 3]) {
        for (const amount of [0, 120, 480, 1800, 99999]) {
          const result = settleTsumo(scores, winner, amount)
          expect(total(result.scores), `${scores} / winner=${winner} / ${amount}`).toBe(
            total(scores),
          )
        }
      }
    }
  })

  it('ロンでクランプが起きても総和が変わらない', () => {
    const patterns: number[][] = [
      [1000, 1000, 1000, 1000],
      [1000, 50, 1000, 1000],
      [0, 0, 0, 4000],
    ]

    for (const scores of patterns) {
      for (const winner of [0, 1, 2, 3]) {
        for (const discarder of [0, 1, 2, 3]) {
          if (winner === discarder) {
            continue
          }
          for (const amount of [0, 300, 1800, 99999]) {
            const result = settleRon(scores, winner, discarder, amount)
            expect(
              total(result.scores),
              `${scores} / winner=${winner} / discarder=${discarder} / ${amount}`,
            ).toBe(total(scores))
          }
        }
      }
    }
  })

  it('和了者の増分は常に payments の合計と一致する', () => {
    const scores = [1000, 50, 1000, 1000]
    const tsumo = settleTsumo(scores, 0, 1800)
    expect(tsumo.scores[0] - scores[0]).toBe(paidTotal(tsumo))

    const ron = settleRon(scores, 0, 1, 1800)
    expect(ron.scores[0] - scores[0]).toBe(paidTotal(ron))
  })

  it('前提に反して負の残高が渡されても保存則は破れない', () => {
    // scores は 0 以上であることが呼び出し側の前提だが、collect が max(残高, 0) で
    // 防御しているため、万一負の値が来ても点数が増殖しないことを固定する。
    const scores = [1000, -200, 1000, 1000]

    const tsumo = settleTsumo(scores, 0, 300)
    expect(total(tsumo.scores)).toBe(total(scores))
    expect(tsumo.scores[1]).toBe(-200)
    expect(tsumo.payments.some((payment) => payment.from === 1)).toBe(false)

    const ron = settleRon(scores, 0, 1, 300)
    expect(total(ron.scores)).toBe(total(scores))
    expect(ron.payments).toEqual([])
  })
})

describe('toPaidEvents', () => {
  it('精算結果を Paid イベント列に変換する', () => {
    const result = settleRon(START, 0, 2, 840)

    expect(toPaidEvents(result)).toEqual([{ type: 'Paid', from: 2, to: 0, amount: 840 }])
  })

  it('ツモでは支払い人数分のイベントになる', () => {
    const result = settleTsumo(START, 0, 300)
    const events = toPaidEvents(result)

    expect(events).toHaveLength(3)
    for (const event of events) {
      expect(event.type).toBe('Paid')
    }
  })

  it('支払いがなければ空になる', () => {
    expect(toPaidEvents(settleTsumo(START, 0, 0))).toEqual([])
  })
})
