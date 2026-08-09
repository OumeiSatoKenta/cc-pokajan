import { useState } from 'react'

import type { Card } from '../../engine/types'
import { COLOR_LABELS } from '../labels'

export interface CardViewProps {
  readonly card: Card
  readonly memberName: string
  /** 設定済みの画像。無ければ名前とアクセントカラーで描画する。 */
  readonly imageUrl?: string
  /** 所属グループの記号。トランプのスートのように左上と右下へ出す。 */
  readonly groupSymbol?: string
  readonly isBonus?: boolean
  /** あと1枚で役が完成する組に寄与しているか（原作のリーチ表示にあたる黄色枠）。 */
  readonly isWaiting?: boolean
  /**
   * 河の直前の1枚（ロン対象）か。白熱色の枠＋グローで示す。
   * 手札の待ち札（`isWaiting`）と違い持ち上げはしない（河の小カードのため）。
   */
  readonly isLast?: boolean
  /** 河のカードは手札より小さく描く。 */
  readonly size?: 'normal' | 'small'
  /**
   * テスト用の識別子。既定は手札の `card`。
   *
   * **河のカードには別の値を渡すこと。** 同じ識別子にすると、
   * 「手札の枚数を数える」「手札の1枚を捨てる」という E2E の操作が
   * 河のカードを拾ってしまい、静かに別の場所を検査することになる。
   */
  readonly testId?: string
  readonly onClick?: (uid: number) => void
  readonly disabled?: boolean
  /**
   * このカードを説明している要素の ID（`aria-describedby`）。
   *
   * 残枚数のツールチップを焦点で読ませるために使う。表示そのものは
   * ツールチップ側の責務で、ここは「どれを説明しているか」だけを持つ。
   */
  readonly describedById?: string
}

/**
 * 手札・河の1枚。
 *
 * 画像は Step 6 で差し替え可能になった。**画像が無くても遊べる**という要件は
 * 変わっておらず、未設定・読み込み失敗のどちらでも名前表示に戻る。
 */
export function CardView({
  card,
  memberName,
  imageUrl,
  groupSymbol,
  isBonus = false,
  isWaiting = false,
  isLast = false,
  size = 'normal',
  testId = 'card',
  onClick,
  disabled = false,
  describedById,
}: CardViewProps) {
  // 読み込みに失敗した URL を覚えておき、再試行で無限にちらつかせない。
  const [failed, setFailed] = useState(false)
  const showImage = imageUrl !== undefined && !failed

  const classes = ['card', `card--${card.color}`]
  if (size === 'small') {
    classes.push('card--small')
  }
  if (isWaiting) {
    classes.push('card--waiting')
  }
  if (isLast) {
    classes.push('card--last')
  }
  if (showImage) {
    classes.push('card--image')
  }
  if (onClick !== undefined && !disabled) {
    classes.push('card--clickable')
  }

  const content = (
    <>
      {showImage && (
        <img
          className="card__image"
          src={imageUrl}
          alt=""
          // 画像が壊れていても対局は続く。名前表示へ戻すだけにする。
          onError={() => setFailed(true)}
        />
      )}

      {/*
        トランプと同じく左上と右下に置く。手札を扇状に重ねても、
        どちらかの角が必ず見えるため、重ねたままグループを数えられる。
        右下は 180 度回すのもトランプの慣習に合わせている。
      */}
      {groupSymbol !== undefined && (
        <>
          <span className="card__corner card__corner--tl" data-testid="card-symbol">
            {groupSymbol}
          </span>
          <span className="card__corner card__corner--br" aria-hidden="true">
            {groupSymbol}
          </span>
        </>
      )}

      {isBonus && <span className="card__bonus">BONUS</span>}
      <span className="card__name">{memberName}</span>
    </>
  )

  if (onClick === undefined) {
    return (
      <div
        className={classes.join(' ')}
        data-testid={testId}
        data-uid={card.uid}
        aria-describedby={describedById}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={classes.join(' ')}
      onClick={() => onClick(card.uid)}
      disabled={disabled}
      data-testid={testId}
      data-uid={card.uid}
      aria-describedby={describedById}
      aria-label={`${memberName}（${COLOR_LABELS[card.color]}）を捨てる`}
    >
      {content}
    </button>
  )
}
