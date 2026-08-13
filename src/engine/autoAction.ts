/**
 * CPU / 自動進行の意思決定（純関数）。
 *
 * 「誰が次に何をするか」を engine の純関数として持つことで、UI（演出遅延つきの薄いアダプタ
 * `src/ui/hooks/autoAction.ts`）と Step 5 の backend が同じ判断を共有できる。状態には `toAiView`
 * 経由でしか触れないため、他家の手札を読む経路は型として存在しない。AI は乱数を使わないので、
 * 同じ状態・設定に対して常に同じ手を返す（自動対局はシードだけで再現できる）。
 *
 * 役割分担: 割り込みの「解決・検証」は `claims.ts`（resolveClaimWinner / verifyCandidate）が担う。
 * ここは「誰が何を選ぶか」の意思決定と、人間に見せる候補の列挙に徹する。
 */

import { chooseDiscard, decideClaim, decideDeclare, toAiView, type AiConfig } from './ai'
import { yakuContextOf } from './gameSelectors'
import { findYaku } from './yaku'
import type { Action, GameState, PlayerId, RulesConfig, YakuCandidate } from './types'

/** `nextCpuAction` が返しうるアクション。TICK（時間経過通知）は CPU 判断では発生しないので型で除外する。 */
export type CpuAction = Exclude<Action, { readonly type: 'TICK' }>

/**
 * 割り込める役（ロン）を列挙する。`claimWindow` 以外・捨て札なし・表明済みでは空。
 *
 * `ai.ts` の `decideClaim` は最良1件に絞ってしまい人間に選ばせる用途に使えないため、`findYaku` を直接呼ぶ。
 */
export function claimableFor(
  state: GameState,
  rules: RulesConfig,
  playerId: PlayerId,
): YakuCandidate[] {
  if (state.phase !== 'claimWindow' || state.lastDiscard === null) {
    return []
  }
  // `!== null` は「表明済み（'pass' / candidate）」と「キー不在＝捨て札の本人で割り込み対象外（undefined）」の
  // 両方を弾く（どちらも列挙する意味がない）。捨て札の本人が claims にキーを持たない前提は game.ts が保証する。
  if (state.claims[playerId] !== null) {
    return []
  }

  const hand = state.players[playerId].hand
  return findYaku([...hand, state.lastDiscard], yakuContextOf(state, rules), state.lastDiscard)
}

/** 宣言できる役（ツモ）を列挙する。`selfDeclare` で宣言権を持つとき以外は空。 */
export function declarableFor(
  state: GameState,
  rules: RulesConfig,
  playerId: PlayerId,
): YakuCandidate[] {
  if (state.phase !== 'selfDeclare' || state.declarer !== playerId) {
    return []
  }
  return findYaku(state.players[playerId].hand, yakuContextOf(state, rules))
}

/**
 * `claimWindow` でまだ意思表示していない CPU（＝ `humanSeats` 以外）を id 昇順で返す。
 *
 * **人間を飛ばして CPU を先に処理するのが要点。** `claims` のキーは `PlayerId`（数値）で、
 * 素朴に「最初の未表明者」を採ると人間席が先に来て、人間が決めるまで CPU の意思表示が出ない。
 */
export function pendingCpuClaimIds(state: GameState, humanSeats: readonly PlayerId[]): PlayerId[] {
  return Object.keys(state.claims)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((id) => !humanSeats.includes(id) && state.claims[id] === null)
}

/** `claimWindow` でまだ意思表示していない human を id 昇順で返す。 */
function pendingHumanIds(state: GameState, humanSeats: readonly PlayerId[]): PlayerId[] {
  return [...humanSeats]
    .sort((a, b) => a - b)
    .filter((id) => id in state.claims && state.claims[id] === null)
}

/**
 * 次に自動で進めるべき1手を決める。`null` なら人間の入力待ち（人間に選ぶ余地があるとき）。
 *
 * 対象プレイヤーはフェーズで変わる: `selfDeclare` は宣言権者（`declarer`）、`draw` / `discard` は手番（`turn`）。
 * ロンの連続宣言では両者が食い違うため取り違えないこと。`humanSeats` は人間が操作する席の集合で、
 * 空なら全員 CPU（`autoplay.ts` の `nextAction` と同じ挙動になる）。
 */
export function nextCpuAction(
  state: GameState,
  rules: RulesConfig,
  ai: AiConfig,
  humanSeats: readonly PlayerId[],
): CpuAction | null {
  switch (state.phase) {
    case 'gameOver':
      return null

    // 引くのは選択ではないので人間の席でも自動で行う。
    case 'draw':
      return { type: 'DRAW' }

    case 'selfDeclare': {
      const declarer = state.declarer

      if (humanSeats.includes(declarer)) {
        // 役が0件のときに「見送る」を押させるのは無意味なので自動で通過する。
        return declarableFor(state, rules, declarer).length === 0 ? { type: 'SKIP_DECLARE' } : null
      }

      const candidate = decideDeclare(toAiView(state, declarer, rules))
      return candidate === null
        ? { type: 'SKIP_DECLARE' }
        : { type: 'DECLARE', playerId: declarer, candidate }
    }

    case 'discard': {
      if (humanSeats.includes(state.turn)) {
        return null
      }
      const card = chooseDiscard(toAiView(state, state.turn, rules), ai)
      return { type: 'DISCARD', uid: card.uid }
    }

    case 'claimWindow': {
      const discard = state.lastDiscard
      if (discard === null) {
        return null
      }

      // CPU を先に処理し切る。人間が考えている間も他家の判断を進めるため。
      const cpu = pendingCpuClaimIds(state, humanSeats)[0]
      if (cpu !== undefined) {
        const candidate = decideClaim(toAiView(state, cpu, rules), discard)
        return candidate === null
          ? { type: 'PASS', playerId: cpu }
          : { type: 'CLAIM', playerId: cpu, candidate }
      }

      // 残りは human だけ。割り込める役がなければ待たせる意味がないので自動でパスする。
      const human = pendingHumanIds(state, humanSeats)[0]
      if (human === undefined) {
        return null
      }
      return claimableFor(state, rules, human).length === 0
        ? { type: 'PASS', playerId: human }
        : null
    }

    default: {
      const exhaustive: never = state.phase
      throw new Error(`未知のフェーズです: ${String(exhaustive)}`)
    }
  }
}
