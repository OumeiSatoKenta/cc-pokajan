import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WIN_TIMING } from '../../src/config/presentation'
import { WinOverlay } from '../../src/ui/components/WinOverlay'
import { SEAT_LABELS, win, EMPTY_MAP } from '../helpers/winPresentation'
import type { WinPresentation } from '../../src/ui/hooks/loopReducer'
import type { PlayerId } from '../../src/engine/types'

/**
 * 和了演出の**入口**の検証。
 *
 * `renderToStaticMarkup` は `useEffect` を実行しないため、ここから見えるのは
 * **カットイン段だけ**。段が進んだ先（点数獲得結果）は `WinResult` を直接描画する
 * `winResult.test.tsx` が受け持ち、実際に段が進むことは E2E が受け持つ。
 *
 * この分担を崩して「オーバーレイから役名が見えること」を書くと、
 * **必ず落ちるテスト**になる（段が進まないので永久にカットインのまま）。
 */
function render(presentation: WinPresentation, avatars?: ReadonlyMap<PlayerId, string>): string {
  return renderToStaticMarkup(
    <WinOverlay
      win={presentation}
      seatLabels={SEAT_LABELS}
      avatarUrls={avatars}
      memberNameById={EMPTY_MAP}
      imageUrlById={EMPTY_MAP}
      groupSymbolById={EMPTY_MAP}
      bonusMemberIds={[]}
      timing={WIN_TIMING}
      onDismiss={() => undefined}
    />,
  )
}

describe('WinOverlay', () => {
  it('初期描画はカットイン段', () => {
    const html = render(win())

    expect(html).toContain('data-stage="cutin"')
    expect(html).toContain('data-testid="win-cutin"')
    // 点数獲得結果はまだ出ていない
    expect(html).not.toContain('data-testid="win-result"')
    expect(html).not.toContain('data-testid="win-score"')
  })

  it('勝者を属性に出す', () => {
    expect(render(win())).toContain('data-winner="3"')
  })

  /**
   * 自動で閉じるものを `aria-modal` のダイアログにすると、読み上げが終わる前に消える。
   * 対局が進まないことはリデューサ側が保証しているので、焦点を閉じ込める必要もない。
   */
  it('焦点を奪わない報せとして描く', () => {
    const html = render(win())

    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).not.toContain('aria-modal')
  })

  it('アバターが設定されていれば勝者の分だけ出す', () => {
    const html = render(
      win(),
      new Map([
        [0, 'blob:avatar-0'],
        [3, 'blob:avatar-3'],
      ]),
    )

    expect(html).toContain('blob:avatar-3')
    expect(html).not.toContain('blob:avatar-0')
  })
})
