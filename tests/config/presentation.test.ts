import { describe, expect, it } from 'vitest'

import { NO_WIN_TIMING, WIN_TIMING, isBigWin } from '../../src/config/presentation'
import { DEFAULT_RULES } from '../../src/config/rules'
import { findYaku } from '../../src/engine/yaku'
import { context, hand } from '../helpers/cards'
import type { YakuCandidate } from '../../src/engine/types'

/**
 * 大物手の判定と演出の長さ。
 *
 * **候補を手で組み立てず `findYaku` から取る。** `sameColor` を直接書いた
 * オブジェクトで検査すると「同色役なら true を返す」ことしか確かめられず、
 * 実際の役判定が付ける `sameColor` と食い違っていても気づけない。
 */
function best(spec: string, predicate: (candidate: YakuCandidate) => boolean): YakuCandidate {
  const found = findYaku(hand(spec), context()).find(predicate)
  if (found === undefined) {
    throw new Error(`条件に合う役が "${spec}" から見つかりませんでした`)
  }
  return found
}

describe('isBigWin', () => {
  it('同色役は大物手として扱う', () => {
    const sameColor = best('a1:pink a1:pink a1:pink', (candidate) => candidate.sameColor)

    expect(sameColor.score).toBe(DEFAULT_RULES.scores.triple.sameColor)
    expect(isBigWin(sameColor)).toBe(true)
  })

  it('混色の役は通常演出のまま', () => {
    const mixed = best('a1:pink a1:blue a1:orange', (candidate) => !candidate.sameColor)

    expect(isBigWin(mixed)).toBe(false)
  })

  /**
   * **点数の大小と演出の大小は一致しない。**
   * 5人組（480点）は3カード同色（840点）より安いが、混色なので通常演出になる。
   * これは承知のうえの帰結なので、変わったら気づけるように固定しておく。
   */
  it('5人組（480点）は混色なら通常演出', () => {
    const quintet = best(
      'c1:pink c2:blue c3:orange c4:pink c5:blue',
      (candidate) => candidate.kind === 'group5',
    )

    expect(quintet.score).toBe(DEFAULT_RULES.scores.group5.base)
    expect(quintet.score).toBeGreaterThan(DEFAULT_RULES.scores.group3.base)
    expect(isBigWin(quintet)).toBe(false)
  })
})

describe('WinTiming', () => {
  it('既定の長さは正の値', () => {
    expect(WIN_TIMING.cutInMs).toBeGreaterThan(0)
    expect(WIN_TIMING.resultMs).toBeGreaterThan(0)
  })

  /** E2E 用。演出の待ちを消しても対局のルール値には影響しない。 */
  it('高速モードでは待ち時間が消える', () => {
    expect(NO_WIN_TIMING).toEqual({ cutInMs: 0, resultMs: 0 })
  })
})
