import { describe, expect, it } from 'vitest'
import {
  AI_PRESETS,
  DEFAULT_AI_CONFIG,
  chooseDiscard,
  decideClaim,
  decideDeclare,
  evaluateTargets,
  toAiView,
  type AiView,
} from '../../src/engine/ai'
import { yakuContextOf } from '../../src/engine/game'
import { DEFAULT_RULES } from '../../src/config/rules'
import { TEST_GROUPS } from '../helpers/cards'
import { createCardSource, gameState, testRules } from '../helpers/game'
import type { Card, GameState, MemberId } from '../../src/engine/types'

/** 手札だけを差し替えた `AiView` を作る。AI は公開情報しか見ないため、これで十分。 */
function view(options: {
  hand: readonly Card[]
  bonusMemberIds?: readonly MemberId[]
  discardsByPlayer?: readonly (readonly Card[])[]
  wallCount?: number
}): AiView {
  const state: GameState = gameState({
    hands: [options.hand, [], [], []],
    bonusMemberIds: options.bonusMemberIds,
  })

  return {
    selfId: 0,
    hand: options.hand,
    ctx: yakuContextOf(state, DEFAULT_RULES),
    discardsByPlayer: options.discardsByPlayer ?? [[], [], [], []],
    wallCount: options.wallCount ?? DEFAULT_RULES.deckSize,
    scores: [1000, 1000, 1000, 1000],
  }
}

describe('toAiView', () => {
  it('自分の手札・河・山札の残り枚数だけを渡し、隠し情報を含めない', () => {
    const make = createCardSource()
    const state = gameState({
      hands: [make('a1:pink'), make('a2:pink a2:blue'), make('a3:pink'), make('b1:pink')],
      wall: make('b2:pink b3:pink b4:pink'),
      discards: [[], make('c1:pink'), [], []],
    })

    const result = toAiView(state, 0, DEFAULT_RULES)

    expect(result.hand).toEqual(state.players[0].hand)
    expect(result.wallCount).toBe(3)
    expect(result.discardsByPlayer).toHaveLength(4)

    // 他家の手札に到達できるフィールドが1つも存在しないことを、
    // ビュー全体を走査して確認する（型でも防いでいるが、値としても確かめる）
    const opponentUids = state.players
      .slice(1)
      .flatMap((player) => player.hand.map((card) => card.uid))
    const serialized = JSON.stringify(result)

    for (const uid of opponentUids) {
      expect(serialized).not.toContain(`"uid":${uid}`)
    }
    // 山札の中身も漏れていない
    for (const card of state.wall) {
      expect(serialized).not.toContain(`"uid":${card.uid}`)
    }
  })
})

describe('evaluateTargets', () => {
  const make = createCardSource()

  it('成立済みの役は need 0 になる', () => {
    const targets = evaluateTargets(
      view({ hand: make('a1:pink a1:blue a1:orange') }),
      DEFAULT_AI_CONFIG,
    )
    const triple = targets.find((target) => target.targetId === 'a1' && target.color === null)

    expect(triple?.need).toBe(0)
    expect(triple?.score).toBe(120)
  })

  it('あと1枚の役は need 1 になる', () => {
    const make2 = createCardSource()
    const targets = evaluateTargets(view({ hand: make2('a1:pink a1:blue') }), DEFAULT_AI_CONFIG)
    const triple = targets.find((target) => target.targetId === 'a1' && target.color === null)

    expect(triple?.need).toBe(1)
  })

  it('グループ役はまだ揃っていないメンバー数が need になる', () => {
    const make2 = createCardSource()
    const targets = evaluateTargets(view({ hand: make2('b1:pink b2:blue') }), DEFAULT_AI_CONFIG)
    const group = targets.find(
      (target) => target.targetId === TEST_GROUPS.quartet.id && target.color === null,
    )

    expect(group?.need).toBe(2)
    expect(group?.score).toBe(300)
  })

  it('ボーナスメンバーを含む役は点数が高く評価される', () => {
    const make2 = createCardSource()
    const plain = evaluateTargets(view({ hand: make2('a1:pink a1:blue') }), DEFAULT_AI_CONFIG)
    const make3 = createCardSource()
    const bonus = evaluateTargets(
      view({ hand: make3('a1:pink a1:blue'), bonusMemberIds: ['a1'] }),
      DEFAULT_AI_CONFIG,
    )

    const find = (targets: ReturnType<typeof evaluateTargets>) =>
      targets.find((target) => target.targetId === 'a1' && target.color === null)

    expect(find(plain)?.score).toBe(120)
    // 3カードは3枚すべてがボーナスメンバーなので +90 × 3
    expect(find(bonus)?.score).toBe(120 + 270)
  })

  it('遠い役ほど価値が割り引かれる', () => {
    const make2 = createCardSource()
    const targets = evaluateTargets(view({ hand: make2('a1:pink a1:blue b1:pink') }), {
      patience: 2,
      safety: 0,
    })

    const near = targets.find((target) => target.targetId === 'a1' && target.color === null)
    const far = targets.find(
      (target) => target.targetId === TEST_GROUPS.quartet.id && target.color === null,
    )

    // 4人組（300点）はあと3枚、3カード（120点）はあと1枚。割引後は近い方が高い
    expect(near?.value).toBeGreaterThan(far?.value ?? Infinity)
  })
})

