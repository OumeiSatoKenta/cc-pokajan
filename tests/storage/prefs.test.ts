import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { clearPrefs, loadPrefs, savePrefs } from '../../src/storage/prefs'

/**
 * 永続化の検証。
 *
 * **localStorage は外部入力として扱う。** ユーザーが直接編集でき、別バージョンの
 * 本アプリが書いた値が残っていることもあり、環境によってはアクセス自体が例外になる。
 * 「正常系で往復できる」だけでは足りず、壊れた入力で落ちないことが要件になる。
 *
 * テスト環境は `node` で localStorage が無いため、最小の代替実装を差し込む。
 */

const KEY = 'cc-pokajan:prefs'
const DEFAULTS = { wallet: 10_000, seed: 42 }

function installStorage(): Map<string, string> {
  const store = new Map<string, string>()

  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  })

  return store
}

beforeEach(() => {
  installStorage()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('保存と復元', () => {
  it('保存した値をそのまま読み戻せる', () => {
    savePrefs({
      version: 1,
      wallet: 12_345,
      lastSeed: 99,
      roster: null,
      avatars: null,
      rulesOverride: null,
    })

    expect(loadPrefs(DEFAULTS)).toEqual({
      version: 1,
      wallet: 12_345,
      lastSeed: 99,
      roster: null,
      avatars: null,
      rulesOverride: null,
    })
  })

  it('保存が無ければ既定値を返す', () => {
    expect(loadPrefs(DEFAULTS)).toEqual({
      version: 1,
      wallet: 10_000,
      lastSeed: 42,
      roster: null,
      avatars: null,
      rulesOverride: null,
    })
  })

  it('消すと既定値に戻る', () => {
    savePrefs({
      version: 1,
      wallet: 1,
      lastSeed: 2,
      roster: null,
      avatars: null,
      rulesOverride: null,
    })
    clearPrefs()

    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  it('所持コイン0を「未保存」と取り違えない', () => {
    savePrefs({
      version: 1,
      wallet: 0,
      lastSeed: 7,
      roster: null,
      avatars: null,
      rulesOverride: null,
    })

    expect(loadPrefs(DEFAULTS).wallet).toBe(0)
  })
})

describe('アバター', () => {
  /**
   * `roster` と同じく**素通しで持つ**。座席番号として読めるかの判断は
   * `parseAvatars`（`src/ui/avatars.ts`）の仕事で、この層は「読めたか」だけを扱う。
   */
  it('保存した対応表をそのまま読み戻せる', () => {
    savePrefs({
      version: 1,
      wallet: 1,
      lastSeed: 1,
      roster: null,
      avatars: { '0': 'avt_1', '2': 'avt_2' },
      rulesOverride: null,
    })

    expect(loadPrefs(DEFAULTS).avatars).toEqual({ '0': 'avt_1', '2': 'avt_2' })
  })

  /**
   * **`avatars` を持たない保存値がそのまま読めること。**
   * version を上げずに項目を足しているので、Step 5・6 までに保存された
   * 所持コインを捨てずに済む（`roster` を足したときと同じ判断）。
   */
  it('avatars を持たない保存値でも所持コインを捨てない', () => {
    localStorage.setItem(
      'cc-pokajan:prefs',
      JSON.stringify({ version: 1, wallet: 7_000, lastSeed: 5, roster: null, rulesOverride: null }),
    )

    const prefs = loadPrefs(DEFAULTS)

    expect(prefs.wallet).toBe(7_000)
    expect(prefs.avatars).toBeNull()
  })
})

describe('壊れた保存データ', () => {
  function write(raw: string): void {
    localStorage.setItem(KEY, raw)
  }

  it('JSON として壊れていても落ちず既定値を返す', () => {
    write('{ これは JSON ではない')

    expect(() => loadPrefs(DEFAULTS)).not.toThrow()
    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  it('オブジェクトでなければ既定値を返す', () => {
    write('"文字列"')
    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)

    write('[1, 2, 3]')
    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)

    write('null')
    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  it('未知のバージョンは移行せず既定値を返す', () => {
    write(JSON.stringify({ version: 999, wallet: 50_000, lastSeed: 1 }))

    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  it('バージョンが無ければ既定値を返す', () => {
    write(JSON.stringify({ wallet: 50_000, lastSeed: 1 }))

    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  /**
   * `typeof x === 'number'` だけの検査では通ってしまう値。
   * 所持コインに入ると以降の計算がすべて壊れたまま永続化される。
   */
  it('数値でない・有限でない所持コインは既定値に倒す', () => {
    for (const wallet of ['1000', null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      write(JSON.stringify({ version: 1, wallet, lastSeed: 5 }))
      expect(loadPrefs(DEFAULTS).wallet, `wallet = ${String(wallet)}`).toBe(10_000)
    }
  })

  it('負の所持コインは既定値に倒す', () => {
    write(JSON.stringify({ version: 1, wallet: -500, lastSeed: 5 }))

    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  it('小数の所持コインは既定値に倒す', () => {
    write(JSON.stringify({ version: 1, wallet: 100.5, lastSeed: 5 }))

    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  it('シードだけが壊れていても所持コインは活かす', () => {
    write(JSON.stringify({ version: 1, wallet: 7_000, lastSeed: 'abc' }))

    const prefs = loadPrefs(DEFAULTS)
    expect(prefs.wallet).toBe(7_000)
    expect(prefs.lastSeed).toBe(42)
  })
})

describe('localStorage が使えない環境', () => {
  it('読み出しが例外を投げても既定値を返す', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    })

    expect(() => loadPrefs(DEFAULTS)).not.toThrow()
    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
  })

  /** 保存できないこと自体は、遊べなくなる理由にならない。 */
  it('書き込みが例外を投げても進行を止めない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => undefined,
    })

    expect(() =>
      savePrefs({
        version: 1,
        wallet: 1,
        lastSeed: 1,
        roster: null,
        avatars: null,
        rulesOverride: null,
      }),
    ).not.toThrow()
  })

  it('削除が例外を投げても落ちない', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => {
        throw new Error('SecurityError')
      },
    })

    expect(() => clearPrefs()).not.toThrow()
  })

  it('localStorage そのものが存在しなくても落ちない', () => {
    vi.stubGlobal('localStorage', undefined)

    expect(() => loadPrefs(DEFAULTS)).not.toThrow()
    expect(loadPrefs(DEFAULTS).wallet).toBe(10_000)
    expect(() =>
      savePrefs({
        version: 1,
        wallet: 1,
        lastSeed: 1,
        roster: null,
        avatars: null,
        rulesOverride: null,
      }),
    ).not.toThrow()
  })
})
