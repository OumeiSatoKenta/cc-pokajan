import { describe, expect, it } from 'vitest'

import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import { DEFAULT_AI_CONFIG } from '../../src/engine/ai'
import {
  claimableFor,
  declarableFor,
  nextCpuAction,
  pendingCpuClaimIds,
} from '../../src/engine/autoAction'
import { playGameToEnd } from '../../src/engine/autoplay'
import { createGame, reduce } from '../../src/engine/game'
import type { Action } from '../../src/engine/types'
import { createCardSource, gameState, testRules } from '../helpers/game'

/**
 * engine へ抽出した CPU/自動判断（nextCpuAction）と候補列挙（claimableFor/declarableFor/pendingCpuClaimIds）の検査。
 *
 * 全 CPU（humanSeats=[]）では、独立参照実装である autoplay.ts の nextAction が選ぶアクション列と
 * 完全一致することを差分オラクルで固定する（別実装どうしの突き合わせ）。人間経路・複数人間も検査する。
 * これらは Step 5 の backend が engine から直接 import するため、UI 経由でなく engine 側で直接テストする。
 */

const SEEDS = Array.from({ length: 20 }, (_, index) => index)

describe('nextCpuAction — 全 CPU 差分オラクル', () => {
  it('humanSeats=[] は autoplay(nextAction) とアクション列が完全一致する（seed 0..19）', () => {
    for (const seed of SEEDS) {
      // 参照: autoplay が選んだアクション列を onStep で捕捉する。
      const reference: Action[] = []
      playGameToEnd({
        roster: DEFAULT_ROSTER,
        rules: DEFAULT_RULES,
        seed,
        onStep: (_state, action) => {
          reference.push(action)
        },
      })

      // 被験: nextCpuAction([]) で同一 seed を最初から駆動する。
      let state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, seed, { humanSeats: [] })
      const subject: Action[] = []
      while (state.phase !== 'gameOver') {
        const action = nextCpuAction(state, DEFAULT_RULES, DEFAULT_AI_CONFIG, [])
        if (action === null) {
          throw new Error(`seed ${seed}: 全 CPU なのに null（phase ${state.phase}）`)
        }
        subject.push(action)
        state = reduce(state, action, DEFAULT_RULES).state
      }

      expect(subject).toEqual(reference)
    }
  })
})

describe('nextCpuAction — 人間経路 [0]', () => {
  const rules = testRules({ handSize: 1 })
  const make = createCardSource()
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  it('draw は人間の席でも DRAW', () => {
    const state = gameState({ phase: 'draw', turn: 0, hands, wall: make('c1:pink') })
    expect(nextCpuAction(state, rules, DEFAULT_AI_CONFIG, [0])).toEqual({ type: 'DRAW' })
  })

  it('自席の discard は null（入力待ち）', () => {
    const state = gameState({ phase: 'discard', turn: 0, hands })
    expect(nextCpuAction(state, rules, DEFAULT_AI_CONFIG, [0])).toBeNull()
  })

  it('CPU の手番の discard は AI が選ぶ', () => {
    const state = gameState({ phase: 'discard', turn: 1, hands })
    expect(nextCpuAction(state, rules, DEFAULT_AI_CONFIG, [0])).toMatchObject({ type: 'DISCARD' })
  })

  it('役なしの自席 selfDeclare は自動 SKIP_DECLARE', () => {
    const source = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      declarer: 0,
      hands: [source('a1:pink a2:blue'), source('b1:pink'), source('b2:pink'), source('b3:pink')],
    })
    expect(nextCpuAction(state, testRules({ handSize: 2 }), DEFAULT_AI_CONFIG, [0])).toEqual({
      type: 'SKIP_DECLARE',
    })
  })

  it('役ありの自席 selfDeclare は null（入力待ち）', () => {
    const source = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      declarer: 0,
      hands: [
        source('a1:pink a1:blue a1:orange'),
        source('b1:pink'),
        source('b2:pink'),
        source('b3:pink'),
      ],
    })
    expect(nextCpuAction(state, testRules({ handSize: 3 }), DEFAULT_AI_CONFIG, [0])).toBeNull()
  })
})

