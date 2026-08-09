/**
 * 演出の可変値。
 *
 * **`RulesConfig` には入れない。** ルール値はエンジンが受け取って対局の結果を左右するが、
 * ここにあるのは「どう見せるか」だけで、エンジンは知る必要がない。
 * 混ぜると、演出を変えただけで対局の再現性（初期シード + アクション列）に
 * 関係があるように見えてしまう。
 */

import type { YakuCandidate } from '../engine/types'

/** 和了演出の段ごとの滞留時間。 */
export interface WinTiming {
  /** カットイン段の長さ。 */
  readonly cutInMs: number
  /** 点数獲得結果の段の長さ。この後に自動で閉じる。 */
  readonly resultMs: number
}

/**
 * 既定の長さ。合計 3.7 秒で自動的に閉じる。
 *
 * 連続宣言は最大8回（`maxChainDeclare`）まで起こりうるため、
 * 1回あたりを長くすると「何もできない時間」が積み上がる。
 * いつでもクリックで飛ばせることと合わせてこの長さにしている。
 */
export const WIN_TIMING: WinTiming = { cutInMs: 1_200, resultMs: 2_500 }

/**
 * 演出の待ち時間を消す。E2E 用で、ルール値には影響しない。
 * `autoAction.ts` の `NO_DELAYS` と同じ扱い。
 */
export const NO_WIN_TIMING: WinTiming = { cutInMs: 0, resultMs: 0 }

/**
 * 大物手の演出に切り替える条件。**同色役かどうかで決める。**
 *
 * 点数の閾値を置かないのは、置いた瞬間に「480点は大物手か」を
 * `rules.scores` を変えるたびに決め直すことになるため。同色役はルールの構造そのもので、
 * 点数を変えても意味が変わらない。
 *
 * 帰結として **5人組（480点）は通常演出**、**3カード同色（840点）は大物手**になる。
 * 点数の大小と演出の大小が一致しない場合があることは承知のうえでの選択。
 *
 * 1行の関数として切り出すのは、**この判断がどこにあるかを1箇所にする**ため。
 * 呼び出し側に `candidate.sameColor` と書くと、条件を変えるときに探すことになる。
 */
export function isBigWin(candidate: YakuCandidate): boolean {
  return candidate.sameColor
}
