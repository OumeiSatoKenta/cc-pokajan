import type { ObservablePhase, YakuCandidate } from '../../engine/types'
import type { TimedDecision } from '../hooks/turnTimer'
import { actionBarItems } from './actionBarItems'
import { SelectionPreview, type SelectionPreviewProps } from './SelectionPreview'
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
  /**
   * 絵札の組み替えのライブプレビュー＋ツモ確定。**自分の宣言番のときだけ** `TableScreen` が渡す。
   * `null` なら出さない。**操作バーの中に置く**のは、横向き 844×390 で `.actions` が持つ
   * 高さ上限＋スクロールの保護に相乗りし、`.table__mine` の grid を増やさないため。
   */
  readonly selection: SelectionPreviewProps | null
  /**
   * ツモ／ロン候補ボタンは**おまかせプレフィル**。押すとその役の構成カードを選択欄へ入れる
   * （即確定ではない）。実際の確定は `SelectionPreview` の確定ボタン（緑ツモ／赤ロン）が担う。
   */
  readonly onPrefill: (candidate: YakuCandidate) => void
  readonly onPass: () => void
  /** 和了演出中はボタンを一切出さない（`actionBarItems` へ透過。7-4 の両層停止のボタン側）。 */
  readonly isPaused: boolean
}

/** 宣言・見送りの操作バー。押せるボタンは `actionBarItems` が決める。 */
export function ActionBar({
  phase,
  declarable,
  claimable,
  timerKind,
  timeLimitMs,
  timerKey,
  selection,
  onPrefill,
  onPass,
  isPaused,
}: ActionBarProps) {
  const items = actionBarItems({ phase, declarable, claimable, isPaused })

  /**
   * **バーの表示はボタンの有無と独立させる。**
   * 打牌フェーズには押すボタンがないが持ち時間は消費しており、
   * ここを items の有無で分岐させると打牌のタイマーだけ画面に出なくなる。
   */
  const timer =
    timerKind === null || timerKey === null ? null : (
      <TimerBar durationMs={timeLimitMs} kind={timerKind} resetKey={timerKey} />
    )

  // プレビューもボタンも無いときだけ「待機」の見た目（打牌フェーズのタイマーだけを残す）。
  const isIdle = items.length === 0 && selection === null

  return (
    <div className={isIdle ? 'actions actions--idle' : 'actions'} data-testid="action-bar">
      {selection !== null && (
        <SelectionPreview
          composed={selection.composed}
          selectionCount={selection.selectionCount}
          onConfirm={selection.onConfirm}
          kind={selection.kind}
        />
      )}

      {items.length > 0 && (
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

            // ツモ・ロンとも「おまかせ」プレフィル（金の `button--primary`）で対称に出す。押すと構成
            // カードを選択欄へ入れるだけで、確定は `SelectionPreview` の確定ボタン（緑ツモ／赤ロン）が担う。
            return (
              <button
                key={`${item.kind}-${candidate.cards.map((c) => c.uid).join('-')}`}
                type="button"
                className="button button--primary"
                onClick={() => onPrefill(candidate)}
                data-testid={`${item.kind}-button`}
              >
                おまかせ {item.label}
              </button>
            )
          })}
        </div>
      )}

      {timer}
    </div>
  )
}
