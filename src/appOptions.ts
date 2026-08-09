/**
 * 起動時オプションの読み取り。
 *
 * `App.tsx` から切り出しているのは、コンポーネント以外を同じファイルから export すると
 * Fast Refresh が効かなくなるため（`ui/labels.ts` と同じ理由）。
 */

import type { RulesConfig } from './engine/types'

export interface AppOptions {
  readonly seed: number
  /**
   * `seed` が URL で明示されたか。
   *
   * 保存済みのシードより URL を優先するかの判断に使う。「指定が無かった」と
   * 「たまたま保存値と同じ値が指定された」を区別できるようにするため、
   * 値そのものではなく由来を持つ。
   */
  readonly seedFromUrl: boolean
  readonly fast: boolean
  /** 持ち時間の初期値の上書き。`null` なら既定値。 */
  readonly turnMs: number | null
}

/**
 * URL クエリからオプションを読む。
 *
 * `seed` は E2E の安定性のために用意している。配牌に依存する検証
 * （待ちの黄色枠が出るか等）は、シードを固定しないと再現性のないテストになる。
 *
 * `fast` は**演出の待ち時間だけ**を消す。持ち時間はルール値なのでここでは変わらない。
 * ルール値まで消すと、時間切れの検証で確かめたい対象そのものが消える。
 *
 * `turnMs` は持ち時間の初期値だけを上書きする。既定の20秒のままでは
 * 時間切れを検証する E2E が1件あたり20秒待つことになり、全体が現実的な時間で回らない。
 */
export function readOptions(): AppOptions {
  if (typeof window === 'undefined') {
    return { seed: 1, seedFromUrl: false, fast: false, turnMs: null }
  }

  const params = new URLSearchParams(window.location.search)
  const seed = intParam(params, 'seed')

  return {
    seed: seed ?? Date.now() % 1_000_000,
    seedFromUrl: seed !== null,
    fast: params.get('fast') === '1',
    turnMs: intParam(params, 'turnMs'),
  }
}

/** 整数のクエリを読む。欠落・不正はどちらも `null`（呼び出し側で既定値に倒す）。 */
function intParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name)
  if (raw === null) {
    return null
  }

  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 持ち時間の初期値だけを差し替える。
 *
 * **下限も一緒に下げる。** 初期値だけを下限より短くすると、時間切れのたびに
 * `Math.max(下限, …)` が効いて持ち時間が**伸びる**（例: 1.5秒 → 5秒）。
 * 上書きの意図は「短くして試す」ことなので、その意図に反する挙動を作らない。
 */
export function withTurnMs(rules: RulesConfig, turnMs: number | null): RulesConfig {
  if (turnMs === null) {
    return rules
  }

  return {
    ...rules,
    turnTimer: {
      ...rules.turnTimer,
      initialMs: turnMs,
      minMs: Math.min(rules.turnTimer.minMs, turnMs),
    },
  }
}
