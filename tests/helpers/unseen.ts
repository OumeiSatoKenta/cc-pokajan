import { countUnseen, toVisibleCards, type UnseenCounts } from '../../src/engine/unseen'
import { DEFAULT_RULES } from '../../src/config/rules'
import type { Card, GameState, MemberId, RulesConfig } from '../../src/engine/types'

/**
 * 残枚数テストの共通の土台。
 *
 * `unseen.test.ts`（構造）と `unseenAutoplay.test.ts`（自動対局との突き合わせ）が
 * 同じ数え方の土台を使うため1箇所にまとめる。
 */

/** 今局の登場メンバー全員。`buildCardPool` にカードを作らせた集合と同じ。 */
export function activeMemberIds(state: GameState): MemberId[] {
  return state.activeMembers.map((member) => member.id)
}

export function unseenFor(
  state: GameState,
  playerId: number,
  rules: RulesConfig = DEFAULT_RULES,
): UnseenCounts {
  return countUnseen(toVisibleCards(state, playerId), activeMemberIds(state), rules)
}

/**
 * メンバー × 色ごとの枚数を数える素朴な実装。
 *
 * **製品コードとは別に書く。** `countUnseen` を呼んで比べると
 * 「同じ間違いを2回する」形になり、数え落としを検出できない。
 */
export function tally(cards: readonly Card[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = `${card.memberId}:${card.color}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** 山札に実際に入った枚数 `inDeck(m,c)`。カード保存則によりこれは対局を通じて変わらない。 */
export function inDeckCounts(state: GameState): Map<string, number> {
  const cards: Card[] = [...state.wall]
  for (const player of state.players) {
    cards.push(...player.hand, ...player.discards)
    for (const candidate of player.declared) {
      cards.push(...candidate.cards)
    }
  }
  return tally(cards)
}

/** 他家（`playerId` 以外）の手札の枚数。**製品コードが決して見ない情報。** */
export function opponentHandCounts(state: GameState, playerId: number): Map<string, number> {
  const cards: Card[] = []
  for (const player of state.players) {
    if (player.id !== playerId) {
      cards.push(...player.hand)
    }
  }
  return tally(cards)
}
