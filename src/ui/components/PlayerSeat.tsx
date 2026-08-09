import type { MemberId, Player } from '../../engine/types'
import { CardBack } from './CardBack'
import { DiscardPile } from './DiscardPile'

/** 他家が置かれる向き。自分（`self`）はこの部品では描かない。 */
export type OpponentOrientation = 'top' | 'left' | 'right'

export interface PlayerSeatProps {
  readonly player: Player
  readonly memberNameById: ReadonlyMap<MemberId, string>
  /** 河のカードに出す画像と記号。手札と同じ見え方にそろえる。 */
  readonly imageUrlById?: ReadonlyMap<MemberId, string>
  readonly groupSymbolById?: ReadonlyMap<MemberId, string>
  readonly seatLabel: string
  /** 座席に設定されたアバター。未設定なら席名だけを出す。 */
  readonly avatarUrl?: string
  /** 卓の上でこの席が置かれる向き。伏せ札の積み方が変わる。 */
  readonly orientation: OpponentOrientation
  /** この席が今の手番か。 */
  readonly isTurn: boolean
  /** この席が今の宣言権者か（ロンの連続宣言中は手番と食い違う）。 */
  readonly isDeclarer: boolean
  /** この席の河の直前札（＝直前に捨てた席）を強調するか。ロン対象の明示に使う。 */
  readonly highlightLast: boolean
}

/**
 * 他家の席。
 *
 * 手札の中身は見せない（見せるとゲームが成立しない）。伏せ札・点数・河・
 * 成立させた役の数だけを表示する。
 *
 * 左右の席では伏せ札を縦に積む。卓を囲んでいる形にするためで、
 * 向きは `seatOrientation`（`src/ui/labels.ts`）が人間の席からの相対位置で決める。
 */
export function PlayerSeat({
  player,
  memberNameById,
  imageUrlById,
  groupSymbolById,
  seatLabel,
  avatarUrl,
  orientation,
  isTurn,
  isDeclarer,
  highlightLast,
}: PlayerSeatProps) {
  const classes = ['seat', `seat--${orientation}`]
  if (isTurn) {
    classes.push('seat--turn')
  }
  if (isDeclarer && !isTurn) {
    classes.push('seat--declarer')
  }

  return (
    <section
      className={classes.join(' ')}
      aria-label={`${seatLabel}の状況`}
      data-testid="seat"
      data-orientation={orientation}
    >
      <header className="seat__head">
        {/* 未設定でも成立させる。画像が無ければ席名だけで席が分かる。 */}
        {avatarUrl !== undefined && (
          <img src={avatarUrl} alt="" className="seat__avatar" data-testid="seat-avatar" />
        )}
        <span className="seat__name">{seatLabel}</span>
        <span className="seat__score" data-testid="seat-score">
          {player.score.toLocaleString('ja-JP')}
        </span>
        <span className="seat__meta">役 {player.declared.length}</span>
      </header>

      {/*
        伏せ札には `player.hand` を渡さない。枚数だけを渡すことで、
        他家の手札の中身が UI へ到達する経路そのものを断つ。
      */}
      <CardBack
        count={player.hand.length}
        orientation={orientation === 'top' ? 'horizontal' : 'vertical'}
        label={`${seatLabel}の伏せ札`}
      />

      {/*
        河は席の中に持つ。以前は「直近の捨て札」をチップ1枚で出していたが、
        河が入れば同じ情報を全履歴つきで示せるため、チップは二重表示になる。
      */}
      <DiscardPile
        cards={player.discards}
        memberNameById={memberNameById}
        imageUrlById={imageUrlById}
        groupSymbolById={groupSymbolById}
        label={`${seatLabel}の河`}
        highlightLast={highlightLast}
      />
    </section>
  )
}
