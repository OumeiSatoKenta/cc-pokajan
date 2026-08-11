import react from '@vitejs/plugin-react'
import type { ConfigEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
//
// GitHub Pages はリポジトリ配下 /cc-pokajan/ で配信するため、build と preview だけ base を付ける。
// Vite 公式の「Conditional Config」パターンに従い command / isPreview で分岐する:
//   vite（dev）  → command 'serve', isPreview undefined/false → base '/'（Playwright の webServer はこれ）
//   vite build   → command 'build'                            → base '/cc-pokajan/'（デプロイ成果物）
//   vite preview → command 'serve', isPreview true            → base '/cc-pokajan/'（dist をサブパス検証）
//   vitest       → command 'serve', isPreview undefined/false → base '/'（base 非依存・無害）
// mode ではなく command/isPreview を使うのは、`vite build --mode X` で mode だけ上書きされても
// base が落ちないため。preview の command は 'build' ではなく 'serve' なので isPreview で拾う。
// isPreview は一部ツールが undefined を渡しうるため、Vite 公式の推奨どおり `=== true` で明示比較する。

// ★ リポジトリ名に対応。リポジトリを改名したらここを変える（＋必要なら public/CNAME）。
const REPO_BASE = '/cc-pokajan/'

// base 解決は本番ビルドでしか効かない分岐なので、tests/config/viteBase.test.ts から
// 検証できるよう純関数に切り出す。「テストは通るが本番だけ全アセット 404」を回帰で防ぐ。
export const resolveBase = (env: Pick<ConfigEnv, 'command' | 'isPreview'>): string =>
  env.command === 'build' || env.isPreview === true ? REPO_BASE : '/'

export default defineConfig((env) => ({
  base: resolveBase(env),
  plugins: [react()],
  test: {
    // エンジン層は DOM を使わない純粋 TS のため node 環境で十分。
    // UI コンポーネントのテストを追加する Step 4 で jsdom への切り替えを検討する。
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
}))
