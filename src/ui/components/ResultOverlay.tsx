import type { GameOverReason, PlayerId } from '../../engine/types'
import { REASON_LABELS } from '../labels'

export interface ResultOverlayProps {
  readonly scores: readonly number[]
  readonly reason: GameOverReason | null
  readonly seatLabels: ReadonlyMap<PlayerId, string>
  readonly ranking: readonly PlayerId[]
  readonly onSettle: () => void
}

/**
 * 終局時の順位表示。
 *
 * **見せるのは「対局の結果」だけ**で、金銭は `ResultScreen` が受け持つ。
 * 同じ内容を2画面に重ねない。
 *
 * ここに「もう1局」を置かないのは、Step 5 で対局の開始が BET と不可分になったため。
 * 対局をやり直す導線が BET を経由しない場所にあると、無料で遊べてしまう。
 */
export function ResultOverlay({
  scores,
  reason,
  seatLabels,
  ranking,
  onSettle,
}: ResultOverlayProps) {
  return (
    <div
      className="overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="result-title"
      data-testid="result-overlay"
    >
      <div className="overlay__panel">
        <h2 className="overlay__title" id="result-title">
          対局終了
        </h2>
        {reason !== null && <p className="overlay__reason">{REASON_LABELS[reason]}</p>}

        <ol className="overlay__ranking">
          {ranking.map((playerId, index) => (
            <li
              key={playerId}
              className={index === 0 ? 'overlay__rank overlay__rank--top' : 'overlay__rank'}
            >
              <span className="overlay__rank-no">{index + 1}位</span>
              <span className="overlay__rank-name">{seatLabels.get(playerId) ?? playerId}</span>
              <span className="overlay__rank-score">
                {(scores[playerId] ?? 0).toLocaleString('ja-JP')}
              </span>
            </li>
          ))}
        </ol>

        <button
          type="button"
          className="button button--primary"
          onClick={onSettle}
          data-testid="settle-button"
        >
          精算へ
        </button>
      </div>
    </div>
  )
}
