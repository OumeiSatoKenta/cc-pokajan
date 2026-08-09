import { beforeAll, describe, expect, it } from 'vitest'

import { playGameToEnd } from '../../src/engine/autoplay'
import { countUnseen, toVisibleCards, unseenOf } from '../../src/engine/unseen'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import { testRules } from '../helpers/game'
import {
  activeMemberIds,
  inDeckCounts,
  opponentHandCounts,
  tally,
  unseenFor,
} from '../helpers/unseen'

/**
 * 残枚数と自動対局の突き合わせ。
 *
 * **数え方そのものの検査は `unseen.test.ts` にある。** こちらは
 * 「製品コードが決して見ない情報から独立に導いた値と一致するか」だけを見る。
 * 共通の土台は `tests/helpers/unseen.ts`。
 */

const SEEDS = Array.from({ length: 100 }, (_, index) => index)

/**
 * **この機能でいちばん重要な検査。**
 *
 * 残枚数を、製品コードが決して見ない情報から**足し算で**組み直して一致を見る。
 *
 * ```
 * unseen(m,c) === wall(m,c) + Σ_{他家} hand(m,c) + notInDeck(m,c)
 * notInDeck(m,c) = copiesPerMemberColor − inDeck(m,c)
 * inDeck(m,c)    = wall + 全員の手札 + 全員の河 + 全員の成立済みの役
 * ```
 *
 * `countUnseen` は同じ引き算をもう一度やる形になっていないので、
 * 河を1人分数え落とす・成立済みの役を忘れるといった欠陥があれば必ず食い違う。
 * 構造だけのテストではこの種の欠陥を取りこぼす（Step 2 の欠陥3件は
 * 186件のテストを通過していた）。
 *
 * `inDeck` は対局を通じて変わらないので**最初のステップで測って固定**し、
 * 以降は不変であることも一緒に検査する（メンバー×色の粒度のカード保存則）。
 *
 * **食い違いは配列に集めて最後に1度だけ `expect` する。** 100局 × 約600ステップ ×
 * 4人 × 66通りで `expect` を呼ぶと1600万回を超え、検査そのものより
 * アサーションの実行時間が支配的になって時間切れになる。
 * 集める形にしても「落ちない検査」にはならないことは、
 * わざと壊して確かめてある（design.md の表）。
 */
describe('自動対局との突き合わせ', () => {
  interface Finding {
    readonly seed: number
    readonly playerId: number
    readonly key: string
    readonly actual: number
    readonly expected: number
  }

  /** 失敗時のメッセージが読める長さで止める。空でなくなった時点で落ちる。 */
  const MAX_FINDINGS = 5

  const mismatches: Finding[] = []
  const outOfRange: Finding[] = []
  const drifted: { readonly seed: number; readonly key: string }[] = []

  beforeAll(() => {
    const { copiesPerMemberColor, colors } = DEFAULT_RULES

    for (const seed of SEEDS) {
      let inDeck: Map<string, number> | null = null

      playGameToEnd({
        roster: DEFAULT_ROSTER,
        rules: DEFAULT_RULES,
        seed,
        onStep: (state) => {
          const current = inDeckCounts(state)
          if (inDeck === null) {
            inDeck = current
          } else if (drifted.length < MAX_FINDINGS) {
            for (const [key, count] of current) {
              if (inDeck.get(key) !== count) {
                drifted.push({ seed, key })
              }
            }
          }
          const fixed = inDeck
          const memberIds = activeMemberIds(state)
          const wall = tally(state.wall)

          /*
           * 視点は全員分見る。1人だけだと `toVisibleCards` の添字の取り違えが
           * player 0 でだけたまたま表に出ない形で通り抜ける。
           */
          for (const player of state.players) {
            const counts = unseenFor(state, player.id)
            const opponents = opponentHandCounts(state, player.id)

            for (const memberId of memberIds) {
              for (const color of colors) {
                const key = `${memberId}:${color}`
                const notInDeck = copiesPerMemberColor - (fixed.get(key) ?? 0)
                const expected = (wall.get(key) ?? 0) + (opponents.get(key) ?? 0) + notInDeck
                const actual = unseenOf(counts, memberId, color)

                if (actual !== expected && mismatches.length < MAX_FINDINGS) {
                  mismatches.push({ seed, playerId: player.id, key, actual, expected })
                }
                if (
                  (actual < 0 || actual > copiesPerMemberColor) &&
                  outOfRange.length < MAX_FINDINGS
                ) {
                  outOfRange.push({ seed, playerId: player.id, key, actual, expected })
                }
              }
            }
          }
        },
      })
    }
  }, 120_000)

  it('全ステップ・全プレイヤーの視点で残枚数が独立に導いた値と一致する', () => {
    expect(mismatches).toEqual([])
  })

  /**
   * **既定値以外のルールでも一致すること。**
   *
   * 上の検査は `DEFAULT_RULES` だけを通る。色数・人数・1色あたりの枚数を
   * 既定から動かした系統を1つ通しておかないと、
   * 「3色・3枚のときだけたまたま合う」実装（重複排除を `Set` でやる、など）を
   * 取りこぼす。`copiesPerMemberColor: 1` は同じカードが1枚しかない極端な場合。
   */
  it('色数・人数・1色あたりの枚数を変えても一致する', () => {
    const rules = testRules({
      playerCount: 3,
      handSize: 5,
      colors: ['pink', 'blue'],
      copiesPerMemberColor: 1,
      deckSize: 24,
      bet: { ...DEFAULT_RULES.bet, rankMultiplier: [2, 1, 0.5] },
    })
    const found: Finding[] = []

    for (const seed of [1, 2, 3, 4, 5]) {
      let inDeck: Map<string, number> | null = null

      playGameToEnd({
        roster: DEFAULT_ROSTER,
        rules,
        seed,
        onStep: (state) => {
          inDeck ??= inDeckCounts(state)
          const fixed = inDeck
          const memberIds = activeMemberIds(state)
          const wall = tally(state.wall)

          for (const player of state.players) {
            const counts = countUnseen(toVisibleCards(state, player.id), memberIds, rules)
            const opponents = opponentHandCounts(state, player.id)

            for (const memberId of memberIds) {
              for (const color of rules.colors) {
                const key = `${memberId}:${color}`
                const notInDeck = rules.copiesPerMemberColor - (fixed.get(key) ?? 0)
                const expected = (wall.get(key) ?? 0) + (opponents.get(key) ?? 0) + notInDeck
                const actual = unseenOf(counts, memberId, color)

                if (actual !== expected && found.length < MAX_FINDINGS) {
                  found.push({ seed, playerId: player.id, key, actual, expected })
                }
              }
            }
          }
        },
      })
    }

    expect(found).toEqual([])
  })

  it('残枚数が 0 〜 copiesPerMemberColor に収まる', () => {
    expect(outOfRange).toEqual([])
  })

  it('山札に入った枚数はメンバー × 色の粒度で対局を通じて変わらない', () => {
    expect(drifted).toEqual([])
  })
})
