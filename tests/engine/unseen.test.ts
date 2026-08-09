import { describe, expect, it } from 'vitest'

import { createGame, reduce } from '../../src/engine/game'
import { yakuContextOf } from '../../src/engine/gameSelectors'
import { computeWaits } from '../../src/engine/yaku'
import { colorCountsOf, countUnseen, toVisibleCards, unseenOf } from '../../src/engine/unseen'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import { createCardSource, gameState, testRules } from '../helpers/game'
import { TEST_GROUPS } from '../helpers/cards'
import { activeMemberIds, unseenFor } from '../helpers/unseen'
import type { ColorId } from '../../src/engine/types'

/**
 * 残枚数の数え方（構造）。
 *
 * **自動対局との突き合わせは `unseenAutoplay.test.ts` にある。**
 * 1ファイルにまとめると 430 行になったため、
 * 「局面を組み立てて数え方を固定する」検査と
 * 「100局を回して独立に導いた値と比べる」検査で分けた。
 * 共通の土台は `tests/helpers/unseen.ts`。
 */

describe('countUnseen — 見えているカードの数え方', () => {
  const rules = testRules()

  it('自分の手札・全員の河・全員の成立済みの役をすべて数える', () => {
    const cards = createCardSource()
    const myHand = cards('a1:pink a1:blue')
    const myRiver = cards('a1:pink')
    const theirRiver = cards('a1:pink')
    const declaredCards = cards('a2:blue a2:blue a2:blue')

    const counts = countUnseen(
      {
        hand: myHand,
        discardsByPlayer: [myRiver, theirRiver],
        declaredByPlayer: [
          [],
          [{ kind: 'triple', sameColor: true, cards: declaredCards, bonusCount: 0, score: 840 }],
        ],
      },
      ['a1', 'a2', 'a3'],
      rules,
    )

    // ピンクの a1 は手札1 + 自分の河1 + 他家の河1 = 3枚見えている
    expect(unseenOf(counts, 'a1', 'pink')).toBe(rules.copiesPerMemberColor - 3)
    // 青の a1 は手札の1枚だけ
    expect(unseenOf(counts, 'a1', 'blue')).toBe(rules.copiesPerMemberColor - 1)
    // 成立済みの役で消えた a2 の青は3枚
    expect(unseenOf(counts, 'a2', 'blue')).toBe(rules.copiesPerMemberColor - 3)
    // どこにも出ていないメンバーは満額のまま
    expect(unseenOf(counts, 'a3', 'orange')).toBe(rules.copiesPerMemberColor)
  })

  /**
   * **3つの出どころが重ならないこと。**
   *
   * 同じ1枚を河と成立済みの役で二重に数えると残枚数が過小になり、
   * 生きている待ちを「もう無い」と言うことになる。
   */
  it('同じ枚数でも出どころが違えば足し合わされる', () => {
    const cards = createCardSource()
    const only = (source: Partial<Parameters<typeof countUnseen>[0]>): number => {
      const counts = countUnseen(
        { hand: [], discardsByPlayer: [], declaredByPlayer: [], ...source },
        ['a1'],
        rules,
      )
      return rules.copiesPerMemberColor - unseenOf(counts, 'a1', 'pink')
    }

    expect(only({ hand: cards('a1:pink') })).toBe(1)
    expect(only({ discardsByPlayer: [cards('a1:pink'), cards('a1:pink')] })).toBe(2)
    expect(
      only({
        declaredByPlayer: [
          [
            {
              kind: 'triple',
              sameColor: true,
              cards: cards('a1:pink a1:pink a1:pink'),
              bonusCount: 0,
              score: 840,
            },
          ],
        ],
      }),
    ).toBe(3)
  })

  it('数える対象に無いメンバーのカードは黙って捨てず例外にする', () => {
    const cards = createCardSource()

    expect(() =>
      countUnseen(
        { hand: cards('z9:pink'), discardsByPlayer: [], declaredByPlayer: [] },
        ['a1'],
        rules,
      ),
    ).toThrow(/z9/)
  })

  it('ルールに無い色のカードも例外にする', () => {
    const cards = createCardSource()
    const twoColors = testRules({ colors: ['pink', 'blue'] })

    expect(() =>
      countUnseen(
        { hand: cards('a1:orange'), discardsByPlayer: [], declaredByPlayer: [] },
        ['a1'],
        twoColors,
      ),
    ).toThrow(/orange/)
  })

  it('色の並びは rules.colors の順になる', () => {
    const counts = countUnseen(
      { hand: [], discardsByPlayer: [], declaredByPlayer: [] },
      ['a1'],
      rules,
    )

    expect(colorCountsOf(counts, 'a1').map((count) => count.color)).toEqual(rules.colors)
  })
})

