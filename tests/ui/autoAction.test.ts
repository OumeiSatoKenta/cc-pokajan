import { describe, expect, it } from 'vitest'

import {
  DELAYS,
  NO_DELAYS,
  autoActionKey,
  claimableFor,
  countPendingCpuClaims,
  declarableFor,
  decideAutoAction,
} from '../../src/ui/hooks/autoAction'
import { DEFAULT_AI_CONFIG } from '../../src/engine/ai'
import { createCardSource, gameState, testRules } from '../helpers/game'
import type { Action, YakuCandidate } from '../../src/engine/types'
import { card } from '../helpers/cards'

const HUMAN = 0

describe('decideAutoAction', () => {
  const make = createCardSource()
  const rules = testRules({ handSize: 1 })
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  it('draw は人間の手番でも自動で引く', () => {
    const state = gameState({ phase: 'draw', turn: HUMAN, hands, wall: make('c1:pink') })

    const step = decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)

    expect(step?.action).toEqual({ type: 'DRAW' })
    expect(step?.delayMs).toBe(DELAYS.draw)
  })

  it('gameOver では何もしない', () => {
    const state = gameState({ phase: 'gameOver', hands })

    expect(decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)).toBeNull()
  })

  it('自分の手番の捨てるフェーズは入力待ちになる', () => {
    const state = gameState({ phase: 'discard', turn: HUMAN, hands })

    expect(decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)).toBeNull()
  })

  it('CPU の手番の捨てるフェーズは AI が選ぶ', () => {
    const state = gameState({ phase: 'discard', turn: 1, hands })

    const step = decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)

    expect(step?.action).toMatchObject({ type: 'DISCARD' })
    expect(step?.delayMs).toBe(DELAYS.discard)
  })

  it('自分に役がなければ宣言フェーズを自動で通過する', () => {
    const make2 = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: HUMAN,
      declarer: HUMAN,
      hands: [make2('a1:pink a2:blue'), make2('b1:pink'), make2('b2:pink'), make2('b3:pink')],
    })

    expect(decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)?.action).toEqual({
      type: 'SKIP_DECLARE',
    })
  })

  it('自分に役があれば入力待ちになる', () => {
    const make2 = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: HUMAN,
      declarer: HUMAN,
      hands: [
        make2('a1:pink a1:blue a1:orange'),
        make2('b1:pink'),
        make2('b2:pink'),
        make2('b3:pink'),
      ],
    })

    expect(decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)).toBeNull()
  })

  /**
   * ロンの連続宣言中は declarer と turn が食い違う。
   * turn を見て判断すると誤ったプレイヤーを操作してしまう。
   */
  it('宣言フェーズでは turn ではなく declarer を対象にする', () => {
    const make2 = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: HUMAN,
      declarer: 1,
      hands: [
        make2('a1:pink a1:blue a1:orange'),
        make2('a2:pink a2:blue a2:orange'),
        make2('b2:pink'),
        make2('b3:pink'),
      ],
    })

    const step = decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)

    // declarer は CPU の1番なので、人間に役があっても入力待ちにはならない
    expect(step?.action).toMatchObject({ type: 'DECLARE', playerId: 1 })
  })
})

describe('decideAutoAction — 割り込み受付', () => {
  function claimWindow(options: { humanHand: string; claims: Record<number, null | 'pass'> }) {
    const make = createCardSource()
    const discarded = make('a1:pink')[0]

    return gameState({
      phase: 'claimWindow',
      turn: 3,
      hands: [make(options.humanHand), make('a2:blue a2:orange'), make('z1:pink'), make('z2:pink')],
      wall: make('z3:pink z4:pink z5:pink z6:pink'),
      discards: [[], [], [], [discarded]],
      lastDiscard: discarded,
      lastDiscardBy: 3,
      claims: options.claims,
    })
  }

  const rules = testRules({ handSize: 2 })

  /**
   * claims のキーは PlayerId（数値）で Object.entries は昇順に返すため、
   * 素朴に「最初の未表明者」を採ると人間（0番）が常に先に来てしまう。
   * それでは人間が決めるまで CPU の意思表示が発行されない。
   */
  it('人間を飛ばして CPU の意思表示を先に処理する', () => {
    const state = claimWindow({
      humanHand: 'a1:blue a1:orange',
      claims: { 0: null, 1: null, 2: null },
    })

    const step = decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)

    expect(step?.action).toMatchObject({ playerId: 1 })
    expect(step?.action.type === 'CLAIM' || step?.action.type === 'PASS').toBe(true)
  })

  it('CPU が全員表明済みで人間に役があれば入力待ちになる', () => {
    const state = claimWindow({
      humanHand: 'a1:blue a1:orange',
      claims: { 0: null, 1: 'pass', 2: 'pass' },
    })

    expect(decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)).toBeNull()
  })

  /** 宣言フェーズで役がないときに自動通過させるのと同じ理屈。 */
  it('人間に割り込める役がなければ受付時間を待たずに自動でパスする', () => {
    const state = claimWindow({
      humanHand: 'z8:pink z9:pink',
      claims: { 0: null, 1: 'pass', 2: 'pass' },
    })

    expect(decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)?.action).toEqual({
      type: 'PASS',
      playerId: HUMAN,
    })
  })

  it('人間が表明済みなら入力待ちにならない', () => {
    const state = claimWindow({
      humanHand: 'a1:blue a1:orange',
      claims: { 0: 'pass', 1: 'pass', 2: 'pass' },
    })

    expect(decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN)).toBeNull()
  })
})

