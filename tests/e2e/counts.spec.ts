import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  CLAIM_SEED,
  discardFirst,
  playUntil,
  startGame,
  url,
  waitForMyDiscard,
} from './helpers/table'

/**
 * 残り枚数の確認（Step 8-2）。
 *
 * **ホバーの受け口がどこにあるか**を確かめられるのはここだけ。単体テストは
 * `renderToStaticMarkup` の文字列しか見られず、マウスイベントが存在しない。
 */

/** `rules.copiesPerMemberColor`。1メンバー1色あたりのカード枚数。 */
const COPIES_PER_MEMBER_COLOR = 3

/** 待ちが配牌直後から立っているシード（`table.spec.ts` の黄色枠の検証と同じ）。 */
const WAITING_SEED = 20260806

/**
 * 対局開始直後（自動で1枚引いた後）に待ちが無いシード。
 *
 * **配牌の7枚ではなく8枚で数えること。** 画面が待ちを出すのは自動の `DRAW` の後で、
 * 7枚で探すと「引いたら待ちができる」シードを選んでしまう（実際に一度そうなった）。
 * 1〜167 に1件しかないほど珍しい。
 */
const NO_WAIT_SEED = 167

/**
 * 手札の `<li>`。**カードそのものではない。**
 *
 * ホバーの受け口は `<li>` にある。捨てられない局面の `CardView` は
 * `disabled` の `<button>` になり、無効化されたボタンにはマウスイベントが来ないため。
 */
function handItem(page: Page, index: number): Locator {
  return page.locator('[data-testid="hand"] > li').nth(index)
}

/** カードの色をクラス名から読む。`data-*` を増やさずに済ませる。 */
async function colorOf(item: Locator): Promise<string> {
  const classes = (await item.locator('[data-testid="card"]').getAttribute('class')) ?? ''
  const matched = /card--(pink|blue|orange)/.exec(classes)

  if (matched?.[1] === undefined) {
    throw new Error(`カードの色が読み取れませんでした: "${classes}"`)
  }
  return matched[1]
}

test('手札の絵札をホバーすると色ごとの残り枚数が出る', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  const item = handItem(page, 0)
  await item.hover()

  await expect(page.getByTestId('card-counts')).toBeVisible()
  await expect(page.getByTestId('card-count')).toHaveCount(COPIES_PER_MEMBER_COLOR)

  /*
   * ホバーした札の色は**必ず満額より少ない**。その1枚が自分の手札にあり、
   * 手札は「見えているカード」だからである。満額のままなら手札を数えていない。
   */
  const color = await colorOf(item)
  const count = page.locator(`[data-testid="card-count"][data-color="${color}"]`)
  const unseen = Number(await count.getAttribute('data-unseen'))

  expect(unseen).toBeGreaterThanOrEqual(0)
  expect(unseen).toBeLessThanOrEqual(COPIES_PER_MEMBER_COLOR - 1)
})

test('手札から離れると残り枚数が消える', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  await handItem(page, 0).hover()
  await expect(page.getByTestId('card-counts')).toBeVisible()

  // 卓の別の場所へ動かす。`<li>` の外に出たので消えるはず。
  await page.getByTestId('wall-count').hover()
  await expect(page.getByTestId('card-counts')).toBeHidden()
})

/**
 * **この機能の要。**
 *
 * 受け口を `CardView` に付けると、捨てられない局面では `disabled` の
 * `<button>` になってマウスイベントが来ず、「自分の捨てる番のときしか
 * 調べられない」機能になる。調べたいのは打つ瞬間だけではない。
 *
 * 「押せない」と「数えられる」が**同時に成り立つ瞬間**を捉える。
 * 別々に確かめると、その間に手番が戻ってきて意味を失う。
 *
 * **毎回いったん手札の外へ出す。** 出さないと、押せた頃に出したツールチップが
 * そのまま残っているだけで通ってしまう（マウスが動かなければ `mouseleave` は
 * 起きない）。受け口を `CardView` へ移す壊し方でこのテストが**通ってしまった**ため、
 * 消えたことを確かめてから掛け直す形にした。
 */
test('自分の手番でなくても残り枚数を調べられる', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { fast: false }))

  await waitForMyDiscard(page)
  await discardFirst(page)

  const item = handItem(page, 0)
  const card = page.getByTestId('card').first()
  const counts = page.getByTestId('card-counts')

  await expect(async () => {
    await page.getByTestId('wall-count').hover()
    await expect(counts).toBeHidden({ timeout: 1_000 })

    await expect(card).toBeDisabled({ timeout: 1_000 })
    await item.hover()
    await expect(card).toBeDisabled({ timeout: 1_000 })
    await expect(counts).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
})

test('テンパイすると待ち一覧が出て、各待ちの残り枚数が並ぶ', async ({ page }) => {
  await startGame(page, url(WAITING_SEED))

  const panel = page.getByTestId('wait-panel')
  expect(await playUntil(page, () => panel.isVisible())).toBe(true)

  // 一覧はフロー外オーバーレイ。開かないと「見える」ことを検証できない
  // （`count()`/`getAttribute()` は display:none でも取れるため、開けなくなる回帰を見逃す）。
  await panel.getByTestId('wait-trigger').click()
  const rows = panel.getByTestId('wait-row')
  await expect(rows.first()).toBeVisible()
  const shown = await rows.count()

  expect(shown).toBeGreaterThan(0)
  // 上限を超えて並べない（60件まで出うるので、卓が埋まらないように打ち切る）。
  expect(shown).toBeLessThanOrEqual(6)

  for (let index = 0; index < shown; index++) {
    const unseen = Number(await rows.nth(index).getAttribute('data-unseen'))

    expect(unseen).toBeGreaterThanOrEqual(0)
    expect(unseen).toBeLessThanOrEqual(COPIES_PER_MEMBER_COLOR)
  }
})

/**
 * 待ち一覧は**テンパイのときだけ**出る。枠が常に居座ると卓の高さを取り続ける。
 *
 * 開始時にテンパイしていないシードは珍しい（`NO_WAIT_SEED` の注記を参照）。ここを
 * 「出ていなければ良し」で書くと、テンパイしているシードでは何も検査しない
 * テストになるため、**出ていないことを確かめてから、出るまで進める**。
 */
test('待ちが無いうちは出ず、テンパイしたら出る', async ({ page }) => {
  await startGame(page, url(NO_WAIT_SEED))

  const panel = page.getByTestId('wait-panel')
  await expect(panel).toHaveCount(0)

  // テンパイすると「待ち N件」トリガが出る（Step 10-1）。
  expect(await playUntil(page, () => panel.isVisible())).toBe(true)

  // 一覧はフロー外オーバーレイ。トリガを開くと各待ちの行が読める。
  await panel.getByTestId('wait-trigger').click()
  await expect(panel.getByTestId('wait-row').first()).toBeVisible()
})
