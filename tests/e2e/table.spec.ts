import { expect, test, type Page } from '@playwright/test'

import {
  CLAIM_SEED,
  HAND_SIZE,
  discardFirst,
  discardTimer,
  playToEnd,
  playUntilClaimWindow,
  playUntilHumanClaim,
  playUntilHumanDeclare,
  screen,
  startGame,
  url,
  waitForMyDiscard,
  wallCount,
} from './helpers/table'

/**
 * 対局画面の E2E。
 *
 * タイマーと `useEffect` に依存する振る舞い（自動進行・受付時間の経過）は
 * 純粋関数のテストでは検証できないため、ここが唯一の担保になる。
 *
 * `seed` を固定するのは再現性のため。到達する局面は配牌に依存するので、
 * 固定しないと「たまたまその局面にならない」ときに落ちる不安定なテストになる。
 *
 * 和了の確認ゲートは `winGate.spec.ts`。
 */

test('対局画面が表示され、場の情報が揃っている', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  await expect(screen(page)).toBeVisible()
  await expect(page.getByTestId('wall-count')).toContainText('枚')
  await expect(page.getByTestId('bonus-members')).not.toBeEmpty()
  await expect(page.getByTestId('seat-score')).toHaveCount(3)
})

test('起動すると自動で1枚引き、捨てる操作を待つ状態になる', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  // 引くのは選択ではないので自動で行われる。人間は捨てる判断から始める。
  await waitForMyDiscard(page)
  await expect(page.getByText('捨てるカードを選んでください')).toBeVisible()
  // 引いた1枚を持っているので規定枚数 + 1
  await expect(page.getByTestId('card')).toHaveCount(HAND_SIZE + 1)
})

test('カードをクリックするとその1枚が手札から消える', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))
  await waitForMyDiscard(page)

  const first = page.getByTestId('card').first()
  const uid = await first.getAttribute('data-uid')
  expect(uid).not.toBeNull()

  await first.click()

  // 枚数で見ないのは、退場アニメーション中のカードが一時的に DOM に残るため。
  await expect(page.locator(`[data-testid="card"][data-uid="${uid}"]`)).toHaveCount(0, {
    timeout: 10_000,
  })
})

test('待ちに寄与するカードが黄色枠で強調される', async ({ page }) => {
  await startGame(page, url(20260806))

  await expect(page.locator('.card--waiting').first()).toBeVisible({ timeout: 15_000 })
})

/**
 * 待ちのちらつき解消（Step 10-1）。
 *
 * 待ち一覧を手札の上の常時フロー配置から、ヘッダー内の「待ち N件」トリガ＋
 * フロー外オーバーレイに変えた。**フローに戻すと展開で手札が下へ押し出される**ため、
 * 「トリガはヘッダー内」「展開しても手札の位置が動かない」を座標で固定する。
 */
test('待ちトリガはヘッダー内にあり、展開しても手札が動かず Escape で閉じる', async ({ page }) => {
  await startGame(page, url(20260806))

  const trigger = page.getByTestId('wait-trigger')
  await expect(trigger).toBeVisible({ timeout: 15_000 })

  // 常時ある行（ヘッダー）に置く。手札の上のフローへ戻るとこの構造が崩れる。
  await expect(page.locator('.table__mine-head [data-testid="wait-trigger"]')).toBeVisible()

  const overlay = page.getByTestId('wait-overlay')
  await expect(overlay).toBeHidden()

  const before = await page.getByTestId('hand').boundingBox()

  // クリック（＝タップ相当）で展開。フロー外オーバーレイなので手札は動かない。
  await trigger.click()
  await expect(overlay).toBeVisible()

  const after = await page.getByTestId('hand').boundingBox()
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1)

  /*
   * 展開中でも横スクロールを出さない。オーバーレイの幅指定を誤ると
   * （`min-width: max-content` が `max-width` に勝つ等）待ちの件数ぶん右へ伸び、
   * このシード（待ちが複数件）で数百〜千px級の横あふれを起こす。
   */
  const hOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(hOverflow).toBeLessThanOrEqual(1)

  // ホバーの覗き見と混ざらないようマウスを離してから Escape で閉じる（ピン留めの解除）。
  await page.mouse.move(0, 0)
  await expect(overlay).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(overlay).toBeHidden()
})

