import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// tests/config/ から2つ上がリポジトリルート。
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * monorepo workspaces の健全性ガード。
 *
 * npm 11 は、package.json が workspace を宣言していてもメンバーのディレクトリ/package.json が
 * 実在しない場合、`npm ci` を **エラーにせず黙ってスキップして exit 0** で通す。つまり backend/ が
 * 誤って削除・.gitignore されても、本番 Pages デプロイのゲート（deploy.yml の `npm ci`）は緑のまま
 * ＝「壊れているのに CI が緑」。npm の失敗に頼れないため、宣言と実体の一致をここで機械的に固定する。
 */
describe('monorepo workspaces の健全性', () => {
  const pkg = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8')) as {
    workspaces?: readonly string[]
  }

  it('root package.json は backend を workspace に宣言している', () => {
    expect(pkg.workspaces ?? []).toContain('backend')
  })

  it('宣言した workspace メンバー backend/package.json が実在する（npm ci の暗黙スキップ対策）', () => {
    expect(existsSync(resolve(repoRoot, 'backend/package.json'))).toBe(true)
  })
})
