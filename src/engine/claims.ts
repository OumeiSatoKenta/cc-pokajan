/**
 * 割り込み宣言の優先度解決と、宣言された役の再計算による検証。
 *
 * どちらも状態機械の可変な作業領域に触れない純関数として切り出してある。
 * 「誰の宣言が通るか」「その宣言は本物か」はゲームの公正さを直接決めるため、
 * 進行ロジックと混ぜずに単体でテストできる形にしておく。
 */

import { IllegalActionError } from './errors'
import type { Card, ClaimDecision, PlayerId, YakuCandidate } from './types'

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

/** 消費カード・役種・同色可否で候補を同定する。点数は含めない（偽装を弾くため）。 */
function candidateKey(candidate: YakuCandidate): string {
  const uids = candidate.cards
    .map((card) => card.uid)
    .sort((a, b) => a - b)
    .join(',')

  return `${candidate.kind}:${candidate.sameColor ? 'same' : 'mixed'}:${uids}`
}

/**
 * 呼び出し側が渡した候補を、エンジンが再計算した候補で置き換える。
 *
 * 「検証して通す」のではなく「再計算した方を採用する」のが要点。点数フィールドを
 * 偽装した候補を渡されても、精算に使われるのは必ずエンジンが計算した点数になる。
 */
export function verifyCandidate(
  available: readonly YakuCandidate[],
  claimed: YakuCandidate,
  label: string,
): YakuCandidate {
  if (!isCandidateShape(claimed)) {
    throw new IllegalActionError(`${label} に渡された候補が役の形をしていません`)
  }

  const key = candidateKey(claimed)
  const match = available.find((candidate) => candidateKey(candidate) === key)

  if (match === undefined) {
    throw new IllegalActionError(
      `${label} で宣言された役は現在の手札では成立しません（${claimed.kind} / ${claimed.cards.length}枚）`,
    )
  }

  return match
}
