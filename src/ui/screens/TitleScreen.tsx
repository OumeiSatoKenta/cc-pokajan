import '../casino.css'

export interface TitleScreenProps {
  readonly wallet: number
  readonly onPlay: () => void
  readonly onOpenRoster: () => void
  readonly onOpenRules: () => void
  readonly onOpenPlayers: () => void
}

/** タイトル画面。所持コインを見せ、対局への入口を1つだけ置く。 */
export function TitleScreen({
  wallet,
  onPlay,
  onOpenRoster,
  onOpenRules,
  onOpenPlayers,
}: TitleScreenProps) {
  return (
    <main className="casino" data-testid="title-screen">
      <section className="casino__panel">
        <p className="casino__lead">1人 + CPU3人で対局し、順位に応じてコインを増やす。</p>

        <dl className="casino__wallet">
          <dt>所持コイン</dt>
          <dd data-testid="wallet">{wallet.toLocaleString('ja-JP')}</dd>
        </dl>

        <button
          type="button"
          className="button button--primary casino__cta"
          onClick={onPlay}
          data-testid="play-button"
        >
          遊ぶ
        </button>

        <div className="casino__sub-actions">
          <button
            type="button"
            className="button"
            onClick={onOpenRoster}
            data-testid="open-roster-button"
          >
            ロスター設定
          </button>
          <button
            type="button"
            className="button"
            onClick={onOpenPlayers}
            data-testid="open-players-button"
          >
            プレイヤー設定
          </button>
          <button
            type="button"
            className="button"
            onClick={onOpenRules}
            data-testid="open-rules-button"
          >
            ルール設定
          </button>
        </div>

        <p className="casino__note">
          自分たちの写真とチーム構成を設定して、
          <br />
          そのチームならではの対局にできます。
        </p>
      </section>
    </main>
  )
}
