import { expect, type Page } from '@playwright/test'

/**
 * 対局を進める E2E ヘルパ。
 *
 * **1箇所にまとめてあるのは、進行の手順が変わったときに直し漏れを起こさないため。**
 * Step 7-4 で和了が対局を止めるようになったとき、`playToEnd` が
 * `table.spec.ts` と `casino.spec.ts` に別々にあったせいで**同じ修正を2回**書いた。
 * 片方を忘れれば、そちらのテストだけが原因の分かりにくいタイムアウトで落ちる。
 */

export const HAND_SIZE = 7

/**
 * 人間が割り込みを選べる局面へ早く到達するシード。
 * `tests/ui/__seedsearch` 相当の探索で、11手で到達することを確認して選んだ。
 */
export const CLAIM_SEED = 13

/**
 * 演出の待ち時間だけを消す。持ち時間（ルール値）は `turnMs` で別に指定する。
 *
 * 既定の持ち時間は20秒。時間切れを検証するテストをその長さで回すと
 * 全体が現実的な時間で終わらないため、必要なテストだけ短い値を渡す。
 */
export function url(seed: number, options: { fast?: boolean; turnMs?: number } = {}): string {
  const fast = options.fast === false ? '' : '&fast=1'
  const turnMs = options.turnMs === undefined ? '' : `&turnMs=${options.turnMs}`
  return `/?seed=${seed}${fast}${turnMs}`
}

export function screen(page: Page) {
  return page.getByTestId('table-screen')
}

/**
 * 対局画面まで進める。
 *
 * Step 5 以降、対局は **BET を経由してしか始まらない**。
 * 各テストは対局そのものを検証するので、そこまでの導線はここへまとめる。
 */
export async function startGame(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.getByTestId('play-button').click()
  await page.getByTestId('bet-1000').click()
  await expect(screen(page)).toBeVisible({ timeout: 10_000 })
}

/**
 * **割り込みの**残り時間バー。
 *
 * バーは打牌・宣言でも表示されるため、種別で限定しないと
 * 打牌フェーズを割り込みと誤認する。
 */
export function claimTimer(page: Page) {
  return page.locator('[data-testid="turn-timer"][data-timer-kind="claim"]')
}

/**
 * **打牌の**残り時間バー。人間の手番でしか描画されない。
 *
 * `data-phase` は他家が捨てるときも `discard` になるため、
 * 「自分が捨てる番か」の判定にはこちらを使う。
 */
export function discardTimer(page: Page) {
  return page.locator('[data-testid="turn-timer"][data-timer-kind="discard"]')
}

/**
 * 山札の残り枚数。
 *
 * **進行が進んだことの証拠として使う。** 山札は決して増えない
 * （エンジンの不変条件テストが100局の全ステップで固定している）ため、
 * 「減った」は進行が再開したことを一方向に示す。ボタンの出入りで見ると、
 * 同じボタンが別の判断にも使われている場合に取り違える。
 */
export async function wallCount(page: Page): Promise<number> {
  const text = await page.getByTestId('wall-count').textContent()
  return Number(text?.replace(/\D/g, ''))
}

/**
 * 手札の先頭を捨てる。人間の手番が来るたびにこれで進める。
 *
 * クリックの失敗を握りつぶさない。押せるはずのボタンが押せない回帰を、
 * 別の場所の分かりにくいタイムアウトではなくその場で失敗させる。
 */
export async function discardFirst(page: Page): Promise<void> {
  const first = page.getByTestId('card').first()
  await expect(first).toBeEnabled({ timeout: 10_000 })
  await first.click()
}

/**
 * 和了演出が出ていれば閉じる。
 *
 * **すべての進行ヘルパがこれを呼ぶ必要がある。** Step 7-4 で和了が対局を止めるように
 * なったため、閉じずに `pass` や打牌を送っても**リデューサが受理しない**。
 * 放置すると「押しているのに進まない」状態でタイムアウトする。
 *
 * Step 8-1 で演出は数秒で自動的に閉じるようになったが、待つと1回あたり
 * 3.7秒かかる（`fast=1` なら 0）。ここでは Escape で即座に閉じる。
 * **Escape を使うのは、段によって出ているボタンが違うため。**
 * カットイン段には閉じるボタンが無い。
 *
 * 閉じたら true。閉じている間は盤面が動かないので、競合の心配がない。
 */
export async function dismissWinIfAny(page: Page): Promise<boolean> {
  const overlay = page.getByTestId('win-overlay')
  if (!(await overlay.isVisible())) {
    return false
  }

  await page.keyboard.press('Escape')
  await overlay.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
  return true
}

/** 見送るボタンを押す。 */
export async function pass(page: Page): Promise<void> {
  const button = page.getByTestId('pass-button')
  await expect(button).toBeVisible({ timeout: 10_000 })
  await button.click()
}