/** PC ではホバーで覗け、離すと閉じる（ピン留めせずに読める経路）。 */
test('待ちトリガはホバーで覗け、離すと閉じる', async ({ page }) => {
  await startGame(page, url(20260806))

  const trigger = page.getByTestId('wait-trigger')
  await expect(trigger).toBeVisible({ timeout: 15_000 })

  const overlay = page.getByTestId('wait-overlay')
  await expect(overlay).toBeHidden()

  await trigger.hover()
  await expect(overlay).toBeVisible()

  await page.mouse.move(0, 0)
  await expect(overlay).toBeHidden()
})

/**
 * ゲーム風ボタンの色分け（Step 10-2）が**実際に描画される**ことを computed style で固定する。
 *
 * `.button--tsumo`/`.button--ron` は table.css にあり、App.css の `.button` ベースより**前**に
 * バンドルされる。単一クラス（0,1,0）では後勝ちのベースに背景・文字色・太字を潰され、
 * 影だけ残る「幽霊ボタン」になる（3軸レビューが実測で捕えた）。複合クラス `.button.button--tsumo`
 * （0,2,0）で詳細度を確保して直した。class 名だけを見る単体テストではこの事故を検出できないため、
 * 実アプリのスタイルシート下で `backgroundImage` を実測する。
 */
test('操作ボタンの色分け（ツモ=緑/ロン=赤）が実際に描画される', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('play-button')).toBeVisible()

  const bg = await page.evaluate(() => {
    const bgOf = (cls: string) => {
      const el = document.createElement('button')
      el.className = `button ${cls}`
      document.body.appendChild(el)
      const image = getComputedStyle(el).backgroundImage
      el.remove()
      return image
    }
    return {
      tsumo: bgOf('button--tsumo'),
      ron: bgOf('button--ron'),
      ghost: bgOf('button--ghost'),
    }
  })

  // フィル系はグラデが乗る（ベースに潰されていない）。
  expect(bg.tsumo).toContain('gradient')
  expect(bg.ron).toContain('gradient')
  // 見送る（ゴースト）はグラデ無しで、フィル系と区別される。
  expect(bg.ghost).not.toContain('gradient')
})

/**
 * 「CPU は人間の入力を待たない」ことの直接的な検証。
 *
 * 設計上もっとも壊れやすい箇所だったため、挙動からの推測ではなく
 * 未表明の CPU 数を画面から観測して確かめる。
 */
test('人間が宣言窓で迷っている間に CPU の意思表示が出揃う', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilClaimWindow(page)
  test.skip(!reached, 'このシードでは割り込みの機会が発生しなかった')

  // 人間は何も操作していないが、CPU は既に表明を終えているはず。
  await expect(screen(page)).toHaveAttribute('data-pending-claims', '0', { timeout: 10_000 })

  /*
   * 見送ると進行が再開する。**再開したことは山札の減少で見る。**
   *
   * 以前は「見送るボタンが消える」で見ていたが、このボタンは割り込みの見送りと
   * 宣言の見送りの**両方**に使われる。進行が正しく再開して自分に宣言の機会が
   * 来ればボタンは戻るため、6回に3回ほど落ちていた（Step 8-2 で発見）。
   * 「割り込みの残り時間バーが消える」も同じ理由で使えない
   * （次の捨て札ですぐ新しい受付が開く）。**山札だけが一方向に動く。**
   */
  const wallBefore = await wallCount(page)
  await page.getByTestId('pass-button').click()
  await expect
    .poll(() => wallCount(page), { timeout: 15_000, message: '見送ると進行が再開すること' })
    .toBeLessThan(wallBefore)
})

/**
 * 受付時間の経過処理の検証。
 * 放置しても進行が止まらないことを、山札の減少で確かめる。
 */
test('宣言窓で放置しても時間切れで進行が続く', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { turnMs: 1_500 }))

  const reached = await playUntilClaimWindow(page)
  test.skip(!reached, 'このシードでは割り込みの機会が発生しなかった')

  const wallBefore = await wallCount(page)

  // 何も操作しない。持ち時間の経過で自動パスされ、進行が続くはず。
  await expect
    .poll(() => wallCount(page), { timeout: 30_000, message: '時間切れ後も進行が続くこと' })
    .toBeLessThan(wallBefore)
})

