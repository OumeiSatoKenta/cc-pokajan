import { describe, expect, it } from 'vitest'

import { createRng, pickSome, randomInt, shuffle } from '../../src/engine/rng'

/** 指定シードから n 個の乱数を取り出す。 */
function take(seed: number, n: number): number[] {
  const rng = createRng(seed)
  return Array.from({ length: n }, () => rng.next())
}

describe('createRng', () => {
  it('同一シードなら完全に同一の乱数列を返す', () => {
    expect(take(12345, 50)).toEqual(take(12345, 50))
  })

  it('異なるシードでは異なる乱数列になる', () => {
    expect(take(1, 50)).not.toEqual(take(2, 50))
  })

  it('生成値が常に 0 以上 1 未満に収まる', () => {
    const rng = createRng(7)
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('state() が呼び出しごとに進み、その状態から続きを再現できる', () => {
    const rng = createRng(99)
    rng.next()
    rng.next()
    const midState = rng.state()
    const expected = [rng.next(), rng.next(), rng.next()]

    const resumed = createRng(midState)
    expect([resumed.next(), resumed.next(), resumed.next()]).toEqual(expected)
  })

  it('シードが 0 でも動作する', () => {
    const values = take(0, 10)
    expect(values).toHaveLength(10)
    expect(new Set(values).size).toBeGreaterThan(1)
  })
})

describe('randomInt', () => {
  it('0 以上 maxExclusive 未満の整数を返す', () => {
    const rng = createRng(42)
    for (let i = 0; i < 1000; i++) {
      const value = randomInt(rng, 6)
      expect(Number.isInteger(value)).toBe(true)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(6)
    }
  })

  it('maxExclusive が 1 なら常に 0 を返す', () => {
    const rng = createRng(3)
    expect([randomInt(rng, 1), randomInt(rng, 1)]).toEqual([0, 0])
  })

  it('maxExclusive が 0 以下なら RangeError を投げる', () => {
    const rng = createRng(1)
    expect(() => randomInt(rng, 0)).toThrow(RangeError)
    expect(() => randomInt(rng, -1)).toThrow(RangeError)
  })

  it('maxExclusive が整数でないなら RangeError を投げる', () => {
    // 非整数を許すと最上位バケットだけ出現確率が下がるサイレントな偏りになる。
    const rng = createRng(1)
    expect(() => randomInt(rng, 4.5)).toThrow(RangeError)
    expect(() => randomInt(rng, Number.NaN)).toThrow(RangeError)
    expect(() => randomInt(rng, Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('shuffle', () => {
  const source = Array.from({ length: 20 }, (_, i) => i)

  it('入力配列を破壊しない', () => {
    const input = [...source]
    shuffle(input, createRng(1))
    expect(input).toEqual(source)
  })

  it('要素の多重集合が保存される', () => {
    const result = shuffle(source, createRng(1))
    expect([...result].sort((a, b) => a - b)).toEqual(source)
  })

  it('同一シードなら同一の並びを返す', () => {
    expect(shuffle(source, createRng(77))).toEqual(shuffle(source, createRng(77)))
  })

  it('異なるシードでは並びが変わる', () => {
    expect(shuffle(source, createRng(1))).not.toEqual(shuffle(source, createRng(2)))
  })

  it('空配列と単一要素を扱える', () => {
    expect(shuffle([], createRng(1))).toEqual([])
    expect(shuffle(['a'], createRng(1))).toEqual(['a'])
  })

  it('重複要素を含む配列でも多重集合が保存される', () => {
    const withDuplicates = ['a', 'a', 'b', 'b', 'b', 'c']
    const result = shuffle(withDuplicates, createRng(5))
    expect([...result].sort()).toEqual([...withDuplicates].sort())
  })
})

describe('pickSome', () => {
  const source = Array.from({ length: 10 }, (_, i) => i)

  it('指定件数を重複なく返す', () => {
    const picked = pickSome(source, 4, createRng(11))
    expect(picked).toHaveLength(4)
    expect(new Set(picked).size).toBe(4)
  })

  it('選ばれた要素はすべて入力に含まれる', () => {
    const picked = pickSome(source, 6, createRng(23))
    for (const value of picked) {
      expect(source).toContain(value)
    }
  })

  it('入力配列を破壊しない', () => {
    const input = [...source]
    pickSome(input, 5, createRng(1))
    expect(input).toEqual(source)
  })

  it('同一シードなら同一の結果を返す', () => {
    expect(pickSome(source, 5, createRng(31))).toEqual(pickSome(source, 5, createRng(31)))
  })

  it('count が 0 なら空配列を返す', () => {
    expect(pickSome(source, 0, createRng(1))).toEqual([])
  })

  it('count が全件なら全要素を過不足なく返す', () => {
    const picked = pickSome(source, source.length, createRng(1))
    expect([...picked].sort((a, b) => a - b)).toEqual(source)
  })

  it('count が範囲外なら RangeError を投げる', () => {
    expect(() => pickSome(source, -1, createRng(1))).toThrow(RangeError)
    expect(() => pickSome(source, source.length + 1, createRng(1))).toThrow(RangeError)
  })
})
