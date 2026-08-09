import type { ColorCount } from '../../engine/unseen'
import { COLOR_LABELS } from '../labels'

/**
 * ツールチップを指す ID。
 *
 * **同時に1つしか出ない**ので固定値でよい。ホバー中のカードだけが
 * `aria-describedby` でこれを指し、読み上げの対象になる。
 */
export const CARD_COUNTS_ID = 'card-counts-tooltip'

export interface CardCountsProps {
  readonly memberName: string
  /** 色ごとの残枚数。並びは `rules.colors` の順で渡ってくる。 */
  readonly counts: readonly ColorCount[]
}

/**
 * 手札ホバー時に出す残枚数のツールチップ。
 *
 * **配置は `.hand-area` を基準にした絶対配置**（`hints.css`）。カード単位に置くと、
 * 375px では端の札の中央から左へ 1.5rem ほどはみ出す。
 *
 * 数は `data-unseen` にも出す。テストが文字列の整形（「残2」なのか「2枚」なのか）に
 * 依存しなくなり、表示を変えても検査が壊れない。
 *
 * **`role="tooltip"` にして、カード側から `aria-describedby` で指す**
 * （WAI-ARIA の Tooltip パターン）。`role="status"` だと暗黙の `aria-live` が付き、
 * **マウスを乗せただけで読み上げが割り込む**。焦点を当てたときにだけ読まれればよい。
 */
export function CardCounts({ memberName, counts }: CardCountsProps) {
  return (
    <div className="card-counts" id={CARD_COUNTS_ID} role="tooltip" data-testid="card-counts">
      <span className="card-counts__name">{memberName}</span>

      <ul className="card-counts__list">
        {counts.map((count) => (
          <li
            key={count.color}
            className={`card-counts__item card-counts__item--${count.color}`}
            data-testid="card-count"
            data-color={count.color}
            data-unseen={count.unseen}
          >
            <span className="card-counts__label">{COLOR_LABELS[count.color]}</span>
            <span className="card-counts__value">{count.unseen}</span>
          </li>
        ))}
      </ul>

      {/*
        「残り」であって「山にあと N 枚」ではない。この数には
        他家の手札にある分と、そもそも山札に入らなかった分が混ざっている
        （`buildDeck` はプールから `deckSize` 枚しか抜かない）。
      */}
      <span className="card-counts__note">見えていない枚数</span>
    </div>
  )
}