/**
 * 打牌の持ち時間とツモ切りの検証。
 *
 * **Step 4 では打牌に制限時間がなく、放置すると対局が永久に止まっていた。**
 * 純粋関数のテストでは `useEffect` のタイマーを検証できないため、ここが唯一の担保になる。
 */
test('捨てるのを放置するとツモ切りされて進行が続く', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { turnMs: 1_500 }))

  // 打牌のタイマーは人間の手番でしか描画されないため、
  // これを待つこと自体が「自分が捨てる番になった」ことの確認になる。
  // （`data-phase` は他家の捨てるフェーズでも `discard` になる）
  await expect(discardTimer(page)).toBeVisible({ timeout: 20_000 })

  // 引いた1枚を特定する。ツモ切りは**この1枚**を捨てるのが仕様。
  const drawn = page.locator('.hand__drawn [data-testid="card"]')
  const uid = await drawn.getAttribute('data-uid')
  expect(uid).not.toBeNull()

  // 一切操作しない。時間切れで引いたカードが自動的に捨てられるはず。
  await expect(page.locator(`.hand [data-testid="card"][data-uid="${uid}"]`)).toHaveCount(0, {
    timeout: 20_000,
  })

  // 自分の打牌フェーズを抜けて進行が続いていること
  await expect(discardTimer(page)).toBeHidden()
})

/**
 * 持ち時間は**使い切ったときだけ**減る。
 * 減った値が画面のラベルに出るので、摩耗したことを観測できる。
 *
 * 下限（5秒）で飽和するため、途中で何回時間切れになっても最終的な表示は同じになる。
 * 「ちょうど1回だけ時間切れにする」制御を必要としない形で書ける。
 */
test('時間切れを繰り返すと持ち時間が減り、下限で止まる', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { turnMs: 10_000 }))

  /*
   * 種別を限定しない。持ち時間はロン・打牌・宣言で**同じ残量を共有する**ので、
   * どの判断で計時していても同じ値が出るのが仕様。最初に計時される判断が
   * 打牌とは限らない（配牌で役が成立していれば宣言が先に来る）。
   *
   * 「5秒」で部分一致させると「15秒」にも当たるため、直前の空白ごと見る。
   */
  const timer = page.locator('[data-testid="turn-timer"]')
  await expect(timer).toHaveText(/ 10秒/, { timeout: 20_000 })

  // 放置して使い切らせる。何回時間切れになっても下限の5秒で止まる。
  await expect(timer).toHaveText(/ 5秒/, { timeout: 90_000 })
})

/** グループ役を狙うには構成メンバーが読めなければならない。 */
test('各グループの構成メンバーが名前で表示される', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  await expect(page.getByTestId('board-group')).toHaveCount(4)

  // 4グループ合計で 12〜20 名。所持済みが区別できていること。
  const members = page.getByTestId('group-member')
  const count = await members.count()
  expect(count).toBeGreaterThanOrEqual(12)
  expect(count).toBeLessThanOrEqual(20)

  await expect(page.locator('[data-testid="group-member"][data-held="true"]').first()).toBeVisible()
})

test('1局を最後まで進めて終局に到達する', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  const overlay = page.getByTestId('result-overlay')
  await playToEnd(page)

  await expect(overlay).toBeVisible({ timeout: 30_000 })
  // 手札の案内にも同じ文言が出るため、オーバーレイの見出しに限定する
  await expect(overlay.getByRole('heading', { name: '対局終了' })).toBeVisible()

  // 4人分の順位が並ぶ
  await expect(page.locator('.overlay__rank')).toHaveCount(4)

  // 対局の結果からは精算へしか進めない（対局のやり直しは BET を経由する）
  await expect(page.getByTestId('settle-button')).toBeVisible()
})

/**
 * カードの表現（Step 7-1）。
 *
 * 伏せ札の情報漏れは単体テスト（`tests/ui/cardVisual.test.tsx`）が出力レベルで固定している。
 * ここでは**実際の対局で枚数が合っているか**と、河・ボーナスが絵で出ているかを見る。
 */
