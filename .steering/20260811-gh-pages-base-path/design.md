# 実装アプローチ — GitHub Pages 公開 Step 1: base パス対応

## 変更対象

`vite.config.ts` のみ。

### 現状

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
```

`base` 未指定 → デフォルト `/`。GitHub Pages のサブパス配信では本番アセットが 404 になる。

### 変更後

Vite 公式の「Conditional Config」パターン（`command` / `isPreview`）で分岐する。base 解決は
`resolveBase` という純関数に切り出し、テスト（`tests/config/viteBase.test.ts`）で回帰を固定する。

```ts
import react from '@vitejs/plugin-react'
import type { ConfigEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// build と preview だけ base を /cc-pokajan/ にする:
//   vite（dev）  → command 'serve', isPreview undefined/false → base '/'（Playwright の webServer）
//   vite build   → command 'build'                            → base '/cc-pokajan/'（デプロイ成果物）
//   vite preview → command 'serve', isPreview true            → base '/cc-pokajan/'（dist をサブパス検証）
//   vitest       → command 'serve', isPreview undefined/false → base '/'（base 非依存・無害）
// isPreview は undefined を取りうるため Vite 公式の推奨どおり `=== true` で明示比較する。
const REPO_BASE = '/cc-pokajan/' // ★ リポジトリ改名時はここを変える（＋必要なら public/CNAME）

export const resolveBase = (env: Pick<ConfigEnv, 'command' | 'isPreview'>): string =>
  env.command === 'build' || env.isPreview === true ? REPO_BASE : '/'

export default defineConfig((env) => ({
  base: resolveBase(env),
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
}))
```

## 設計判断

### なぜ関数形 `defineConfig(({ command, isPreview }) => ...)` か

`base` を静的値ではなくビルド文脈で切り替えるため、`ConfigEnv` を受け取る関数形にする。
`vitest/config` の `defineConfig` は関数形をサポートする（既存の import をそのまま使える）。

### なぜ `mode` ではなく `command` / `isPreview` か（最重要）

要件は「dev/e2e は `/`、build と preview は `/cc-pokajan/`」。ここで **`vite preview` の `command` は
`'build'` ではなく `'serve'`**（dev と同じ）なので、`command` 単独では preview を dev と区別できない。
Vite はこの区別のために専用フラグ **`isPreview`** を用意しており、公式の「Conditional Config」節がこの用途を明示している。
そこで `command === 'build' || isPreview === true` とする（`isPreview` は undefined を取りうるため公式推奨どおり `=== true` の明示比較）。
これを純関数 `resolveBase` に切り出し、`tests/config/viteBase.test.ts` で回帰を固定する:

- `vite`（dev）→ `command 'serve'` / `isPreview false` → `/`（Playwright の webServer。受け入れ基準3）
- `vite build` → `command 'build'` → `/cc-pokajan/`（デプロイ成果物。受け入れ基準1）
- `vite preview` → `command 'serve'` / `isPreview true` → `/cc-pokajan/`（サブパス検証。受け入れ基準1）
- `vitest` → `command 'serve'` / `isPreview false` → `/`（base 非依存なので値は無害）

**当初は `mode === 'production'` 案だった**が、3軸コードレビューの [推奨]（欠陥・API 両軸が収束）で見直した。
`mode` 分岐は「build/preview が既定 mode のまま」という暗黙前提に依存し、`vite build --mode X` のように
mode だけ上書きされると base が黙って `/` に落ちる潜在的な脆さがあった（現行 npm scripts では未発現）。
`command`/`isPreview` は Vite 公式の正準パターンで、この前提に依存せず build/preview の一致を保証する。

### E2E を壊さない根拠

`playwright.config.ts` は `baseURL: http://localhost:5174`、`webServer: npm run dev`、
各テストは `page.goto('/')` などルート相対。dev は `command 'serve'` / `isPreview false` なので base `/` を保ち、
既存の goto は従来どおり解決する。**Playwright / playwright.config.ts / 既存の tests は一切変更不要**
（追加するのは `tests/config/viteBase.test.ts` の1本のみ。E2E には無関係）。

### Vitest への影響

Vitest（`npm test`）はノード環境でエンジン/UI ロジックを検査するだけで `base` に依存しない。
`test` ブロックを関数の戻り値内にそのまま残せば挙動不変。Vitest 実行時は `command 'serve'` /
`isPreview false` なので base は `'/'` に落ちるだけ ─ どのみち base に依存しないため実害なし。

## リスクと対応

| リスク | 対応 |
| --- | --- |
| `base` 無条件付与で Playwright 全滅 | `command`/`isPreview` 分岐で dev=`/` を維持。受け入れに `npx playwright test` 緑を含める |
| `preview` がサブパスで割れる | `command` は preview でも `'serve'` のため `isPreview` で拾う（`command === 'build' \|\| isPreview`） |
| `vite build --mode X` で base が落ちる | `mode` に依存せず `command`/`isPreview` で判定（Vite 公式の正準パターン） |
| 関数形への変換で `test` 設定が抜ける | `test` ブロックを戻り値オブジェクト内に維持。`npm test` 件数不変で確認 |

## 検証

- `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` 全 PASS
- `npx playwright test` 全 PASS（dev=`/` の砦）
- `npm run build && npm run preview` → `http://localhost:4173/cc-pokajan/` を目視（404 なし・一周回る）
- `npm run dev` → `http://localhost:5173/`（ルート）で従来どおり
