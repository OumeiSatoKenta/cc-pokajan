import { describe, expect, it } from 'vitest'

import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import { cardsPerMember, validateRoster } from '../../src/engine/deck'
import { COLOR_IDS, type YakuKind } from '../../src/engine/types'

const YAKU_KINDS: YakuKind[] = ['triple', 'group3', 'group4', 'group5']

describe('DEFAULT_RULES の自己整合性', () => {
  it('全ての役の点数が3で割り切れる（ツモ時の1/3分配を整数演算で行う前提）', () => {
    for (const kind of YAKU_KINDS) {
      const score = DEFAULT_RULES.scores[kind]
      expect(score.base % 3, `${kind}.base = ${score.base}`).toBe(0)
      expect(score.sameColor % 3, `${kind}.sameColor = ${score.sameColor}`).toBe(0)
    }
  })

  it('ボーナス加点が3で割り切れる', () => {
    expect(DEFAULT_RULES.bonusPerCard % 3).toBe(0)
  })

  /**
   * 持ち時間は「初期値から減少幅ずつ減り、下限で止まる」形でしか使われない。
   * 3値の関係が崩れると、減り方が仕様どおりにならないか一度も減らなくなる。
   */
  it('持ち時間の3値が整合している', () => {
    const { initialMs, decrementMs, minMs } = DEFAULT_RULES.turnTimer

    expect(minMs).toBeGreaterThan(0)
    expect(initialMs).toBeGreaterThanOrEqual(minMs)
    expect(decrementMs).toBeGreaterThan(0)
    // 減少幅が初期値と下限の差を割り切らないと、下限にちょうど着地せず飽和で丸められる
    expect((initialMs - minMs) % decrementMs).toBe(0)
  })

  /**
   * 精算では `整数の点数 × 順位倍率` を切り捨てる。倍率が 0.5 の倍数であれば
   * 二進浮動小数で厳密に表現でき、丸めに誤差が入らない。
   * 1.1 のような値を入れると `floor` の結果が1ずれうる。
   */
  it('順位倍率が 0.5 の倍数である（精算の丸めに誤差を入れないため）', () => {
    for (const multiplier of DEFAULT_RULES.bet.rankMultiplier) {
      expect((multiplier * 2) % 1, `倍率 ${multiplier}`).toBe(0)
    }
  })

  it('順位倍率が人数分あり、上位ほど高い', () => {
    const multipliers = DEFAULT_RULES.bet.rankMultiplier

    expect(multipliers).toHaveLength(DEFAULT_RULES.playerCount)
    for (let i = 1; i < multipliers.length; i++) {
      expect(multipliers[i - 1], `${i}位と${i + 1}位`).toBeGreaterThanOrEqual(multipliers[i])
    }
  })

  it('初期コインで最大の BET を出せる', () => {
    // これを下回ると初回起動時にどの BET も選べず、補充からしか始められない
    expect(DEFAULT_RULES.bet.initialWallet).toBeGreaterThanOrEqual(
      Math.max(...DEFAULT_RULES.bet.options),
    )
  })

  it('BET の選択肢がすべて正の数である', () => {
    expect(DEFAULT_RULES.bet.options.length).toBeGreaterThan(0)
    for (const option of DEFAULT_RULES.bet.options) {
      expect(option, `BET ${option}`).toBeGreaterThan(0)
    }
  })

  it('「3の倍数」の前提が playerCount と結びついている', () => {
    // ツモ時は自分以外の (playerCount - 1) 人から等分で徴収する。
    // playerCount を変えるなら scores の割り切れ条件も見直す必要がある。
    expect(DEFAULT_RULES.playerCount - 1).toBe(3)
  })

  it('同色の点数が通常の点数を上回る', () => {
    for (const kind of YAKU_KINDS) {
      const score = DEFAULT_RULES.scores[kind]
      expect(score.sameColor, `${kind}`).toBeGreaterThan(score.base)
    }
  })

  it('グループ役の基本点が人数の多い役ほど高い', () => {
    expect(DEFAULT_RULES.scores.group3.base).toBeLessThan(DEFAULT_RULES.scores.group4.base)
    expect(DEFAULT_RULES.scores.group4.base).toBeLessThan(DEFAULT_RULES.scores.group5.base)
  })

  it('調査で判明した点数が反映されている', () => {
    expect(DEFAULT_RULES.scores.triple).toEqual({ base: 120, sameColor: 840 })
    expect(DEFAULT_RULES.scores.group4).toEqual({ base: 300, sameColor: 840 })
    expect(DEFAULT_RULES.scores.group5).toEqual({ base: 480, sameColor: 1800 })
    expect(DEFAULT_RULES.scores.group3.base).toBe(180)
    // group3.sameColor は実機未確認の推定値（TODO(要実機確認)）。
    expect(DEFAULT_RULES.scores.group3.sameColor).toBe(540)
    expect(DEFAULT_RULES.bonusPerCard).toBe(90)
  })

  it('山札が配牌に足りる', () => {
    expect(DEFAULT_RULES.deckSize).toBeGreaterThanOrEqual(
      DEFAULT_RULES.playerCount * DEFAULT_RULES.handSize,
    )
  })

  it('順位倍率がプレイヤー数分だけ定義され、降順になっている', () => {
    const { rankMultiplier } = DEFAULT_RULES.bet
    expect(rankMultiplier).toHaveLength(DEFAULT_RULES.playerCount)
    for (let i = 1; i < rankMultiplier.length; i++) {
      expect(rankMultiplier[i]).toBeLessThanOrEqual(rankMultiplier[i - 1])
    }
  })

  it('色定義が COLOR_IDS と一致し、1メンバー9枚になる', () => {
    expect(DEFAULT_RULES.colors).toEqual(COLOR_IDS)
    expect(cardsPerMember(DEFAULT_RULES)).toBe(9)
  })

  it('グループ人数の下限・上限が妥当である', () => {
    expect(DEFAULT_RULES.minGroupSize).toBeLessThanOrEqual(DEFAULT_RULES.maxGroupSize)
    expect(DEFAULT_RULES.minGroupSize).toBeGreaterThan(0)
  })
})

describe('DEFAULT_ROSTER と DEFAULT_RULES の組み合わせ', () => {
  it('デフォルトロスターがデフォルトルールで検証を通過する', () => {
    expect(validateRoster(DEFAULT_ROSTER, DEFAULT_RULES).errors).toEqual([])
  })

  it('6グループ22メンバーで構成されている', () => {
    expect(DEFAULT_ROSTER.groups).toHaveLength(6)
    expect(DEFAULT_ROSTER.members).toHaveLength(22)
  })

  it('3人組・4人組・5人組の全サイズが含まれる（全役が出現しうる）', () => {
    const sizes = new Set(DEFAULT_ROSTER.groups.map((group) => group.memberIds.length))
    expect(sizes).toEqual(new Set([3, 4, 5]))
  })

  it('全メンバーがいずれかのグループに所属している', () => {
    const assigned = new Set(DEFAULT_ROSTER.groups.flatMap((group) => group.memberIds))
    for (const member of DEFAULT_ROSTER.members) {
      expect(assigned.has(member.id), member.id).toBe(true)
    }
  })

  it('全メンバーに accent カラーが設定されている（画像なしでも描画できる）', () => {
    for (const member of DEFAULT_ROSTER.members) {
      expect(member.accent, member.id).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
