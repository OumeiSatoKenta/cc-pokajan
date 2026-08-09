/**
 * 画面遷移と所持コインの純粋ロジック。
 *
 * `createLoopReducer` と同じく `rules` を束縛したファクトリにする。
 * 精算計算に `rules` が要るため、素の `useReducer` では毎回引数を持ち回ることになる。
 *
 * **BET の充足判定と補充の条件はここで検査する。** 画面側のボタン無効化は
 * 見た目の話であって、状態の正しさを保証しない。
 */

import { canAfford, computePayout, rankOf, type PayoutBreakdown } from '../engine/payout'
import type { PlayerId, RulesConfig } from '../engine/types'

export type Screen = 'title' | 'bet' | 'table' | 'result' | 'roster' | 'rules' | 'players'

/** 1局分の結果。精算の内訳に、順位表示に必要な情報を添えたもの。 */
export interface Outcome {
  readonly payout: PayoutBreakdown
  readonly ranking: readonly PlayerId[]
  readonly scores: readonly number[]
  readonly humanSeat: PlayerId
  /** 精算前の所持コイン（BET を引いた後の額）。 */
  readonly walletBefore: number
  readonly walletAfter: number
}

export interface AppState {
  readonly screen: Screen
  readonly wallet: number
  /** 次に始める対局のシード。精算のたびに +1 する。 */
  readonly seed: number
  /** 進行中の対局の BET 額。対局していなければ `null`。 */
  readonly bet: number | null
  readonly outcome: Outcome | null
}

export type AppAction =
  | { readonly type: 'GO_BET' }
  | { readonly type: 'GO_TITLE' }
  | { readonly type: 'GO_SETTINGS'; readonly screen: 'roster' | 'rules' | 'players' }
  | { readonly type: 'PLACE_BET'; readonly amount: number }
  | {
      readonly type: 'FINISH'
      readonly ranking: readonly PlayerId[]
      readonly scores: readonly number[]
      readonly humanSeat: PlayerId
    }
  | { readonly type: 'TOP_UP' }

export interface CreateAppStateOptions {
  readonly wallet: number
  readonly seed: number
}

export function createInitialAppState(options: CreateAppStateOptions): AppState {
  return {
    screen: 'title',
    wallet: options.wallet,
    seed: options.seed,
    bet: null,
    outcome: null,
  }
}

/** 出せる BET の最小額。これを下回ると1局も始められない。 */
export function minimumBet(rules: RulesConfig): number {
  return Math.min(...rules.bet.options)
}

/** 補充の導線を出すべきか。**どの BET も出せないときだけ**。 */
export function needsTopUp(wallet: number, rules: RulesConfig): boolean {
  return wallet < minimumBet(rules)
}

export function createAppReducer(
  rules: RulesConfig,
): (state: AppState, action: AppAction) => AppState {
  return (state, action) => {
    switch (action.type) {
      case 'GO_BET':
        return { ...state, screen: 'bet', bet: null, outcome: null }

      case 'GO_TITLE':
        return { ...state, screen: 'title', bet: null, outcome: null }

      case 'GO_SETTINGS':
        // 設定はタイトルからしか開けない。対局中に入れると、進行中の対局と
        // 保存されたルールが食い違ったまま精算まで進んでしまう。
        if (state.screen !== 'title') {
          return state
        }
        return { ...state, screen: action.screen }

      case 'PLACE_BET': {
        // 出せない BET は受け付けない。画面の無効化だけに頼らない。
        if (!rules.bet.options.includes(action.amount) || !canAfford(state.wallet, action.amount)) {
          return state
        }

        // **BET はこの時点で引く。** 精算時にまとめて差額を足す方式だと、
        // 対局を中断してタブを閉じるだけで負けを帳消しにできてしまう。
        return {
          ...state,
          screen: 'table',
          wallet: state.wallet - action.amount,
          bet: action.amount,
          outcome: null,
        }
      }

      case 'FINISH': {
        const bet = state.bet
        if (bet === null || state.screen !== 'table') {
          // BET を経由していない対局は精算しない。
          return state
        }

        const rank = rankOf(action.ranking, action.humanSeat)
        const finalScore = action.scores[action.humanSeat] ?? 0
        const payout = computePayout(finalScore, bet, rank, rules)
        const walletAfter = state.wallet + payout.gross

        return {
          screen: 'result',
          // シードを進めるのはここだけ。GO_BET で進めると、タイトルから
          // 初回に入るだけで URL 指定のシードがずれる。
          seed: state.seed + 1,
          wallet: walletAfter,
          bet: null,
          outcome: {
            payout,
            ranking: action.ranking,
            scores: action.scores,
            humanSeat: action.humanSeat,
            walletBefore: state.wallet,
            walletAfter,
          },
        }
      }

      case 'TOP_UP':
        // 足りているうちは補充させない（無制限に増やせてしまう）。
        if (!needsTopUp(state.wallet, rules)) {
          return state
        }
        return { ...state, wallet: rules.bet.initialWallet }

      default: {
        const exhaustive: never = action
        throw new Error(`未知の画面アクションです: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
}
