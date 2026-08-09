import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import App from '../../src/App'
import { withTurnMs } from '../../src/appOptions'
import { DEFAULT_RULES } from '../../src/config/rules'

/**
 * 起動直後の画面が実際にレンダリングできることを確認する。
 *
 * `renderToStaticMarkup` は `useEffect` を実行しないため、**初期状態の描画のみ**を検証する。
 * 画面遷移・自動進行・タイマー・操作の検証は E2E（Playwright）と、
 * 純粋関数の単体テスト（appReducer / loopReducer / actionBarItems）が担当する。
 * DOM を必要としないため jsdom は導入していない。
 */
describe('App（起動画面）', () => {
  let html: string

  beforeAll(() => {
    html = renderToStaticMarkup(<App />)
  })

  it('例外を投げずにレンダリングできる', () => {
    expect(html.length).toBeGreaterThan(0)
  })

  it('Vite テンプレートのデモ内容を含まない', () => {
    expect(html).not.toContain('count is')
    expect(html).not.toContain('vite.svg')
    expect(html).not.toContain('react.svg')
  })

  /** Step 5 以降、起動直後はタイトル画面。対局は BET を経由してしか始まらない。 */
  it('タイトル画面が描画される', () => {
    expect(html).toContain('ポカジャン')
    expect(html).toContain('data-testid="title-screen"')
    expect(html).toContain('data-testid="play-button"')
  })

  it('所持コインが表示される', () => {
    expect(html).toContain('data-testid="wallet"')
    expect(html).toContain(DEFAULT_RULES.bet.initialWallet.toLocaleString('ja-JP'))
  })

  it('BET を経由せずに対局画面へ入らない', () => {
    expect(html).not.toContain('data-testid="table-screen"')
    expect(html).not.toContain('data-testid="card"')
  })

  it('起動直後に精算画面が出ていない', () => {
    expect(html).not.toContain('data-testid="result-screen"')
  })

  /** Step 6 で追加した設定への導線。 */
  it('ロスター設定とルール設定への導線がある', () => {
    expect(html).toContain('data-testid="open-roster-button"')
    expect(html).toContain('data-testid="open-rules-button"')
  })

  it('保存された設定が無いので既定値のまま起動する（案内が出ない）', () => {
    expect(html).not.toContain('data-testid="settings-fallback"')
  })
})

describe('withTurnMs', () => {
  it('上書きがなければ同じルールをそのまま返す', () => {
    expect(withTurnMs(DEFAULT_RULES, null)).toBe(DEFAULT_RULES)
  })

  it('初期値を上書きする', () => {
    expect(withTurnMs(DEFAULT_RULES, 3_000).turnTimer.initialMs).toBe(3_000)
  })

  /**
   * 初期値だけを下限より短くすると、時間切れのたびに持ち時間が**伸びる**。
   * 上書きの意図（短くして試す）と正反対の挙動になるため、下限も一緒に下げる。
   */
  it('下限より短い値を渡すと下限も下がる', () => {
    const rules = withTurnMs(DEFAULT_RULES, 1_500)

    expect(rules.turnTimer.minMs).toBe(1_500)
    expect(rules.turnTimer.initialMs).toBeGreaterThanOrEqual(rules.turnTimer.minMs)
  })

  it('下限より長い値では下限を変えない', () => {
    expect(withTurnMs(DEFAULT_RULES, 10_000).turnTimer.minMs).toBe(DEFAULT_RULES.turnTimer.minMs)
  })

  it('元のルールを破壊しない', () => {
    const snapshot = structuredClone(DEFAULT_RULES)

    withTurnMs(DEFAULT_RULES, 1_000)

    expect(DEFAULT_RULES).toEqual(snapshot)
  })
})
