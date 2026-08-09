/**
 * 自動進行の判断と、演出のための待ち時間。
 *
 * 「次に誰が何をするか」を純粋関数として切り出しておくことで、
 * CPU の手番・宣言・割り込みの振る舞いを jsdom なしで単体テストできる。
 */

import { chooseDiscard, decideClaim, decideDeclare, toAiView, type AiConfig } from '../../engine/ai'
import { findYaku } from '../../engine/yaku'
import { yakuContextOf } from '../../engine/gameSelectors'
import type { Action, GameState, PlayerId, RulesConfig, YakuCandidate } from '../../engine/types'

/** 自動進行の1手。`delayMs` は演出のための待ち時間で、エンジンには渡らない。 */
export interface AutoStep {
  readonly action: Action
  readonly delayMs: number
}

// --- 演出のための遅延 ---------------------------------------------------------

/** アクション種別ごとの演出待ち時間。 */
export interface Delays {
  readonly draw: number
  readonly discard: number
  readonly declare: number
  readonly skipDeclare: number
  readonly claim: number
}

/**
 * 既定の遅延。エンジンは時間を持たないため、ここが体感速度を決める。
 * 全員 CPU で1巡すると `(420 + 620 + 260×3) × 4 ≈ 7.3秒`。
 */
export const DELAYS: Delays = {
  draw: 420,
  discard: 620,
  declare: 900,
  skipDeclare: 0,
  claim: 260,
}

/** 高速モード（E2E 用）。演出の待ち時間だけを消し、ルール値には触れない。 */
export const NO_DELAYS: Delays = {
  draw: 0,
  discard: 0,
  declare: 0,
  skipDeclare: 0,
  claim: 0,
}

/** 役成立のトーストを表示しておく時間。 */
export const EVENT_HOLD_MS = 1600

// --- 自動進行の判断 -----------------------------------------------------------

/**
 * 人間が割り込める役。`claimWindow` 以外では空になる。
 *
 * `ai.ts` の `decideClaim` は `bestYaku` で最良の1件に絞ってしまうため、
 * 人間に選ばせる用途には使えない。`findYaku` を直接呼ぶ。
 */
export function claimableFor(
  game: GameState,
  rules: RulesConfig,
  playerId: PlayerId,
): YakuCandidate[] {
  if (game.phase !== 'claimWindow' || game.lastDiscard === null) {
    return []
  }
  if (game.claims[playerId] !== null) {
    return []
  }

  const hand = game.players[playerId].hand
  return findYaku([...hand, game.lastDiscard], yakuContextOf(game, rules), game.lastDiscard)
}

/** 人間が宣言できる役（ツモ）。`selfDeclare` で宣言権を持つとき以外は空。 */
export function declarableFor(
  game: GameState,
  rules: RulesConfig,
  playerId: PlayerId,
): YakuCandidate[] {
  if (game.phase !== 'selfDeclare' || game.declarer !== playerId) {
    return []
  }
  return findYaku(game.players[playerId].hand, yakuContextOf(game, rules))
}

/**
 * `claimWindow` で次に処理すべき CPU を返す。
 *
 * **人間を飛ばして CPU を先に処理するのが要点。** `claims` のキーは `PlayerId`（数値）で、
 * `Object.entries` は整数キーを昇順で返すため、素朴に「最初の未表明者」を採ると
 * 既定の人間席（0番）が常に先に来てしまい、人間が決めるまで CPU の意思表示が発行されない。
 */
function pendingCpuClaimIds(game: GameState, humanSeat: PlayerId): PlayerId[] {
  return Object.keys(game.claims)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((id) => id !== humanSeat && game.claims[id] === null)
}

function nextPendingCpu(game: GameState, humanSeat: PlayerId): PlayerId | null {
  return pendingCpuClaimIds(game, humanSeat)[0] ?? null
}

/**
 * まだ意思表示していない CPU の数。
 *
 * 「CPU は人間の入力を待たない」という性質を画面から観測できるようにするために公開している
 * （`claims` の内部構造の知識を画面側に持たせない）。
 */
export function countPendingCpuClaims(game: GameState, humanSeat: PlayerId): number {
  return pendingCpuClaimIds(game, humanSeat).length
}

/**
 * 次に自動で進めるべき1手を決める。`null` なら人間の入力待ち。
 *
 * 対象プレイヤーはフェーズによって異なる。`selfDeclare` は宣言権者（`declarer`）、
 * `draw` / `discard` は手番（`turn`）。ロンによる連続宣言中は両者が食い違うため、
 * ここを取り違えると誤ったプレイヤーを操作してしまう。
 */
