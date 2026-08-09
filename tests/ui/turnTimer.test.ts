import { describe, expect, it } from 'vitest'

import { autoDiscardUid, decideTimeout, nextTimeLimitMs } from '../../src/ui/hooks/turnTimer'
import { createCardSource, gameState, testRules } from '../helpers/game'
import { hand } from '../helpers/cards'

const HUMAN = 0

describe('nextTimeLimitMs', () => {
  const rules = testRules()

  it('使い切るたびに減少幅の分だけ減る', () => {
    expect(nextTimeLimitMs(20_000, rules)).toBe(15_000)
    expect(nextTimeLimitMs(15_000, rules)).toBe(10_000)
  })

  it('下限で飽和し、それ以上は減らない', () => {
    expect(nextTimeLimitMs(10_000, rules)).toBe(5_000)
    expect(nextTimeLimitMs(5_000, rules)).toBe(5_000)
    expect(nextTimeLimitMs(5_000, rules)).toBe(5_000)
  })

  it('下限より短い値を渡しても下限に戻す（負値にならない）', () => {
    expect(nextTimeLimitMs(1_000, rules)).toBe(5_000)
  })

  it('20 → 15 → 10 → 5 → 5 の順に落ちる', () => {
    const steps: number[] = []
    let current = rules.turnTimer.initialMs

    for (let i = 0; i < 5; i++) {
      steps.push(current)
      current = nextTimeLimitMs(current, rules)
    }

    expect(steps).toEqual([20_000, 15_000, 10_000, 5_000, 5_000])
  })
})

describe('autoDiscardUid', () => {
  it('引いたカードが手札にあればそれを捨てる', () => {
    const cards = hand('a1:pink a2:pink a3:pink')

    expect(autoDiscardUid(cards, 1)).toBe(1)
  })

  /**
   * 連続宣言で引いたカードが役に消費されると「引いたカード」が存在しなくなる。
   * このとき末尾（＝直近の補充分）に倒す。
   */
  it('引いたカードが手札にない場合は末尾を捨てる', () => {
    const cards = hand('a1:pink a2:pink a3:pink')

    expect(autoDiscardUid(cards, 99)).toBe(2)
  })

  it('引いたカードが未記録なら末尾を捨てる', () => {
    const cards = hand('a1:pink a2:pink')

    expect(autoDiscardUid(cards, null)).toBe(1)
  })

  it('手札が空なら null', () => {
    expect(autoDiscardUid([], null)).toBeNull()
    expect(autoDiscardUid([], 3)).toBeNull()
  })

  /**
   * 末尾に倒す実装だと、引いたカードが手札の途中にあるケースを取りこぼす。
   * 連続宣言後は実際にこの形になる（末尾は補充カード）。
   */
  it('引いたカードが手札の途中にあっても正しく選ぶ', () => {
    // uid 1 が引いたカード。uid 2,3 は宣言後の補充分
    const cards = hand('a1:pink a2:pink r1:pink r2:pink')

    expect(autoDiscardUid(cards, 1)).toBe(1)
  })
})

