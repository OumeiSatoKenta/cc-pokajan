import { DEFAULT_RULES } from '../../src/config/rules'
import { card } from './cards'
import { TEST_GROUPS } from './cards'
import type {
  Card,
  ClaimDecision,
  GameState,
  Group,
  Member,
  MemberId,
  ObservablePhase,
  PlayerId,
  RulesConfig,
} from '../../src/engine/types'

/**
 * 対局状態機械テスト用のヘルパ。
 *
 * `createGame` から配牌させると手札を狙った形にできないため、テストでは
 * `GameState` を直接組み立てて特定の局面から検証する。
 */

/**
 * uid を通し番号で振るカード生成器。
 *
 * `hand()` は常に uid 0 から振り直すため、手札・山札・河を別々に作ると uid が衝突する。
 * 1つの局面で使うカードは必ず同じ生成器から作ること。
 */
export function createCardSource(): (spec: string) => Card[] {
  let nextUid = 0

  return (spec: string): Card[] =>
    spec
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0)
      .map((token) => card(token, nextUid++))
}

/** テスト用に一部の値だけ差し替えたルール。 */
export function testRules(overrides: Partial<RulesConfig> = {}): RulesConfig {
  return { ...DEFAULT_RULES, ...overrides }
}

export interface GameStateOptions {
  readonly phase?: ObservablePhase
  readonly turn?: PlayerId
  readonly declarer?: PlayerId
  readonly hands: readonly (readonly Card[])[]
  readonly wall?: readonly Card[]
  readonly scores?: readonly number[]
  readonly discards?: readonly (readonly Card[])[]
  readonly lastDiscard?: Card | null
  readonly lastDiscardBy?: PlayerId | null
  readonly claims?: Readonly<Record<PlayerId, ClaimDecision>>
  readonly claimTimerMs?: number
  readonly chainCount?: number
  readonly groups?: readonly Group[]
  readonly bonusMemberIds?: readonly MemberId[]
  readonly startingScore?: number
}

/** 指定した局面の `GameState` を組み立てる。省略した項目は素直な既定値になる。 */
export function gameState(options: GameStateOptions): GameState {
  const turn = options.turn ?? 0
  const groups = options.groups ?? [TEST_GROUPS.trio, TEST_GROUPS.quartet]
  const startingScore = options.startingScore ?? DEFAULT_RULES.startingScore

  const members: Member[] = groups
    .flatMap((group) => group.memberIds)
    .map((id) => ({ id, name: id }))

  return {
    phase: options.phase ?? 'draw',
    turn,
    declarer: options.declarer ?? turn,
    players: options.hands.map((hand, id) => ({
      id,
      isCpu: true,
      hand,
      score: options.scores?.[id] ?? startingScore,
      discards: options.discards?.[id] ?? [],
      declared: [],
    })),
    wall: options.wall ?? [],
    activeGroups: groups,
    activeMembers: members,
    bonusMemberIds: options.bonusMemberIds ?? [],
    lastDiscard: options.lastDiscard ?? null,
    lastDiscardBy: options.lastDiscardBy ?? null,
    claims: options.claims ?? {},
    claimTimerMs: options.claimTimerMs ?? 0,
    chainCount: options.chainCount ?? 0,
    seed: 12345,
    rngState: 67890,
  }
}

/** 場に存在する全カードの uid。カード保存則の検査に使う。 */
export function allCardUids(state: GameState): number[] {
  const uids: number[] = state.wall.map((c) => c.uid)

  for (const player of state.players) {
    uids.push(...player.hand.map((c) => c.uid))
    uids.push(...player.discards.map((c) => c.uid))
    for (const candidate of player.declared) {
      uids.push(...candidate.cards.map((c) => c.uid))
    }
  }

  return uids
}

/** 4人の点数の合計。点数保存則の検査に使う。 */
export function totalScore(state: GameState): number {
  return state.players.reduce((sum, player) => sum + player.score, 0)
}