test('他家の手札が伏せ札の絵で並び、枚数が一致する', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  const seats = page.getByTestId('card-backs')
  await expect(seats).toHaveCount(3)

  // 配牌直後はどの他家も規定枚数
  for (let i = 0; i < 3; i++) {
    await expect(seats.nth(i)).toHaveAttribute('data-count', String(HAND_SIZE))
  }
})

test('伏せ札に他家のカードの中身が出ていない', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  const backs = page.getByTestId('card-back').first()
  await expect(backs).toBeVisible()

  // 伏せ札の中にメンバー名・記号・画像が入っていないこと
  await expect(page.locator('[data-testid="card-back"] [data-testid="card-symbol"]')).toHaveCount(0)
  await expect(page.locator('[data-testid="card-back"] img')).toHaveCount(0)
  await expect(page.locator('[data-testid="card-back"] .card__name')).toHaveCount(0)
})

test('河が捨てた絵札で並ぶ', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))
  await waitForMyDiscard(page)

  /*
   * **自分の河に限定して数える。** 卓レイアウトでは4人全員が河を持つため、
   * `river-card` の総数を見ると自分の番までに CPU が切った札を巻き込む。
   * ここで見たいのは「自分が1枚捨てたら自分の河に1枚出る」こと。
   */
  const myRiver = page.locator('[data-testid="my-river"] [data-testid="river-card"]')

  await expect(myRiver).toHaveCount(0)
  await discardFirst(page)

  await expect(myRiver).toHaveCount(1, { timeout: 10_000 })
  // 河のカードは押せない（手札と取り違えない）
  await expect(page.locator('button[data-testid="river-card"]')).toHaveCount(0)
})

test('ボーナスがカード型のタイルで出る', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  const tiles = page.getByTestId('bonus-tile')
  await expect(tiles.first()).toBeVisible()
  await expect(tiles.first()).toContainText('ボーナス')
})

/**
 * 4方向レイアウト（Step 7-2）。
 *
 * 席の呼び名と向きの対応は単体テスト（`tests/ui/labels.test.ts`）が固定している。
 * ここでは**実際に描かれた座標**を見る。CSS の `grid-template-areas` は
 * 単体テストでは踏めないため、配置が入れ替わる事故はここでしか捕まらない。
 */
test('他家が上・左・右に、自分が下に配置される', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  const boxOf = async (locator: ReturnType<Page['locator']>) => {
    const box = await locator.boundingBox()
    if (box === null) {
      throw new Error('要素が描画されていません')
    }
    return box
  }

  const top = await boxOf(page.locator('[data-testid="seat"][data-orientation="top"]'))
  const left = await boxOf(page.locator('[data-testid="seat"][data-orientation="left"]'))
  const right = await boxOf(page.locator('[data-testid="seat"][data-orientation="right"]'))
  const mine = await boxOf(page.getByLabel('あなたの手札'))

  // 対面は左右の席より上、自分は下
  expect(top.y + top.height).toBeLessThanOrEqual(left.y + 1)
  expect(mine.y).toBeGreaterThanOrEqual(left.y + left.height - 1)

  // 上家が左、下家が右
  expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1)

  // 席の呼び名が向きと一致している（卓が回っていない）
  await expect(page.locator('[data-orientation="top"] .seat__name')).toHaveText('対面')
  await expect(page.locator('[data-orientation="left"] .seat__name')).toHaveText('上家')
  await expect(page.locator('[data-orientation="right"] .seat__name')).toHaveText('下家')
})

test('4人全員が河を持つ', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED))

  // 他家3人分 + 自分の河
  await expect(page.getByTestId('river')).toHaveCount(3)
  await expect(page.getByTestId('my-river')).toHaveCount(1)
})

/** 375px では卓を組めないので1列に積む。横スクロールが出たら破綻。 */
test('375px で1列に積まれ、横スクロールが出ない', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 720 })
  await startGame(page, url(CLAIM_SEED))

  await expect(page.getByTestId('seat')).toHaveCount(3)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(1)

  // 縦積みの伏せ札は横並びに戻る（1列では高さを食うだけになるため）
  const back = page.locator('[data-orientation="left"] [data-testid="card-back"]').first()
  const box = await back.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeLessThan(box!.height)
})

