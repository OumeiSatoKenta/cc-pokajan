import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/*
 * backend の独立テスト設定。root の vitest（tests/**）とは別グラフで backend/tests/** を実行する。
 *
 * `@engine/*`・`@config/*` を tsconfig.json の paths と同じ先へ解決する。正規表現形の alias を使うのは、
 * 文字列前方一致だと `@engine`（barrel なし）自体の解決が曖昧になるため。サブパスを $1 で展開する。
 * DynamoDB は実 AWS を叩かず、注入した偽 doc クライアントでテストする（環境は node 既定）。
 */
export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@engine\/(.*)$/,
        replacement: fileURLToPath(new URL('../src/engine/$1', import.meta.url)),
      },
      {
        find: /^@config\/(.*)$/,
        replacement: fileURLToPath(new URL('../src/config/$1', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