describe('chooseDiscard', () => {
  it('どの役にも寄与しないカードを捨てる', () => {
    const make = createCardSource()
    const hand = make('a1:pink a1:blue a1:orange b1:pink z9:pink')
    const useless = hand[4]

    // z9 はどのグループにも属さず、同じメンバーが他にないので3カードにもならない
    expect(chooseDiscard(view({ hand })).uid).toBe(useless.uid)
  })

  it('成立済みの役を構成するカードは捨てない', () => {
    const make = createCardSource()
    const hand = make('a1:pink a1:blue a1:orange z8:pink z9:pink')
    const tripleUids = new Set(hand.slice(0, 3).map((card) => card.uid))

    expect(tripleUids.has(chooseDiscard(view({ hand })).uid)).toBe(false)
  })

  it('同じ入力に対して常に同じカードを返す（乱数を使っていない）', () => {
    const make = createCardSource()
    const hand = make('a1:pink a2:blue b1:orange b2:pink c1:pink')
    const target = view({ hand })

    const choices = Array.from({ length: 10 }, () => chooseDiscard(target).uid)

    expect(new Set(choices).size).toBe(1)
  })

  it('手札が空なら例外を投げる', () => {
    expect(() => chooseDiscard(view({ hand: [] }))).toThrow(RangeError)
  })

  it('safety が有効な終盤では、河に出ていないメンバーのカードを避ける', () => {
    const make = createCardSource()
    // どちらもどの役にも寄与しない2枚。片方だけが他家の河に大量に出ている
    const hand = make('z8:pink z9:pink')
    const seen = make('z9:blue z9:orange z9:pink')

    const endgame = view({
      hand,
      discardsByPlayer: [[], seen, [], []],
      wallCount: 5,
    })

    // 河に出ている z9 の方が安全とみなされ、そちらを捨てる
    expect(chooseDiscard(endgame, AI_PRESETS.hard).uid).toBe(hand[1].uid)
    // safety が 0 の easy では河を考慮しないので、決定的な既定（uid 昇順）で選ぶ
    expect(chooseDiscard(endgame, AI_PRESETS.easy).uid).toBe(hand[0].uid)
  })

  it('序盤は safety が効かない', () => {
    const make = createCardSource()
    const hand = make('z8:pink z9:pink')
    const seen = make('z9:blue z9:orange z9:pink')

    const early = view({
      hand,
      discardsByPlayer: [[], seen, [], []],
      wallCount: DEFAULT_RULES.deckSize,
    })

    expect(chooseDiscard(early, AI_PRESETS.hard).uid).toBe(hand[0].uid)
  })
})