/**
 * 横持ちスマホ（844×390）。横向き専用レイアウト（Step 10-3）で**縦横とも収まる**こと。
 *
 * - 横向きの CSS が実際に効いた証拠として、下段が **[手札 | 操作] のレール**
 *   （`.table__controls` の `flex-direction: row`）になっていること、app__header が隠れていることを見る。
 *   「viewport を変えたが media query が届いていない」偽陽性を避ける（7-5 の教訓の別形）。
 * - **縦 fit（`vOverflow <= 1`）を達成**（9-3 の保留を解除）。DOM 再構成（下段レール化）＋
 *   他家席の簡略化＋app__header 隠しで 844×390 に収めた。E2E の高さ実測で詰めた。
 * - 横スクロール無し（`hOverflow <= 1`）も硬い要件。
 */
test('横向き 844×390 で縦横ともスクロールが出ず、下段がレールになる', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await startGame(page, url(CLAIM_SEED))

  await expect(page.getByTestId('table-screen')).toBeVisible()
  await expect(page.getByTestId('seat')).toHaveCount(3)

  // 横向きレイアウトが発火している（縦では column、横では row のレール）。
  const controlsDir = await page
    .locator('.table__controls')
    .evaluate((el) => getComputedStyle(el).flexDirection)
  expect(controlsDir).toBe('row')

  // 卓の外で縦を食っていた app タイトル見出しは、横向きの対局画面ではレイアウト上の高さを
  // 持たない（sr-only で画面外へ退避）。ただし `display:none` にはせず、見出しは残す。
  const headerHeight = await page
    .locator('.app__header')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height))
  expect(headerHeight).toBeLessThanOrEqual(1)
  // 見出しが支援技術から消えていないこと（sr-only で残す。`display:none` だと 0 件になる）。
  expect(await page.getByRole('heading').count()).toBeGreaterThanOrEqual(1)

  const { hOverflow, vOverflow } = await page.evaluate(() => {
    const el = document.documentElement
    return {
      hOverflow: el.scrollWidth - el.clientWidth,
      vOverflow: el.scrollHeight - el.clientHeight,
    }
  })
  // 縦横ともスクロールを出さない（縦 fit を達成。9-3 の保留を解除）。
  expect(hOverflow).toBeLessThanOrEqual(1)
  expect(vOverflow).toBeLessThanOrEqual(1)

  /*
   * 操作候補が多い局面（宣言候補が3〜4個＋見送る）でも縦あふれしないことを固定する。
   * 実ゲームで4ボタンの局面を決定論的に引くのは難しいため、`.actions` にボタンを注入して
   * 模す。操作バーは幅固定・高さ上限＋スクロールなので、レール行は手札ブロックの高さで決まり、
   * ボタンが増えても行は伸びない。max-height の上限を外すとここが落ちる。
   */
  await page.evaluate(() => {
    const actions = document.querySelector('.actions')
    if (actions === null) {
      throw new Error('.actions が見つかりません')
    }
    for (let i = 0; i < 4; i++) {
      const button = document.createElement('button')
      button.className = 'button button--tsumo'
      button.textContent = 'ツモ 3人組（同色）540点'
      actions.appendChild(button)
    }
  })
  const vOverflowManyButtons = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  )
  expect(vOverflowManyButtons).toBeLessThanOrEqual(1)
})

/**
 * app タイトル見出しの畳み込みは**対局画面だけ**に効く（`.app[data-screen='table']` でスコープ）。
 * landscape.css はバンドル全体に効くため、スコープが無いとタイトル画面など他画面でも
 * 見出しが消える。タイトル画面は他に見出しを持たないので、横向きでも app__header が
 * 高さを保つ（見えている）ことを固定する。
 */
test('横向きでも対局画面以外（タイトル）の見出しは畳まれない', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await page.goto('/')

  await expect(page.getByTestId('play-button')).toBeVisible()
  const headerHeight = await page
    .locator('.app__header')
    .evaluate((el) => Math.round(el.getBoundingClientRect().height))
  // 通常の見出し高さ（約51px）。閾値を 30 に置き、スコープだけ崩れて sr-only の 1px 化は残る
  // 中間状態（App.css の padding だけ後勝ちして高さ 16〜24px）も拾えるようにする。
  expect(headerHeight).toBeGreaterThan(30)
})

