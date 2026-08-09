import { describe, expect, it } from 'vitest'

import {
  ALL_FIELDS,
  applyFormValues,
  diffFromDefaults,
  parseIntegerInput,
  toFormValues,
} from '../../src/ui/rulesForm'
import { DEFAULT_RULES } from '../../src/config/rules'

describe('parseIntegerInput', () => {
  it('整数として読める文字列を数値にする', () => {
    expect(parseIntegerInput('120')).toBe(120)
    expect(parseIntegerInput(' 120 ')).toBe(120)
    expect(parseIntegerInput('0')).toBe(0)
    expect(parseIntegerInput('-5')).toBe(-5)
  })

  /**
   * `Number('')` も `Number(' ')` も 0 になる。空欄を 0 と解釈すると
   * 「消しただけ」が「0 を設定した」に化け、対局が始まらない設定が保存される。
   */
  it('空欄を0として扱わない', () => {
    expect(parseIntegerInput('')).toBeNull()
    expect(parseIntegerInput('   ')).toBeNull()
  })

  it('数値でない文字列を受け付けない', () => {
    expect(parseIntegerInput('abc')).toBeNull()
    expect(parseIntegerInput('12px')).toBeNull()
    expect(parseIntegerInput('-')).toBeNull()
  })

  it('小数を受け付けない', () => {
    expect(parseIntegerInput('1.5')).toBeNull()
  })

  it('無限大や NaN を受け付けない', () => {
    expect(parseIntegerInput('Infinity')).toBeNull()
    expect(parseIntegerInput('NaN')).toBeNull()
  })
})

describe('toFormValues / applyFormValues', () => {
  it('全項目を文字列にできる', () => {
    const values = toFormValues(DEFAULT_RULES)

    expect(Object.keys(values)).toHaveLength(ALL_FIELDS.length)
    expect(values['startingScore']).toBe('1000')
  })

  it('往復すると元のルールに戻る', () => {
    const applied = applyFormValues(DEFAULT_RULES, toFormValues(DEFAULT_RULES))

    expect(applied.invalid).toEqual([])
    expect(applied.rules).toEqual(DEFAULT_RULES)
  })

  it('変更した項目だけが反映される', () => {
    const values = { ...toFormValues(DEFAULT_RULES), startingScore: '2000' }
    const applied = applyFormValues(DEFAULT_RULES, values)

    expect(applied.rules.startingScore).toBe(2000)
    expect(applied.rules.bonusPerCard).toBe(DEFAULT_RULES.bonusPerCard)
  })

  it('入れ子の項目も更新できる', () => {
    const values = { ...toFormValues(DEFAULT_RULES), 'scores.triple.base': '150' }
    const applied = applyFormValues(DEFAULT_RULES, values)

    expect(applied.rules.scores.triple.base).toBe(150)
    expect(applied.rules.scores.triple.sameColor).toBe(DEFAULT_RULES.scores.triple.sameColor)
    expect(applied.rules.scores.group3).toEqual(DEFAULT_RULES.scores.group3)
  })

  it('持ち時間の項目も更新できる', () => {
    const values = { ...toFormValues(DEFAULT_RULES), 'turnTimer.initialMs': '30000' }
    const applied = applyFormValues(DEFAULT_RULES, values)

    expect(applied.rules.turnTimer.initialMs).toBe(30_000)
    expect(applied.rules.turnTimer.minMs).toBe(DEFAULT_RULES.turnTimer.minMs)
  })

  /** 読めない項目は適用せず報告する。黙って0にしない。 */
  it('読めない項目は適用せずラベルを返す', () => {
    const values = { ...toFormValues(DEFAULT_RULES), startingScore: '' }
    const applied = applyFormValues(DEFAULT_RULES, values)

    expect(applied.invalid.length).toBe(1)
    expect(applied.rules.startingScore).toBe(DEFAULT_RULES.startingScore)
  })

  it('複数の項目が読めない場合すべて報告する', () => {
    const values = { ...toFormValues(DEFAULT_RULES), startingScore: '', bonusPerCard: 'abc' }

    expect(applyFormValues(DEFAULT_RULES, values).invalid).toHaveLength(2)
  })

  it('未知のキーは無視する', () => {
    const values = { ...toFormValues(DEFAULT_RULES), 'nope.nope': '1' }

    expect(applyFormValues(DEFAULT_RULES, values).invalid).toEqual([])
  })

  it('元のルールを破壊しない', () => {
    const snapshot = structuredClone(DEFAULT_RULES)
    applyFormValues(DEFAULT_RULES, { ...toFormValues(DEFAULT_RULES), startingScore: '9999' })

    expect(DEFAULT_RULES).toEqual(snapshot)
  })
})

describe('diffFromDefaults', () => {
  /**
   * 全体を保存すると、既定値を変更したときに古い保存値が全項目を上書きし続け、
   * 更新が利用者に届かなくなる。触った項目だけを保存する。
   */
  it('変更がなければ null', () => {
    expect(diffFromDefaults(DEFAULT_RULES, DEFAULT_RULES)).toBeNull()
  })

  it('変更した項目だけを含む', () => {
    const changed = { ...DEFAULT_RULES, startingScore: 2000 }
    const diff = diffFromDefaults(changed, DEFAULT_RULES)

    expect(diff).toEqual({ startingScore: 2000 })
  })

  it('点数表を変えると scores だけが入る', () => {
    const changed = {
      ...DEFAULT_RULES,
      scores: { ...DEFAULT_RULES.scores, triple: { base: 150, sameColor: 840 } },
    }
    const diff = diffFromDefaults(changed, DEFAULT_RULES)

    expect(Object.keys(diff ?? {})).toEqual(['scores'])
  })

  it('持ち時間を変えると turnTimer だけが入る', () => {
    const changed = {
      ...DEFAULT_RULES,
      turnTimer: { ...DEFAULT_RULES.turnTimer, initialMs: 30_000 },
    }

    expect(Object.keys(diffFromDefaults(changed, DEFAULT_RULES) ?? {})).toEqual(['turnTimer'])
  })

  it('初期コインを変えると bet が入る', () => {
    const changed = { ...DEFAULT_RULES, bet: { ...DEFAULT_RULES.bet, initialWallet: 5000 } }
    const diff = diffFromDefaults(changed, DEFAULT_RULES)

    const bet = diff === null ? null : (diff.bet as { initialWallet: number })
    expect(bet?.initialWallet).toBe(5000)
  })

  it('複数を変えるとすべて含む', () => {
    const changed = { ...DEFAULT_RULES, startingScore: 2000, bonusPerCard: 60 }
    const diff = diffFromDefaults(changed, DEFAULT_RULES)

    expect(Object.keys(diff ?? {}).sort()).toEqual(['bonusPerCard', 'startingScore'])
  })

  /** 差分をマージし直すと元のルールに戻ること。 */
  it('差分を既定値へマージすると元に戻る', () => {
    const changed = {
      ...DEFAULT_RULES,
      startingScore: 2000,
      turnTimer: { ...DEFAULT_RULES.turnTimer, initialMs: 30_000 },
    }
    const diff = diffFromDefaults(changed, DEFAULT_RULES)

    expect({ ...DEFAULT_RULES, ...diff }).toEqual(changed)
  })
})
