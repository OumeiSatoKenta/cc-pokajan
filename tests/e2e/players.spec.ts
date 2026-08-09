import { expect, test, type Page } from '@playwright/test'

/**
 * プレイヤー設定（座席アバター）の E2E。
 *
 * IndexedDB と File API は jsdom を入れていない単体テストでは動かせないため、
 * **画像が実際に保存され、席に出て、リロードで残ること**の担保はここだけになる。
 * 純粋関数（`parseAvatars` / `setAvatar` / `usedImageIds`）はそれぞれの単体テストが持つ。
 */

const URL = '/?seed=13&fast=1&turnMs=1000'

/** 1×1 の赤い PNG。アップロードの検証に使う最小の実画像。 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function openPlayers(page: Page): Promise<void> {
  await page.getByTestId('open-players-button').click()
  await expect(page.getByTestId('player-settings')).toBeVisible()
}

/** `index` 番目の席にアバターを設定する（保存はしない）。 */
async function uploadAvatar(page: Page, index: number): Promise<void> {
  await page.getByTestId('pick-avatar').nth(index).click()
  await page.getByTestId('avatar-file-input').setInputFiles({
    name: 'face.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
  // **その行に**画像が出たことを見る。全体の枚数で待つと、どの席に付いたか分からない。
  await expect(page.getByTestId('avatar-row').nth(index).getByTestId('avatar-image')).toBeVisible({
    timeout: 10_000,
  })
}

async function startGame(page: Page): Promise<void> {
  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-1000').click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })
}

test('タイトルからプレイヤー設定を開き、席の数だけ行がある', async ({ page }) => {
  await page.goto(URL)
  await openPlayers(page)

  await expect(page.getByTestId('avatar-row')).toHaveCount(4)
  await expect(page.getByTestId('avatar-row').nth(0)).toContainText('あなた')
  await expect(page.getByTestId('avatar-row').nth(1)).toContainText('下家')
  await expect(page.getByTestId('avatar-row').nth(2)).toContainText('対面')
  await expect(page.getByTestId('avatar-row').nth(3)).toContainText('上家')
})

test('アバターを設定すると席に出て、リロード後も残る', async ({ page }) => {
  await page.goto(URL)
  await openPlayers(page)

  // 自分（0番）と対面（2番）に設定する
  await uploadAvatar(page, 0)
  await uploadAvatar(page, 2)
  await page.getByTestId('save-players').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  await startGame(page)
  await expect(page.getByTestId('seat-avatar')).toHaveCount(2, { timeout: 10_000 })

  // リロードして設定画面に戻っても残っている
  await page.goto(URL)
  await openPlayers(page)
  await expect(page.getByTestId('avatar-image')).toHaveCount(2, { timeout: 10_000 })
})

/**
 * **着手前に見つけた欠陥の回帰。**
 *
 * `pruneImages` は渡された ID **以外を全部消す**。ロスター保存時の keep 集合が
 * ロスターぶんしか無いと、ロスター設定を開いて保存するだけで全アバターが消える。
 * `usedImageIds(roster, avatars)` を必須2引数にして塞いだが、
 * 実際に消えないことは IndexedDB を触るここでしか確かめられない。
 */
test('アバター設定後にロスターを保存してもアバターが消えない', async ({ page }) => {
  await page.goto(URL)
  await openPlayers(page)
  await uploadAvatar(page, 0)
  await page.getByTestId('save-players').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  // ロスター設定を開いて、何も変えずに保存する
  await page.getByTestId('open-roster-button').click()
  await expect(page.getByTestId('roster-editor')).toBeVisible()
  await page.getByTestId('save-roster').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  // アバターが生き残っていること
  await openPlayers(page)
  await expect(page.getByTestId('avatar-image')).toHaveCount(1, { timeout: 10_000 })
})

test('アバターを消せる', async ({ page }) => {
  await page.goto(URL)
  await openPlayers(page)
  await uploadAvatar(page, 0)

  await page.getByTestId('clear-avatar').click()
  await expect(page.getByTestId('avatar-image')).toHaveCount(0)

  await page.getByTestId('save-players').click()
  await openPlayers(page)
  await expect(page.getByTestId('avatar-image')).toHaveCount(0)
})

/** アバターは飾りなので、未設定でも対局は成立しなければならない。 */
test('アバター未設定でも対局できる', async ({ page }) => {
  await page.goto(URL)
  await startGame(page)

  await expect(page.getByTestId('seat-avatar')).toHaveCount(0)
  await expect(page.getByTestId('seat-score')).toHaveCount(3)
})

/** 設定はタイトルからしか開けない（既存の `GO_SETTINGS` の方針）。 */
test('対局中はプレイヤー設定の導線が無い', async ({ page }) => {
  await page.goto(URL)
  await startGame(page)

  await expect(page.getByTestId('open-players-button')).toHaveCount(0)
})