/**
 * 絵札の組み替え（Step 2）— 自分の宣言番でカードをタップして役を構成する。
 *
 * 到達性は配牌依存のため、宣言機会が来なければ skip する（`winGate` と同じ流儀）。
 */
test('selfDeclare でカードをタップすると選択リングが付き、もう一度で外れる', async ({ page }) => {
  // 和了は伴わないので fast=1（演出待ちを消す）で軽く回す。宣言の持ち時間は既定（20秒）。
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilHumanDeclare(page)
  test.skip(!reached, 'このシードでは人間の宣言機会が発生しなかった')

  // 宣言番ではライブプレビューが出ている（操作バー内）。
  await expect(page.getByTestId('selection-preview')).toBeVisible()

  const selected = page.locator('.card--selected')
  await expect(selected).toHaveCount(0)

  // 手札の1枚をタップ＝役の構成として選ぶ（捨てるのではない）。
  const first = page.getByTestId('card').first()
  await first.click()
  await expect(selected).toHaveCount(1)
  await expect(first).toHaveAttribute('aria-pressed', 'true')

  // もう一度タップで選択が外れる（トグル）。
  await first.click()
  await expect(selected).toHaveCount(0)
})

test('局面が変わると選択がリセットされる（宣言を見送ると選択が空に戻る）', async ({ page }) => {
  // `data-selected-count` を直接見るので、消費済み uid が手札から消える偶然に頼らない。
  // リセット効果（`[phase,turn,declarer,chainCount]`）を外すと最後の assert が落ちる。
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilHumanDeclare(page)
  test.skip(!reached, 'このシードでは人間の宣言機会が発生しなかった')

  const table = screen(page)
  await page.getByTestId('card').first().click()
  await expect(table).toHaveAttribute('data-selected-count', '1')

  // 見送る（SKIP_DECLARE）で selfDeclare → discard へ遷移。選択は空に戻るはず。
  await page.getByTestId('pass-button').click()
  await expect(table).toHaveAttribute('data-selected-count', '0')
})

test('おまかせ候補ごとにライブプレビューの点数が切り替わる（色の取り方で点数が変わる）', async ({
  page,
}) => {
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilHumanDeclare(page)
  test.skip(!reached, 'このシードでは人間の宣言機会が発生しなかった')

  // おまかせ候補は findYaku の列挙（混色/同色は別候補で点数が違う）。各候補をプレフィルすると、
  // プレビューはその候補の役名＋点数（＝おまかせラベルから「おまかせ 」を除いたもの）を実測で示す。
  // 候補が複数あればここで「色の取り方で点数が変わる」を画面上で確認できる。
  const buttons = page.getByTestId('declare-button')
  const previewText = page.locator('.selection-preview__text')
  const count = await buttons.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count; i++) {
    const label = (await buttons.nth(i).textContent()) ?? ''
    const yaku = label.replace('おまかせ', '').trim()

    await buttons.nth(i).click()
    await expect(previewText).toHaveAttribute('data-valid', 'true')
    await expect(previewText).toHaveText(yaku)
  }
})

test('おまかせプレフィルから選択を埋め、緑のツモで確定できる', async ({ page }) => {
  await startGame(page, url(CLAIM_SEED, { fast: false, turnMs: 2_000 }))

  const reached = await playUntilHumanDeclare(page)
  test.skip(!reached, 'このシードでは人間の宣言機会が発生しなかった')

  // 確定はまだ押せない（何も選んでいない）。
  await expect(page.getByTestId('declare-confirm')).toBeDisabled()

  // おまかせを押すと構成カードが選択欄へ入り（選択リングが付き）、プレビューが有効になる。
  await page.getByTestId('declare-button').first().click()
  await expect(page.locator('.card--selected').first()).toBeVisible()
  await expect(page.locator('.selection-preview__text')).toHaveAttribute('data-valid', 'true')

  // 有効な役になったので緑のツモで確定でき、和了演出が出る。
  const confirm = page.getByTestId('declare-confirm')
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByTestId('win-overlay')).toBeVisible({ timeout: 10_000 })
})

