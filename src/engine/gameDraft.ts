/**
 * リデューサ内部の可変な作業領域（Draft）と、その不変条件ガード。
 *
 * `GameState` は全フィールドが `readonly` なので、進行処理のたびに深いコピーを積み上げると
 * 読みにくくなる。そこで「入口で複製 → 内部では素直に書き換え → 出口で不変な状態を組み直す」
 * という形にし、`reduce` が入力を破壊しない契約を構造で守る。
 */

import { IllegalActionError } from './errors'
import type { Card, ClaimDecision, GameState, Phase, Player, PlayerId } from './types'

/** `readonly` を外した型。`Draft` を `GameState` から導出するために使う。 */
type Writable<T> = { -readonly [K in keyof T]: T[K] }

/** 可変な `Player`。配列も書き換えられるようにする。 */
export interface DraftPlayer extends Writable<Omit<Player, 'hand' | 'discards' | 'declared'>> {
  hand: Card[]
  discards: Card[]
  declared: Player['declared'][number][]
}

/**
 * 進行中の可変状態。
 *
 * `GameState` から導出しているので、`GameState` にフィールドを足したのに `toDraft` を
 * 更新し忘れると**コンパイルエラーになる**。手書きの独立した型にすると、この取りこぼしが
 * 静かに通ってしまう。
 *
 * `phase` だけは `GameState` より広い `Phase`（過渡フェーズ `resolveClaim` を含む）を持つ。
 * 過渡フェーズを通過できるのはリデューサ内部だけ、という区別を型で表している。
 */
export interface Draft extends Writable<
  Omit<
    GameState,
    | 'phase'
    | 'players'
    | 'claims'
    | 'activeGroups'
    | 'activeMembers'
    | 'bonusMemberIds'
    | 'seed'
    | 'rngState'
  >
> {
  phase: Phase
  players: DraftPlayer[]
  claims: Partial<Record<PlayerId, ClaimDecision>>
}

/** 入力状態を壊さないよう、書き換える可能性のある配列をすべて複製する。 */
export function toDraft(state: GameState): Draft {
  return {
    phase: state.phase,
    turn: state.turn,
    declarer: state.declarer,
    players: state.players.map((player) => ({
      id: player.id,
      isCpu: player.isCpu,
      hand: [...player.hand],
      score: player.score,
      discards: [...player.discards],
      declared: [...player.declared],
    })),
    wall: [...state.wall],
    lastDiscard: state.lastDiscard,
    lastDiscardBy: state.lastDiscardBy,
    claims: { ...state.claims },
    claimTimerMs: state.claimTimerMs,
    chainCount: state.chainCount,
  }
}

/**
 * 進行結果から新しい不変状態を組み立てる。
 *
 * 過渡フェーズのまま外部へ返そうとしたら内部不変条件の違反なので、ここで検出する。
 * これにより `GameState.phase` が `resolveClaim` を含まないことを型と実行時の両方で保証できる。
 */
export function fromDraft(state: GameState, draft: Draft): GameState {
  if (draft.phase === 'resolveClaim') {
    throw new Error('内部エラー: 過渡フェーズ resolveClaim のまま状態を返そうとしました')
  }

  return {
    phase: draft.phase,
    turn: draft.turn,
    declarer: draft.declarer,
    players: draft.players,
    wall: draft.wall,
    activeGroups: state.activeGroups,
    activeMembers: state.activeMembers,
    bonusMemberIds: state.bonusMemberIds,
    lastDiscard: draft.lastDiscard,
    lastDiscardBy: draft.lastDiscardBy,
    claims: draft.claims,
    claimTimerMs: draft.claimTimerMs,
    chainCount: draft.chainCount,
    seed: state.seed,
    // 進行に乱数を使わないため対局中は変化しない。将来乱数を要するルールを足したときに
    // ここから続きを再開できるよう保持している。
    rngState: state.rngState,
  }
}

export function requirePhase(draft: Draft, expected: Phase, actionType: string): void {
  if (draft.phase !== expected) {
    throw new IllegalActionError(
      `${actionType} は ${expected} フェーズでのみ受け付けますが、現在は ${draft.phase} です`,
    )
  }
}

export function requirePlayer(draft: Draft, playerId: PlayerId, label: string): void {
  if (!Number.isInteger(playerId) || playerId < 0 || playerId >= draft.players.length) {
    throw new IllegalActionError(
      `${label} は 0〜${draft.players.length - 1} の整数である必要がありますが ${playerId} でした`,
    )
  }
}

/**
 * 捨て札を出したプレイヤーを取り出す。
 *
 * ロン成立の経路では必ず記録済みだが、その前提を `as PlayerId` のキャストで表すと
 * 前提が崩れたときに `undefined` 添字という分かりにくい壊れ方をする。
 * 実行時に確かめて、他の検証と同じ形で表面化させる。
 */
export function requireDiscarder(draft: Draft): PlayerId {
  if (draft.lastDiscardBy === null) {
    throw new IllegalActionError('捨て札を出したプレイヤーが記録されていません')
  }
  return draft.lastDiscardBy
}

/** 割り込みの意思表示を取り出す。対象外のプレイヤーと未表明を区別する。 */
export function claimDecisionOf(draft: Draft, playerId: PlayerId): ClaimDecision {
  const decision = draft.claims[playerId]

  if (decision === undefined) {
    throw new IllegalActionError(`プレイヤー${playerId}は今回の割り込み受付の対象ではありません`)
  }
  return decision
}

/** 山札の先頭から最大 `count` 枚を取り出す。残りが足りなければ取れるだけ返す。 */
export function takeFromWall(draft: Draft, count: number): Card[] {
  const taken = draft.wall.slice(0, count)
  draft.wall = draft.wall.slice(taken.length)
  return taken
}
