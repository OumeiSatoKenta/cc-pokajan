/**
 * ルール値の検証。
 *
 * **設定画面と永続化から届く値がそのままエンジンに渡る**ため、ここが最後の砦になる。
 * localStorage はユーザーが直接編集でき、別バージョンの本アプリが書いた値も残る。
 * 不正な値で `createGame` が落ちると、永続化されている分リロードしても回復せず、
 * **タイトル画面すら出せなくなる**。
 *
 * 検査するのは「これを外すと対局が始まらない／進まない」項目に限る。
 * 好みの範囲（点数が高すぎる等）は誤りではないので弾かない。
 */

import { createGame } from './game'
import { MAX_YAKU_GROUP_SIZE, MIN_YAKU_GROUP_SIZE, type Roster, type RulesConfig } from './types'

export interface RulesValidationResult {
  /** `errors` が空かどうか。`warnings` は `ok` に影響しない。 */
  readonly ok: boolean
  readonly errors: readonly string[]
  /** 対局は成立するが利用者に伝えたい指摘。 */
  readonly warnings: readonly string[]
}

const YAKU_KINDS = ['triple', 'group3', 'group4', 'group5'] as const

export function validateRules(rules: RulesConfig): RulesValidationResult {
  const errors = [
    ...validateCounts(rules),
    ...validateGroupSizes(rules),
    ...validateScores(rules),
    ...validateTimer(rules),
    ...validateBet(rules),
  ]

  return { ok: errors.length === 0, errors, warnings: collectWarnings(rules) }
}

function validateCounts(rules: RulesConfig): string[] {
  const errors: string[] = []

  // `playerCount` と `handSize` は createGame では例外にならず、
  // 「始まるが進まない対局」を作る。例外にならない値のほうが危険なので必ず捕まえる。
  if (!isCountAtLeast(rules.playerCount, 2)) {
    errors.push(`プレイヤー数は2人以上の整数である必要があります: ${rules.playerCount}`)
  }
  if (!isCountAtLeast(rules.handSize, 1)) {
    errors.push(`手札の枚数は1枚以上の整数である必要があります: ${rules.handSize}`)
  }
  if (!isCountAtLeast(rules.groupsPerGame, 1)) {
    errors.push(`1局に登場するグループ数は1以上の整数である必要があります: ${rules.groupsPerGame}`)
  }
  if (!isCountAtLeast(rules.copiesPerMemberColor, 1)) {
    errors.push(
      `1メンバー1色あたりの枚数は1以上の整数である必要があります: ${rules.copiesPerMemberColor}`,
    )
  }
  if (!isCountAtLeast(rules.maxChainDeclare, 1)) {
    errors.push(`連続宣言の上限は1以上の整数である必要があります: ${rules.maxChainDeclare}`)
  }
  if (!isCountAtLeast(rules.bonusMemberCount, 0)) {
    errors.push(`ボーナスメンバー数は0以上の整数である必要があります: ${rules.bonusMemberCount}`)
  }
  if (!isCountAtLeast(rules.startingScore, 1)) {
    errors.push(`初期点は1以上の整数である必要があります: ${rules.startingScore}`)
  }

  if (rules.colors.length === 0) {
    errors.push('色は1色以上必要です')
  } else if (new Set(rules.colors).size !== rules.colors.length) {
    errors.push(`色が重複しています: [${rules.colors.join(', ')}]`)
  }

  // 配りきれない山札では対局そのものが始まらない。
  const dealt = rules.playerCount * rules.handSize
  if (!isCountAtLeast(rules.deckSize, 1)) {
    errors.push(`山札の枚数は1以上の整数である必要があります: ${rules.deckSize}`)
  } else if (Number.isInteger(dealt) && rules.deckSize <= dealt) {
    errors.push(`山札(${rules.deckSize}枚)が配牌(${dealt}枚)以下です。引く札が残りません`)
  }

  return errors
}

function validateGroupSizes(rules: RulesConfig): string[] {
  const { minGroupSize, maxGroupSize } = rules

  if (!isCountAtLeast(minGroupSize, 1) || !isCountAtLeast(maxGroupSize, 1)) {
    return ['グループ人数の上下限は1以上の整数である必要があります']
  }
  if (minGroupSize > maxGroupSize) {
    return [`グループ人数の下限(${minGroupSize})が上限(${maxGroupSize})を超えています`]
  }
  // 役判定はこの範囲にしか対応していない（`YakuKind` が group3〜group5 のため）。
  if (minGroupSize < MIN_YAKU_GROUP_SIZE || maxGroupSize > MAX_YAKU_GROUP_SIZE) {
    return [
      `グループ人数は${MIN_YAKU_GROUP_SIZE}〜${MAX_YAKU_GROUP_SIZE}人の範囲である必要があります（役判定がこの範囲にしか対応していません）: ${minGroupSize}〜${maxGroupSize}`,
    ]
  }

  return []
}

