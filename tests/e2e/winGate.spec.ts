import { expect, test, type Page } from '@playwright/test'

import { CLAIM_SEED, playUntilHumanDeclare, screen, startGame, url } from './helpers/table'

/**
 * 和了演出（Step 7-4 の停止 + Step 8-1 の2段構成）の E2E。
 *
 * リデューサが停止中のアクションを弾くことは `tests/ui/winGate.test.ts` が、
 * 各段の中身は `tests/ui/winCutIn.test.tsx` / `winResult.test.tsx` が固定している。
 * **ここでしか踏めないのは「タイマーが本当に動く／止まる」ところ**なので、
 * 段が自動で進むこと・自動で閉じること・閉じるまで盤面が動かないことに絞る。
 */

/** 和了が起きるまで対局を進める。**演出は閉じない。** */
async function playUntilWin(page: Page): Promise<boolean> {
  const overlay = page.getByTestId('win-overlay')
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline && !(await overlay.isVisible())) {
    if (await page.getByTestId('result-overlay').isVisible()) {
      break
    }
    if (await page.getByTestId('pass-button').isVisible()) {
      await page
        .getByTestId('pass-button')
        .click({ timeout: 5_000 })
        .catch(() => undefined)
    } else if ((await screen(page).getAttribute('data-phase')) === 'discard') {
      await page
        .getByTestId('card')
        .first()
        .click({ timeout: 5_000 })
        .catch(() => undefined)
    } else {
      await page.waitForTimeout(100)
    }
  }

  return overlay.isVisible()
}

/**
 * 人間が**自分で**和了するまで進める。見つかったら true。
 *
 * **CPU の和了では持ち時間の停止を検査できない。** 和了の直後はフェーズが
 * `selfDeclare` になるが、そのときの宣言権者は和了した本人なので、
 * CPU が和了した局面では人間の時計はそもそも動いていない（`decideTimeout` 参照）。
 * 人間が和了して初めて「演出中に人間の時計が動いている」状況が作れる。
 */
async function playUntilHumanWin(page: Page): Promise<boolean> {
  // 進行の手順は helpers の `playUntilHumanDeclare` に一本化する（Step 7-4 の「写しを2箇所直す」轍を避ける）。
  if (!(await playUntilHumanDeclare(page))) {
    return false
  }

  // Step 2 で人間のツモは「おまかせでプレフィル → 緑のツモで確定」の2段になった。
  // declare-button は選択欄に構成カードを入れるだけで、確定は declare-confirm が担う。
  await page
    .getByTestId('declare-button')
    .first()
    .click({ timeout: 5_000 })
    .catch(() => undefined)
  // プレフィル後、composed が有効になり確定ボタンが活性化する（クリックが活性を待つ）。
  await page
    .getByTestId('declare-confirm')
    .click({ timeout: 5_000 })
    .catch(() => undefined)
  return page.getByTestId('win-overlay').isVisible()
}

/**
 * 盤面が進んだかどうかを1つの値で見るための指紋。
 *
 * - 山札の残り: 自動進行が1手進むと必ず減る
 * - 自分の河の枚数: 持ち時間を止め忘れてツモ切りされると増える
 * - フェーズ: 時間切れで見送りが走ると `selfDeclare` から動く
 */
async function boardFingerprint(page: Page): Promise<string> {
  const wall = await page.getByTestId('wall-count').textContent()
  const myRiver = await page
    .locator('[data-testid="my-river"] [data-testid="river-list"]')
    .getAttribute('data-count')
  const phase = await screen(page).getAttribute('data-phase')

  return `${wall ?? '?'}/${myRiver ?? '?'}/${phase ?? '?'}`
}

/**
 * **止まっていることの検査。**
 *
 * 山札の残りは自動進行が1手進むたびに必ず減る。自分の河の枚数は、
 * **持ち時間を止め忘れてツモ切りされた**ときに増える。この2つを同時に見ることで、
 * 3つの効果のうち自動進行と持ち時間の両方が止まっていることを1回で押さえられる。
 *
 * 7-4 では持ち時間の停止を**タイマーの表示文字**で見ていたが、`withTurnMs` は
 * `minMs` も一緒に下げるため、短い持ち時間では表示が変わらない（下限に張り付く）。
 * つまりあの検査は短い `turnMs` では素通りしていた。
 */
