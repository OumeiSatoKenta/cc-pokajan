import { canAfford } from '../../engine/payout'
import type { RulesConfig } from '../../engine/types'
import { needsTopUp } from '../appReducer'
import '../casino.css'

export interface BetScreenProps {
  readonly wallet: number
  readonly rules: RulesConfig
  readonly onPlaceBet: (amount: number) => void
  readonly onTopUp: () => void
  readonly onBack: () => void
}

/**
 * BET 選択画面。
 *
 * 所持コインが足りない BET は押せないようにする。ただし**これは見た目の防御**で、
 * 実際の可否は `appReducer` が判定する。
 *
 * どの BET も出せなくなったときだけ補充の導線を出す。これが無いと
 * 所持コインが尽きた時点で全てのボタンが押せなくなり、localStorage に
 * 残るためリロードしても回復しない（＝二度と遊べなくなる）。
 */
export function BetScreen({ wallet, rules, onPlaceBet, onTopUp, onBack }: BetScreenProps) {
  const broke = needsTopUp(wallet, rules)
  const base = Math.min(...rules.bet.options)

  return (
    <main className="casino" data-testid="bet-screen">
      <section className="casino__panel">
        <h2 className="casino__title">BET を選ぶ</h2>

        <dl className="casino__wallet">
          <dt>所持コイン</dt>
          <dd data-testid="wallet">{wallet.toLocaleString('ja-JP')}</dd>
        </dl>

        <ul className="bet__options">
          {rules.bet.options.map((amount) => {
            const affordable = canAfford(wallet, amount)

            return (
              <li key={amount}>
                <button
                  type="button"
                  className="button button--primary bet__option"
                  onClick={() => onPlaceBet(amount)}
                  disabled={!affordable}
                  data-testid={`bet-${amount}`}
                >
                  <span className="bet__amount">{amount.toLocaleString('ja-JP')}</span>
                  <span className="bet__multiplier">配当 {amount / base}倍</span>
                </button>
              </li>
            )
          })}
        </ul>

        {broke && (
          <div className="bet__topup" data-testid="topup">
            <p className="bet__topup-text">コインが足りません。補充して続けられます。</p>
            <button
              type="button"
              className="button button--primary"
              onClick={onTopUp}
              data-testid="topup-button"
            >
              コインを補充する
            </button>
          </div>
        )}

        <p className="casino__note">
          精算額 =（最終点数 × BET倍率 × 順位倍率）− BET額
          <br />
          順位倍率: 1位 {rules.bet.rankMultiplier.join(' / ')}
        </p>

        <button type="button" className="button button--ghost" onClick={onBack}>
          タイトルへ戻る
        </button>
      </section>
    </main>
  )
}
