/**
 * 割り込み宣言の優先度解決と、宣言された役の再計算による検証。
 *
 * どちらも状態機械の可変な作業領域に触れない純関数として切り出してある。
 * 「誰の宣言が通るか」「その宣言は本物か」はゲームの公正さを直接決めるため、
 * 進行ロジックと混ぜずに単体でテストできる形にしておく。
 */

import { IllegalActionError } from './errors'
import { candidateFromSelection } from './yakuSelection'
import type { Card, ClaimDecision, PlayerId, YakuCandidate, YakuContext } from './types'

/** 割り込み宣言の勝者。 */
export interface ClaimWinner {
  readonly playerId: PlayerId
  readonly candidate: YakuCandidate
}

/**
 * 割り込み宣言の優先度を解決する。
 *
 * 1. 点数が最大の役
 * 2. 同点なら捨てたプレイヤーから反時計回りに近いプレイヤー
 *
 * 勝者以外は何も得ず、支払いも発生しない（頭ハネ）。
 */
export function resolveClaimWinner(
  claims: Readonly<Partial<Record<PlayerId, ClaimDecision>>>,
  discarder: PlayerId,
  playerCount: number,
): ClaimWinner | null {
  let winner: ClaimWinner | null = null
  let winnerDistance = Number.POSITIVE_INFINITY

  for (const [key, decision] of Object.entries(claims)) {
    if (decision === undefined || decision === null || decision === 'pass') {
      continue
    }

    const playerId = Number(key)
    const distance = (playerId - discarder + playerCount) % playerCount

    if (winner === null || decision.score > winner.candidate.score) {
      winner = { playerId, candidate: decision }
      winnerDistance = distance
      continue
    }
    if (decision.score === winner.candidate.score && distance < winnerDistance) {
      winner = { playerId, candidate: decision }
      winnerDistance = distance
    }
  }

  return winner
}

/**
 * 宣言された候補が `YakuCandidate` の形をしているかを確かめる。
 *
 * 呼び出し側が組み立てたデータをそのまま `cards.map(...)` に流すと、壊れた入力に対して
 * ドメイン例外ではなく素の `TypeError` が出てしまう。このファイル内の他の検証と
 * 同じ失敗のしかたに揃えるための入口ガード。
 */
function isCandidateShape(value: unknown): value is YakuCandidate {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Partial<YakuCandidate>

  return (
    typeof candidate.kind === 'string' &&
    Array.isArray(candidate.cards) &&
    candidate.cards.every((card: Card | undefined) => typeof card?.uid === 'number')
  )
}

/**
 * 宣言された候補を、選択されたカードから再導出した候補で置き換える。
 *
 * 「列挙候補との一致を検証する」のではなく「選んだカードから役を再計算して採用する」のが要点。
 * `findYaku` が正準の1組しか列挙しないのに対し、`candidateFromSelection` はプレイヤーが選んだ
 * カードそのものから役を組むため、**正準以外の合法選択**（同一メンバー4枚のうち別の3枚など）も
 * 受理できる。安全性は従来と同値に保たれる:
 *
 * - **点数偽装不可**: 精算に使うのは再計算した候補の点数（`claimed.score` は捨てる）。
 * - **未所持カード不可**: 選択 uid が `hand` に解決できなければ `null`。
 * - **不要牌ロン不可**: `required` の「反手内成立でロン不可」規則。
 *
 * `hand` はロンでは「自分の手札 + 相手の捨て札」、`required` はその捨て札。
 */
export function verifyCandidate(
  hand: readonly Card[],
  claimed: unknown,
  ctx: YakuContext,
  label: string,
  required?: Card,
): YakuCandidate {
  if (!isCandidateShape(claimed)) {
    throw new IllegalActionError(`${label} に渡された候補が役の形をしていません`)
  }

  const selectedUids = claimed.cards.map((card) => card.uid)
  const candidate = candidateFromSelection(hand, selectedUids, ctx, required)

  if (candidate === null) {
    throw new IllegalActionError(
      `${label} で宣言された役は現在の手札では成立しません（${claimed.kind} / ${claimed.cards.length}枚）`,
    )
  }

  return candidate
}