export function decideAutoAction(
  game: GameState,
  rules: RulesConfig,
  ai: AiConfig,
  humanSeat: PlayerId,
  delays: Delays = DELAYS,
): AutoStep | null {
  switch (game.phase) {
    case 'gameOver':
      return null

    // 引くのは選択ではないので、人間の手番でも自動で行う。
    case 'draw':
      return { action: { type: 'DRAW' }, delayMs: delays.draw }

    case 'selfDeclare': {
      const declarer = game.declarer

      if (declarer === humanSeat) {
        // 役が0件のときに「見送る」を押させるのは無意味な操作なので自動で通過する。
        const candidates = declarableFor(game, rules, humanSeat)
        return candidates.length === 0
          ? { action: { type: 'SKIP_DECLARE' }, delayMs: delays.skipDeclare }
          : null
      }

      const candidate = decideDeclare(toAiView(game, declarer, rules))
      return candidate === null
        ? { action: { type: 'SKIP_DECLARE' }, delayMs: delays.skipDeclare }
        : { action: { type: 'DECLARE', playerId: declarer, candidate }, delayMs: delays.declare }
    }

    case 'discard': {
      if (game.turn === humanSeat) {
        return null
      }
      const card = chooseDiscard(toAiView(game, game.turn, rules), ai)
      return { action: { type: 'DISCARD', uid: card.uid }, delayMs: delays.discard }
    }

    case 'claimWindow': {
      const discard = game.lastDiscard
      if (discard === null) {
        return null
      }

      // CPU を先に処理し切る。人間が考えている間も他家の判断を進めるため。
      const cpu = nextPendingCpu(game, humanSeat)
      if (cpu !== null) {
        const candidate = decideClaim(toAiView(game, cpu, rules), discard)
        return candidate === null
          ? { action: { type: 'PASS', playerId: cpu }, delayMs: delays.claim }
          : { action: { type: 'CLAIM', playerId: cpu, candidate }, delayMs: delays.claim }
      }

      // 残りは人間だけ。割り込める役がなければ待たせる意味がないので自動でパスする
      // （`selfDeclare` で役がないときに自動通過させるのと同じ理由）。
      if (game.claims[humanSeat] !== null) {
        return null
      }
      return claimableFor(game, rules, humanSeat).length === 0
        ? { action: { type: 'PASS', playerId: humanSeat }, delayMs: delays.claim }
        : null
    }

    default: {
      const exhaustive: never = game.phase
      throw new Error(`未知のフェーズです: ${String(exhaustive)}`)
    }
  }
}

/**
 * 決定したアクションの同一性を表す文字列。
 *
 * 自動進行の `useEffect` はこれを依存に取る。`GameState` を丸ごと依存にすると、
 * **別の効果が状態を変えるたびに予約中のタイマーが破棄・再予約される**。
 * 例えば受付時間の経過処理が状態を変えると、CPU の割り込み判断のために予約した
 * タイマーが発火前に毎回キャンセルされ、CPU が永久にロンできなくなる。
 *
 * 決定が実質的に変わったときだけキーが変わるようにして、この競合を構造的に防ぐ。
 */
export function autoActionKey(game: GameState, action: Action): string {
  const head = `${game.phase}:${game.turn}:${game.declarer}:${action.type}`

  switch (action.type) {
    case 'DISCARD':
      return `${head}:${action.uid}`
    case 'DECLARE':
    case 'CLAIM':
      return `${head}:${action.playerId}:${candidateKey(action.candidate)}`
    case 'PASS':
      return `${head}:${action.playerId}`

    // パラメータを持たないアクション。head だけで同一性を表せる。
    case 'DRAW':
    case 'SKIP_DECLARE':
    case 'TICK':
      return head

    default: {
      // 新しい Action 種別を足したときに、ここの更新漏れをコンパイル時に検出する。
      // 取りこぼすと「決定の同一性」が粗くなり、タイマー競合が別の形で再発する。
      const exhaustive: never = action
      throw new Error(`未知のアクション種別です: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function candidateKey(candidate: YakuCandidate): string {
  const uids = candidate.cards
    .map((card) => card.uid)
    .sort((a, b) => a - b)
    .join('-')

  return `${candidate.kind}:${candidate.sameColor ? 'same' : 'mixed'}:${uids}`
}
