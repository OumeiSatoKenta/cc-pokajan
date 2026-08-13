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

  // AWS 版（S3+CloudFront）はサイトルート配信。target='aws' は command/isPreview を問わず '/'。
  it('AWS ターゲット（target=aws）は build/preview/dev すべて /', () => {
    expect(resolveBase({ command: 'build', isPreview: false }, 'aws')).toBe('/')
    expect(resolveBase({ command: 'serve', isPreview: true }, 'aws')).toBe('/')
    expect(resolveBase({ command: 'serve', isPreview: false }, 'aws')).toBe('/')
  })

  // 未知の target・undefined は Pages の分岐へフォールバック（aws だけを特別扱いする）。
  it('未知/未指定の target は Pages 分岐にフォールバック（build→/cc-pokajan/, dev→/）', () => {
    expect(resolveBase({ command: 'build', isPreview: false }, 'foo')).toBe('/cc-pokajan/')
    expect(resolveBase({ command: 'serve', isPreview: false }, 'foo')).toBe('/')
    expect(resolveBase({ command: 'build', isPreview: false }, undefined)).toBe('/cc-pokajan/')
  })

  // target は厳密一致（trim/大文字小文字の吸収なし）。deploy.ts の deriveDeployConfig と対称に固定し、
  // deploy-aws.yml の手書き YAML で `VITE_DEPLOY_TARGET: AWS` のような typo を書いても aws 扱いしないことを担保。
  it('target の大文字・前後空白ゆらぎは aws 扱いしない（厳密一致・Pages 分岐へ）', () => {
    expect(resolveBase({ command: 'build', isPreview: false }, 'AWS')).toBe('/cc-pokajan/')
    expect(resolveBase({ command: 'build', isPreview: false }, 'aws ')).toBe('/cc-pokajan/')
    expect(resolveBase({ command: 'build', isPreview: false }, ' aws')).toBe('/cc-pokajan/')
  })
})
