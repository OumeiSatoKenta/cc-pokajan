import type { Card, MemberId } from '../../engine/types'
import { CardView } from './CardView'
import { nameOf } from '../labels'

/**
 * 河に表示する最大枚数。古い札は押し出して**卓の高さを一定に保つ**（縦に伸ばさない）。
 * ロン対象は直前の1枚だけで、手札は毎差し入れ替わるため、古い捨て札の読みは価値が薄い。
 * ※ これは**表示上の制限**で、残枚数（`src/engine/unseen.ts`）は全枚を数える（別経路）。
 */
const MAX_RIVER = 5

export interface DiscardPileProps {
  readonly cards: readonly Card[]
  readonly memberNameById: ReadonlyMap<MemberId, string>
  /** 設定済みの画像。手札と同じ見え方にそろえるため河にも出す。 */
  readonly imageUrlById?: ReadonlyMap<MemberId, string>
  readonly groupSymbolById?: ReadonlyMap<MemberId, string>
  /** 読み上げ用の名前。卓では位置で誰の河か分かるため、見出しとしては出さない。 */
  readonly label: string
  /**
   * 識別子。既定は `river`。
   *
   * 4人分の河が同時に出るため、E2E が「自分の河が1枚増えた」を見るには
   * 席ごとに数えられる必要がある。全部が同じ識別子だと総数しか数えられず、
   * CPU の捨て札を巻き込んで**別のものを検査してしまう**。
   */
  readonly testId?: string
  /**
   * 直前の1枚（ロン対象）を強調するか。true のとき、表示中の**最後の札**に
   * 白熱色の枠を付ける。どの席を強調するかは呼び出し側が `lastDiscardBy` で決める。
   */
  readonly highlightLast?: boolean
}

/**
 * 河（捨て札の置き場）。
 *
 * **手札と同じ絵を小さく描く。** 以前はチップ（色付きラベル）だったが、
 * それだと手札の見え方と対応が取れず、「何が場に出たか」を手札と突き合わせにくい。
 *
 * カードは押せない（`onClick` を渡さないので `<div>` として描かれる）。
 * 手札と同じ `data-testid` を使わないのも重要で、同じにすると
 * 「手札の1枚を捨てる」E2E が河のカードを拾ってしまう。
 *
 * **名前の見出しは持たない。** 卓レイアウトでは河が4つ並ぶため、
 * 「上家の河」のような見出しを出すと文字が卓を埋める。誰の河かは位置が示す。
 * 読み上げ向けには `aria-label` を残す。
 * ただし**枚数ラベル**は持つ。表示は直近5枚に絞るため、「見えていない分」を
 * 「直近5枚 / 計N」で明示する（`MAX_RIVER` を超えたときだけ計数が変わる）。
 */
export function DiscardPile({
  cards,
  memberNameById,
  imageUrlById,
  groupSymbolById,
  label,
  testId = 'river',
  highlightLast = false,
}: DiscardPileProps) {
  // 表示は直近 MAX_RIVER 枚だけ。データ（残枚数計算）は別経路で全枚を数える。
  const shown = cards.slice(-MAX_RIVER)
  const countLabel =
    cards.length <= MAX_RIVER ? `${cards.length}枚` : `直近${MAX_RIVER}枚 / 計${cards.length}`

  return (
    <section className="river" aria-label={label} data-testid={testId}>
      {/*
        枚数ラベルは常に出す。出現/消失で段がズレないよう、0枚でも描く。
        古い札を押し出したことは「直近5枚 / 計N」で分かる。
      */}
      <span className="river__count" data-testid="river-count">
        {countLabel}
      </span>
      {/*
        空でも `<ul>` を描く。空のときだけ要素ごと消すと、1枚目が出た瞬間に
        河の高さが 0 から立ち上がって卓がガタつく（高さは CSS の min-height で確保する）。
      */}
      <ul className="river__list" data-testid="river-list" data-count={cards.length}>
        {shown.map((card, i) => (
          <li key={card.uid}>
            <CardView
              card={card}
              memberName={nameOf(memberNameById, card.memberId)}
              imageUrl={imageUrlById?.get(card.memberId)}
              groupSymbol={groupSymbolById?.get(card.memberId)}
              size="small"
              testId="river-card"
              isLast={highlightLast && i === shown.length - 1}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
