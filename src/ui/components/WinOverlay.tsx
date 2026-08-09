import { useEffect, useEffectEvent, useState } from 'react'
import { AnimatePresence } from 'framer-motion'

import type { MemberId, PlayerId } from '../../engine/types'
import type { WinPresentation } from '../hooks/loopReducer'
import { WinCutIn } from './WinCutIn'
import { WinResult } from './WinResult'
import { YAKU_LABELS } from '../labels'
import { isBigWin, type WinTiming } from '../../config/presentation'

export interface WinOverlayProps {
  readonly win: WinPresentation
  readonly seatLabels: ReadonlyMap<PlayerId, string>
  /** 座席アバター。未設定なら席名の頭文字を出す。 */
  readonly avatarUrls?: ReadonlyMap<PlayerId, string>
  readonly memberNameById: ReadonlyMap<MemberId, string>
  readonly imageUrlById: ReadonlyMap<MemberId, string>
  readonly groupSymbolById: ReadonlyMap<MemberId, string>
  readonly bonusMemberIds: readonly MemberId[]
  /** 段ごとの滞留時間。E2E では `NO_WIN_TIMING` が渡る。 */
  readonly timing: WinTiming
  readonly onDismiss: () => void
}

/** 演出の段。`cutin` で誰が和了したかを、`result` で何が起きたかを見せる。 */
type Stage = 'cutin' | 'result'

/**
 * 和了の演出。**閉じるまで対局は進まない。**
 *
 * ポカジャンは和了しても局が終わらないため、和了は局の途中で何度も起こる。
 * 進行を止めずに流すと、誰が何点取ったのかを読む前に盤面が先へ進む。
 *
 * 止めている間に2段で見せ、**確認を待たずに自動で閉じる**。
 * 連続宣言は最大8回まで起こりうるので、毎回ボタンを押させない。
 *
 * **このコンポーネントは段の進行だけを持つ。** 対局ループ（`useGameLoop`）は
 * 「`pendingWins` が空でない間は止まる」ことだけを知っていればよく、
 * 段が2つあることは演出の内部事情。ここに置くことで、
 * 7-4 で作った「停止フラグを持つ効果が3つ」の構造を増やさずに済む。
 */
export function WinOverlay({
  win,
  seatLabels,
  avatarUrls,
  memberNameById,
  imageUrlById,
  groupSymbolById,
  bonusMemberIds,
  timing,
  onDismiss,
}: WinOverlayProps) {
  const [stage, setStage] = useState<Stage>('cutin')

  /*
   * **効果の中から呼ぶ分だけ `useEffectEvent` で受ける。**
   * `onDismiss` を依存配列に載せると、親が再描画するたびにタイマーが
   * 破棄・再予約され、**永久に閉じない**（`useGameLoop` の自動進行と同じ罠）。
   *
   * 操作（クリック・ボタン）からは `onDismiss` を直接呼ぶ。
   * Effect Event は効果の中から呼ぶためのもので、イベントハンドラの経路に混ぜない。
   */
  const dismissFromEffect = useEffectEvent(() => onDismiss())

  // カットイン段 → 結果段。
  useEffect(() => {
    if (stage !== 'cutin') {
      return
    }

    const timer = setTimeout(() => setStage('result'), timing.cutInMs)
    return () => clearTimeout(timer)
  }, [stage, timing.cutInMs])

  // 結果段 → 自動で閉じる。
  useEffect(() => {
    if (stage !== 'result') {
      return
    }

    const timer = setTimeout(dismissFromEffect, timing.resultMs)
    return () => clearTimeout(timer)
  }, [stage, timing.resultMs])

  /**
   * クリックは**1段だけ進める**。1回で全部消さないのは、他家の和了が
   * こちらの打とうとした瞬間に割り込むため。押しかけていたクリックで
   * 演出が丸ごと消えると、何が起きたのか分からないまま盤面が進む。
   *
   * **`setStage` の更新関数の中で閉じない。** 更新関数は純粋でなければならず、
   * StrictMode の二重実行で閉じる処理が2回走る。
   */
  const advance = () => {
    if (stage === 'cutin') {
      setStage('result')
      return
    }
    onDismiss()
  }

  /*
   * Escape はいつでも閉じる。焦点を奪わない代わりに、キーボードからの出口を必ず残す。
   * `window` に付けるのは、焦点がどこにあっても効かせるため。
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissFromEffect()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    /*
     * **`role="status"` にして焦点は奪わない。** 自動で閉じるものを
     * `aria-modal` のダイアログにすると、読み上げが終わる前に消える。
     * 対局が進まないことは状態側（リデューサ）が保証しているので、
     * 焦点を閉じ込める必要もない。
     */
    <div
      className="overlay win-overlay"
      role="status"
      aria-live="polite"
      data-testid="win-overlay"
      data-winner={win.playerId}
      data-stage={stage}
      onClick={advance}
    >
      <div className="overlay__panel win">
        {/*
          `mode="wait"` は前の段の退場を待ってから次を入れる。
          2つが重なって一瞬2人分の情報が並ぶのを防ぐ。
        */}
        <AnimatePresence mode="wait" initial={false}>
          {stage === 'cutin' ? (
            <WinCutIn
              key="cutin"
              name={seatLabels.get(win.playerId) ?? `P${win.playerId}`}
              avatarUrl={avatarUrls?.get(win.playerId)}
              yakuLabel={YAKU_LABELS[win.candidate.kind]}
              sameColor={win.candidate.sameColor}
              winKind={win.winKind}
              variant={isBigWin(win.candidate) ? 'big' : 'normal'}
            />
          ) : (
            <WinResult
              key="result"
              win={win}
              seatLabels={seatLabels}
              memberNameById={memberNameById}
              imageUrlById={imageUrlById}
              groupSymbolById={groupSymbolById}
              bonusMemberIds={bonusMemberIds}
              onDismiss={onDismiss}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
