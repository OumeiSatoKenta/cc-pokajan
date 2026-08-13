import { expect, test } from '@playwright/test'

import { url } from './helpers/table'

/**
 * Pages 版（既定 github-pages・認証無効）は aws-amplify / 認証チャンクを実行時に取得しない。
 *
 * 受け入れ基準「Pages の実行時に aws-amplify を読み込まない」を、dist の静的比較ではなく
 * **ブラウザの実ネットワーク**で固定する（CLAUDE.md 9-3/10-2「静的チェックは実行時のズレを見逃す」の轍）。
 * AuthGate が素通しし、lazy chunk（AuthProvider＝aws-amplify を含む）が一度も fetch されないことを担保する。
 * 認証チャンクは初回レンダリング時に読まれるため、タイトル→BET→対局画面まで起動できれば十分に固定できる。
 */
test('Pages 版は認証を要求せず、認証チャンク(aws-amplify)を実行時に取得しない', async ({
  page,
}) => {
  const authRequests: string[] = []
  page.on('request', (req) => {
    if (/amplify|AuthProvider|cognito-idp/i.test(req.url())) authRequests.push(req.url())
  })

  await page.goto(url(13, { fast: true, turnMs: 1000 }))

  // 認証を要求されず、いきなりタイトル画面が触れる（＝ AuthGate 素通し）。
  await expect(page.getByTestId('title-screen')).toBeVisible({ timeout: 10_000 })

  // タイトル → BET → 対局画面まで起動しても、認証チャンクは取得されない。
  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-1000').click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })

  expect(authRequests, `想定外の認証リクエスト: ${authRequests.join(', ')}`).toEqual([])
})
