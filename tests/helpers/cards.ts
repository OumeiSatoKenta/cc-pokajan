import { DEFAULT_RULES } from '../../src/config/rules'
import {
  COLOR_IDS,
  type Card,
  type ColorId,
  type Group,
  type MemberId,
  type RulesConfig,
  type YakuContext,
} from '../../src/engine/types'

/**
 * 役判定テスト用のカード組み立てヘルパ。
 *
 * 手札を `'a1:pink a1:blue a1:orange'` のような文字列で書けるようにして、
 * テストの意図（どのメンバーの何色を何枚持っているか）が一目で読めるようにする。
 */

function isColorId(value: string): value is ColorId {
  return (COLOR_IDS as readonly string[]).includes(value)
}

/** `'a1:pink'` 形式の1枚を組み立てる。 */
export function card(spec: string, uid: number): Card {
  const [memberId, color] = spec.split(':')
  if (memberId === undefined || color === undefined || !isColorId(color)) {
    throw new Error(`カードの指定が不正です: "${spec}"（期待する形式: "memberId:color"）`)
  }
  return { uid, memberId, color }
}

/**
 * 空白区切りの指定から手札を組み立てる。uid は 0 から順に振られる。
 *
 * 例: `hand('a1:pink a1:blue a2:pink')`
 */
export function hand(spec: string): Card[] {
  return spec
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token, index) => card(token, index))
}

/** テスト用のグループ定義。3人組・4人組・5人組と、今局に登場させない比較用グループ。 */
export const TEST_GROUPS = {
  trio: { id: 'trio', name: 'トリオ組', memberIds: ['a1', 'a2', 'a3'] },
  quartet: { id: 'quartet', name: 'カルテット組', memberIds: ['b1', 'b2', 'b3', 'b4'] },
  quintet: { id: 'quintet', name: 'クインテット組', memberIds: ['c1', 'c2', 'c3', 'c4', 'c5'] },
  /** 今局の `activeGroups` にあえて含めず、「登場していないグループでは役が成立しない」検証に使う。 */
  absent: { id: 'absent', name: 'アブセント組', memberIds: ['z1', 'z2', 'z3'] },
} as const satisfies Record<string, Group>

/** 既定では3人組・4人組・5人組の3グループが登場している状態。 */
export function context(options?: {
  groups?: readonly Group[]
  bonusMemberIds?: readonly MemberId[]
  rules?: RulesConfig
}): YakuContext {
  return {
    activeGroups: options?.groups ?? [TEST_GROUPS.trio, TEST_GROUPS.quartet, TEST_GROUPS.quintet],
    bonusMemberIds: options?.bonusMemberIds ?? [],
    rules: options?.rules ?? DEFAULT_RULES,
  }
}

/** 候補の消費カードを `'a1:pink'` 形式の昇順配列にして、比較しやすくする。 */
export function describeCards(cards: readonly Card[]): string[] {
  return cards.map((c) => `${c.memberId}:${c.color}`).sort()
}