describe('nextCpuAction — 複数人間 [0, 1]', () => {
  const rules = testRules({ handSize: 2 })

  function claimWindow(claims: Record<number, null | 'pass'>, humanHand: string) {
    const make = createCardSource()
    const discarded = make('a1:pink')[0]
    return gameState({
      phase: 'claimWindow',
      turn: 3,
      hands: [
        make(humanHand),
        make('z1:pink z2:pink'),
        make('z3:pink z4:pink'),
        make('z5:pink z6:pink'),
      ],
      wall: make('z7:pink z8:blue'),
      discards: [[], [], [], [discarded]],
      lastDiscard: discarded,
      lastDiscardBy: 3,
      claims,
    })
  }

  it('0,1 が未表明でも CPU(2) を先に処理する', () => {
    // 2 の手札は z3/z4 で役なし → PASS(2)。humanSeats=[0,1] なので CPU の対象は 2 のみ。
    expect(
      nextCpuAction(
        claimWindow({ 0: null, 1: null, 2: null }, 'z8:pink z9:pink'),
        rules,
        DEFAULT_AI_CONFIG,
        [0, 1],
      ),
    ).toEqual({ type: 'PASS', playerId: 2 })
  })

  it('CPU 表明済みなら先頭の未表明 human を処理（役なしは自動 PASS）', () => {
    // CPU(2)='pass'。未表明 human は [0,1]、先頭 0 は役なしなので PASS(0)。
    expect(
      nextCpuAction(
        claimWindow({ 0: null, 1: null, 2: 'pass' }, 'z8:pink z9:pink'),
        rules,
        DEFAULT_AI_CONFIG,
        [0, 1],
      ),
    ).toEqual({ type: 'PASS', playerId: 0 })
  })

  it('CPU 表明済みで先頭 human に役があれば null（入力待ち・[高] 明示検証）', () => {
    // human 0 は a1:blue a1:orange ＋ 捨て札 a1:pink で a1 の triple をロンできる → 入力待ち。
    expect(
      nextCpuAction(
        claimWindow({ 0: null, 1: null, 2: 'pass' }, 'a1:blue a1:orange'),
        rules,
        DEFAULT_AI_CONFIG,
        [0, 1],
      ),
    ).toBeNull()
  })
})

describe('claimableFor / declarableFor（engine 直接）', () => {
  const rules = testRules({ handSize: 2 })

  it('宣言権を持つ席には役を返し、持たない席には空を返す', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      declarer: 0,
      hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
    })

    expect(declarableFor(state, testRules({ handSize: 3 }), 0).length).toBeGreaterThan(0)
    expect(declarableFor(state, testRules({ handSize: 3 }), 1)).toEqual([])
  })

  it('割り込める役がある席には返し、受付でないフェーズでは空を返す', () => {
    const make = createCardSource()
    const discarded = make('a1:pink')[0]
    const claimState = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands: [
        make('a1:blue a1:orange'),
        make('z1:pink z2:pink'),
        make('z3:pink z4:pink'),
        make('z5:pink z6:pink'),
      ],
      wall: make('z7:pink z8:blue'),
      discards: [[], [], [], [discarded]],
      lastDiscard: discarded,
      lastDiscardBy: 3,
      claims: { 0: null, 1: null, 2: null },
    })
    expect(claimableFor(claimState, rules, 0).length).toBeGreaterThan(0)

    const discardState = gameState({
      phase: 'discard',
      turn: 0,
      hands: [make('a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
    })
    expect(claimableFor(discardState, rules, 0)).toEqual([])
  })
})

describe('pendingCpuClaimIds — humanSeats の一般化', () => {
  const make = createCardSource()
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  it('humanSeats=[0]: 人間を除いた未表明 CPU を id 昇順で返す', () => {
    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands,
      claims: { 0: null, 1: null, 2: 'pass' },
    })
    expect(pendingCpuClaimIds(state, [0])).toEqual([1])
  })

  it('humanSeats=[0,1]: 0,1 を human として除外する', () => {
    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands,
      claims: { 0: null, 1: null, 2: null },
    })
    expect(pendingCpuClaimIds(state, [0, 1])).toEqual([2])
  })

  it('引数の humanSeats 配列を破壊的に並べ替えない', () => {
    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands,
      claims: { 0: null, 1: null, 2: null },
    })
    const humanSeats = [1, 0]
    pendingCpuClaimIds(state, humanSeats)
    expect(humanSeats).toEqual([1, 0])
  })
})
