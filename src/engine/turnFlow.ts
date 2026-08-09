/**
 * 手番の進行と対局の終了。
 *
 * 「次は誰の番か」「対局はもう終わりか」だけを担い、和了そのものの処理（`win.ts`）や
 * アクションの受付（`game.ts`）からは切り離している。この2つは和了処理からも
 * 割り込み解決からも呼ばれるため、依存の向きを一方向に保つために独立させている。
 */

import { computeRanking } from './gameSelectors'
import type { Draft } from './gameDraft'
import type { GameEvent, GameOverReason, RulesConfig } from './types'

/**
 * 対局を終了させ、順位を確定する。
 *
 * 順位の算出は `computeRanking` に委ねる。**対局中の演出も同じ関数を使う**ため、
 * ここに並べ替えを書き戻すと二重実装になり、精算額と演出が食い違いうる。
 */
export function finishGame(draft: Draft, events: GameEvent[], reason: GameOverReason): void {
  draft.phase = 'gameOver'

  events.push({ type: 'GameOver', ranking: computeRanking(draft.players), reason })
}

/**
 * 和了1回分の後始末として終了条件を検査する。
 *
 * 破産と山切れが同時に成立したときは `bankrupt` を優先する（点数のやり取りが
 * ゲームの主目的であり、終了理由としての情報量が大きいため）。
 */
export function checkGameOverAfterWin(
  draft: Draft,
  events: GameEvent[],
  hasRefillShortage: boolean,
): boolean {
  if (draft.players.some((player) => player.score <= 0)) {
    finishGame(draft, events, 'bankrupt')
    return true
  }
  if (hasRefillShortage) {
    finishGame(draft, events, 'wallEmpty')
    return true
  }
  return false
}

/** 次のプレイヤーへ手番を渡す。反時計回り＝プレイヤー ID の昇順。 */
export function advanceTurn(draft: Draft, events: GameEvent[], rules: RulesConfig): void {
  draft.turn = (draft.turn + 1) % rules.playerCount
  draft.declarer = draft.turn
  draft.chainCount = 0
  draft.lastDiscard = null
  draft.lastDiscardBy = null
  draft.claims = {}
  draft.claimTimerMs = 0
  draft.phase = 'draw'

  events.push({ type: 'TurnChanged', playerId: draft.turn })
}

/**
 * 連続宣言のチェーンから抜ける。
 *
 * ツモチェーンの主は引いたカードをまだ持っているので捨てる必要があるが、
 * ロンチェーンの主は捨て札を消費しただけで、手番プレイヤーは既に捨て終わっている。
 * この2経路を一本化すると「既に捨てたプレイヤーにもう一度捨てさせる」バグになる。
 */
export function exitChain(draft: Draft, events: GameEvent[], rules: RulesConfig): void {
  if (draft.declarer === draft.turn) {
    draft.phase = 'discard'
    return
  }
  advanceTurn(draft, events, rules)
}
