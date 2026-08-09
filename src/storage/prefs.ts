/**
 * localStorage への永続化。
 *
 * **保存するのは所持コインの残高と次のシードだけ。** 精算額や順位は保存しない。
 * 計算結果を保存すると、localStorage を書き換えるだけでコインを増やせる経路が増える。
 * 精算はその都度 `engine/payout.ts` が計算する。
 *
 * この層をエンジンから参照しない（依存の向きは UI → storage → なし）。
 */

/** `docs/architecture.md` の「データ永続化戦略」で定めたキー。 */
const STORAGE_KEY = 'cc-pokajan:prefs'

/** 保存形式のバージョン。読み出し時に一致しなければ既定値へ倒す。 */
const PREFS_VERSION = 1

export interface Prefs {
  readonly version: number
  readonly wallet: number
  /** 次に始める対局のシード。 */
  readonly lastSeed: number
  /**
   * 編集されたロスター。未設定なら同梱ロスターを使う。
   *
   * **ここでは形だけを確かめ、内容の妥当性は検査しない。** `validateRoster` は
   * `rules` を必要とし、この層はエンジンに依存しないため。
   * 読み出した側が対局を作れるか確かめてから採用する。
   */
  readonly roster: unknown
  /**
   * 座席ごとのプレイヤー画像（座席番号 → 画像 ID）。
   *
   * `roster` と同じく**形の検査もここではしない**。座席番号として読めるかの判断は
   * `parseAvatars`（`src/ui/avatars.ts`）が持つ。この層は「読めたか」だけを扱い、
   * 内容の意味を知らない（`storage` は `engine` にも `ui` にも依存しない）。
   */
  readonly avatars: unknown
  /**
   * ルールの**差分**。全体ではなく差分で持つ。
   *
   * 全体を保存すると、既定値を変更したときに古い保存値が全項目を上書きし続ける。
   * 差分なら触っていない項目は常に最新の既定値に追随する。
   */
  readonly rulesOverride: Record<string, unknown> | null
}

export interface PrefsDefaults {
  readonly wallet: number
  readonly seed: number
}

/**
 * 保存された設定を読む。**読めなければ必ず既定値を返し、例外を投げない。**
 *
 * localStorage は外部入力として扱う。ユーザーが直接編集でき、別バージョンの
 * 本アプリが書いた値が残っていることもある。プライベートモードでは
 * アクセスそのものが例外になる環境もある。
 */
export function loadPrefs(defaults: PrefsDefaults): Prefs {
  const fallback: Prefs = {
    version: PREFS_VERSION,
    wallet: defaults.wallet,
    lastSeed: defaults.seed,
    roster: null,
    avatars: null,
    rulesOverride: null,
  }

  const raw = readRaw()
  if (raw === null) {
    return fallback
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }

  if (!isRecord(parsed) || parsed.version !== PREFS_VERSION) {
    // 未知のバージョンは移行せず既定値に倒す。移行が必要になった時点で分岐を足す。
    return fallback
  }

  return {
    version: PREFS_VERSION,
    wallet: wholeNumber(parsed.wallet) ?? fallback.wallet,
    lastSeed: wholeNumber(parsed.lastSeed) ?? fallback.lastSeed,
    // 追加された項目は「無ければ未設定」として扱う。version を上げずに済ませることで、
    // Step 5 までに保存された所持コインを捨てなくてよくなる。
    roster: parsed.roster ?? null,
    avatars: parsed.avatars ?? null,
    rulesOverride: isRecord(parsed.rulesOverride) ? parsed.rulesOverride : null,
  }
}

/**
 * 設定を保存する。**失敗しても例外を投げない。**
 *
 * 容量超過やプライベートモードで書き込みが弾かれることがある。
 * 保存できないこと自体は遊べなくなる理由にならないので、進行を止めない。
 */
export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // 保存できなくても対局は続けられる。次回起動時に既定値へ戻るだけ。
  }
}

/** 保存内容を消す。テストと、将来の「初期化」導線で使う。 */
export function clearPrefs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 消せなくても進行に影響しない。
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    // localStorage そのものが使えない環境（プライベートモード等）。
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 0以上の有限な整数だけを受け入れる。それ以外は `null`（呼び出し側で既定値へ）。
 *
 * `typeof x === 'number'` だけでは `NaN` / `Infinity` / 負値 / 小数が通る。
 * 所持コインにこれらが入ると、以降のあらゆる計算が壊れたまま永続化される。
 */
function wholeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null
  }
  return value
}