describe('引き当ての失敗', () => {
  const rules = testRules()
  const counts = countUnseen(
    { hand: [], discardsByPlayer: [], declaredByPlayer: [] },
    ['a1'],
    rules,
  )

  /**
   * **0 を返すフォールバックを置かない。**
   * 「残0」は「その待ちは捨てろ」という意味を持つので、数え落としを 0 で埋めると
   * この機能が防ごうとしている誤りをこの機能が生む。
   */
  it('数えていないメンバーは例外になる（0 を返さない）', () => {
    expect(() => colorCountsOf(counts, 'b1')).toThrow(RangeError)
    expect(() => unseenOf(counts, 'b1', 'pink')).toThrow(RangeError)
  })

  it('数えていない色も例外になる', () => {
    expect(() => unseenOf(counts, 'a1', 'silver' as ColorId)).toThrow(RangeError)
  })
})

describe('toVisibleCards — 状態に触る唯一の場所', () => {
  it('指定したプレイヤーの手札だけを取り、他家の手札は入らない', () => {
    const cards = createCardSource()
    const mine = cards('a1:pink')
    const theirs = cards('a2:blue')
    const state = gameState({ hands: [mine, theirs], discards: [cards('a3:orange'), []] })

    const visible = toVisibleCards(state, 0)

    expect(visible.hand).toEqual(mine)
    expect(visible.discardsByPlayer).toHaveLength(2)
    expect(JSON.stringify(visible)).not.toContain('a2')
  })

  it('席にいないプレイヤーは例外にする', () => {
    const state = gameState({ hands: [[], []] })

    expect(() => toVisibleCards(state, 5)).toThrow(RangeError)
  })

  it('見ている人が変われば手札も変わる', () => {
    const cards = createCardSource()
    const state = gameState({
      hands: [cards('a1:pink'), cards('a2:blue')],
      groups: [TEST_GROUPS.trio, TEST_GROUPS.quartet],
    })

    expect(toVisibleCards(state, 0).hand[0]?.memberId).toBe('a1')
    expect(toVisibleCards(state, 1).hand[0]?.memberId).toBe('a2')
  })
})

/**
 * **待ちの集合と、数える集合が一致していること。**
 *
 * 画面は `computeWaits` が返した (メンバー, 色) を `unseenOf` に渡す。
 * `computeWaits` は `activeGroups` からメンバーを作り、`countUnseen` の呼び出し側は
 * `activeMembers` から作る。両者は `deck.ts` の `collectMembers` によって
 * 同じ集合になるが、それは**2つの離れたモジュール間の暗黙の合意**でしかない。
 *
 * 崩れると `unseenOf` が `RangeError` を投げ、`ErrorBoundary` で画面ごと落ちる。
 * 「たまたま成り立っている条件」に画面の生死を預けないため、ここで直接固定する。
 */
describe('待ちの集合と数える集合', () => {
  it('activeMembers と activeGroups のメンバーは同じ集合になる', () => {
    for (const seed of [1, 7, 42, 2026]) {
      const state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, seed, { humanSeats: [0] })
      const fromGroups = new Set(state.activeGroups.flatMap((group) => group.memberIds))

      expect(new Set(activeMemberIds(state))).toEqual(fromGroups)
    }
  })

  it('computeWaits が返した待ちは必ず残枚数を引ける', () => {
    for (const seed of [1, 7, 42, 2026]) {
      const start = createGame(DEFAULT_ROSTER, DEFAULT_RULES, seed, { humanSeats: [0] })
      // 画面が待ちを出すのは自動の `DRAW` の後（手札は規定枚数 + 1）。
      const state = reduce(start, { type: 'DRAW' }, DEFAULT_RULES).state
      const counts = unseenFor(state, 0)
      const { waits } = computeWaits(state.players[0].hand, yakuContextOf(state, DEFAULT_RULES))

      for (const wait of waits) {
        expect(() => unseenOf(counts, wait.memberId, wait.color)).not.toThrow()
      }
    }
  })
})
