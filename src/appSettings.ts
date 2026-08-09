/**
 * 保存されたロスターとルールの読み出し。
 *
 * **ここが localStorage とエンジンの境界になる。** 保存値はユーザーが直接編集でき、
 * 別バージョンの本アプリが書いた値も残る。`handSize: 0` のような値がそのまま
 * `createGame` に渡ると、配牌の時点で例外になり**タイトル画面すら出せなくなる**。
 * 永続化されているのでリロードしても回復しない。
 *
 * 採用の条件は「実際に対局を始められること」。検査項目の列挙に正しさを預けない。
 */

import { validateRoster } from './engine/deck'
import { canStartGame, validateRules } from './engine/rulesValidation'
import type { Roster, RulesConfig } from './engine/types'
import type { Prefs } from './storage/prefs'

export interface ResolvedSettings {
  readonly roster: Roster
  readonly rules: RulesConfig
  /** 保存値を採用できず既定値に倒したか。画面で知らせるために返す。 */
  readonly fellBack: boolean
}

export interface SettingsDefaults {
  readonly roster: Roster
  readonly rules: RulesConfig
}

/**
 * 保存値を検証して採用するか決める。
 *
 * **ロスターとルールをまとめて判定する。** 片方だけ採用すると、
 * 「メンバー13人のロスター」と「登場グループ6」のように
 * 単体では妥当なのに組み合わせでは対局できない状態が作れてしまう。
 */
export function resolveSettings(prefs: Prefs, defaults: SettingsDefaults): ResolvedSettings {
  const rules = mergeRules(prefs.rulesOverride, defaults.rules)
  const roster = asRoster(prefs.roster) ?? defaults.roster

  if (
    // 構造的な検査。`handSize: 0` や `playerCount: 0` は createGame が例外にしないため、
    // `canStartGame` だけでは通り抜けてしまう（「始まるが進まない対局」になる）。
    validateRules(rules).ok &&
    validateRoster(roster, rules).ok &&
    // 実際に始められること。列挙し切れないルールとロスターの組み合わせを捕まえる。
    canStartGame(roster, rules) &&
    // 既定ロスターでも始められること。設定画面から戻すだけで復帰できる状態を保つ。
    canStartGame(defaults.roster, rules)
  ) {
    return { roster, rules, fellBack: false }
  }

  return { ...defaults, fellBack: prefs.roster !== null || prefs.rulesOverride !== null }
}

/**
 * ルールの差分を既定値へマージする。
 *
 * 差分で保存しているので、触っていない項目は常に最新の既定値に追随する。
 * 型としては素通しになるため、**マージ結果は必ず `resolveSettings` の検査を通す**。
 */
function mergeRules(override: Record<string, unknown> | null, defaults: RulesConfig): RulesConfig {
  if (override === null) {
    return defaults
  }
  return { ...defaults, ...override } as RulesConfig
}

/** ロスターの**形**だけを確かめる。妥当性は `validateRoster` の仕事。 */
function asRoster(value: unknown): Roster | null {
  if (typeof value !== 'object' || value === null) {
    return null
  }

  const candidate = value as Partial<Roster>
  if (!Array.isArray(candidate.members) || !Array.isArray(candidate.groups)) {
    return null
  }

  return candidate as Roster
}
