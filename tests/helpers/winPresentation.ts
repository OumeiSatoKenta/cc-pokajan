import { hand } from './cards'
import type { PlayerId } from '../../src/engine/types'
import type { WinPresentation } from '../../src/ui/hooks/loopReducer'

/**
 * 和了演出テストの共通の土台。
 *
 * 3つのテストファイル（`winOverlay` / `winCutIn` / `winResult`）が同じ和了を
 * 使うため1箇所にまとめる。写しにすると、点数の前後関係を片方だけ直したときに
 * 「同じ和了のはずなのに獲得点が違う」テストができあがる。
 */

export const SEAT_LABELS: ReadonlyMap<PlayerId, string> = new Map([
  [0, 'あなた'],
  [1, '下家'],
  [2, '対面'],
  [3, '上家'],
])

/** 名前・画像・記号を持たない場合の既定。 */
export const EMPTY_MAP: ReadonlyMap<string, string> = new Map()

/** 上家(3) が あなた(0) から 120 を取る混色の3カード。 */
export function win(overrides: Partial<WinPresentation> = {}): WinPresentation {
  return {
    playerId: 3,
    candidate: {
      kind: 'triple',
      sameColor: false,
      cards: hand('a1:pink a1:blue a1:orange'),
      bonusCount: 0,
      score: 120,
    },
    winKind: 'ron',
    scoresBefore: [1000, 1000, 1000, 1000],
    scoresAfter: [880, 1000, 1000, 1120],
    ...overrides,
  }
}

/** 同色の3カード（大物手）。点数は既定ルールの `triple.sameColor`。 */
export function sameColorWin(overrides: Partial<WinPresentation> = {}): WinPresentation {
  return win({
    candidate: {
      kind: 'triple',
      sameColor: true,
      cards: hand('a1:pink a1:pink a1:pink'),
      bonusCount: 0,
      score: 840,
    },
    scoresBefore: [1000, 1000, 1000, 1000],
    scoresAfter: [160, 1000, 1000, 1840],
    ...overrides,
  })
}
