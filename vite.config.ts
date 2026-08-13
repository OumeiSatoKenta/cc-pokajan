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
//
// AWS 版（S3+CloudFront）はサイトルート配信のため base '/'。target は CI/CLI がインラインで渡す
// VITE_DEPLOY_TARGET（例: `VITE_DEPLOY_TARGET=aws npm run build`）で、config 評価時は .env ではなく
// process.env でしか読めない（Vite 公式: .env* は config 解決の後に読まれる）。aws を最優先し、
// それ以外（未知値・undefined 含む）は従来どおり GitHub Pages の command/isPreview 分岐にフォールバックする。
//
// 同じ VITE_DEPLOY_TARGET は src/config/deploy.ts の deriveDeployConfig も解釈する（実行時フラグはあちら／
// base はここ）。target 文字列の種類を増やすときは両方を同時に直すこと。かつ .env* ファイルには書かない
// （config 側は .env* を読めず process.env のみ見るため、書くと base と実行時フラグがソース不一致で食い違う）。
export const resolveBase = (
  env: Pick<ConfigEnv, 'command' | 'isPreview'>,
  target?: string,
): string => {
  if (target === 'aws') return '/'
  return env.command === 'build' || env.isPreview === true ? REPO_BASE : '/'
}

export default defineConfig((env) => ({
  base: resolveBase(env, process.env.VITE_DEPLOY_TARGET),
  plugins: [react()],
  test: {
    // エンジン層は DOM を使わない純粋 TS のため node 環境で十分。
    // UI コンポーネントのテストを追加する Step 4 で jsdom への切り替えを検討する。
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // 100 局シミュレーション（autoplay / unseenAutoplay の SEEDS=100、特に全ステップで
    // 不変条件を検査する重いケース）は、既定の 5s では CI の遅い Runner で時間切れになる。
    // ローカルは速く通るのに本番 CI だけ落ちるため、余裕のある上限にする（ハングは 30s で検出）。
    testTimeout: 30_000,
  },
}))