/**
 * 横向き 844×390 で **SelectionPreview がマウントされた状態**でも縦 fit が保たれる（doc-reviewer [高]）。
 *
 * `canSelect` を決定論的に 844×390 で引くのは難しいため、実マウント相当の `.selection-preview`
 * （文言＋緑のツモ）を操作バー（`.actions`）へ注入して高さを模す。`.actions` は横向きで
 * `max-height`＋`overflow-y: auto` の保護を持つため、プレビューが増えても行は伸びない。
 * この保護（`.table__mine` の grid を増やさず `.actions` に相乗りする設計）が崩れるとここが落ちる。
 */
test('横向き 844×390 で選択プレビューが出ても縦横スクロールが出ない', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await startGame(page, url(CLAIM_SEED))

  await expect(page.getByTestId('table-screen')).toBeVisible()

  await page.evaluate(() => {
    const actions = document.querySelector('.actions')
    if (actions === null) {
      throw new Error('.actions が見つかりません')
    }
    const preview = document.createElement('div')
    preview.className = 'selection-preview'
    preview.setAttribute('data-testid', 'selection-preview')
    const text = document.createElement('span')
    text.className = 'selection-preview__text'
    text.textContent = '3人組（同色） 540点'
    const confirm = document.createElement('button')
    confirm.className = 'button button--tsumo'
    confirm.textContent = 'ツモ'
    preview.append(text, confirm)
    // 実際の並び（プレビューが先頭）に合わせて先頭へ入れる。
    actions.prepend(preview)
  })

  const { hOverflow, vOverflow } = await page.evaluate(() => {
    const el = document.documentElement
    return {
      hOverflow: el.scrollWidth - el.clientWidth,
      vOverflow: el.scrollHeight - el.clientHeight,
    }
  })
  expect(hOverflow).toBeLessThanOrEqual(1)
  expect(vOverflow).toBeLessThanOrEqual(1)
})

/**
 * 絵札の組み替え（Step 3）— 割り込み（`claimWindow`）で手札をタップしてロンを構成する。
 *
 * ロンでは**捨て札（`lastDiscard`）が構成の固定要素**で、手札選択（`.card--selected`）には入らない。
 * プレイヤーは手札だけをタップし、確定時に捨て札が合流する。到達性は配牌依存のため、
 * 人間のロン機会が来なければ skip する（`winGate` と同じ流儀）。
 */
test('claimWindow でおまかせロンをプレフィルし、赤のロンで確定できる（捨て札は手札選択に入らない）', async ({
  page,
}) => {
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilHumanClaim(page)
  test.skip(!reached, 'このシードでは人間のロン機会が発生しなかった')

  // ロン受付では選択プレビューが出て、確定は赤のロン（claim-confirm）。まだ何も選んでいないので不活性。
  await expect(page.getByTestId('selection-preview')).toBeVisible()
  const confirm = page.getByTestId('claim-confirm')
  await expect(confirm).toBeVisible()
  await expect(confirm).toBeDisabled()

  // おまかせを押すと構成カード（**手札分だけ**）が選択欄へ入り、プレビューが有効になる。
  await page.getByTestId('claim-button').first().click()
  await expect(page.locator('.card--selected').first()).toBeVisible()
  await expect(page.locator('.selection-preview__text')).toHaveAttribute('data-valid', 'true')

  /*
   * 捨て札は固定要素なので手札選択（`.card--selected`）には入らない。
   * `data-selected-count`（手札の選択数）と `.card--selected` の枚数が一致することで、
   * 捨て札が手札側に二重計上されていないことを観測する（合流を外すと役が崩れ確定が不活性になる）。
   */
  const selectedCount = await page.locator('.card--selected').count()
  await expect(screen(page)).toHaveAttribute('data-selected-count', String(selectedCount))
  expect(selectedCount).toBeGreaterThan(0)

  // 有効なロンなので赤のロンで確定でき、和了演出が出る。
  await expect(confirm).toBeEnabled()
  await confirm.click()
  await expect(page.getByTestId('win-overlay')).toBeVisible({ timeout: 10_000 })
})

test('ロンは選択カードをタップで外すと確定が不活性になり、組み直すと活性に戻る', async ({
  page,
}) => {
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilHumanClaim(page)
  test.skip(!reached, 'このシードでは人間のロン機会が発生しなかった')

  await page.getByTestId('claim-button').first().click()
  const confirm = page.getByTestId('claim-confirm')
  await expect(confirm).toBeEnabled()

  // 選択中の1枚をタップで外すと役が崩れる → 確定が不活性（タップ駆動の再導出をロンでも確認）。
  await page.locator('.card--selected').first().click()
  await expect(confirm).toBeDisabled()

  // おまかせで組み直すと再び有効。
  await page.getByTestId('claim-button').first().click()
  await expect(confirm).toBeEnabled()
})

