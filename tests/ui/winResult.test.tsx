import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WinRanking } from '../../src/ui/components/WinRanking'
import { WinResult } from '../../src/ui/components/WinResult'
import { EMPTY_MAP, SEAT_LABELS, win } from '../helpers/winPresentation'
import { hand } from '../helpers/cards'
import type { MemberId } from '../../src/engine/types'
import type { WinPresentation } from '../../src/ui/hooks/loopReducer'

/**
 * 和了演出の2段目。**何が起きたか**を見せる段。
 *
 * 7-5 で `WinOverlay` に書いていた検査（役名・獲得点・順位表）はここへ移した。
 * 段を分けたことで、オーバーレイの初期描画からは見えなくなったため。
 */

const NAMES: ReadonlyMap<MemberId, string> = new Map([['a1', 'ミナ']])

function render(
  presentation: WinPresentation,
  options: { bonusMemberIds?: readonly MemberId[] } = {},
): string {
  return renderToStaticMarkup(
    <WinResult
      win={presentation}
      seatLabels={SEAT_LABELS}
      memberNameById={NAMES}
      imageUrlById={EMPTY_MAP}
      groupSymbolById={EMPTY_MAP}
      bonusMemberIds={options.bonusMemberIds ?? []}
      onDismiss={() => undefined}
    />,
  )
}

describe('WinResult — 役の中身', () => {
  it('勝者の席名と役名を出す', () => {
    const html = render(win())

    expect(html).toContain('上家')
    expect(html).toContain('3カード')
  })

  it('同色なら印を出す', () => {
    const plain = render(win())
    const same = render(win({ candidate: { ...win().candidate, sameColor: true, score: 840 } }))

    expect(plain).not.toContain('同色')
    expect(same).toContain('同色')
  })

  /**
   * **役の構成カードをそのまま出す。** 何で和了したのかは役名だけでは分からず、
   * 同色かどうかも絵で見えたほうが早い。
   */
  it('構成カードを枚数分そのまま出す', () => {
    const presentation = win()
    const html = render(presentation)

    const uids = [...html.matchAll(/data-testid="win-card" data-uid="(\d+)"/g)].map((match) =>
      Number(match[1]),
    )

    expect(uids).toEqual(presentation.candidate.cards.map((card) => card.uid))
    expect(html).toContain('ミナ')
  })

  it('5枚の役でも全部出す', () => {
    const quintet = win({
      candidate: {
        kind: 'group5',
        sameColor: false,
        cards: hand('c1:pink c2:blue c3:orange c4:pink c5:blue'),
        bonusCount: 0,
        score: 480,
      },
    })

    expect(render(quintet).match(/data-testid="win-card"/g)).toHaveLength(5)
  })

  /**
   * `.card--small` は BONUS の帯を隠す（`App.css`）ため、絵札を見ても
   * ボーナスが効いているか分からない。点数の内訳として文字で出す。
   */
  it('ボーナスを含む役では枚数を出す', () => {
    const withBonus = render(win({ candidate: { ...win().candidate, bonusCount: 2, score: 300 } }))
    const without = render(win())

    expect(withBonus).toContain('ボーナス×2')
    expect(without).not.toContain('data-testid="win-bonus"')
  })
})

describe('WinResult — 獲得点', () => {
  /**
   * **候補の点数ではなく実際に動いた差分を出す。**
   * 残高不足で徴収額が減った場合、候補の点数を出すと
   * すぐ下の順位表に並ぶ点数と食い違う。
   */
  it('獲得点は前後の差分から出す', () => {
    const html = render(
      win({
        candidate: { ...win().candidate, score: 999 },
        scoresBefore: [1000, 1000, 1000, 1000],
        scoresAfter: [950, 1000, 1000, 1050],
      }),
    )

    expect(html).toContain('+50')
    expect(html).not.toContain('999')
  })
})

describe('WinResult — 出さないもの', () => {
  /** アバターは直前の段（カットイン）で見せたばかり。この段の新しい情報は絵札と点数。 */
  it('アバターは出さない', () => {
    expect(render(win())).not.toContain('data-testid="win-avatar"')
  })
})

describe('WinRanking', () => {
  function renderRanking(presentation: WinPresentation): string {
    return renderToStaticMarkup(
      <WinRanking
        scoresBefore={presentation.scoresBefore}
        scoresAfter={presentation.scoresAfter}
        seatLabels={SEAT_LABELS}
        winnerId={presentation.playerId}
      />,
    )
  }

  it('全員分の行を出す', () => {
    const html = renderRanking(win())

    expect(html.match(/data-testid="win-rank-row"/g)).toHaveLength(4)
  })

  /** 初期描画は和了「前」の順。ここから後の順へ動く。 */
  it('初期描画は和了前の順位から始まる', () => {
    const html = renderRanking(win())

    expect(html).toContain('data-phase="before"')
    // 全員同点なので ID 昇順
    const order = [...html.matchAll(/data-player="(\d)"/g)].map((match) => match[1])
    expect(order).toEqual(['0', '1', '2', '3'])
  })

  it('点数が変わった席にだけ増減を出す', () => {
    const html = renderRanking(win())

    expect(html.match(/data-testid="win-rank-delta"/g)).toHaveLength(2)
    expect(html).toContain('−120')
    expect(html).toContain('+120')
  })

  /** ツモは他3人が減るので、増減は4件出る。 */
  it('ツモでは4人分の増減が出る', () => {
    const html = renderRanking(
      win({
        winKind: 'tsumo',
        scoresBefore: [1000, 1000, 1000, 1000],
        scoresAfter: [960, 960, 960, 1120],
      }),
    )

    expect(html.match(/data-testid="win-rank-delta"/g)).toHaveLength(4)
  })

  it('勝者の行を強調する', () => {
    expect(renderRanking(win())).toContain('win-rank__row--win')
  })
})