describe('autoActionKey', () => {
  const make = createCardSource()
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  /**
   * 自動進行の useEffect はこのキーを依存に取る。
   * キーが無関係な状態変化で変わってしまうと、予約中のタイマーが破棄され、
   * CPU の割り込み判断が発火できなくなる。
   */
  it('受付の残り時間だけが変わってもキーは変わらない', () => {
    const base = gameState({ phase: 'draw', turn: 1, hands, claimTimerMs: 4000 })
    const ticked = { ...base, claimTimerMs: 1200 }
    const action: Action = { type: 'DRAW' }

    expect(autoActionKey(ticked, action)).toBe(autoActionKey(base, action))
  })

  it('対象プレイヤーが変わればキーが変わる', () => {
    const state = gameState({ phase: 'claimWindow', turn: 3, hands })

    expect(autoActionKey(state, { type: 'PASS', playerId: 1 })).not.toBe(
      autoActionKey(state, { type: 'PASS', playerId: 2 }),
    )
  })

  it('捨てるカードが変わればキーが変わる', () => {
    const state = gameState({ phase: 'discard', turn: 1, hands })

    expect(autoActionKey(state, { type: 'DISCARD', uid: 1 })).not.toBe(
      autoActionKey(state, { type: 'DISCARD', uid: 2 }),
    )
  })

  it('フェーズが変わればキーが変わる', () => {
    const draw = gameState({ phase: 'draw', turn: 1, hands })
    const discard = gameState({ phase: 'discard', turn: 1, hands })
    const action: Action = { type: 'DRAW' }

    expect(autoActionKey(draw, action)).not.toBe(autoActionKey(discard, action))
  })
})

describe('declarableFor / claimableFor', () => {
  const rules = testRules({ handSize: 2 })

  it('宣言権を持たないプレイヤーには空を返す', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 1,
      declarer: 1,
      hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
    })

    expect(declarableFor(state, rules, HUMAN)).toEqual([])
  })

  it('割り込み受付でないフェーズでは claimable が空になる', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'discard',
      turn: HUMAN,
      hands: [make('a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
    })

    expect(claimableFor(state, rules, HUMAN)).toEqual([])
  })
})

describe('遅延の設定', () => {
  it('高速モードではすべての遅延が 0 になる', () => {
    expect(Object.values(NO_DELAYS).every((value) => value === 0)).toBe(true)
  })

  it('高速モードでもアクションの決定は変わらない', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'discard',
      turn: 1,
      hands: [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')],
    })
    const rules = testRules({ handSize: 1 })

    const normal = decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN, DELAYS)
    const fast = decideAutoAction(state, rules, DEFAULT_AI_CONFIG, HUMAN, NO_DELAYS)

    expect(fast?.action).toEqual(normal?.action)
    expect(fast?.delayMs).toBe(0)
  })
})

describe('countPendingCpuClaims', () => {
  const make = createCardSource()
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  it('人間を除いた未表明の数を返す', () => {
    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands,
      claims: { 0: null, 1: null, 2: 'pass' },
    })

    expect(countPendingCpuClaims(state, HUMAN)).toBe(1)
  })

  it('CPU が全員表明済みなら0になる（人間が未表明でも）', () => {
    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands,
      claims: { 0: null, 1: 'pass', 2: 'pass' },
    })

    expect(countPendingCpuClaims(state, HUMAN)).toBe(0)
  })
})

describe('autoActionKey — 候補の同一性', () => {
  const make = createCardSource()
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  function candidate(overrides: Partial<YakuCandidate> = {}): YakuCandidate {
    return {
      kind: 'triple',
      sameColor: false,
      cards: [card('a1:pink', 1), card('a1:blue', 2), card('a1:orange', 3)],
      bonusCount: 0,
      score: 120,
      ...overrides,
    }
  }

  it('同じプレイヤーでも役の種類が変われば別のキーになる', () => {
    const state = gameState({ phase: 'selfDeclare', turn: 1, declarer: 1, hands })

    expect(autoActionKey(state, { type: 'DECLARE', playerId: 1, candidate: candidate() })).not.toBe(
      autoActionKey(state, {
        type: 'DECLARE',
        playerId: 1,
        candidate: candidate({ kind: 'group4' }),
      }),
    )
  })

  it('同色可否が変われば別のキーになる', () => {
    const state = gameState({ phase: 'selfDeclare', turn: 1, declarer: 1, hands })

    expect(autoActionKey(state, { type: 'DECLARE', playerId: 1, candidate: candidate() })).not.toBe(
      autoActionKey(state, {
        type: 'DECLARE',
        playerId: 1,
        candidate: candidate({ sameColor: true }),
      }),
    )
  })

  it('消費するカードが変われば別のキーになる', () => {
    const state = gameState({ phase: 'claimWindow', turn: 3, hands })

    expect(autoActionKey(state, { type: 'CLAIM', playerId: 1, candidate: candidate() })).not.toBe(
      autoActionKey(state, {
        type: 'CLAIM',
        playerId: 1,
        candidate: candidate({
          cards: [card('a2:pink', 7), card('a2:blue', 8), card('a2:orange', 9)],
        }),
      }),
    )
  })

  it('カードの並び順が違っても同じキーになる（uid をソートしている）', () => {
    const state = gameState({ phase: 'selfDeclare', turn: 1, declarer: 1, hands })
    const forward = candidate()
    const reversed = candidate({ cards: [...forward.cards].reverse() })

    expect(autoActionKey(state, { type: 'DECLARE', playerId: 1, candidate: forward })).toBe(
      autoActionKey(state, { type: 'DECLARE', playerId: 1, candidate: reversed }),
    )
  })
})