test('和了で進行が止まり、確認を押さずに自動で閉じて再開する', async ({ page }) => {
  // 持ち時間を演出より短くする。止め忘れていれば演出中に何度も時間切れになる。
  await startGame(page, url(CLAIM_SEED, { fast: false, turnMs: 1_000 }))

  test.skip(!(await playUntilWin(page)), 'このシードでは和了が起きる前に終局した')

  const overlay = page.getByTestId('win-overlay')
  const before = await boardFingerprint(page)

  /*
   * 見えている間は盤面がまったく動かない。
   *
   * **期限を自分で持つ。** 期限を置かずにテスト全体のタイムアウトへ委ねると、
   * 自動クローズが壊れたときに3分待たされたうえ「`waitForTimeout` が遅い」という
   * 的外れなメッセージで落ちる（実際にそうなった）。
   */
  const deadline = Date.now() + 15_000
  while (await overlay.isVisible()) {
    expect(await boardFingerprint(page)).toBe(before)

    if (Date.now() > deadline) {
      throw new Error('和了演出が自動で閉じませんでした（確認を押さずに閉じるはず）')
    }
    await page.waitForTimeout(150)
  }

  /*
   * **何も操作していないのに閉じている。** 上のループは可視の間だけ回るので、
   * ここへ到達した時点で自動クローズが起きたことになる。
   */
  await expect(overlay).toBeHidden()

  // 閉じたら進行が再開する（止まったままにならない）
  await expect.poll(async () => boardFingerprint(page), { timeout: 20_000 }).not.toBe(before)
})

/**
 * **持ち時間が止まっていることの検査。**
 *
 * 人間が和了すると、演出が出ている間もフェーズは `selfDeclare` のまま
 * 宣言権が人間に残る（連続宣言のため）。つまり**人間の時計が動いている**唯一の局面。
 * ここで止め忘れると、演出を読んでいる間に見送りが走って次の手番へ進み、
 * さらに持ち時間まで削られる。
 *
 * 持ち時間（1秒）は演出（3.7秒）より短くしてあるので、
 * 止まっていなければ演出中に必ず時間切れが起きる。
 */
test('人間の和了では、演出中に持ち時間が進まない', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { fast: false, turnMs: 1_000 }))

  test.skip(!(await playUntilHumanWin(page)), 'このシードでは人間が和了しなかった')

  const overlay = page.getByTestId('win-overlay')
  const before = await boardFingerprint(page)
  expect(before).toContain('selfDeclare')

  const deadline = Date.now() + 15_000
  while (await overlay.isVisible()) {
    expect(await boardFingerprint(page)).toBe(before)

    if (Date.now() > deadline) {
      throw new Error('和了演出が自動で閉じませんでした')
    }
    await page.waitForTimeout(120)
  }
})

/**
 * **クリックは1段だけ進める。**
 *
 * 1回で全部消す実装だと、他家の和了に押しかけのクリックが重なったときに
 * 演出が丸ごと飛び、何が起きたのか分からないまま盤面が進む。
 */
test('クリック1回では閉じず、カットインから点数獲得結果へ進む', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { fast: false }))
  test.skip(!(await playUntilWin(page)), 'このシードでは和了が起きる前に終局した')

  const overlay = page.getByTestId('win-overlay')

  // 和了直後はカットイン段
  await expect(overlay).toHaveAttribute('data-stage', 'cutin')
  await expect(page.getByTestId('win-cutin')).toBeVisible()
  await expect(page.getByTestId('win-avatar')).toBeVisible()

  await overlay.click()

  // 閉じずに次の段へ進んでいる
  await expect(overlay).toHaveAttribute('data-stage', 'result')
  await expect(overlay).toBeVisible()
  await expect(page.getByTestId('win-score')).toContainText('+')
})

/**
 * 段が**時間で**進むこと。
 *
 * `data-stage` が `cutin` から `result` へ動くことで観測する。
 * クリックしないので、進むのはタイマーの働きだけによる。
 */
