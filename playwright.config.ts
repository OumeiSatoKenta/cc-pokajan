import { defineConfig, devices } from '@playwright/test'

/**
 * E2E の設定。
 *
 * Vitest とは拡張子で実行系を分けている（`vite.config.ts` の `include` は
 * `tests/**\/*.test.{ts,tsx}` を拾うため、`.spec.ts` は Vitest の対象に入らない）。
 */
const PORT = 5174

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: process.env.CI !== undefined,
  retries: process.env.CI !== undefined ? 1 : 0,
  reporter: 'list',
  // 1局を通しで進めるテストがあるため、既定の30秒では足りない。
  timeout: 180_000,

  use: {
    baseURL: `http://localhost:${PORT}`,
    // 失敗時だけ証跡を残す。成功時に大量の画像を貯めない。
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: process.env.CI === undefined,
    timeout: 60_000,
  },
})
