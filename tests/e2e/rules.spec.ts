import { expect, test, type Page } from '@playwright/test'

/**
 * ルール設定の E2E。
 *
 * 検証ロジックそのものは `tests/engine/rulesValidation.test.ts` と
 * `tests/ui/appSettings.test.ts` が持つ。ここは**永続化を挟んだ往復**、
 * つまり「保存した値が次の起動で本当に使われるか」「壊れた値でも起動するか」に絞る。
 */

const URL = '/?seed=13&fast=1&turnMs=1000'
const PREFS_KEY = 'cc-pokajan:prefs'

async function openRules(page: Page): Promise<void> {
  await page.goto(URL)
  await page.getByTestId('open-rules-button').click()
  await expect(page.getByTestId('rules-settings')).toBeVisible()
}

test('タイトルからルール設定を開ける', async ({ page }) => {
  await openRules(page)

  await expect(page.getByTestId('rule-startingScore')).toHaveValue('1000')
  await expect(page.getByTestId('rules-valid')).toBeVisible()
})

test('TODO(要実機確認) の項目に注記が出る', async ({ page }) => {
  await openRules(page)

  // 初期点と3人組の同色点は推定値
  await expect(page.locator('.settings__note').first()).toBeVisible()
})

test('値を変更して保存でき、リロード後も残る', async ({ page }) => {
  await openRules(page)

  await page.getByTestId('rule-startingScore').fill('1500')
  await page.getByTestId('save-rules').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  await page.reload()
  await page.getByTestId('open-rules-button').click()
  await expect(page.getByTestId('rule-startingScore')).toHaveValue('1500')
})

/** 差分で保存しているので、触っていない項目は保存されない。 */
test('変更していない項目は保存されない', async ({ page }) => {
  await openRules(page)

  await page.getByTestId('rule-startingScore').fill('1500')
  await page.getByTestId('save-rules').click()
  await expect(page.getByTestId('title-screen')).toBeVisible()

  const stored = await page.evaluate((key) => localStorage.getItem(key), PREFS_KEY)
  const prefs = JSON.parse(stored ?? '{}')

  expect(Object.keys(prefs.rulesOverride)).toEqual(['startingScore'])
})

test('デフォルトに戻せる', async ({ page }) => {
  await openRules(page)

  await page.getByTestId('rule-startingScore').fill('9999')
  await page.getByTestId('reset-rules').click()

  await expect(page.getByTestId('rule-startingScore')).toHaveValue('1000')
})

/**
 * 空欄を 0 として扱うと「消しただけ」が「0 を設定した」に化け、
 * 対局が始まらない設定が保存される。
 */
test('空欄のまま保存できない', async ({ page }) => {
  await openRules(page)

  await page.getByTestId('rule-startingScore').fill('')

  await expect(page.getByTestId('rules-errors')).toBeVisible()
  await expect(page.getByTestId('save-rules')).toBeDisabled()
})

test('数値でない入力は保存できない', async ({ page }) => {
  await openRules(page)

  await page.getByTestId('rule-startingScore').fill('abc')

  await expect(page.getByTestId('save-rules')).toBeDisabled()
})

test('対局が成立しない値は保存できない', async ({ page }) => {
  await openRules(page)

  /*
   * 初期コインが最低 BET を下回ると1局も始められない。
   *
   * 持ち時間で試さないのは、この画面が `?turnMs=` の指定を受けた既定値の上に
   * 乗っているため。`withTurnMs` は下限も一緒に下げるので、
   * 「初期値 < 下限」を作るには URL の指定値をさらに下回る必要があり、
   * テストの意図が URL パラメータに依存してしまう。
   */
  await page.getByTestId('rule-bet.initialWallet').fill('500')

  await expect(page.getByTestId('rules-errors')).toBeVisible()
  await expect(page.getByTestId('save-rules')).toBeDisabled()
})

/** 3の倍数でない点数は誤りではないが、伝える価値がある。 */
test('3で割り切れない点数は警告になるが保存できる', async ({ page }) => {
  await openRules(page)

  await page.getByTestId('rule-scores.triple.base').fill('100')

  await expect(page.getByTestId('rules-warnings')).toBeVisible()
  await expect(page.getByTestId('save-rules')).toBeEnabled()
})

test('保存した点数が対局に反映される', async ({ page }) => {
  await openRules(page)

  await page.getByTestId('rule-startingScore').fill('3000')
  await page.getByTestId('save-rules').click()

  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-1000').click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })

  // 初期点が反映されている（自分の持ち点表示）
  await expect(page.getByText('あなた（3,000点）')).toBeVisible()
})

/**
 * 保存値がそのままエンジンに渡ると、配牌の時点で例外になり
 * タイトル画面すら出せなくなる。永続化されるのでリロードでも回復しない。
 */
test('壊れたルール上書きが保存されていても既定値で起動する', async ({ page }) => {
  await page.goto(URL)
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        wallet: 10_000,
        lastSeed: 13,
        roster: null,
        rulesOverride: { handSize: 0, deckSize: -5 },
      }),
    )
  }, PREFS_KEY)
  await page.reload()

  await expect(page.getByTestId('title-screen')).toBeVisible()
  await expect(page.getByTestId('settings-fallback')).toBeVisible()

  // 既定値で遊べる
  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-1000').click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })
})

test('壊れたロスターが保存されていても既定値で起動する', async ({ page }) => {
  await page.goto(URL)
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({
        version: 1,
        wallet: 10_000,
        lastSeed: 13,
        roster: { version: 1, members: [], groups: [] },
        rulesOverride: null,
      }),
    )
  }, PREFS_KEY)
  await page.reload()

  await expect(page.getByTestId('title-screen')).toBeVisible()
  await expect(page.getByTestId('settings-fallback')).toBeVisible()
})

test('対局中は設定を開く導線が無い', async ({ page }) => {
  await page.goto(URL)
  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-1000').click()
  await expect(page.getByTestId('table-screen')).toBeVisible({ timeout: 10_000 })

  await expect(page.getByTestId('open-rules-button')).toBeHidden()
  await expect(page.getByTestId('open-roster-button')).toBeHidden()
})
