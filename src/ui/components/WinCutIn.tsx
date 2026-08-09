import { motion, useReducedMotion } from 'framer-motion'

import type { WinKind } from '../../engine/types'

/** 演出の種類。同色役かどうかで決まる（判定は `src/config/presentation.ts`）。 */
export type WinVariant = 'normal' | 'big'

export interface WinCutInProps {
  /** 勝者の席名。 */
  readonly name: string
  /** 座席アバター。未設定なら席名の頭文字を出す。 */
  readonly avatarUrl?: string
  readonly yakuLabel: string
  readonly sameColor: boolean
  readonly winKind: WinKind
  readonly variant: WinVariant
}

/**
 * 和了演出の1段目。**誰が和了したか**だけを見せる。
 *
 * 点数も順位もここでは出さない。7-5 では全部を同時に出していたため、
 * どこを見ればよいかが定まらなかった。段を分ける目的がこれ。
 *
 * 大物手（同色役）は枠と背景を変えて拡大する。**画像は使わない**（CSS だけで作る）。
 */
export function WinCutIn({
  name,
  avatarUrl,
  yakuLabel,
  sameColor,
  winKind,
  variant,
}: WinCutInProps) {
  const reduced = useReducedMotion() === true
  const big = variant === 'big'

  return (
    <motion.div
      className={big ? 'win-cutin win-cutin--big' : 'win-cutin'}
      /*
       * **フェードイン。** 7-5 は横から差し込む動き（`x: -48`）だったが、
       * 卓の上で横に動くものは捨て札と紛らわしい。大物手だけ拡大を添える。
       */
      initial={reduced ? false : { opacity: 0, scale: big ? 0.86 : 1 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reduced ? 0 : 0.42, ease: 'easeOut' }}
      data-testid="win-cutin"
      data-variant={variant}
    >
      <span className="win-cutin__avatar" data-testid="win-avatar">
        {avatarUrl === undefined ? (
          // 画像が無くても成立させる。席名の頭文字で誰かは分かる。
          name.slice(0, 1)
        ) : (
          <img src={avatarUrl} alt="" className="win-cutin__avatar-image" />
        )}
      </span>

      <h2 className="overlay__title" id="win-title">
        {name}
      </h2>

      <p className="win-cutin__yaku">
        {big && (
          <span className="win-cutin__badge" data-testid="win-big-badge">
            大物手
          </span>
        )}
        {yakuLabel}
        {sameColor && <span className="tag">同色</span>}
        <span className="win-cutin__kind">{winKind === 'ron' ? 'ロン' : 'ツモ'}</span>
      </p>
    </motion.div>
  )
}
