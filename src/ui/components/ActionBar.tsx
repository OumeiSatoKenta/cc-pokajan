import type { ObservablePhase, YakuCandidate } from '../../engine/types'
import type { TimedDecision } from '../hooks/turnTimer'
import { actionBarItems } from './actionBarItems'
import { TimerBar } from './TimerBar'

export interface ActionBarProps {
  readonly phase: ObservablePhase
  readonly declarable: readonly YakuCandidate[]
  readonly claimable: readonly YakuCandidate[]
  /** 計時中の判断。`null` なら持ち時間を消費していないのでバーを出さない。 */
  readonly timerKind: TimedDecision | null
  readonly timeLimitMs: number
  /** 判断が変わるたびに変わる値。タイマーの再生に使う。 */
  readonly timerKey: string | null
  readonly onDeclare: (candidate: YakuCandidate) => void
  readonly onClaim: (candidate: YakuCandidate) => void
  readonly onPass: () => void
}

/** 宣言・見送りの操作バー。押せるボタンは `actionBarItems` が決める。 */
export function ActionBar({
  phase,
  declarable,
  claimable,
  timerKind,
  timeLimitMs,
  timerKey,
  onDeclare,
  onClaim,
  onPass,
}: ActionBarProps) {
  const items = actionBarItems({ phase, declarable, claimable })

  /**
   * **バーの表示はボタンの有無と独立させる。**
   * 打牌フェーズには押すボタンがないが持ち時間は消費しており、
   * ここを items の有無で分岐させると打牌のタイマーだけ画面に出なくなる。
   */
  const timer =
    timerKind === null || timerKey === null ? null : (
      <TimerBar durationMs={timeLimitMs} kind={timerKind} resetKey={timerKey} />
    )

  if (items.length === 0) {
    return (
      <div className="actions actions--idle" data-testid="action-bar">
        {timer}
      </div>
    )
  }

  return (
    <div className="actions" data-testid="action-bar">
      <div className="actions__buttons">
        {items.map((item) => {
          if (item.kind === 'pass') {
            return (
              <button
                key="pass"
                type="button"
                className="button button--ghost"
                onClick={onPass}
                data-testid="pass-button"
              >
                {item.label}
              </button>
            )
          }

          const candidate = item.candidate
          if (candidate === undefined) {
            return null
          }

          // ツモ（自摸宣言）=緑 / ロン（割り込み）=赤で色分けする（見た目は table.css）。
          const variant = item.kind === 'declare' ? 'button--tsumo' : 'button--ron'

          return (
            <button
              key={`${item.kind}-${candidate.cards.map((c) => c.uid).join('-')}`}
              type="button"
              className={`button ${variant}`}
              onClick={() => (item.kind === 'declare' ? onDeclare(candidate) : onClaim(candidate))}
              data-testid={`${item.kind}-button`}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {timer}
    </div>
  )
}
