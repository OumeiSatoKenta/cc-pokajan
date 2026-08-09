import type { Outcome } from '../appReducer'
import { seatName } from '../labels'
import '../casino.css'

export interface ResultScreenProps {
  readonly outcome: Outcome
  readonly playerCount: number
  readonly onPlayAgain: () => void
  readonly onBackToTitle: () => void
}

/**
 * 精算画面。
 *
 * 対局そのものの結果（順位と点数）は `ResultOverlay` が見せ、ここは**金銭**を見せる。
 * 同じ内容を2画面に重ねて置かない。
 *
 * 内訳を並べるのは、増減の理由を追えるようにするため。精算式は
 * `engine/payout.ts` が計算した値をそのまま表示し、ここで計算し直さない。
 */
export function ResultScreen({
  outcome,
  playerCount,
  onPlayAgain,
  onBackToTitle,
}: ResultScreenProps) {
  const { payout } = outcome
  const won = payout.net > 0

  return (
    <main className="casino" data-testid="result-screen">
      <section className="casino__panel">
        <h2 className="casino__title">精算</h2>

        <p className={won ? 'result__net result__net--plus' : 'result__net'} data-testid="net">
          {won ? '+' : ''}
          {payout.net.toLocaleString('ja-JP')}
        </p>

        <p className="result__rank">
          {seatName(outcome.humanSeat, outcome.humanSeat, playerCount)}は
          <strong data-testid="my-rank">{payout.rank}位</strong>（
          {payout.finalScore.toLocaleString('ja-JP')}点）
        </p>

        <dl className="result__breakdown">
          <div>
            <dt>最終点数</dt>
            <dd>{payout.finalScore.toLocaleString('ja-JP')}</dd>
          </div>
          <div>
            <dt>BET倍率</dt>
            <dd>×{payout.betMultiplier}</dd>
          </div>
          <div>
            <dt>順位倍率</dt>
            <dd>×{payout.rankMultiplier}</dd>
          </div>
          <div>
            <dt>払い戻し</dt>
            <dd>{payout.gross.toLocaleString('ja-JP')}</dd>
          </div>
          <div>
            <dt>BET額</dt>
            <dd>−{payout.bet.toLocaleString('ja-JP')}</dd>
          </div>
        </dl>

        <dl className="casino__wallet">
          <dt>所持コイン</dt>
          <dd data-testid="wallet">{outcome.walletAfter.toLocaleString('ja-JP')}</dd>
        </dl>

        <div className="result__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={onPlayAgain}
            data-testid="play-again-button"
          >
            もう1局
          </button>
          <button type="button" className="button button--ghost" onClick={onBackToTitle}>
            タイトルへ
          </button>
        </div>
      </section>
    </main>
  )
}
