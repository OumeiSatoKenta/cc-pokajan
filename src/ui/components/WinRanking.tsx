import { useEffect, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import { computeRanking } from '../../engine/game'
import type { PlayerId } from '../../engine/types'

export interface WinRankingProps {
  readonly scoresBefore: readonly number[]
  readonly scoresAfter: readonly number[]
  readonly seatLabels: ReadonlyMap<PlayerId, string>
  /** 和了したプレイヤー。強調して見せる。 */
  readonly winnerId: PlayerId
}

/**
 * 和了による順位の移動。
 *
 * **順位の算出は `computeRanking`（エンジン）を使う。** 対局中の順位には
 * エンジン側の対応物がないが、ここで並べ替えを書くと同点の扱いが2箇所に散り、
 * 「演出の順位と精算の順位が違う」というもっとも分かりにくい不一致が起こりうる。
 *
 * 和了**前**の順で描いてから和了**後**の順へ動かす。順位が変わらない和了では
 * 何も動かないが、それが正しい（点数の増減だけが出る）。
 */
export function WinRanking({ scoresBefore, scoresAfter, seatLabels, winnerId }: WinRankingProps) {
  const reduced = useReducedMotion() === true

  /*
   * **初期値で「視覚効果を減らす」を吸収する。** マウント後に切り替える形にすると、
   * アニメーションが無い環境では「一瞬だけ和了前の順位が見えて、次の描画で入れ替わる」
   * というちらつきになる。減らす設定では最初から結果を出す。
   */
  const [showAfter, setShowAfter] = useState(reduced)

  useEffect(() => {
    if (reduced) {
      return
    }
    // 1フレーム待たずに即座に立てても、React が2回の描画に分けるため動きは出る。
    const timer = setTimeout(() => setShowAfter(true), 260)
    return () => clearTimeout(timer)
  }, [reduced])

  const order = computeRanking(toPlayers(showAfter ? scoresAfter : scoresBefore))

  return (
    <ol
      className="win-rank"
      data-testid="win-ranking"
      data-phase={showAfter ? 'after' : 'before'}
      data-reduced={reduced}
    >
      {order.map((playerId, index) => {
        const before = scoresBefore[playerId] ?? 0
        const after = scoresAfter[playerId] ?? 0
        const delta = after - before

        return (
          <motion.li
            // **人に紐づける。** 順位を key にすると「並べ替え」ではなく
            // 「中身が入れ替わっただけ」になり、位置が補間されない。
            key={playerId}
            layout={!reduced}
            transition={{ duration: reduced ? 0 : 0.42, ease: 'easeInOut' }}
            className={playerId === winnerId ? 'win-rank__row win-rank__row--win' : 'win-rank__row'}
            data-testid="win-rank-row"
            data-player={playerId}
          >
            <span className="win-rank__no">{index + 1}位</span>
            <span className="win-rank__name">{seatLabels.get(playerId) ?? `P${playerId}`}</span>
            <span className="win-rank__score">
              {(showAfter ? after : before).toLocaleString('ja-JP')}
            </span>
            {/*
              増減は**前後の点数の差**から出す。支払い明細を集計して出すと、
              集計の書き方1つで隣に並んでいる点数とずれる余地が残る。
            */}
            {delta !== 0 && (
              <span
                className={delta > 0 ? 'win-rank__delta win-rank__delta--up' : 'win-rank__delta'}
                data-testid="win-rank-delta"
              >
                {delta > 0 ? '+' : '−'}
                {Math.abs(delta).toLocaleString('ja-JP')}
              </span>
            )}
          </motion.li>
        )
      })}
    </ol>
  )
}

/** `computeRanking` が要るのは `id` と `score` だけ。 */
function toPlayers(scores: readonly number[]): { id: PlayerId; score: number }[] {
  return scores.map((score, id) => ({ id, score }))
}
