import { useReducedMotion } from 'framer-motion'

import type { TimedDecision } from '../hooks/turnTimer'

export interface TimerBarProps {
  readonly durationMs: number
  /** どの判断を計時しているか。画面と E2E が割り込みと打牌を区別するために使う。 */
  readonly kind: TimedDecision
  /** 判断が変わるたびに変わる値。これを key にしてアニメーションをやり直す。 */
  readonly resetKey: string | number
}

const KIND_LABELS: Record<TimedDecision, string> = {
  claim: '割り込み',
  discard: '打牌',
  declare: '宣言',
}

/**
 * 持ち時間の残りバー。**割り込み専用ではなく、打牌と宣言でも表示する。**
 *
 * 残り時間は CSS アニメーションで描く。React の状態を毎フレーム更新すると、
 * その state 変化が対局ループの他のタイマーを巻き添えに破棄・再予約してしまう
 * （CPU の割り込み判断が発火できなくなる）。描画は CSS に任せ、
 * エンジンへは時間切れの1手だけを送る設計にしている。
 */
export function TimerBar({ durationMs, kind, resetKey }: TimerBarProps) {
  const reduced = useReducedMotion()

  return (
    <div className="timer" data-testid="turn-timer" data-timer-kind={kind}>
      <span className="timer__label">
        {KIND_LABELS[kind]} {Math.round(durationMs / 1000)}秒
      </span>
      <div className="timer__track" aria-hidden="true">
        <div
          key={resetKey}
          className={reduced === true ? 'timer__fill timer__fill--static' : 'timer__fill'}
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </div>
    </div>
  )
}
