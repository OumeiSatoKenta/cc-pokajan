export interface TableHeaderProps {
  /**
   * 今の和了チェーンで連続何回上がったか（`GameState.chainCount`）。
   * 平常時は 0 で、和了チェーン中に増える。山を引く・手番交代で 0 に戻る
   * （ロンは内部で一度 0 にした直後に +1 されるため、UI 上は 0 を経由せず 1 から見える）。
   */
  readonly chainCount: number
  /** 連続和了の上限（`rules.maxChainDeclare`）。ピップの本数になる。 */
  readonly maxChain: number
  /** この対局に賭けた額。順位倍率で精算される。 */
  readonly bet: number
}

/**
 * 卓の木縁上部のヘッダー。タイトル・連続和了・BET を出す。
 *
 * **連続和了は実データ（`chainCount`）そのもの**を出す。平常時 0/8 と表示されるのは
 * 「今チェーンが走っていない」という正しい状態で、和了を重ねるとピップが灯っていく。
 * 存在しない機能（供託・局・親・オンライン）は出さない（第1稿の差し戻し理由）。
 */
export function TableHeader({ chainCount, maxChain, bet }: TableHeaderProps) {
  // 先頭から chainCount 個を点灯。maxChain が上限なので配列長で本数が決まる。
  const pips = Array.from({ length: maxChain }, (_, i) => i < chainCount)

  return (
    <header className="table__header" data-testid="table-header">
      <div className="table__brand">
        <span className="table__title">ポカジャン</span>
        <span className="table__subtitle">CARD MAHJONG</span>
      </div>

      <div className="table__stats">
        <div className="streak" aria-label={`連続和了 ${chainCount} / ${maxChain}`}>
          <span className="streak__label">連続和了</span>
          <span className="streak__pips">
            {pips.map((lit, i) => (
              <span
                key={i}
                className={lit ? 'streak__pip streak__pip--lit' : 'streak__pip'}
                data-lit={lit}
              />
            ))}
          </span>
          <span className="streak__count" data-testid="streak-count">
            {chainCount} / {maxChain}
          </span>
        </div>

        <div className="bet">
          <span className="bet__label">BET</span>
          <span className="bet__amount" data-testid="bet-amount">
            {bet.toLocaleString('ja-JP')}
          </span>
        </div>
      </div>
    </header>
  )
}