test('カットインは操作しなくても点数獲得結果へ進む', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { fast: false }))
  test.skip(!(await playUntilWin(page)), 'このシードでは和了が起きる前に終局した')

  const overlay = page.getByTestId('win-overlay')
  await expect(overlay).toHaveAttribute('data-stage', 'cutin')
  await expect(overlay).toHaveAttribute('data-stage', 'result', { timeout: 5_000 })
})

/**
 * 点数獲得結果の中身（Step 8-1 で役の絵札が加わった）。
 *
 * 順位の並べ替えは `layout` アニメーションなので、**実ブラウザでしか動かない**。
 * 単体テストは初期描画までしか見られない。
 */
test('点数獲得結果に役の絵札・獲得点・順位表が出る', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { fast: false }))
  test.skip(!(await playUntilWin(page)), 'このシードでは和了が起きる前に終局した')

  const overlay = page.getByTestId('win-overlay')
  await overlay.click()

  /*
   * **`data-stage` が変わっても中身はまだ入れ替わっていない。**
   * `AnimatePresence mode="wait"` は前の段の退場を待ってから次を入れるため、
   * 属性が先に動き、DOM の差し替えは次の描画になる。
   * 再試行しない `count()` をここで呼ぶと 0 を拾う（実際に一度落とした）。
   */
  await expect(page.getByTestId('win-result')).toBeVisible()

  // 役の構成カードが出る（役は最低3枚）
  const cardCount = await page.getByTestId('win-card').count()
  expect(cardCount).toBeGreaterThanOrEqual(3)

  await expect(page.getByTestId('win-yaku')).toBeVisible()
  await expect(page.getByTestId('win-score')).toContainText('+')

  // 順位表は全員分。増減は必ず出る（和了なら誰かの点数が動く）
  await expect(page.getByTestId('win-rank-row')).toHaveCount(4)
  await expect(page.getByTestId('win-rank-delta').first()).toBeVisible()
})

/**
 * **順位表が和了前から和了後へ切り替わること。**
 *
 * 並べ替えの見た目そのものは検査できないが、`data-phase` が
 * `before` → `after` へ動くことで「切り替えが起きた」ことは確かめられる。
 */
test('順位表が和了前の状態から和了後へ切り替わる', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { fast: false }))
  test.skip(!(await playUntilWin(page)), 'このシードでは和了が起きる前に終局した')

  await page.getByTestId('win-overlay').click()

  const ranking = page.getByTestId('win-ranking')
  await expect(ranking).toBeVisible()
  await expect(ranking).toHaveAttribute('data-phase', 'after', { timeout: 5_000 })
})

/**
 * OS の「視覚効果を減らす」設定の尊重。
 *
 * **減らす設定では最初から結果を出す。** 後から切り替える実装だと、
 * アニメーションが無いぶん「一瞬だけ和了前の順位が見えて、次の描画で入れ替わる」
 * というちらつきになる。
 *
 * **`page.emulateMedia()` を使う。** `test.use({ reducedMotion: 'reduce' })` は
 * この構成ではページに届かず（`matchMedia` が false のまま）、
 * **減らす設定を検査したつもりで通常の経路を検査する**ことになる。
 */
test('視覚効果を減らす設定では順位表が最初から和了後の状態で出る', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startGame(page, url(CLAIM_SEED, { fast: false }))
  test.skip(!(await playUntilWin(page)), 'このシードでは和了が起きる前に終局した')

  await page.getByTestId('win-overlay').click()

  const ranking = page.getByTestId('win-ranking')

  // 設定がページに届いていること自体を確かめる（届かないと以下が素通りする）
  await expect(ranking).toHaveAttribute('data-reduced', 'true')
  // 切り替えを待たずに after になっている
  await expect(ranking).toHaveAttribute('data-phase', 'after')
})

/**
 * **段の滞留時間は「視覚効果を減らす」設定でも変わらない。**
 *
 * 減らす設定は「動きを減らす」ものであって「読む時間を減らす」ものではない。
 * 動きを消すついでに段まで飛ばすと、減らす設定の人だけ和了を読めなくなる。
 */
test('視覚効果を減らす設定でもカットイン段から始まる', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await startGame(page, url(CLAIM_SEED, { fast: false }))
  test.skip(!(await playUntilWin(page)), 'このシードでは和了が起きる前に終局した')

  await expect(page.getByTestId('win-overlay')).toHaveAttribute('data-stage', 'cutin')
})
