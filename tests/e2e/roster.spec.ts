import { expect, test, type Page } from '@playwright/test'

/**
 * ロスター設定の E2E。
 *
 * IndexedDB・canvas・File API は jsdom を入れていない単体テストでは動かせないため、
 * **画像まわりの担保はここだけ**になる。純粋関数（切り出し矩形・CRUD・書き出し）は
 * それぞれの単体テストが持つので、ここでは実際のブラウザでしか確かめられない
 * 「保存される」「対局に出る」「リロードで残る」に絞る。
 */

const URL = '/?seed=13&fast=1&turnMs=1000'

/** 1×1 の赤い PNG。アップロードの検証に使う最小の実画像。 */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function openRoster(page: Page): Promise<void> {
  await page.goto(URL)
  await page.getByTestId('open-roster-button').click()
  await expect(page.getByTestId('roster-editor')).toBeVisible()
}

async function uploadImage(page: Page): Promise<void> {
  await page.getByTestId('pick-image').first().click()
  await page.getByTestId('image-input').setInputFiles({
    name: 'face.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_BASE64, 'base64'),
  })
}

test('タイトルからロスター設定を開ける', async ({ page }) => {
  await openRoster(page)

  // 同梱ロスターは6グループ
  await expect(page.getByTestId('editor-group')).toHaveCount(6)
  await expect(page.getByTestId('roster-valid')).toBeVisible()
})

test('グループとメンバーを追加・削除できる', async ({ page }) => {
  await openRoster(page)

  await page.getByTestId('add-group').click()
  await expect(page.getByTestId('editor-group')).toHaveCount(7)

  const before = await page.getByTestId('editor-member').count()
  await page.getByTestId('add-member').first().click()
  await expect(page.getByTestId('editor-member')).toHaveCount(before + 1)
})

/**
 * 検証は編集を妨げず、保存だけを止める。
 * 途中経過を作れないと、グループを1つずつ組み立てる操作ができなくなる。
 */
test('不正な構成では保存できず、理由が表示される', async ({ page }) => {
  await openRoster(page)

  // 空のグループを足すと「3〜5人」の条件を満たさなくなる
  await page.getByTestId('add-group').click()

  await expect(page.getByTestId('roster-errors')).toBeVisible()
  await expect(page.getByTestId('save-roster')).toBeDisabled()
})

test('グループ名を変更して保存でき、リロード後も残る', async ({ page }) => {
  await openRoster(page)

  const nameInput = page.getByLabel('グループ名').first()
  await nameInput.fill('わがチーム')
  await page.getByTestId('save-roster').click()

  // 保存するとタイトルへ戻る
  await expect(page.getByTestId('title-screen')).toBeVisible()

  await page.reload()
  await page.getByTestId('open-roster-button').click()
  await expect(page.getByLabel('グループ名').first()).toHaveValue('わがチーム')
})

test('デフォルトに戻せる', async ({ page }) => {
  await openRoster(page)

  await page.getByLabel('グループ名').first().fill('変更後')
  await page.getByTestId('reset-roster').click()

  await expect(page.getByLabel('グループ名').first()).not.toHaveValue('変更後')
  await expect(page.getByTestId('save-roster')).toBeEnabled()
})

/**
 * 画像の保存経路（canvas 変換 → IndexedDB → 表示）の担保。
 * 単体テストでは動かせないので、実際に PNG をアップロードして確かめる。
 */
test('画像をアップロードするとサムネイルに反映される', async ({ page }) => {
  await openRoster(page)
  await uploadImage(page)

  await expect(page.locator('.roster__thumb-image').first()).toBeVisible({ timeout: 10_000 })
})

test('アップロードした画像がリロード後も残る', async ({ page }) => {
  await openRoster(page)
  await uploadImage(page)
  await expect(page.locator('.roster__thumb-image').first()).toBeVisible({ timeout: 10_000 })

  await page.getByTestId('save-roster').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  await page.reload()
  await page.getByTestId('open-roster-button').click()
  await expect(page.locator('.roster__thumb-image').first()).toBeVisible({ timeout: 10_000 })
})