/**
 * 自分が捨てる番になるまで進める。
 *
 * 配牌直後に役が成立していると宣言フェーズで止まるため、
 * その場合は見送って先へ進める。
 */
export async function waitForMyDiscard(page: Page, deadlineMs = 30_000): Promise<void> {
  const deadline = Date.now() + deadlineMs

  while (Date.now() < deadline) {
    // 和了で止まっている間はフェーズが進まないので、まず演出を閉じる。
    if (await dismissWinIfAny(page)) {
      continue
    }

    const phase = await screen(page).getAttribute('data-phase')
    if (phase === 'discard') {
      return
    }
    if (phase === 'selfDeclare' && (await page.getByTestId('pass-button').isVisible())) {
      await pass(page)
    }
    await page.waitForTimeout(60)
  }

  throw new Error('自分の捨てる番に到達しませんでした')
}

/**
 * 進行を1手だけ進める。押せる操作が無ければ少し待つ。
 *
 * **進行の「手順」はこの1つの関数にしかない。** 下の3つのループは
 * 止まる条件だけが違う。手順を増やしたり順序を変えたりするときはここを直す。
 *
 * `strict` を立てると、押せるはずのボタンが押せない回帰をその場で失敗させる。
 * 立てない場合は、可視性の判定と操作の間に状態が動いたときの失敗を許容する
 * （終局まで走らせる用途では、次の周回で拾い直したほうが安定する）。
 *
 * **`passInClaimWindow` を立てないと割り込みの受付では見送らない。**
 * 受付そのものを目的地にするループ（`playUntilClaimWindow`）が、
 * 目的地に着いた同じ周回で見送ってしまい**通り過ぎる**のを防ぐ。
 * 受付が開いた瞬間は「割り込み種別のタイマーが出る」より
 * 「見送るボタンが出る」が先に観測されうるため、フェーズで判断する。
 */
async function advanceOneStep(
  page: Page,
  options: { strict?: boolean; passInClaimWindow?: boolean } = {},
): Promise<void> {
  // 和了で止まっている間はフェーズが進まないので、まず演出を閉じる。
  if (await dismissWinIfAny(page)) {
    return
  }

  const phase = await screen(page).getAttribute('data-phase')
  const mayPass = phase === 'selfDeclare' || options.passInClaimWindow === true

  if (mayPass && (await page.getByTestId('pass-button').isVisible())) {
    if (options.strict === true) {
      await pass(page)
      return
    }
    await page
      .getByTestId('pass-button')
      .click({ timeout: 5_000 })
      .catch(() => undefined)
    return
  }

  if (phase === 'discard') {
    if (options.strict === true) {
      await discardFirst(page)
      return
    }
    await page
      .getByTestId('card')
      .first()
      .click({ timeout: 5_000 })
      .catch(() => undefined)
    return
  }

  await page.waitForTimeout(60)
}

/**
 * 条件が満たされるまで進める。満たされたら true、期限切れなら false。
 *
 * 「終局まで」「割り込みの受付まで」以外の目的地が要るたびに
 * spec 側へ進行ループを書くと、7-4 の「同じ修正を2回書く」が再演する。
 */
export async function playUntil(
  page: Page,
  isDone: () => Promise<boolean>,
  deadlineMs = 60_000,
): Promise<boolean> {
  const deadline = Date.now() + deadlineMs

  while (Date.now() < deadline) {
    if (await isDone()) {
      return true
    }
    if (await page.getByTestId('result-overlay').isVisible()) {
      return false
    }
    await advanceOneStep(page, { passInClaimWindow: true })
  }
  return false
}

/**
 * **割り込みの受付**が開くまで進める。見つかったら true。
 *
 * 宣言フェーズ（`selfDeclare`）の宣言機会と混同しないこと。
 * 受付が開いているかは**割り込み種別の**残り時間バーの有無で判定する。
 */
export async function playUntilClaimWindow(page: Page, deadlineMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + deadlineMs

  while (Date.now() < deadline) {
    if (await claimTimer(page).isVisible()) {
      return true
    }
    if (await page.getByTestId('result-overlay').isVisible()) {
      return false
    }
    await advanceOneStep(page, { strict: true })
  }
  return false
}

/** 終局まで進める。捨てる番なら捨て、宣言・割り込みは見送る。 */
export async function playToEnd(page: Page, deadlineMs = 150_000): Promise<void> {
  const overlay = page.getByTestId('result-overlay')
  const deadline = Date.now() + deadlineMs

  while (Date.now() < deadline && !(await overlay.isVisible())) {
    await advanceOneStep(page, { passInClaimWindow: true })
  }
}
