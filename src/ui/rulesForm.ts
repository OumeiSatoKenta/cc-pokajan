/**
 * ルール設定フォームの純粋ロジック。
 *
 * 編集中の値は**文字列**で持つ。数値の state にすると `''`（消した状態）や
 * 入力途中の `-` を表現できず、入力体験が壊れる。確定時にまとめて数値へ変換する。
 */

import type { RulesConfig, YakuKind } from '../engine/types'

/** 編集できる項目1つ分の定義。画面はこの配列を並べるだけにする。 */
export interface RuleField {
  readonly key: string
  readonly label: string
  /** `TODO(要実機確認)` の項目に出す注記。 */
  readonly note?: string
  readonly get: (rules: RulesConfig) => number
  readonly set: (rules: RulesConfig, value: number) => RulesConfig
}

const YAKU_LABELS: Record<YakuKind, string> = {
  triple: '3カード',
  group3: '3人組',
  group4: '4人組',
  group5: '5人組',
}

const YAKU_KINDS: readonly YakuKind[] = ['triple', 'group3', 'group4', 'group5']

function scoreField(kind: YakuKind, sameColor: boolean): RuleField {
  const variant = sameColor ? 'sameColor' : 'base'

  return {
    key: `scores.${kind}.${variant}`,
    label: `${YAKU_LABELS[kind]}${sameColor ? '（同色）' : ''}`,
    note: kind === 'group3' && sameColor ? '出典が見つからず推定値' : undefined,
    get: (rules) => rules.scores[kind][variant],
    set: (rules, value) => ({
      ...rules,
      scores: { ...rules.scores, [kind]: { ...rules.scores[kind], [variant]: value } },
    }),
  }
}

/** 点数表。 */
export const SCORE_FIELDS: readonly RuleField[] = YAKU_KINDS.flatMap((kind) => [
  scoreField(kind, false),
  scoreField(kind, true),
])

/** 対局の数値。 */
export const GAME_FIELDS: readonly RuleField[] = [
  {
    key: 'startingScore',
    label: '初期点',
    note: '攻略記事の精算例からの推定値',
    get: (rules) => rules.startingScore,
    set: (rules, value) => ({ ...rules, startingScore: value }),
  },
  {
    key: 'bonusPerCard',
    label: 'ボーナス加点（1枚あたり）',
    get: (rules) => rules.bonusPerCard,
    set: (rules, value) => ({ ...rules, bonusPerCard: value }),
  },
  {
    key: 'turnTimer.initialMs',
    label: '持ち時間の初期値（ミリ秒）',
    get: (rules) => rules.turnTimer.initialMs,
    set: (rules, value) => ({ ...rules, turnTimer: { ...rules.turnTimer, initialMs: value } }),
  },
  {
    key: 'turnTimer.decrementMs',
    label: '持ち時間の減少幅（ミリ秒）',
    get: (rules) => rules.turnTimer.decrementMs,
    set: (rules, value) => ({ ...rules, turnTimer: { ...rules.turnTimer, decrementMs: value } }),
  },
  {
    key: 'turnTimer.minMs',
    label: '持ち時間の下限（ミリ秒）',
    get: (rules) => rules.turnTimer.minMs,
    set: (rules, value) => ({ ...rules, turnTimer: { ...rules.turnTimer, minMs: value } }),
  },
]

/** カジノの数値。 */
export const CASINO_FIELDS: readonly RuleField[] = [
  {
    key: 'bet.initialWallet',
    label: '初期コイン',
    note: '実機の値が不明',
    get: (rules) => rules.bet.initialWallet,
    set: (rules, value) => ({ ...rules, bet: { ...rules.bet, initialWallet: value } }),
  },
]

export const ALL_FIELDS: readonly RuleField[] = [...SCORE_FIELDS, ...GAME_FIELDS, ...CASINO_FIELDS]

/** 全項目の現在値を文字列にする（フォームの初期値）。 */
export function toFormValues(rules: RulesConfig): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of ALL_FIELDS) {
    values[field.key] = String(field.get(rules))
  }
  return values
}

export interface AppliedForm {
  readonly rules: RulesConfig
  /** 数値として読めなかった項目のラベル。 */
  readonly invalid: readonly string[]
}

/**
 * フォームの文字列を数値へ変換し、ベースのルールへ適用する。
 *
 * **読めなかった項目は適用せず、報告する。** 空文字を 0 として扱うと、
 * 入力を消しただけで初期点が 0 になり、対局が始まらない設定が保存される。
 */
export function applyFormValues(
  base: RulesConfig,
  values: Readonly<Record<string, string>>,
): AppliedForm {
  let rules = base
  const invalid: string[] = []

  for (const field of ALL_FIELDS) {
    const raw = values[field.key]
    if (raw === undefined) {
      continue
    }

    const parsed = parseIntegerInput(raw)
    if (parsed === null) {
      invalid.push(field.label)
      continue
    }

    rules = field.set(rules, parsed)
  }

  return { rules, invalid }
}

/**
 * 整数として読める文字列だけを受け付ける。
 *
 * `Number('')` は 0、`Number(' ')` も 0 になる。空欄を 0 と解釈すると
 * 「消しただけ」が「0 を設定した」に化けるので、明示的に弾く。
 */
export function parseIntegerInput(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }

  const value = Number(trimmed)
  return Number.isInteger(value) ? value : null
}

/**
 * 既定値との差分だけを取り出す。
 *
 * **全体ではなく差分を保存する。** 全体を保存すると、既定値を変更したときに
 * 古い保存値が全項目を上書きし続け、更新が利用者に届かなくなる。
 */
export function diffFromDefaults(
  rules: RulesConfig,
  defaults: RulesConfig,
): Record<string, unknown> | null {
  const diff: Record<string, unknown> = {}

  if (rules.startingScore !== defaults.startingScore) {
    diff.startingScore = rules.startingScore
  }
  if (rules.bonusPerCard !== defaults.bonusPerCard) {
    diff.bonusPerCard = rules.bonusPerCard
  }
  if (!shallowEqual(rules.turnTimer, defaults.turnTimer)) {
    diff.turnTimer = rules.turnTimer
  }
  if (!scoresEqual(rules, defaults)) {
    diff.scores = rules.scores
  }
  if (rules.bet.initialWallet !== defaults.bet.initialWallet) {
    diff.bet = { ...defaults.bet, initialWallet: rules.bet.initialWallet }
  }

  return Object.keys(diff).length === 0 ? null : diff
}

function scoresEqual(a: RulesConfig, b: RulesConfig): boolean {
  return YAKU_KINDS.every(
    (kind) =>
      a.scores[kind].base === b.scores[kind].base &&
      a.scores[kind].sameColor === b.scores[kind].sameColor,
  )
}

function shallowEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])

  return [...keys].every((key) => left[key] === right[key])
}
