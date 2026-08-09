import { describe, expect, it } from 'vitest'

import { computeRanking, reduce } from '../../src/engine/game'
import { DEFAULT_RULES } from '../../src/config/rules'
import { createCardSource, gameState } from '../helpers/game'

/**
 * 順位算出の検証。
 *
 * **この関数はエンジンと演出の両方が使う。** 対局中の順位にはエンジン側の
 * 対応物がないため、演出側で並べ替えを書くと精算額と食い違う余地が生まれる。
 * ここで確かめるのは「終局時に確定する順位と同じものが出る」こと。
 */

function players(scores: readonly number[]): { id: number; score: number }[] {
  return scores.map((score, id) => ({ id, score }))
}

describe('computeRanking', () => {
  it('点数の降順に並ぶ', () => {
    expect(computeRanking(players([100, 400, 200, 300]))).toEqual([1, 3, 2, 0])
  })

  /** 決定性のため。同点をどう並べるかが揺れると、精算額が実行ごとに変わる。 */
  it('同点はプレイヤー ID の昇順になる', () => {
    expect(computeRanking(players([500, 500, 500, 500]))).toEqual([0, 1, 2, 3])
    expect(computeRanking(players([100, 500, 100, 500]))).toEqual([1, 3, 0, 2])
  })

  it('マイナスの点数も扱える（破産で0を下回る場合）', () => {
    expect(computeRanking(players([-100, 0, 50, -200]))).toEqual([2, 1, 0, 3])
  })

  it('人数が4人でなくても並ぶ', () => {
    expect(computeRanking(players([10, 30, 20]))).toEqual([1, 2, 0])
    expect(computeRanking(players([]))).toEqual([])
  })

  /** 入力を破壊すると、呼び出し元の `players` の並びが変わって対局が壊れる。 */
  it('入力の配列を破壊しない', () => {
    const input = players([100, 400, 200, 300])
    const snapshot = structuredClone(input)

    computeRanking(input)

    expect(input).toEqual(snapshot)
  })
})

/**
 * **抽出で振る舞いが変わっていないことの検査。**
 *
 * `finishGame` のソートを切り出したので、終局時に発行される `GameOver.ranking` が
 * `computeRanking` の結果と一致していなければならない。ここが崩れると、
 * 演出に出る順位と精算に使われる順位が違うことになる。
 */
describe('終局時の順位との一致', () => {
  it('GameOver.ranking が computeRanking と一致する', () => {
    const make = createCardSource()
    // 山切れで終局させる。点数はバラバラにしておく。
    const state = gameState({
      phase: 'draw',
      turn: 0,
      hands: [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')],
      wall: [],
      scores: [1200, 800, 1500, 800],
    })

    const result = reduce(state, { type: 'DRAW' }, DEFAULT_RULES)
    const gameOver = result.events.find((event) => event.type === 'GameOver')

    expect(gameOver).toBeDefined()
    expect(gameOver?.ranking).toEqual(computeRanking(result.state.players))
    // 同点（800）が ID 昇順で並んでいることまで確かめる
    expect(gameOver?.ranking).toEqual([2, 0, 1, 3])
  })
})
