import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { AuthGate } from '../../src/ui/auth/AuthGate'

// gate 分岐の描画で本物の AuthProvider（aws-amplify を含む）を読み込まないようモックする。
// React.lazy は初回の同期描画で必ず Suspense fallback を出すため、モックの中身は描画結果に影響しない。
vi.mock('../../src/ui/auth/AuthProvider', () => ({ default: () => null }))

/**
 * AuthGate の描画分岐。純関数 authGateMode（authGate.test.ts）に加え、
 * 「AuthGate 本体が条件を無視して常に children を出す」欠陥も描画で固定する。
 */
describe('AuthGate 描画', () => {
  it('認証無効なら children を素通しで描画する（Pages 挙動）', () => {
    const html = renderToStaticMarkup(
      <AuthGate isAuthEnabled={false}>
        <span>APP_MARKER</span>
      </AuthGate>,
    )
    expect(html).toContain('APP_MARKER')
  })

  it('認証有効なら children を直接描画しない（ゲートで止め、fallback を出す）', () => {
    const html = renderToStaticMarkup(
      <AuthGate isAuthEnabled={true}>
        <span>APP_MARKER</span>
      </AuthGate>,
    )
    expect(html).not.toContain('APP_MARKER')
    expect(html).toContain('読み込み中')
  })
})
