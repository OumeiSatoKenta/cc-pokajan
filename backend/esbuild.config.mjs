/*
 * game-api Lambda を単一ファイルにバンドルする。
 *
 * - platform=node / target=node22 / format=esm: Lambda の nodejs22.x（ESM ハンドラ）向け。
 * - AWS SDK v3（@aws-sdk/*）も**バンドルに含める**。ランタイム同梱版に依存しない（AWS 公式が strongly recommend。
 *   同梱される正確なマイナー版はリージョン/ランタイム更新で変わり得るため、pin した版を焼き込む方が将来の後方互換に強い）。
 *   ＝「たまたま同梱版で動く」に正しさを預けない（CLAUDE.md）。ulid も同梱されないのでバンドルに含める。
 * - alias @engine / @config: src/engine・src/config を物理移動せず共有する
 *   （tsconfig.json の paths・vitest.config.ts の resolve.alias と一致させること）。
 * - arm64 は Terraform 側（architectures=["arm64"]）で指定。バンドル自体はアーキ非依存。
 *
 * 出力 dist/index.mjs は CI（deploy-aws.yml）が zip して `aws lambda update-function-code` で反映する。
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const resolve = (relative) => fileURLToPath(new URL(relative, import.meta.url))

await build({
  entryPoints: [resolve('./src/index.ts')],
  outfile: resolve('./dist/index.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  minify: true,
  sourcemap: true,
  alias: {
    '@engine': resolve('../src/engine'),
    '@config': resolve('../src/config'),
  },
  logLevel: 'info',
})
