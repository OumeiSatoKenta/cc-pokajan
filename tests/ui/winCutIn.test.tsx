import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { isBigWin } from '../../src/config/presentation'
import { WinCutIn } from '../../src/ui/components/WinCutIn'
import { YAKU_LABELS } from '../../src/ui/labels'
import { sameColorWin, win } from '../helpers/winPresentation'
import type { WinPresentation } from '../../src/ui/hooks/loopReducer'

/**
 * 和了演出の1段目。**誰が和了したか**だけを見せる段。
 *
 * `variant` の決定は `isBigWin`（`src/config/presentation.ts`）が持つ。
 * ここでは「その判断が画面に届いているか」を見る。
 * **`variant` を直接渡した検査だけにしない。** それだと `WinOverlay` が
 * 判断を間違えていても気づけないので、`isBigWin` を通した値でも確かめる。
 */
function render(presentation: WinPresentation, options: { avatarUrl?: string } = {}): string {
  return renderToStaticMarkup(
    <WinCutIn
      name="上家"
      avatarUrl={options.avatarUrl}
      yakuLabel={YAKU_LABELS[presentation.candidate.kind]}
      sameColor={presentation.candidate.sameColor}
      winKind={presentation.winKind}
      variant={isBigWin(presentation.candidate) ? 'big' : 'normal'}
    />,
  )
}

describe('WinCutIn — 誰が何で和了したか', () => {
  it('席名・役名・ロンを出す', () => {
    const html = render(win())

    expect(html).toContain('上家')
    expect(html).toContain('3カード')
    expect(html).toContain('ロン')
  })

  it('ツモとロンを区別する', () => {
    expect(render(win({ winKind: 'tsumo' }))).toContain('ツモ')
    expect(render(win({ winKind: 'ron' }))).toContain('ロン')
  })
})

describe('WinCutIn — 大物手', () => {
  it('同色役は大物手バージョンになる', () => {
    const html = render(sameColorWin())

    expect(html).toContain('data-variant="big"')
    expect(html).toContain('data-testid="win-big-badge"')
    expect(html).toContain('同色')
  })

  it('混色の役は通常バージョン', () => {
    const html = render(win())

    expect(html).toContain('data-variant="normal"')
    expect(html).not.toContain('data-testid="win-big-badge"')
    expect(html).not.toContain('同色')
  })

  /**
   * **点数の大小と演出の大小は一致しない。**
   * 5人組（480点）は3カード同色（840点）より安いが、混色なので通常演出。
   * 承知のうえの帰結なので、変わったら気づけるように固定しておく。
   */
  it('高得点でも混色なら通常バージョン', () => {
    const quintet = win({
      candidate: {
        kind: 'group5',
        sameColor: false,
        cards: win().candidate.cards,
        bonusCount: 0,
        score: 480,
      },
    })

    expect(render(quintet)).toContain('data-variant="normal"')
  })
})

describe('WinCutIn — アバター', () => {
  it('設定されていれば画像を出す', () => {
    expect(render(win(), { avatarUrl: 'blob:avatar-3' })).toContain('blob:avatar-3')
  })

  /** 画像が無くても成立させるのは 7-3 から通している要件。 */
  it('未設定なら席名の頭文字を出す', () => {
    const html = render(win())

    expect(html).not.toContain('<img')
    expect(html).toContain('data-testid="win-avatar"')
    expect(html).toContain('>上<')
  })
})