test('画像を消せる', async ({ page }) => {
  await openRoster(page)
  await uploadImage(page)
  await expect(page.locator('.roster__thumb-image').first()).toBeVisible({ timeout: 10_000 })

  await page.getByRole('button', { name: '消す' }).first().click()
  await expect(page.locator('.roster__thumb-image')).toHaveCount(0)
})

/** 画像でないファイルを選んでも既存の状態を壊さない。 */
test('画像でないファイルを選ぶとエラーを表示する', async ({ page }) => {
  await openRoster(page)

  await page.getByTestId('pick-image').first().click()
  await page.getByTestId('image-input').setInputFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('これは画像ではありません'),
  })

  await expect(page.getByTestId('roster-message')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('roster-editor')).toBeVisible()
})

test('編集したロスターが対局に反映される', async ({ page }) => {
  await openRoster(page)

  // 全グループの1人目をまとめて分かる名前に変える
  await page.getByLabel('メンバー名').first().fill('ゾロメンバー')
  await page.getByTestId('save-roster').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  // そのメンバーが登場するまで対局を始め直す必要はない。
  // 設定画面へ戻って保存されていることを確認する。
  await page.getByTestId('open-roster-button').click()
  await expect(page.getByLabel('メンバー名').first()).toHaveValue('ゾロメンバー')
})

test('ロスターを書き出せる', async ({ page }) => {
  await openRoster(page)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '書き出す' }).click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toBe('pokajan-roster.json')
  await expect(page.getByTestId('roster-message')).toContainText('書き出しました')
})

test('別形式の JSON を読み込んでも既存のロスターを壊さない', async ({ page }) => {
  await openRoster(page)

  const before = await page.getByTestId('editor-group').count()

  await page.getByTestId('import-input').setInputFiles({
    name: 'other.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ format: 'other-app', roster: {} })),
  })

  await expect(page.getByTestId('roster-message')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByTestId('editor-group')).toHaveCount(before)
})

test('書き出したファイルを読み込むと復元される', async ({ page }) => {
  await openRoster(page)

  await page.getByLabel('グループ名').first().fill('書き出し元')
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '書き出す' }).click()
  const download = await downloadPromise
  const path = await download.path()

  // 別の内容に変えてから読み戻す
  await page.getByLabel('グループ名').first().fill('上書き後')
  await page.getByTestId('import-input').setInputFiles(path)

  await expect(page.getByLabel('グループ名').first()).toHaveValue('書き出し元', {
    timeout: 10_000,
  })
})

/**
 * グループの記号。
 *
 * カードの角に出るため、**同じ画像・同じ色でもグループを区別できる**手がかりになる。
 * 名前の1文字目を既定値にしつつ、似た名前（ステラ組 / ソレイユ組）のために上書きできる。
 */
test('グループの記号を設定でき、保存後も残る', async ({ page }) => {
  await openRoster(page)

  // 未設定なら名前の1文字目が既定値として示される
  await expect(page.getByTestId('group-symbol').first()).toHaveAttribute('placeholder', 'ス')

  await page.getByTestId('group-symbol').first().fill('★')
  await page.getByTestId('save-roster').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  await page.getByTestId('open-roster-button').click()
  await expect(page.getByTestId('group-symbol').first()).toHaveValue('★')
})

test('記号を空にすると名前の1文字目に戻る', async ({ page }) => {
  await openRoster(page)

  const symbol = page.getByTestId('group-symbol').first()
  await symbol.fill('★')
  await symbol.fill('')

  await expect(symbol).toHaveAttribute('placeholder', 'ス')
})

test('対局中のカードにグループの記号が出る', async ({ page }) => {
  await page.goto(URL)
  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-1000').click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })

  // 手札の全カードに記号が付く
  const cards = await page.getByTestId('card').count()
  expect(cards).toBeGreaterThan(0)
  expect(await page.getByTestId('card-symbol').count()).toBe(cards)
})
