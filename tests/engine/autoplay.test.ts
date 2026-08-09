import { beforeAll, describe, expect, it } from 'vitest'
import { playGameToEnd, summarizeAutoplay, type AutoplaySummary } from '../../src/engine/autoplay'
import { expectedHandSize } from '../../src/engine/game'
import { AI_PRESETS } from '../../src/engine/ai'
import { DEFAULT_RULES } from '../../src/config/rules'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { allCardUids, totalScore } from '../helpers/game'
import type { GameState } from '../../src/engine/types'

const SEEDS = Array.from({ length: 100 }, (_, index) => index)
const EXPECTED_TOTAL = DEFAULT_RULES.startingScore * DEFAULT_RULES.playerCount

describe('自動対局', () => {
  it('1局が例外なく終局する', () => {
    const result = playGameToEnd({ roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seed: 1 })

    expect(result.finalState.phase).toBe('gameOver')
    expect(['wallEmpty', 'bankrupt']).toContain(result.reason)
    expect(result.ranking).toHaveLength(DEFAULT_RULES.playerCount)
    expect(result.discardCount).toBeGreaterThan(0)
  })

  it('同一シードなら完全に同じ結果になる', () => {
    const options = { roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seed: 99 }
    const a = playGameToEnd(options)
    const b = playGameToEnd(options)

    expect(a.finalScores).toEqual(b.finalScores)
    expect(a.steps).toBe(b.steps)
    expect(a.reason).toBe(b.reason)
  })

  it('進行が止まったら握りつぶさず例外にする', () => {
    expect(() =>
      playGameToEnd({ roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seed: 1, maxSteps: 5 }),
    ).toThrow(/5 ステップ以内に終了しませんでした/)
  })

  it('シードを変えた100局がすべて例外なく完走する', () => {
    for (const seed of SEEDS) {
      const result = playGameToEnd({ roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seed })

      expect(result.finalState.phase).toBe('gameOver')
      expect(result.ranking).toHaveLength(DEFAULT_RULES.playerCount)
    }
  })
})

describe('対局を通じての不変条件', () => {
  /**
   * 100局のすべてのステップで不変条件を検査する。
   *
   * 手札枚数だけを見るテストではカードの湧き出し・消失を検出できないため、
   * uid の一意性と総枚数（カード保存則）を最重要の検査項目にしている。
   */
  it('100局の全ステップで点数保存則・カード保存則・手札枚数が成立する', () => {
    for (const seed of SEEDS) {
      let previousWallSize = Number.POSITIVE_INFINITY

      const check = (state: GameState): void => {
        // 点数保存則: 誰かが失った点は必ず誰かが得ている
        expect(totalScore(state)).toBe(EXPECTED_TOTAL)
        for (const player of state.players) {
          expect(player.score).toBeGreaterThanOrEqual(0)
        }

        // カード保存則: 山札 + 手札 + 河 + 成立済みの役 = 常に山札サイズ、uid は一意
        const uids = allCardUids(state)
        expect(uids).toHaveLength(DEFAULT_RULES.deckSize)
        expect(new Set(uids).size).toBe(DEFAULT_RULES.deckSize)

        // 山札は増えない
        expect(state.wall.length).toBeLessThanOrEqual(previousWallSize)
        previousWallSize = state.wall.length

        // 過渡フェーズのまま外部に返らない
        expect(state.phase).not.toBe('resolveClaim')

        // 手札枚数。山札が尽きて補充しきれなかった終局時だけは例外
        if (state.phase !== 'gameOver') {
          for (const player of state.players) {
            expect(player.hand).toHaveLength(expectedHandSize(state, player.id, DEFAULT_RULES))
          }
        }
      }

      const result = playGameToEnd({
        roster: DEFAULT_ROSTER,
        rules: DEFAULT_RULES,
        seed,
        onStep: check,
      })

      expect(result.finalState.phase).toBe('gameOver')
    }
  })

  it('順位は最終点数の降順になっている', () => {
    for (const seed of SEEDS.slice(0, 20)) {
      const result = playGameToEnd({ roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seed })
      const scores = result.ranking.map((playerId) => result.finalScores[playerId])

      for (let index = 1; index < scores.length; index++) {
        expect(scores[index - 1]).toBeGreaterThanOrEqual(scores[index])
      }
    }
  })
})

describe('統計回帰', () => {
  /**
   * 実測値を基準にした回帰テスト。
   *
   * 目的は「実機の再現度の証明」ではなく **AI やルールを変更したときに分布が壊れたことの検知**。
   * 計画書が挙げる実機の実測値（山切れ終了率 69.7% / 平均35打牌）とは乖離があり、
   * その理由と扱いは design.md の「統計回帰テストの方針」に記載している。
   */
  // 100局の実行は describe 直下（収集フェーズ）ではなく beforeAll で行う。
  let summary: AutoplaySummary

  beforeAll(() => {
    summary = summarizeAutoplay({ roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seeds: SEEDS })
  })

  it('100局すべてが2つの終了理由のいずれかで終わる', () => {
    expect(summary.games).toBe(100)
    expect(summary.byReason.wallEmpty + summary.byReason.bankrupt).toBe(100)
  })

  it('終了理由の内訳が実測レンジに収まる（実測 40% 山切れ）', () => {
    expect(summary.wallEmptyRatio).toBeGreaterThan(0.25)
    expect(summary.wallEmptyRatio).toBeLessThan(0.55)
  })

  it('平均打牌数が実測レンジに収まる（実測 21.7）', () => {
    expect(summary.averageDiscards).toBeGreaterThan(17)
    expect(summary.averageDiscards).toBeLessThan(27)
  })

  it('平均宣言回数とロン回数が実測レンジに収まる（実測 13.6 / 6.5）', () => {
    expect(summary.averageDeclares).toBeGreaterThan(10)
    expect(summary.averageDeclares).toBeLessThan(17)
    expect(summary.averageRons).toBeGreaterThan(4)
    expect(summary.averageRons).toBeLessThan(9)
  })

  it('初期点を上げると山切れ終了が増える（破産が終局の主因であることの確認）', () => {
    const richer = summarizeAutoplay({
      roster: DEFAULT_ROSTER,
      rules: { ...DEFAULT_RULES, startingScore: 2000 },
      seeds: SEEDS,
    })

    expect(richer.wallEmptyRatio).toBeGreaterThan(summary.wallEmptyRatio)
  })

  it('どの難易度プリセットでも100局が完走する', () => {
    for (const ai of Object.values(AI_PRESETS)) {
      const result = summarizeAutoplay({
        roster: DEFAULT_ROSTER,
        rules: DEFAULT_RULES,
        seeds: SEEDS.slice(0, 30),
        ai,
      })

      expect(result.games).toBe(30)
      expect(result.averageDiscards).toBeGreaterThan(0)
    }
  })
})
