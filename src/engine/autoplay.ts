/**
 * 全員 CPU で1局を最後まで回すヘルパ。
 *
 * 主な用途はテストで、「ゲームとして成立していること」を自動対局で証明するための土台。
 * Step 4 以降ではデモ再生にも使える。
 */

import { createGame, reduce, type ReduceResult } from './game'
import { chooseDiscard, decideClaim, decideDeclare, toAiView, DEFAULT_AI_CONFIG } from './ai'
import type { AiConfig } from './ai'
import type {
  Action,
  GameEvent,
  GameOverReason,
  GameState,
  PlayerId,
  Roster,
  RulesConfig,
} from './types'

export interface AutoplayOptions {
  readonly roster: Roster
  readonly rules: RulesConfig
  readonly seed: number
  readonly ai?: AiConfig
  /**
   * 進行が止まらない場合に打ち切る上限。既定値は「山札の枚数 × 十分な係数」。
   * 超過は握りつぶさず例外にする（無限ループはバグであり、成功として報告してはいけない）。
   */
  readonly maxSteps?: number
  /** 各ステップ後に呼ばれる。テストが全ステップで不変条件を検査するために使う。 */
  readonly onStep?: (state: GameState, action: Action, events: readonly GameEvent[]) => void
}

export interface AutoplayResult {
  readonly seed: number
  readonly reason: GameOverReason
  readonly finalScores: readonly number[]
  readonly ranking: readonly PlayerId[]
  /** 打牌数（`DISCARD` の回数）。 */
  readonly discardCount: number
  /** 宣言回数（ツモ + ロン）。 */
  readonly declareCount: number
  /** 宣言回数のうちロンだった回数。 */
  readonly ronCount: number
  /** `reduce` を呼んだ回数。 */
  readonly steps: number
  readonly finalState: GameState
}

/**
 * 打牌1回あたりに山札とは無関係に必要なステップ数の見積もり。
 * `DRAW` + 宣言の判断 + `DISCARD` + 割り込み解決の余裕分。
 */
const STEPS_PER_DISCARD_OVERHEAD = 6

/**
 * 進行が止まったと判断するまでのステップ数を見積もる。
 *
 * 捨て札1回につき手番以外の全員が `CLAIM` / `PASS` を送るため、必要なステップ数は
 * プレイヤー数に比例して増える。人数を係数に含めないと、Step 6 で人数を増やしたときに
 * 正常に終局する対局まで「無限ループ」と誤検知してしまう。
 */
function defaultMaxSteps(rules: RulesConfig): number {
  return rules.deckSize * (rules.playerCount + STEPS_PER_DISCARD_OVERHEAD)
}

/**
 * 現在のフェーズに対して CPU が取るべきアクションを1つ決める。
 *
 * `claimWindow` では未表明のプレイヤーを1人ずつ処理する。CPU は即決するため `TICK` は使わない
 * （`TICK` による時間切れ経路は `game.test.ts` で個別に検証する）。
 */
function nextAction(state: GameState, rules: RulesConfig, ai: AiConfig): Action {
  switch (state.phase) {
    case 'draw':
      return { type: 'DRAW' }

    case 'selfDeclare': {
      const view = toAiView(state, state.declarer, rules)
      const candidate = decideDeclare(view)

      if (candidate === null) {
        return { type: 'SKIP_DECLARE' }
      }
      return { type: 'DECLARE', playerId: state.declarer, candidate }
    }

    case 'discard': {
      const view = toAiView(state, state.turn, rules)
      return { type: 'DISCARD', uid: chooseDiscard(view, ai).uid }
    }

    case 'claimWindow': {
      const discard = state.lastDiscard
      if (discard === null) {
        throw new Error('claimWindow なのに捨て札がありません')
      }

      const pending = Object.entries(state.claims).find(([, decision]) => decision === null)
      if (pending === undefined) {
        throw new Error('claimWindow なのに未表明のプレイヤーがいません')
      }

      const playerId = Number(pending[0])
      const view = toAiView(state, playerId, rules)
      const candidate = decideClaim(view, discard)

      if (candidate === null) {
        return { type: 'PASS', playerId }
      }
      return { type: 'CLAIM', playerId, candidate }
    }

    default:
      throw new Error(`フェーズ ${state.phase} に対する CPU のアクションがありません`)
  }
}

/** 全員 CPU で1局を最後まで進め、統計を返す。 */
export function playGameToEnd(options: AutoplayOptions): AutoplayResult {
  const { roster, rules, seed } = options
  const ai = options.ai ?? DEFAULT_AI_CONFIG
  const maxSteps = options.maxSteps ?? defaultMaxSteps(rules)

  let state = createGame(roster, rules, seed, { humanSeats: [] })
  let steps = 0
  let discardCount = 0
  let declareCount = 0
  let ronCount = 0
  let reason: GameOverReason | null = null
  let ranking: readonly PlayerId[] = []

  while (state.phase !== 'gameOver') {
    if (steps >= maxSteps) {
      throw new Error(
        `シード ${seed} の対局が ${maxSteps} ステップ以内に終了しませんでした（フェーズ: ${state.phase}）`,
      )
    }

    const action = nextAction(state, rules, ai)
    const result: ReduceResult = reduce(state, action, rules)
    state = result.state
    steps += 1

    if (action.type === 'DISCARD') {
      discardCount += 1
    }
    for (const event of result.events) {
      if (event.type === 'Declared') {
        declareCount += 1
        if (event.winKind === 'ron') {
          ronCount += 1
        }
      }
      if (event.type === 'GameOver') {
        reason = event.reason
        ranking = event.ranking
      }
    }

    options.onStep?.(state, action, result.events)
  }

  if (reason === null) {
    throw new Error(`シード ${seed} の対局が GameOver イベントなしで終了しました`)
  }

  return {
    seed,
    reason,
    finalScores: state.players.map((player) => player.score),
    ranking,
    discardCount,
    declareCount,
    ronCount,
    steps,
    finalState: state,
  }
}

export interface AutoplaySummary {
  readonly games: number
  readonly byReason: Readonly<Record<GameOverReason, number>>
  readonly averageDiscards: number
  readonly averageDeclares: number
  readonly averageRons: number
  readonly wallEmptyRatio: number
}

/**
 * 複数のシードで対局を回し、統計をまとめる。回帰テスト用。
 *
 * `seeds` は任意の数値配列でよい（連続している必要はない）。テストでは再現性のために
 * `0..N-1` の連番を渡している。
 */
export function summarizeAutoplay(
  options: Omit<AutoplayOptions, 'seed'> & { readonly seeds: readonly number[] },
): AutoplaySummary {
  const results = options.seeds.map((seed) => playGameToEnd({ ...options, seed }))
  const byReason: Record<GameOverReason, number> = { wallEmpty: 0, bankrupt: 0 }

  for (const result of results) {
    byReason[result.reason] += 1
  }

  const total = results.length
  const sum = (pick: (result: AutoplayResult) => number): number =>
    results.reduce((acc, result) => acc + pick(result), 0)

  return {
    games: total,
    byReason,
    averageDiscards: sum((result) => result.discardCount) / total,
    averageDeclares: sum((result) => result.declareCount) / total,
    averageRons: sum((result) => result.ronCount) / total,
    wallEmptyRatio: byReason.wallEmpty / total,
  }
}
