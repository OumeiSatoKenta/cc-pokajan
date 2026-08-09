import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { TableHeader } from '../../src/ui/components/TableHeader'

/**
 * 卓ヘッダーの検証。
 *
 * 連続和了は `chainCount`（実データ）をそのまま出すため、点灯数が chainCount に一致すること、
 * BET が桁区切りで出ることを確かめる。存在しない機能（供託・局・親・ONLINE）は出さない。
 */
describe('TableHeader', () => {
  const litCount = (html: string) => html.match(/data-lit="true"/g)?.length ?? 0
  const pipCount = (html: string) => html.match(/data-lit=/g)?.length ?? 0

  it('BET を桁区切りで出す', () => {
    const html = renderToStaticMarkup(<TableHeader chainCount={0} maxChain={8} bet={1000} />)

    expect(html).toContain('data-testid="bet-amount"')
    expect(html).toContain('1,000')
  })

  it('ピップは maxChain 本で、chainCount 本だけ点灯する', () => {
    const html = renderToStaticMarkup(<TableHeader chainCount={3} maxChain={8} bet={2000} />)

    expect(pipCount(html)).toBe(8)
    expect(litCount(html)).toBe(3)
    expect(html).toContain('3 / 8')
  })

  it('平常時（chainCount=0）は全消灯', () => {
    const html = renderToStaticMarkup(<TableHeader chainCount={0} maxChain={8} bet={1000} />)

    expect(litCount(html)).toBe(0)
    expect(pipCount(html)).toBe(8)
  })

  it('上限まで連続和了すると全点灯', () => {
    const html = renderToStaticMarkup(<TableHeader chainCount={8} maxChain={8} bet={1000} />)

    expect(litCount(html)).toBe(8)
  })

  /** 存在しない機能を出さない（第1稿の差し戻し理由）。 */
  it('供託・局・親・ONLINE を出さない', () => {
    const html = renderToStaticMarkup(<TableHeader chainCount={1} maxChain={8} bet={1000} />)

    expect(html).not.toContain('供託')
    expect(html).not.toContain('親')
    expect(html).not.toContain('ONLINE')
  })
})
