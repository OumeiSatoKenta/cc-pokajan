import { describe, expect, it } from 'vitest'

import { resolveBase } from '../../vite.config'

/**
 * GitHub Pages サブパス配信のための base 解決の回帰テスト。
 *
 * **なぜ必要か**: この分岐は production ビルド（と preview）でしか効かず、dev/test では
 * base '/' のまま。手動の build/preview 検証だけに頼ると、誰かが後で `mode === 'production'`
 * などに書き換えても `npm test` は落ちず、「本番だけ全アセット 404」という、テストが通っても
 * 本番でしか出ない欠陥になる（CLAUDE.md が繰り返し警戒しているクラス）。command/isPreview →
 * base の対応をここで機械的に固定する。
 *
 * `vite preview` の command は 'build' ではなく 'serve' なので、preview は isPreview で拾う。
 * isPreview は undefined を取りうるため `=== true` の明示比較にしており、その意図も最後のケースで固定する。
 */
describe('resolveBase（vite.config の base 解決）', () => {
  it('vite build（command=build）は /cc-pokajan/', () => {
    expect(resolveBase({ command: 'build', isPreview: false })).toBe('/cc-pokajan/')
  })

  it('vite preview（command=serve, isPreview=true）は /cc-pokajan/', () => {
    expect(resolveBase({ command: 'serve', isPreview: true })).toBe('/cc-pokajan/')
  })

  it('vite dev（command=serve, isPreview=false）は /', () => {
    expect(resolveBase({ command: 'serve', isPreview: false })).toBe('/')
  })

  it('isPreview 未指定（undefined）でも dev は /（=== true の明示比較を固定）', () => {
    expect(resolveBase({ command: 'serve' })).toBe('/')
  })
})
