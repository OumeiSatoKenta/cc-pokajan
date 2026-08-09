import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CardCounts } from '../../src/ui/components/CardCounts'
import type { ColorCount } from '../../src/engine/unseen'

/**
 * 手札ホバーで出す残枚数のツールチップ。
 *
 * **ホバーそのものはここでは踏めない。** テスト環境は `node` で、
 * `renderToStaticMarkup` は文字列を返すだけなのでマウスイベントが存在しない。
 * 「どこにホバーの受け口を置いたか」（`<li>` か `CardView` か）は
 * `tests/e2e/counts.spec.ts` が受け持つ。
 */

const COUNTS: readonly ColorCount[] = [
  { color: 'pink', unseen: 1 },
  { color: 'blue', unseen: 2 },
  { color: 'orange', unseen: 0 },
]

function render(counts: readonly ColorCount[] = COUNTS): string {
  return renderToStaticMarkup(<CardCounts memberName="ミナ" counts={counts} />)
}

describe('CardCounts', () => {
  it('メンバー名を出す', () => {
    expect(render()).toContain('ミナ')
  })

  it('色ごとの残枚数を渡された順に出す', () => {
    const html = render()

    expect(html).toContain('data-color="pink"')
    expect(html).toContain('data-color="blue"')
    expect(html).toContain('data-color="orange"')
    expect(html.indexOf('data-color="pink"')).toBeLessThan(html.indexOf('data-color="blue"'))
  })

  /**
   * 数は `data-unseen` にも出す。E2E が「残2」なのか「2枚」なのかという
   * 表示の整形に依存しなくなる。
   */
  it('残枚数を属性にも出す', () => {
    const html = render()

    expect(html).toContain('data-unseen="1"')
    expect(html).toContain('data-unseen="2"')
    expect(html).toContain('data-unseen="0"')
  })

  it('色数がルールで変わっても、渡された分だけ出す', () => {
    const html = render([
      { color: 'pink', unseen: 3 },
      { color: 'blue', unseen: 3 },
    ])

    expect(html).not.toContain('data-color="orange"')
  })

  /**
   * **確定値だと誤解させない。** この数には他家の手札にある分と、
   * そもそも山札に入らなかった分が混ざっている。
   */
  it('山札の残数だと読める言い方をしない', () => {
    const html = render()

    expect(html).toContain('見えていない枚数')
    expect(html).not.toContain('山')
  })
})
