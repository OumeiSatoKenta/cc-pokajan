import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PlayerSeat } from '../../src/ui/components/PlayerSeat'
import type { OpponentOrientation } from '../../src/ui/components/PlayerSeat'
import { hand } from '../helpers/cards'
import type { PlayerSummary } from '../../src/engine/playerView'
import type { MemberId } from '../../src/engine/types'

/**
 * 卓レイアウト（Step 7-2）の検証。
 *
 * 席の**置き場所**そのものは CSS（`grid-area`）が決めるため、ここで確かめるのは
 * 「向きが出力に現れること」と「席が持つ情報が正しく分かれていること」。
 * 実際に上下左右へ並ぶかは E2E のスクリーンショットで見る。
 */

const NAMES: ReadonlyMap<MemberId, string> = new Map([
  ['a1', 'アオイ'],
  ['a2', 'ヒナタ'],
  ['a3', 'カエデ'],
])

const IMAGES: ReadonlyMap<MemberId, string> = new Map([['a1', 'blob:image-a1']])
const SYMBOLS: ReadonlyMap<MemberId, string> = new Map([['a1', 'ス']])

function player(overrides: Partial<PlayerSummary> = {}): PlayerSummary {
  return {
    id: 1,
    isCpu: true,
    handCount: 3,
    score: 12_000,
    discards: [],
    declared: [],
    ...overrides,
  }
}

function seat(
  orientation: OpponentOrientation,
  overrides: Partial<PlayerSummary> = {},
  avatarUrl?: string,
  highlightLast = false,
): string {
  return renderToStaticMarkup(
    <PlayerSeat
      player={player(overrides)}
      memberNameById={NAMES}
      imageUrlById={IMAGES}
      groupSymbolById={SYMBOLS}
      seatLabel="上家"
      avatarUrl={avatarUrl}
      orientation={orientation}
      isTurn={false}
      isDeclarer={false}
      highlightLast={highlightLast}
    />,
  )
}

describe('PlayerSeat — 席の向き', () => {
  it('向きがクラスと属性に出る', () => {
    for (const orientation of ['top', 'left', 'right'] as const) {
      const html = seat(orientation)

      expect(html, orientation).toContain(`seat--${orientation}`)
      expect(html, orientation).toContain(`data-orientation="${orientation}"`)
    }
  })

  /** 左右の席は伏せ札を縦に積む。上（対面）だけが横並び。 */
  it('左右の席では伏せ札が縦積みになる', () => {
    expect(seat('top')).toContain('card-backs--horizontal')
    expect(seat('left')).toContain('card-backs--vertical')
    expect(seat('right')).toContain('card-backs--vertical')
  })
})

describe('PlayerSeat — 席が持つ情報', () => {
  it('伏せ札の枚数が手札の枚数と一致する', () => {
    const html = seat('top', { handCount: 4 })

    expect(html).toContain('data-count="4"')
    expect(html.match(/data-testid="card-back"/g)).toHaveLength(4)
  })

  /**
   * **7-1 で得た性質の維持（Step 6 で型による保証に格上げ）。** 他家は `PlayerSummary`（`handCount` のみ・
   * `hand` フィールドを持たない）で渡るため、席の出力に手札の中身が入る経路は**型として存在しない**。
   * 河のメンバー（公開情報）は出てよい。
   */
  it('席の出力に他家の手札の中身が含まれない', () => {
    // handCount だけ渡す（手札の中身を渡す術がない）。河には別のメンバーだけを置く。
    const html = seat('left', {
      handCount: 2,
      discards: hand('a3:orange'),
    })

    // 手札にしか居ないメンバー（アオイ/ヒナタ）は席に一切現れない。
    expect(html).not.toContain('アオイ')
    expect(html).not.toContain('ヒナタ')
    expect(html).not.toContain('blob:image-a1')
    // 河に出したメンバーは当然見えてよい
    expect(html).toContain('カエデ')
  })

  /** 河は席ごとに分かれる。自分の捨て札だけを描く。 */
  it('河にはその席の捨て札だけが並ぶ', () => {
    const html = seat('right', { discards: hand('a3:orange a3:pink') })

    expect(html.match(/data-testid="river-card"/g)).toHaveLength(2)
    expect(html).toContain('aria-label="上家の河"')
  })

  /**
   * `highlightLast` が席から河へ素通しされ、直前の1枚だけが強調される。
   * PlayerSeat → DiscardPile の配線ミス（例: 反転や渡し忘れ）を捕まえる。
   */
  it('highlightLast を河へ素通しし、直前札だけを強調する', () => {
    const lit = seat('right', { discards: hand('a3:orange a3:pink') }, undefined, true)
    const dim = seat('right', { discards: hand('a3:orange a3:pink') }, undefined, false)

    expect(lit.match(/card--last/g)).toHaveLength(1)
    expect(dim).not.toContain('card--last')
  })

  /**
   * 河が入ったことで「直近の捨て札チップ」は同じ情報の劣化版になった。
   * 残すと二重表示になり、CSS にも死んだ定義が残る。
   */
  it('直近の捨て札チップを持たない', () => {
    const html = seat('top', { discards: hand('a3:orange') })

    expect(html).not.toContain('chip')
  })

  it('役の数と点数を出す', () => {
    const html = seat('top', { score: 3000 })

    expect(html).toContain('3,000')
    expect(html).toContain('役 0')
  })
})

describe('PlayerSeat — アバター', () => {
  it('設定されていれば席に出る', () => {
    const html = seat('top', {}, 'blob:avatar-1')

    expect(html).toContain('blob:avatar-1')
    expect(html).toContain('data-testid="seat-avatar"')
  })

  /**
   * **未設定でも成立させる。** 空の枠を残すと「設定し忘れ」に見えるので、
   * 画像が無いときは要素ごと描かない。席名だけで誰の席かは分かる。
   */
  it('未設定なら要素ごと描かれない', () => {
    const html = seat('top')

    expect(html).not.toContain('seat-avatar')
    expect(html).toContain('上家')
  })

  /** 向きが変わってもアバターの扱いは同じ。 */
  it('どの向きでも出る', () => {
    for (const orientation of ['top', 'left', 'right'] as const) {
      expect(seat(orientation, {}, 'blob:a'), orientation).toContain('blob:a')
    }
  })
})
