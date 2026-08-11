/**
 * 和了1回分の処理。
 *
 * ポカジャンは**和了しても局が終わらない**ため、和了は「局の締めくくり」ではなく
 * 「局の途中で何度も起こる出来事」になる。精算・消費・補充・連続宣言をひとまとまりの
 * 手続きとして切り出しておくことで、ツモ（`DECLARE`）とロン（割り込み解決）の
 * どちらの経路からも同じ順序で実行されることを保証する。
 */

import { verifyCandidate } from './claims'
import { IllegalActionError } from './errors'
import { requireDiscarder, takeFromWall, type Draft } from './gameDraft'
import { settleRon, settleTsumo, toPaidEvents } from './settle'
import { checkGameOverAfterWin, exitChain } from './turnFlow'
import type { GameEvent, PlayerId, RulesConfig, WinKind, YakuCandidate, YakuContext } from './types'

/** 点数を移動させる。ロンは放銃者が全額、ツモは他の全員が等分を支払う。 */
function settleWin(
  draft: Draft,
  events: GameEvent[],
  winnerId: PlayerId,
  candidate: YakuCandidate,
  winKind: WinKind,
): void {
  const scores = draft.players.map((player) => player.score)
  const settlement =
    winKind === 'tsumo'
      ? settleTsumo(scores, winnerId, candidate.score)
      : settleRon(scores, winnerId, requireDiscarder(draft), candidate.score)

  settlement.scores.forEach((score, id) => {
    draft.players[id].score = score
  })
  events.push(...toPaidEvents(settlement))
}

/**
 * 役に使ったカードを場から取り除き、手札から出た枚数だけ補充する。
 *
 * 補充枚数は「消費したカードのうち自分の手札から出た枚数」。ツモ（消費が全て手札から）でも
 * ロン（1枚は捨て札）でもこの1つの規則で説明できるので、和了種別で分岐しない。
 * 実際に手札から消えた枚数を数えているため、ロンの構成枚数の規則が将来変わっても壊れない。
 *
 * 補充が足りなかった（山札が尽きた）場合に `true` を返す。
 */
function consumeAndRefill(
  draft: Draft,
  events: GameEvent[],
  winnerId: PlayerId,
  candidate: YakuCandidate,
  winKind: WinKind,
): boolean {
  const consumedUids = new Set(candidate.cards.map((card) => card.uid))
  const winner = draft.players[winnerId]
  const kept = winner.hand.filter((card) => !consumedUids.has(card.uid))
  const consumedFromHand = winner.hand.length - kept.length

  winner.declared = [...winner.declared, candidate]

  // ロンで使った捨て札は役として場から消えるため、河から取り除く。
  // 残すと「1枚のカードが河と成立済み役の両方に存在する」ことになり、カード保存則が破れる。
  if (winKind === 'ron') {
    const discarder = draft.players[requireDiscarder(draft)]
    discarder.discards = discarder.discards.filter((card) => !consumedUids.has(card.uid))
    draft.lastDiscard = null
  }

  const refill = takeFromWall(draft, consumedFromHand)
  winner.hand = [...kept, ...refill]

  if (refill.length > 0) {
    events.push({ type: 'Refilled', playerId: winnerId, cards: refill })
  }

  return refill.length < consumedFromHand
}

/**
 * 連続宣言を続けるか、チェーンを抜けるかを決める。
 *
 * 上限のガードは「`DECLARE` を例外で弾く」のではなく「遷移でチェーンを抜ける」形にする。
 * 役があれば必ず宣言する CPU を例外で止めないためであり、この結果
 * `reduce` の戻り値が「`selfDeclare` かつ上限到達済み」になることは決してない。
 */
function continueOrExitChain(draft: Draft, events: GameEvent[], rules: RulesConfig): void {
  draft.chainCount += 1

  if (draft.chainCount >= rules.maxChainDeclare) {
    exitChain(draft, events, rules)
    return
  }
  draft.phase = 'selfDeclare'
}

/**
 * 和了1回分を適用する。処理順序は `精算 → 消費 → 補充 → 終了判定` に固定する。
 *
 * 補充の途中で山札が尽きても和了を取り消さない。既に公開された和了を巻き戻す処理は
 * カード保存則を壊す最大の温床であり、精算だけ確定させて対局を終える方が単純で安全。
 */
export function applyWin(
  draft: Draft,
  events: GameEvent[],
  winnerId: PlayerId,
  candidate: YakuCandidate,
  winKind: WinKind,
  rules: RulesConfig,
): void {
  events.push({ type: 'Declared', playerId: winnerId, candidate, winKind })

  settleWin(draft, events, winnerId, candidate, winKind)
  const hasRefillShortage = consumeAndRefill(draft, events, winnerId, candidate, winKind)

  if (checkGameOverAfterWin(draft, events, hasRefillShortage)) {
    return
  }
  continueOrExitChain(draft, events, rules)
}

/** 自分の手番での宣言（ツモ）。宣言権を持つプレイヤー以外は受け付けない。 */
export function applyDeclare(
  draft: Draft,
  events: GameEvent[],
  playerId: PlayerId,
  claimed: YakuCandidate,
  ctx: YakuContext,
  rules: RulesConfig,
): void {
  if (playerId !== draft.declarer) {
    throw new IllegalActionError(
      `宣言権を持つのはプレイヤー${draft.declarer}ですが、プレイヤー${playerId}が DECLARE を送りました`,
    )
  }

  const hand = draft.players[playerId].hand
  // 列挙候補との一致ではなく、宣言された候補が選んだカードから役を再導出して検証する。
  const candidate = verifyCandidate(hand, claimed, ctx, 'DECLARE')

  applyWin(draft, events, playerId, candidate, 'tsumo', rules)
}