describe('decideDeclare', () => {
  it('役が成立していれば必ず宣言する', () => {
    const make = createCardSource()
    const candidate = decideDeclare(view({ hand: make('a1:pink a1:blue a1:orange z9:pink') }))

    expect(candidate).not.toBeNull()
    expect(candidate?.kind).toBe('triple')
  })

  it('役が成立していなければ宣言しない', () => {
    const make = createCardSource()

    expect(decideDeclare(view({ hand: make('a1:pink a2:blue b1:orange') }))).toBeNull()
  })

  it('複数の役が成立していれば点数が最大のものを選ぶ', () => {
    const make = createCardSource()
    // a1 の3カード（120）と 4人組（300）が同時に成立している
    const hand = make('a1:pink a1:blue a1:orange b1:pink b2:blue b3:orange b4:pink')
    const candidate = decideDeclare(view({ hand }))

    expect(candidate?.kind).toBe('group4')
    expect(candidate?.score).toBe(300)
  })

  it('同色の役があればそちらを選ぶ', () => {
    const make = createCardSource()
    const candidate = decideDeclare(view({ hand: make('a1:pink a1:pink a1:pink') }))

    expect(candidate?.sameColor).toBe(true)
    expect(candidate?.score).toBe(840)
  })
})

describe('decideClaim', () => {
  it('捨て札で役が完成するなら割り込む', () => {
    const make = createCardSource()
    const hand = make('a1:blue a1:orange z9:pink')
    const discard = make('a1:pink')[0]

    const candidate = decideClaim(view({ hand }), discard)

    expect(candidate?.kind).toBe('triple')
    expect(candidate?.cards.map((card) => card.uid)).toContain(discard.uid)
  })

  it('手の内で既に成立している役では割り込まない', () => {
    const make = createCardSource()
    // 手札だけで a1 の3カードが成立済み。4枚目の a1 が出ても新しい役にはならない
    const hand = make('a1:pink a1:blue a1:orange')
    const discard = make('a1:pink')[0]

    expect(decideClaim(view({ hand }), discard)).toBeNull()
  })

  it('関係のない捨て札には割り込まない', () => {
    const make = createCardSource()
    const hand = make('a1:blue a1:orange')
    const discard = make('c5:pink')[0]

    expect(decideClaim(view({ hand }), discard)).toBeNull()
  })
})

describe('AI_PRESETS', () => {
  it('3段階の難易度が定義され、既定は normal である', () => {
    expect(Object.keys(AI_PRESETS)).toEqual(['easy', 'normal', 'hard'])
    expect(DEFAULT_AI_CONFIG).toBe(AI_PRESETS.normal)
  })

  it('patience が大きいほど遠い役の価値が下がる', () => {
    const make = createCardSource()
    const target = view({ hand: make('b1:pink') })

    const patient = evaluateTargets(target, { patience: 1, safety: 0 })
    const impatient = evaluateTargets(target, { patience: 3, safety: 0 })

    const pick = (targets: ReturnType<typeof evaluateTargets>) =>
      targets.find((entry) => entry.targetId === TEST_GROUPS.quartet.id && entry.color === null)

    expect(pick(impatient)?.value).toBeLessThan(pick(patient)?.value ?? 0)
  })
})

describe('ルール設定への追随', () => {
  it('点数表を差し替えると評価もそれに従う', () => {
    const make = createCardSource()
    const hand = make('a1:pink a1:blue a1:orange')
    const rules = testRules({
      scores: { ...DEFAULT_RULES.scores, triple: { base: 999, sameColor: 1200 } },
    })
    const state = gameState({ hands: [hand, [], [], []] })

    const custom: AiView = {
      selfId: 0,
      hand,
      ctx: yakuContextOf(state, rules),
      discardsByPlayer: [[], [], [], []],
      wallCount: 50,
      scores: [1000, 1000, 1000, 1000],
    }

    const triple = evaluateTargets(custom, DEFAULT_AI_CONFIG).find(
      (target) => target.targetId === 'a1' && target.color === null,
    )

    expect(triple?.score).toBe(999)
  })
})