function validateScores(rules: RulesConfig): string[] {
  const errors: string[] = []

  if (!isCountAtLeast(rules.bonusPerCard, 0)) {
    errors.push(`ボーナス加点は0以上の整数である必要があります: ${rules.bonusPerCard}`)
  }

  for (const kind of YAKU_KINDS) {
    const score = rules.scores[kind]
    if (score === undefined) {
      errors.push(`役「${kind}」の点数が設定されていません`)
      continue
    }
    if (!isCountAtLeast(score.base, 0)) {
      errors.push(`役「${kind}」の点数は0以上の整数である必要があります: ${score.base}`)
    }
    if (!isCountAtLeast(score.sameColor, 0)) {
      errors.push(`役「${kind}」の同色点は0以上の整数である必要があります: ${score.sameColor}`)
    }
  }

  return errors
}

function validateTimer(rules: RulesConfig): string[] {
  const { initialMs, decrementMs, minMs } = rules.turnTimer
  const errors: string[] = []

  if (!isCountAtLeast(minMs, 1)) {
    errors.push(`持ち時間の下限は1ミリ秒以上の整数である必要があります: ${minMs}`)
  }
  if (!isCountAtLeast(decrementMs, 0)) {
    errors.push(`持ち時間の減少幅は0以上の整数である必要があります: ${decrementMs}`)
  }
  if (!isCountAtLeast(initialMs, 1)) {
    errors.push(`持ち時間の初期値は1ミリ秒以上の整数である必要があります: ${initialMs}`)
  } else if (isCountAtLeast(minMs, 1) && initialMs < minMs) {
    // 初期値が下限を下回ると、時間切れのたびに持ち時間が**伸びる**。
    errors.push(`持ち時間の初期値(${initialMs})が下限(${minMs})を下回っています`)
  }

  return errors
}

function validateBet(rules: RulesConfig): string[] {
  const { options, rankMultiplier, initialWallet } = rules.bet
  const errors: string[] = []

  if (options.length === 0) {
    errors.push('BET の選択肢が1つ以上必要です')
  } else if (options.some((option) => !isCountAtLeast(option, 1))) {
    errors.push(`BET 額は1以上の整数である必要があります: [${options.join(', ')}]`)
  }

  if (rankMultiplier.length !== rules.playerCount) {
    errors.push(
      `順位倍率の数(${rankMultiplier.length})がプレイヤー数(${rules.playerCount})と一致しません`,
    )
  }
  // 0.5 の倍数なら `整数 × 倍率` が厳密に表現でき、精算の切り捨てに誤差が入らない。
  if (
    rankMultiplier.some((value) => !Number.isFinite(value) || value <= 0 || (value * 2) % 1 !== 0)
  ) {
    errors.push(`順位倍率は 0.5 の倍数の正の数である必要があります: [${rankMultiplier.join(', ')}]`)
  }

  if (!isCountAtLeast(initialWallet, 0)) {
    errors.push(`初期コインは0以上の整数である必要があります: ${initialWallet}`)
  } else if (options.length > 0 && initialWallet < Math.min(...options)) {
    errors.push(
      `初期コイン(${initialWallet})が最低 BET 額(${Math.min(...options)})を下回っています。1局も始められません`,
    )
  }

  return errors
}

/**
 * 対局は成立するが伝えたい指摘。
 *
 * 点数が3の倍数でない場合、ツモの 1/3 分配で端数が切り捨てられ、
 * 実際に動く点数が点数表より小さくなる。ただし**点数保存則は保たれる**
 * （各人が同額を払い、勝者はその合計を得る）ため誤りではない。
 */
function collectWarnings(rules: RulesConfig): string[] {
  const warnings: string[] = []
  const divisor = rules.playerCount - 1

  if (!isCountAtLeast(divisor, 1)) {
    return warnings
  }

  const indivisible = YAKU_KINDS.filter((kind) => {
    const score = rules.scores[kind]
    return score !== undefined && (score.base % divisor !== 0 || score.sameColor % divisor !== 0)
  })

  if (indivisible.length > 0) {
    warnings.push(
      `次の役の点数が${divisor}で割り切れません: ${indivisible.join(', ')}。ツモの分配で端数が切り捨てられます`,
    )
  }
  if (rules.bonusPerCard % divisor !== 0) {
    warnings.push(
      `ボーナス加点(${rules.bonusPerCard})が${divisor}で割り切れません。ツモの分配で端数が切り捨てられます`,
    )
  }

  return warnings
}

/**
 * **実際に1局を初期化できるか**で判定する。
 *
 * `bonusMemberCount` の上限のように、ルール単体では判定できず
 * ロスターとの組み合わせで初めて壊れる項目がある。検査項目を列挙し切ろうとすると、
 * 数え漏れがそのまま起動不能につながる。
 * ここでは列挙の網羅性に正しさを預けず、**始められること自体**を条件にする。
 *
 * 固定シードで初期化を試すだけで、副作用も乱数の持ち越しもない。
 */
export function canStartGame(roster: Roster, rules: RulesConfig): boolean {
  try {
    createGame(roster, rules, PROBE_SEED, { humanSeats: [] })
    return true
  } catch {
    return false
  }
}

/** 試行用の固定シード。どの局面にも影響しない。 */
const PROBE_SEED = 1

/** 有限な整数で下限以上か。`NaN` / `Infinity` / 小数を弾く。 */
function isCountAtLeast(value: number, min: number): boolean {
  return Number.isInteger(value) && value >= min
}
