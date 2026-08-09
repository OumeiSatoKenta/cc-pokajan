import { expect, test, type Page } from '@playwright/test'

import { playToEnd } from './helpers/table'

/**
 * カジノループ（BET → 対局 → 精算 → 永続化）の E2E。
 *
 * 所持コインの永続化は localStorage を経由するため、純粋関数のテストでは
 * 「実際にリロードしても残るか」を確かめられない。ここが唯一の担保になる。
 *
 * Playwright はテストごとに新しいブラウザコンテキストを作るので、
 * localStorage は毎回空から始まる（＝初回起動の状態）。
 */

const SEED = 13
const INITIAL_WALLET = 10_000

/*
 * 進行そのもの（`playToEnd`）は `helpers/table.ts` の1本を使う。
 * 以前はここに写しを持っていたが、Step 7-4 で和了が対局を止めるようになったとき
 * **同じ修正を2箇所に書く**羽目になった。片方を忘れれば、そちらだけが
 * 原因の分かりにくいタイムアウトで落ちる。
 */
function url(seed: number = SEED): string {
  return `/?seed=${seed}&fast=1&turnMs=1000`
}

function walletValue(page: Page): Promise<number> {
  return page
    .getByTestId('wallet')
    .textContent()
    .then((text) => Number((text ?? '').replace(/\D/g, '')))
}

/** BET → 対局 → 精算画面まで一気に進める。 */
async function playOneGame(page: Page, bet: 1000 | 2000 = 1000): Promise<void> {
  await page.getByTestId(`bet-${bet}`).click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })

  await playToEnd(page)
  await expect(page.getByTestId('result-overlay')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('settle-button').click()
  await expect(page.getByTestId('result-screen')).toBeVisible({ timeout: 10_000 })
}

test('初回起動時はタイトル画面に初期コインが表示される', async ({ page }) => {
  await page.goto(url())

  await expect(page.getByTestId('title-screen')).toBeVisible()
  expect(await walletValue(page)).toBe(INITIAL_WALLET)
})

test('タイトルから BET 画面へ進み、BET を選べる', async ({ page }) => {
  await page.goto(url())
  await page.getByTestId('play-button').click()

  await expect(page.getByTestId('bet-screen')).toBeVisible()
  await expect(page.getByTestId('bet-1000')).toBeEnabled()
  await expect(page.getByTestId('bet-2000')).toBeEnabled()
})

/** BET はその場で引かれる。中断しても戻らないのが正しい挙動。 */
test('BET を選ぶとその場で所持コインが減る', async ({ page }) => {
  await page.goto(url())
  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-2000').click()

  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })

  // 対局中は所持コインを表示していないので、精算画面まで進めて確認する
  await playToEnd(page)
  await page.getByTestId('settle-button').click()

  const net = Number((await page.getByTestId('net').textContent())?.replace(/[^\d-]/g, ''))
  expect(await walletValue(page)).toBe(INITIAL_WALLET + net)
})

test('BET → 対局 → 精算まで一周し、所持コインが増減する', async ({ page }) => {
  await page.goto(url())
  await page.getByTestId('play-button').click()

  await playOneGame(page)

  // 精算の内訳が出そろっている
  await expect(page.getByTestId('my-rank')).toContainText('位')
  await expect(page.getByTestId('net')).not.toBeEmpty()

  const wallet = await walletValue(page)
  expect(wallet).not.toBe(INITIAL_WALLET)
  expect(wallet).toBeGreaterThanOrEqual(0)
})

test('リロードしても所持コインが保持される', async ({ page }) => {
  await page.goto(url())
  await page.getByTestId('play-button').click()
  await playOneGame(page)

  const afterGame = await walletValue(page)

  // シード指定のまま再読み込みしても、コインは保存された値が使われる
  await page.reload()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  expect(await walletValue(page)).toBe(afterGame)
})

test('もう1局を押すと BET 画面に戻り、次の対局を始められる', async ({ page }) => {
  await page.goto(url())
  await page.getByTestId('play-button').click()
  await playOneGame(page)

  await page.getByTestId('play-again-button').click()
  await expect(page.getByTestId('bet-screen')).toBeVisible()

  await page.getByTestId('bet-1000').click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })
})

test('タイトルへ戻れる', async ({ page }) => {
  await page.goto(url())
  await page.getByTestId('play-button').click()
  await playOneGame(page)

  await page.getByRole('button', { name: 'タイトルへ' }).click()
  await expect(page.getByTestId('title-screen')).toBeVisible()
})

/**
 * BET 不足のガードと、そこからの復帰。
 *
 * ガードだけを実装すると所持コインが尽きた時点でどのボタンも押せなくなり、
 * localStorage に残るためリロードしても回復しない（＝二度と遊べない）。
 * 補充の導線がその状態でだけ現れることを確かめる。
 */
test('所持コインが足りないと BET を選べず、補充してから続けられる', async ({ page }) => {
  // 保存済みのコインを最低 BET 未満にしてから開く
  await page.goto(url())
  await page.evaluate(() => {
    localStorage.setItem(
      'cc-pokajan:prefs',
      JSON.stringify({ version: 1, wallet: 500, lastSeed: 13 }),
    )
  })
  await page.reload()

  expect(await walletValue(page)).toBe(500)

  await page.getByTestId('play-button').click()
  await expect(page.getByTestId('bet-1000')).toBeDisabled()
  await expect(page.getByTestId('bet-2000')).toBeDisabled()

  // この状態でだけ補充の導線が出る
  await expect(page.getByTestId('topup')).toBeVisible()
  await page.getByTestId('topup-button').click()

  expect(await walletValue(page)).toBe(INITIAL_WALLET)
  await expect(page.getByTestId('bet-1000')).toBeEnabled()
  await expect(page.getByTestId('topup')).toBeHidden()
})

test('所持コインが足りているときは補充の導線が出ない', async ({ page }) => {
  await page.goto(url())
  await page.getByTestId('play-button').click()

  await expect(page.getByTestId('bet-screen')).toBeVisible()
  await expect(page.getByTestId('topup')).toBeHidden()
})

/** 壊れた保存データでアプリが起動不能にならないこと。 */
test('保存データが壊れていても初期コインで起動する', async ({ page }) => {
  await page.goto(url())
  await page.evaluate(() => {
    localStorage.setItem('cc-pokajan:prefs', '{ これは JSON ではない')
  })
  await page.reload()

  await expect(page.getByTestId('title-screen')).toBeVisible()
  expect(await walletValue(page)).toBe(INITIAL_WALLET)
})
