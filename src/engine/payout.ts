/**
 * BET の精算計算。
 *
 * ```
 * BET倍率 = bet / min(options)          // 1000→1倍, 2000→2倍
 * gross   = floor(最終点数 × BET倍率 × 順位倍率)
 * net     = gross − bet
 * ```
 *
 * **金額を扱うため、不正な入力に対して黙って値を返さない。** 誤った額は
 * 所持コインに書き込まれて永続化されるので、その場で例外にする。
 */

import { IllegalActionError } from './errors'
import type { PlayerId, RulesConfig } from './types'

/** 精算1回分の内訳。画面が同じ計算を再実装しないで済むよう、途中の値も含める。 */
export interface PayoutBreakdown {
  readonly finalScore: number
  readonly bet: number
  readonly betMultiplier: number
  /** 1始まりの順位。 */
  readonly rank: number
  readonly rankMultiplier: number
  /** 払い戻し額（BET を引く前）。 */
  readonly gross: number
  /** 所持コインの増減。負なら減る。 */
  readonly net: number
}

/**
 * 順位表からプレイヤーの順位（1始まり）を取り出す。
 *
 * **画面側で `indexOf` を書かない。** 0始まりと1始まりの取り違えは
 * そのまま順位倍率のずれ、つまり金額の誤りになる。
 */
export function rankOf(ranking: readonly PlayerId[], playerId: PlayerId): number {
  const index = ranking.indexOf(playerId)

  if (index < 0) {
    throw new IllegalActionError(
      `プレイヤー${playerId}が順位表に含まれていません: [${ranking.join(', ')}]`,
    )
  }

  return index + 1
}

/**
 * 精算額を求める。
 *
 * 丸めは**切り捨て**。払い戻しが厳密値を超えないことを保証する。
 * 順位倍率が 0.5 の倍数である限り、`整数 × 倍率` は厳密に表現できるため
 * 切り捨てで値がずれることはない（`BetConfig.rankMultiplier` の制約）。
 *
 * なお既定ルールでは役の点数もボーナス加点もすべて偶数のため最終点は常に偶数で、
 * 2.5 倍しても端数が出ない。**切り捨てが働かないことに正しさを預けない**ため、
 * 端数のケースは単体テストで直接与えて検証している。
 */
export function computePayout(
  finalScore: number,
  bet: number,
  rank: number,
  rules: RulesConfig,
): PayoutBreakdown {
  if (!Number.isFinite(finalScore) || finalScore < 0) {
    throw new IllegalActionError(`最終点数が不正です: ${finalScore}`)
  }
  if (!rules.bet.options.includes(bet)) {
    throw new IllegalActionError(
      `BET 額 ${bet} は選択肢にありません: [${rules.bet.options.join(', ')}]`,
    )
  }
  if (!Number.isInteger(rank) || rank < 1 || rank > rules.bet.rankMultiplier.length) {
    throw new IllegalActionError(
      `順位 ${rank} が範囲外です（1〜${rules.bet.rankMultiplier.length}）`,
    )
  }

  const betMultiplier = bet / baseBet(rules)
  const rankMultiplier = rules.bet.rankMultiplier[rank - 1]
  const gross = Math.floor(finalScore * betMultiplier * rankMultiplier)

  return {
    finalScore,
    bet,
    betMultiplier,
    rank,
    rankMultiplier,
    gross,
    net: gross - bet,
  }
}

/**
 * BET 倍率の基準額。**選択肢の並び順に依存させない**ため最小値を使う。
 * 配列の先頭を基準にすると、設定画面で順序を入れ替えただけで倍率が変わってしまう。
 */
function baseBet(rules: RulesConfig): number {
  const base = Math.min(...rules.bet.options)

  if (!Number.isFinite(base) || base <= 0) {
    throw new IllegalActionError(`BET の選択肢が不正です: [${rules.bet.options.join(', ')}]`)
  }

  return base
}

/** その BET を出せるだけの所持コインがあるか。 */
export function canAfford(wallet: number, bet: number): boolean {
  return wallet >= bet
}
