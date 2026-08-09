import { describe, expect, it } from 'vitest'

import { IMAGE_SIZE, fitWithin } from '../../src/ui/imageResize'

/**
 * 縮小のうち**判断を含むのは寸法の計算だけ**なので、ここを固定する。
 * canvas を触る部分には分岐が無く、E2E で担保する。
 */
describe('fitWithin', () => {
  it('正方形は長辺の上限に合わせる', () => {
    expect(fitWithin(500, 500, 256)).toEqual({ width: 256, height: 256 })
  })

  /** 元画像が上限より小さければ拡大しない（粗くなるだけで情報は増えない）。 */
  it('上限より小さい画像は拡大しない', () => {
    expect(fitWithin(100, 80, 256)).toEqual({ width: 100, height: 80 })
    expect(fitWithin(256, 256, 256)).toEqual({ width: 256, height: 256 })
  })

  it('横長は幅を上限に合わせる', () => {
    expect(fitWithin(1000, 500, 256)).toEqual({ width: 256, height: 128 })
  })

  it('縦長は高さを上限に合わせる', () => {
    expect(fitWithin(500, 1000, 256)).toEqual({ width: 128, height: 256 })
  })

  /**
   * **切り取らない**のがこの関数の要件。
   * 正方形へ収めるために中央を切り出すと、集合写真の端の人が消える。
   */
  it('縦横比を保つ', () => {
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [800, 600],
      [333, 777],
    ]) {
      const fitted = fitWithin(w, h, 256)
      const before = w / h
      const after = fitted.width / fitted.height

      // 整数へ丸める分の誤差だけを許す
      expect(Math.abs(before - after), `${w}x${h}`).toBeLessThan(0.02)
    }
  })

  it('長辺が必ず上限以下になる', () => {
    for (const [w, h] of [
      [4000, 3000],
      [3000, 4000],
      [10_000, 1],
      [1, 10_000],
    ]) {
      const fitted = fitWithin(w, h, 256)

      expect(Math.max(fitted.width, fitted.height), `${w}x${h}`).toBeLessThanOrEqual(256)
    }
  })

  /** 極端に細長い画像でも描画できる寸法を返す（0px の canvas は作れない）。 */
  it('1px 未満に潰さない', () => {
    const fitted = fitWithin(10_000, 1, 256)

    expect(fitted.width).toBe(256)
    expect(fitted.height).toBeGreaterThanOrEqual(1)
  })

  it('整数の寸法を返す', () => {
    const fitted = fitWithin(333, 777, 256)

    expect(Number.isInteger(fitted.width)).toBe(true)
    expect(Number.isInteger(fitted.height)).toBe(true)
  })

  it('寸法が0以下でも落ちない', () => {
    expect(() => fitWithin(0, 0, 256)).not.toThrow()
    expect(fitWithin(0, 100, 256).width).toBeGreaterThan(0)
    expect(fitWithin(-5, -5, 256).height).toBeGreaterThan(0)
  })

  it('既定の上限を使える', () => {
    expect(fitWithin(1000, 1000)).toEqual({ width: IMAGE_SIZE, height: IMAGE_SIZE })
  })
})