describe('decideTimeout', () => {
  const make = createCardSource()
  const rules = testRules({ handSize: 1 })
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  it('引くフェーズは自動で進むので計時しない', () => {
    const state = gameState({ phase: 'draw', turn: HUMAN, hands })

    expect(decideTimeout(state, HUMAN, null, rules)).toBeNull()
  })

  it('終局後は計時しない', () => {
    const state = gameState({ phase: 'gameOver', hands })

    expect(decideTimeout(state, HUMAN, null, rules)).toBeNull()
  })

  it('他家の捨てるフェーズは計時しない', () => {
    const state = gameState({ phase: 'discard', turn: 1, hands })

    expect(decideTimeout(state, HUMAN, null, rules)).toBeNull()
  })

  it('自分の捨てるフェーズは引いたカードのツモ切りを予約する', () => {
    const state = gameState({ phase: 'discard', turn: HUMAN, hands })
    const uid = hands[HUMAN][0].uid

    const timeout = decideTimeout(state, HUMAN, uid, rules)

    expect(timeout?.kind).toBe('discard')
    expect(timeout?.action).toEqual({ type: 'DISCARD', uid })
  })

  it('宣言フェーズでは自分が宣言権者のときだけ計時する', () => {
    const mine = gameState({ phase: 'selfDeclare', turn: HUMAN, declarer: HUMAN, hands })
    const theirs = gameState({ phase: 'selfDeclare', turn: HUMAN, declarer: 1, hands })

    expect(decideTimeout(mine, HUMAN, null, rules)?.action).toEqual({ type: 'SKIP_DECLARE' })
    expect(decideTimeout(theirs, HUMAN, null, rules)).toBeNull()
  })

  /**
   * エンジンの claimTimerMs は上限で初期化されている。摩耗した持ち時間
   * （最短5秒）を渡すとカウンタが0にならず、自動パスが発火せずに対局が固まる。
   */
  it('割り込みの時間切れは経過時間ではなく上限値を送る', () => {
    const make2 = createCardSource()
    const discarded = make2('a1:pink')[0]
    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands: [make2('a1:blue'), make2('b1:pink'), make2('b2:pink'), make2('b3:pink')],
      discards: [[], [], [], [discarded]],
      lastDiscard: discarded,
      lastDiscardBy: 3,
      claims: { 0: null, 1: null, 2: null },
    })

    const timeout = decideTimeout(state, HUMAN, null, rules)

    expect(timeout?.kind).toBe('claim')
    expect(timeout?.action).toEqual({ type: 'TICK', deltaMs: rules.turnTimer.initialMs })
  })

  it('割り込みに表明済みなら計時しない', () => {
    const make2 = createCardSource()
    const discarded = make2('a1:pink')[0]
    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands: [make2('a1:blue'), make2('b1:pink'), make2('b2:pink'), make2('b3:pink')],
      discards: [[], [], [], [discarded]],
      lastDiscard: discarded,
      lastDiscardBy: 3,
      claims: { 0: 'pass', 1: null, 2: null },
    })

    expect(decideTimeout(state, HUMAN, null, rules)).toBeNull()
  })

  /** 捨てた本人は claims にキーが無い（undefined）。未表明の null と混同しない。 */
  it('自分が捨てた側なら計時しない', () => {
    const make2 = createCardSource()
    const discarded = make2('a1:pink')[0]
    const state = gameState({
      phase: 'claimWindow',
      turn: HUMAN,
      hands: [make2('a1:blue'), make2('b1:pink'), make2('b2:pink'), make2('b3:pink')],
      discards: [[discarded], [], [], []],
      lastDiscard: discarded,
      lastDiscardBy: HUMAN,
      claims: { 1: null, 2: null, 3: null },
    })

    expect(decideTimeout(state, HUMAN, null, rules)).toBeNull()
  })

  it('手札が空なら捨てるものがないので計時しない', () => {
    const state = gameState({ phase: 'discard', turn: HUMAN, hands: [[], [], [], []] })

    expect(decideTimeout(state, HUMAN, null, rules)).toBeNull()
  })
})

describe('decideTimeout — キーの安定性', () => {
  /**
   * **この性質が持ち時間の要**。人間が割り込みを考えている間、CPU は次々と
   * 意思表示して game を書き換える。キーがそれに反応すると useEffect のタイマーが
   * 毎回張り直され、人間の持ち時間が永久に尽きなくなる。
   */
  it('CPU が意思表示してもキーが変わらない', () => {
    const rules = testRules({ handSize: 1 })
    function windowWith(claims: Record<number, null | 'pass'>) {
      const make = createCardSource()
      const discarded = make('a1:pink')[0]
      return gameState({
        phase: 'claimWindow',
        turn: 3,
        hands: [make('a1:blue'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
        discards: [[], [], [], [discarded]],
        lastDiscard: discarded,
        lastDiscardBy: 3,
        claims,
      })
    }

    const before = decideTimeout(windowWith({ 0: null, 1: null, 2: null }), HUMAN, null, rules)
    const after = decideTimeout(windowWith({ 0: null, 1: 'pass', 2: 'pass' }), HUMAN, null, rules)

    expect(before?.key).toBe(after?.key)
  })

  /**
   * 逆に、連続宣言では判断の機会だけが新しくなる。
   * キーが変わらないと2回目以降の宣言に時間が与えられない。
   */
  it('連続宣言が進むとキーが変わる', () => {
    const rules = testRules({ handSize: 1 })
    const make = createCardSource()
    const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

    const first = decideTimeout(
      gameState({ phase: 'selfDeclare', turn: HUMAN, declarer: HUMAN, hands, chainCount: 0 }),
      HUMAN,
      null,
      rules,
    )
    const second = decideTimeout(
      gameState({ phase: 'selfDeclare', turn: HUMAN, declarer: HUMAN, hands, chainCount: 1 }),
      HUMAN,
      null,
      rules,
    )

    expect(first?.key).not.toBe(second?.key)
  })

  it('捨て札が変われば割り込みのキーも変わる', () => {
    const rules = testRules({ handSize: 1 })
    function windowFor(uidBase: string) {
      const make = createCardSource()
      const discarded = make(uidBase)[0]
      return gameState({
        phase: 'claimWindow',
        turn: 3,
        hands: [make('a1:blue'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
        discards: [[], [], [], [discarded]],
        lastDiscard: discarded,
        lastDiscardBy: 3,
        claims: { 0: null, 1: null, 2: null },
      })
    }

    // 別々の生成器なので uid が同じになる。lastDiscard の uid が同じなら
    // 「同じ捨て札を待っている」ことを意味するのでキーも同じでよい。
    expect(decideTimeout(windowFor('a1:pink'), HUMAN, null, rules)?.key).toBe(
      decideTimeout(windowFor('a2:blue'), HUMAN, null, rules)?.key,
    )
  })
})