test('claimWindow で選択しても、見送ると選択がリセットされる', async ({ page }) => {
  // `selfDeclare` 版のリセットテスト（局面が変わると…）の claimWindow 対。受付が閉じる瞬間に
  // `resetKeyOf`（phase/turn）が変わって選択が空へ戻ることを直接観測する（依存を壊すと最後の assert が落ちる）。
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilHumanClaim(page)
  test.skip(!reached, 'このシードでは人間のロン機会が発生しなかった')

  const table = screen(page)
  // ロン受付で手札を1枚タップ（構成の一部）。捨てるのではなく選ぶ。
  await page.getByTestId('card').first().click()
  await expect(table).toHaveAttribute('data-selected-count', '1')

  // 見送る（PASS）で claimWindow を抜けると、選択は空に戻る。
  await page.getByTestId('pass-button').click()
  await expect(table).toHaveAttribute('data-selected-count', '0')
})

test('おまかせロン候補ごとにライブプレビューの点数が切り替わる（色の取り方で点数が変わる）', async ({
  page,
}) => {
  await startGame(page, url(CLAIM_SEED))

  const reached = await playUntilHumanClaim(page)
  test.skip(!reached, 'このシードでは人間のロン機会が発生しなかった')

  // おまかせ claim 候補は findYaku の列挙（混色/同色は別候補で点数が違う）。各候補をプレフィルすると、
  // プレビューはその候補の役名＋点数（＝おまかせラベルから「おまかせ 」を除いたもの）を実測で示す。
  // ロンの composed 分岐（捨て札合流＋required）が UI 結線経由でも点数を正しく再計算することを担保する
  // （ツモ側の同型テストとの対称。doc-reviewer [高]）。
  const buttons = page.getByTestId('claim-button')
  const previewText = page.locator('.selection-preview__text')
  const count = await buttons.count()
  expect(count).toBeGreaterThan(0)

  for (let i = 0; i < count; i++) {
    const label = (await buttons.nth(i).textContent()) ?? ''
    const yaku = label.replace('おまかせ', '').trim()

    await buttons.nth(i).click()
    await expect(previewText).toHaveAttribute('data-valid', 'true')
    await expect(previewText).toHaveText(yaku)
  }
})

/**
 * 横向き 844×390 で **ロンの SelectionPreview がマウントされた状態**でも縦 fit が保たれる。
 *
 * ロンの確定（赤 `button--ron`）もツモと同じ `.actions`（横向きで `max-height`＋`overflow-y`）に
 * 相乗りする。`canClaim` を決定論的に 844×390 で引くのは難しいため、実マウント相当の
 * `.selection-preview`（文言＋赤のロン）を注入して高さを模す。この高さ保護が崩れるとここが落ちる。
 */
test('横向き 844×390 でロンの選択プレビューが出ても縦横スクロールが出ない', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await startGame(page, url(CLAIM_SEED))

  await expect(page.getByTestId('table-screen')).toBeVisible()

  await page.evaluate(() => {
    const actions = document.querySelector('.actions')
    if (actions === null) {
      throw new Error('.actions が見つかりません')
    }
    const preview = document.createElement('div')
    preview.className = 'selection-preview'
    preview.setAttribute('data-testid', 'selection-preview')
    const text = document.createElement('span')
    text.className = 'selection-preview__text'
    text.textContent = '3カード（同色） 480点'
    const confirm = document.createElement('button')
    confirm.className = 'button button--ron'
    confirm.textContent = 'ロン'
    preview.append(text, confirm)
    actions.prepend(preview)
  })

  const { hOverflow, vOverflow } = await page.evaluate(() => {
    const el = document.documentElement
    return {
      hOverflow: el.scrollWidth - el.clientWidth,
      vOverflow: el.scrollHeight - el.clientHeight,
    }
  })
  expect(hOverflow).toBeLessThanOrEqual(1)
  expect(vOverflow).toBeLessThanOrEqual(1)
})
