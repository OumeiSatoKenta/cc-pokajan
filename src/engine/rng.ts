/**
 * シード付き擬似乱数。
 *
 * エンジン層では `Math.random()` を一切使わず、必ずこのモジュールの `Rng` を引数で受け取る。
 * これによりテストが決定的になり、シードから局を完全に再現できる（リプレイ機能の土台）。
 */

/** 32bit 符号なし整数の上限。mulberry32 の出力を [0, 1) に正規化するために使う。 */
const UINT32_RANGE = 0x100000000

export interface Rng {
  /** 次の乱数を `0 <= x < 1` で返す。 */
  next(): number
  /** 現在の内部状態。`createRng(state)` に渡せば続きから再現できる。 */
  state(): number
}

/**
 * mulberry32 による決定的 PRNG を作る。
 *
 * 内部状態が 32bit 整数1個だけで済むため、`GameState` に状態を保持してリプレイするのが容易。
 */
export function createRng(seed: number): Rng {
  let a = seed | 0

  return {
    next(): number {
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / UINT32_RANGE
    },
    state(): number {
      return a
    },
  }
}

/**
 * `0 <= x < maxExclusive` の整数を返す。
 *
 * 非整数を許すと最上位のバケットだけ出現確率が下がるサイレントな偏りになるため、
 * 整数であることを明示的に要求する（Step 6 でルール値がユーザー編集可能になるため重要）。
 */
export function randomInt(rng: Rng, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive)) {
    throw new RangeError(`maxExclusive must be an integer, got ${maxExclusive}`)
  }
  if (maxExclusive <= 0) {
    throw new RangeError(`maxExclusive must be positive, got ${maxExclusive}`)
  }
  return Math.floor(rng.next() * maxExclusive)
}

/**
 * Fisher–Yates シャッフル。
 *
 * 入力配列は破壊しない（エンジン層の純粋性を保つため必ずコピーしてから並べ替える）。
 */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1)
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

/**
 * 重複なしで `count` 件を無作為に選ぶ。
 *
 * 全体をシャッフルせず部分 Fisher–Yates で必要な件数だけ確定させる。
 */
export function pickSome<T>(items: readonly T[], count: number, rng: Rng): T[] {
  if (count < 0) {
    throw new RangeError(`count must not be negative, got ${count}`)
  }
  if (count > items.length) {
    throw new RangeError(`count ${count} exceeds items length ${items.length}`)
  }

  const pool = [...items]
  const picked: T[] = []
  for (let i = 0; i < count; i++) {
    const j = i + randomInt(rng, pool.length - i)
    const tmp = pool[i]
    pool[i] = pool[j]
    pool[j] = tmp
    picked.push(pool[i])
  }
  return picked
}
