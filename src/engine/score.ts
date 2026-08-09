/**
 * 役の点数計算。
 *
 * 同色時の倍率は役ごとにばらつく（3カード 7倍 / 4人組 2.8倍 / 5人組 3.75倍）ため、
 * 計算式では導けずルックアップテーブルとして扱う。値は `RulesConfig.scores` から引き、
 * このモジュールに数値をハードコードしない。
 */

import type { Card, MemberId, RulesConfig, YakuKind } from './types'

/**
 * 役の構成カードのうち、ボーナスメンバーのカードが何枚あるかを数える。
 *
 * 判定はメンバーID基準で色に依存しない。同一メンバー3枚の役でそのメンバーが
 * ボーナスなら3枚分（既定では +270 点）が加算される。
 */
export function countBonusCards(
  cards: readonly Card[],
  bonusMemberIds: readonly MemberId[],
): number {
  const bonus = new Set(bonusMemberIds)
  return cards.reduce((count, card) => (bonus.has(card.memberId) ? count + 1 : count), 0)
}

/**
 * 役の点数を求める。
 *
 * 点数は「役種・同色可否・ボーナス枚数」だけで決まり、**どの色のカードを消費するかには依存しない**。
 * 役の構成メンバーが固定される（3カードは1人、N人組はグループ全員）ため、
 * ボーナス枚数もカードの選び方によって変わらない。
 * この性質のおかげで、`yaku.ts` の候補列挙で点数を最大化するカードの探索が不要になっている。
 */
export function scoreYaku(
  kind: YakuKind,
  sameColor: boolean,
  bonusCount: number,
  rules: RulesConfig,
): number {
  const table = rules.scores[kind]
  if (table === undefined) {
    throw new RangeError(`役種「${kind}」の点数がルール設定に定義されていません`)
  }
  if (!Number.isInteger(bonusCount) || bonusCount < 0) {
    throw new RangeError(`bonusCount must be a non-negative integer, got ${bonusCount}`)
  }

  return (sameColor ? table.sameColor : table.base) + bonusCount * rules.bonusPerCard
}
