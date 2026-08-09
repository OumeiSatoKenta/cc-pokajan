/**
 * 和了時の点数移動。
 *
 * 役判定とは独立しており、算出済みの金額を受け取って点数を動かすだけ。
 *
 * このモジュールで最も重要なのは **0 クランプと点数保存則の両立** である。
 * 支払い者の残高が足りない場合は残高分だけを徴収し、和了者は「実際に徴収できた合計」を
 * 受け取る。和了者に満額を渡して支払い者を 0 で止める実装にすると点数が増殖してしまい、
 * 「4人の合計点は対局を通じて一定」という不変条件が崩れる。
 *
 * **前提**: `scores` の各要素は 0 以上であること。ポカジャンは誰かの点数が 0 以下になった
 * 時点で対局が終了するため、Step 3 のリデューサからは常にこの前提が満たされる。
 * 万一負の値が渡されても `collect` が `max(残高, 0)` で防御し、点数保存則は保たれる
 * （その相手からは何も徴収しない）。
 */

import type { GameEvent, Payment, PlayerId } from './types'

export type { Payment }

export interface SettlementResult {
  /** 支払い後の全プレイヤーの点数。入力は破壊しない。 */
  readonly scores: readonly number[]
  /** 誰が誰にいくら払ったか。Step 4 のコイン移動演出で使う。 */
  readonly payments: readonly Payment[]
}

/**
 * 精算結果を演出用のイベント列に変換する。
 *
 * Step 3 のリデューサが複数箇所で同じ変換を書かないよう、ここに1つだけ置く。
 */
export function toPaidEvents(result: SettlementResult): GameEvent[] {
  return result.payments.map((payment) => ({ type: 'Paid', ...payment }))
}

function assertValidPlayer(scores: readonly number[], id: PlayerId, label: string): void {
  if (!Number.isInteger(id) || id < 0 || id >= scores.length) {
    throw new RangeError(
      `${label} は 0〜${scores.length - 1} の整数である必要がありますが ${id} でした`,
    )
  }
}

function assertValidAmount(amount: number): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`amount must be a non-negative finite number, got ${amount}`)
  }
}

/**
 * `from` から `to` へ最大 `owed` を移す。
 *
 * 実際に動かす額は `min(owed, from の残高)`。移動は常に等量なので総和は変わらない。
 */
function collect(
  scores: number[],
  payments: Payment[],
  from: PlayerId,
  to: PlayerId,
  owed: number,
): void {
  const payable = Math.max(scores[from], 0)
  const paid = Math.min(owed, payable)
  if (paid <= 0) {
    return
  }

  scores[from] -= paid
  scores[to] += paid
  payments.push({ from, to, amount: paid })
}

/**
 * ツモ和了。自分以外の全員から等分を徴収する。
 *
 * 既定ルールでは全ての点数が3の倍数で `playerCount - 1 = 3` 人に割り切れるが、
 * Step 6 でルール値が編集可能になることを見越して `Math.floor` で分配する。
 * 割り切れない端数は誰からも徴収されない（和了者の取り分が僅かに減る）。
 */
export function settleTsumo(
  scores: readonly number[],
  winner: PlayerId,
  amount: number,
): SettlementResult {
  if (scores.length < 2) {
    throw new RangeError(`ツモの精算には2人以上必要ですが ${scores.length} 人でした`)
  }
  assertValidPlayer(scores, winner, 'winner')
  assertValidAmount(amount)

  const next = [...scores]
  const payments: Payment[] = []
  const share = Math.floor(amount / (scores.length - 1))

  for (let player = 0; player < scores.length; player++) {
    if (player === winner) {
      continue
    }
    collect(next, payments, player, winner, share)
  }

  return { scores: next, payments }
}

/** ロン和了。捨て札を出したプレイヤーが全額を支払う。 */
export function settleRon(
  scores: readonly number[],
  winner: PlayerId,
  discarder: PlayerId,
  amount: number,
): SettlementResult {
  assertValidPlayer(scores, winner, 'winner')
  assertValidPlayer(scores, discarder, 'discarder')
  assertValidAmount(amount)
  if (winner === discarder) {
    throw new RangeError('自分の捨て札でロンすることはできません')
  }

  const next = [...scores]
  const payments: Payment[] = []
  collect(next, payments, discarder, winner, amount)

  return { scores: next, payments }
}
