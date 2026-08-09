/**
 * 山札の構築と配牌。
 *
 * ポカジャン固有の仕様として、カードプールと山札は別物である。
 * プールは「今局の登場メンバー × 3色 × 3枚」（117〜144枚）だが、
 * 山札はそこからシャッフルして先頭 `deckSize`（100枚）だけを抜き出す。
 * 残りは局中に一切登場しないため、プレイヤーは残り枚数を完全には読み切れない。
 */

import { pickSome, shuffle, type Rng } from './rng'
import {
  MAX_YAKU_GROUP_SIZE,
  MIN_YAKU_GROUP_SIZE,
  type Card,
  type Group,
  type Member,
  type MemberId,
  type Roster,
  type RulesConfig,
} from './types'

/** ロスターが不正で対局を開始できないときに投げられる。 */
export class RosterValidationError extends Error {
  readonly errors: readonly string[]

  constructor(errors: readonly string[]) {
    super(`ロスターの検証に失敗しました: ${errors.join(' / ')}`)
    this.name = 'RosterValidationError'
    this.errors = errors
  }
}

export interface RosterValidationResult {
  /** `errors` が空かどうか。`warnings` は `ok` に影響しない。 */
  readonly ok: boolean
  readonly errors: readonly string[]
  /** 対局は可能だが利用者に伝えたい指摘（例: どのグループにも属さないメンバー）。 */
  readonly warnings: readonly string[]
}

/** 1局分のセットアップ結果。 */
export interface GameSetup {
  readonly activeGroups: readonly Group[]
  readonly activeMembers: readonly Member[]
  readonly bonusMemberIds: readonly MemberId[]
  /** プレイヤーごとの初期手札。`hands[i]` の長さは `rules.handSize`。 */
  readonly hands: readonly (readonly Card[])[]
  /** 配牌後に残った山札。 */
  readonly wall: readonly Card[]
}

/** 1メンバーあたりのカード枚数（色数 × 各色の枚数）。 */
export function cardsPerMember(rules: RulesConfig): number {
  return rules.colors.length * rules.copiesPerMemberColor
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * ロスターの「形」を検証する。
 *
 * Step 6 ではユーザーが用意した JSON をそのまま `Roster` として読み込むため、
 * 型システムの保証はここでは効かない。配列でない・フィールドが欠けているといった
 * 壊れた入力に対しても `TypeError` を投げず、エラーメッセージとして返す必要がある。
 */
function validateStructure(roster: Roster): string[] {
  const candidate = roster as Partial<Roster> | null | undefined
  const errors: string[] = []

  if (!Array.isArray(candidate?.members)) {
    errors.push('members が配列ではありません')
  }
  if (!Array.isArray(candidate?.groups)) {
    errors.push('groups が配列ではありません')
  }
  // 以降の走査が成立しないため、ここで打ち切る。
  if (errors.length > 0) {
    return errors
  }

  for (const member of roster.members) {
    if (!isNonEmptyString(member?.id)) {
      errors.push('メンバーの id が空でない文字列ではありません')
      break
    }
  }

  for (const group of roster.groups) {
    if (!isNonEmptyString(group?.id)) {
      errors.push('グループの id が空でない文字列ではありません')
      break
    }
    if (!Array.isArray(group.memberIds) || !group.memberIds.every(isNonEmptyString)) {
      errors.push(`グループ「${group.id}」の memberIds が文字列の配列ではありません`)
    }
  }

  return errors
}

/** メンバーIDの重複を検出する。 */
function validateMemberUniqueness(members: readonly Member[]): string[] {
  const seen = new Set<MemberId>()
  const duplicated = new Set<MemberId>()

  for (const member of members) {
    if (seen.has(member.id)) {
      duplicated.add(member.id)
    }
    seen.add(member.id)
  }

  return duplicated.size > 0 ? [`メンバーIDが重複しています: ${[...duplicated].join(', ')}`] : []
}

/** グループIDの重複を検出する。 */
function validateGroupUniqueness(groups: readonly Group[]): string[] {
  const seen = new Set<string>()
  const duplicated = new Set<string>()

  for (const group of groups) {
    if (seen.has(group.id)) {
      duplicated.add(group.id)
    }
    seen.add(group.id)
  }

  return duplicated.size > 0 ? [`グループIDが重複しています: ${[...duplicated].join(', ')}`] : []
}

/**
 * 各グループの構成を検証する。
 *
 * 1メンバーが複数グループに所属すると「N人組」役が両グループで二重に成立し、
 * 役判定と点数が曖昧になるため禁止する。
 */
function validateGroupComposition(
  groups: readonly Group[],
  knownMemberIds: ReadonlySet<MemberId>,
  rules: RulesConfig,
): string[] {
  const errors: string[] = []
  const groupOfMember = new Map<MemberId, string>()

  for (const group of groups) {
    const uniqueMemberIds = new Set(group.memberIds)

    if (uniqueMemberIds.size !== group.memberIds.length) {
      errors.push(`グループ「${group.name}」に同じメンバーが複数含まれています`)
    }

    if (uniqueMemberIds.size < rules.minGroupSize || uniqueMemberIds.size > rules.maxGroupSize) {
      errors.push(
        `グループ「${group.name}」の人数は${rules.minGroupSize}〜${rules.maxGroupSize}人である必要がありますが、${uniqueMemberIds.size}人です`,
      )
    }

    for (const memberId of uniqueMemberIds) {
      if (!knownMemberIds.has(memberId)) {
        errors.push(`グループ「${group.name}」に未知のメンバー「${memberId}」が含まれています`)
        continue
      }
      const owner = groupOfMember.get(memberId)
      if (owner !== undefined) {
        errors.push(
          `メンバー「${memberId}」がグループ「${owner}」と「${group.id}」に重複所属しています`,
        )
        continue
      }
      groupOfMember.set(memberId, group.id)
    }
  }

  return errors
}

/**
 * どのグループが選ばれても山札が組めることを検証する。
 *
 * グループ選出は無作為なので、合計人数ではなく
 * 「人数の少ない順に `groupsPerGame` 個を取った最悪ケース」で枚数を確認する必要がある。
 */
function validatePoolCapacity(groups: readonly Group[], rules: RulesConfig): string[] {
  if (groups.length < rules.groupsPerGame) {
    return []
  }

  const worstCaseMembers = groups
    .map((group) => new Set(group.memberIds).size)
    .sort((a, b) => a - b)
    .slice(0, rules.groupsPerGame)
    .reduce((sum, size) => sum + size, 0)
  const worstCasePool = worstCaseMembers * cardsPerMember(rules)

  return worstCasePool < rules.deckSize
    ? [
        `最小構成のグループ選出（${worstCaseMembers}人 = ${worstCasePool}枚）では山札${rules.deckSize}枚を組めません`,
      ]
    : []
}

/**
 * ルール設定のグループ人数が役判定の対応範囲に収まっているかを検証する。
 *
 * 役種は `group3` / `group4` / `group5` の3つしかないため、`maxGroupSize` を 6 にすると
 * ロスター検証と配牌は通るのに、最初の役判定で `groupYakuKind` が落ちて対局が壊れる。
 * 対局を始める前に弾く。
 */
function validateGroupSizeRules(rules: RulesConfig): string[] {
  const errors: string[] = []

  if (rules.minGroupSize > rules.maxGroupSize) {
    errors.push(
      `minGroupSize(${rules.minGroupSize}) が maxGroupSize(${rules.maxGroupSize}) を超えています`,
    )
  }
  if (rules.minGroupSize < MIN_YAKU_GROUP_SIZE || rules.maxGroupSize > MAX_YAKU_GROUP_SIZE) {
    errors.push(
      `グループ人数の設定は${MIN_YAKU_GROUP_SIZE}〜${MAX_YAKU_GROUP_SIZE}人の範囲内である必要があります（役判定がこの範囲にしか対応していません）が、${rules.minGroupSize}〜${rules.maxGroupSize}人でした`,
    )
  }

  return errors
}

/** どのグループにも属さないメンバーを警告として拾う（局に一度も登場できないため）。 */
function collectOrphanWarnings(roster: Roster): string[] {
  const assigned = new Set(roster.groups.flatMap((group) => group.memberIds))
  const orphans = roster.members.filter((member) => !assigned.has(member.id))

  return orphans.length > 0
    ? [
        `どのグループにも属さないメンバーがいます（局に登場しません）: ${orphans
          .map((member) => member.id)
          .join(', ')}`,
      ]
    : []
}

/**
 * ロスターを検証する。
 *
 * 例外を投げずに結果を返すのは、Step 6 のロスターエディタでエラー一覧を
 * そのまま画面に出したいため。対局開始時の致命的エラーとして扱いたい場合は
 * `setupGame` を使う（`RosterValidationError` を投げる）。
 *
 * ユーザー提供の JSON をロスターとして読み込む経路があるため、
 * ここは信頼できない入力の検証点として構造から順に確認する。
 */
export function validateRoster(roster: Roster, rules: RulesConfig): RosterValidationResult {
  const structuralErrors = validateStructure(roster)
  if (structuralErrors.length > 0) {
    return { ok: false, errors: structuralErrors, warnings: [] }
  }

  const knownMemberIds = new Set(roster.members.map((member) => member.id))
  const errors = [
    ...validateGroupSizeRules(rules),
    ...validateMemberUniqueness(roster.members),
    ...validateGroupUniqueness(roster.groups),
    ...(roster.groups.length < rules.groupsPerGame
      ? [
          `グループが${rules.groupsPerGame}個以上必要ですが、${roster.groups.length}個しかありません`,
        ]
      : []),
    ...validateGroupComposition(roster.groups, knownMemberIds, rules),
    ...validatePoolCapacity(roster.groups, rules),
  ]

  return { ok: errors.length === 0, errors, warnings: collectOrphanWarnings(roster) }
}

/**
 * 今局に登場するグループを無作為に選ぶ。
 *
 * `roster.groups` が `rules.groupsPerGame` 未満の場合は `RangeError` を投げる。
 * 事前に `validateRoster` を通すこと。
 */
export function selectGroups(roster: Roster, rules: RulesConfig, rng: Rng): Group[] {
  return pickSome(roster.groups, rules.groupsPerGame, rng)
}

/**
 * 選出グループに所属する全メンバーを、ロスターの定義から解決する。
 *
 * 未知のメンバーを参照していた場合は例外を投げるが、これは `validateRoster` を
 * 通していれば起こり得ない内部不変条件の違反を示す。
 */
export function collectMembers(roster: Roster, groups: readonly Group[]): Member[] {
  const memberById = new Map(roster.members.map((member) => [member.id, member]))

  return groups.flatMap((group) =>
    group.memberIds.map((memberId) => {
      const member = memberById.get(memberId)
      if (member === undefined) {
        throw new Error(`メンバー「${memberId}」がロスターに存在しません`)
      }
      return member
    }),
  )
}

/**
 * カードプールを構築する。
 *
 * 枚数は `メンバー数 × 色数 × copiesPerMemberColor`（既定では1メンバー9枚）。
 * `uid` は 0 から連番で振るため、同一シード・同一メンバー順なら常に同じ割り当てになる。
 */
export function buildCardPool(members: readonly Member[], rules: RulesConfig): Card[] {
  const pool: Card[] = []
  let uid = 0

  for (const member of members) {
    for (const color of rules.colors) {
      for (let copy = 0; copy < rules.copiesPerMemberColor; copy++) {
        pool.push({ uid, memberId: member.id, color })
        uid++
      }
    }
  }

  return pool
}

/** プールをシャッフルし、先頭 `deckSize` 枚を山札として切り出す。 */
export function buildDeck(members: readonly Member[], rules: RulesConfig, rng: Rng): Card[] {
  const pool = buildCardPool(members, rules)

  if (pool.length < rules.deckSize) {
    throw new RangeError(
      `カードプールが${pool.length}枚しかなく、山札${rules.deckSize}枚を組めません`,
    )
  }

  return shuffle(pool, rng).slice(0, rules.deckSize)
}

/**
 * 今局のボーナスメンバーを選ぶ。役に含まれると1枚につき `bonusPerCard` 点が加算される。
 *
 * 選出母集団は「登場メンバー全員」ではなく **山札に実際に含まれるメンバー** に限定する。
 * プールから `deckSize` 枚を抜き出す際、あるメンバーの9枚すべてが山札外に落ちることがあり、
 * その場合ボーナスが一度も引けない「死にボーナス」になってしまうため。
 *
 * 候補順は山札のシャッフル順に依存させず ID 昇順に固定しているので、
 * 同一シードなら常に同じボーナスが選ばれる。
 */
export function selectBonusMembers(
  deck: readonly Card[],
  rules: RulesConfig,
  rng: Rng,
): MemberId[] {
  const presentMemberIds = [...new Set(deck.map((card) => card.memberId))].sort()

  if (presentMemberIds.length < rules.bonusMemberCount) {
    throw new RangeError(
      `ボーナスメンバーを${rules.bonusMemberCount}人選ぶ必要がありますが、山札には${presentMemberIds.length}人分のカードしかありません`,
    )
  }

  return pickSome(presentMemberIds, rules.bonusMemberCount, rng)
}

/**
 * 山札から各プレイヤーへ配牌する。
 *
 * 山札は既にシャッフル済みのため、実際の卓のように1枚ずつ回して配る必要はなく、
 * 先頭から `handSize` 枚ずつ切り出せば統計的に等価になる。
 */
export function deal(deck: readonly Card[], rules: RulesConfig): { hands: Card[][]; wall: Card[] } {
  const needed = rules.playerCount * rules.handSize

  if (deck.length < needed) {
    throw new RangeError(`配牌に${needed}枚必要ですが、山札は${deck.length}枚しかありません`)
  }

  const hands: Card[][] = []
  for (let player = 0; player < rules.playerCount; player++) {
    hands.push(deck.slice(player * rules.handSize, (player + 1) * rules.handSize))
  }

  return { hands, wall: deck.slice(needed) }
}

/**
 * 1局分のセットアップを一括で行う。
 *
 * ロスターが不正な場合は `RosterValidationError` を投げる。壊れた形の入力（配列でない等）も
 * `validateRoster` が構造から検証するため、生の `TypeError` が漏れることはない。
 */
export function setupGame(roster: Roster, rules: RulesConfig, rng: Rng): GameSetup {
  const validation = validateRoster(roster, rules)
  if (!validation.ok) {
    throw new RosterValidationError(validation.errors)
  }

  const activeGroups = selectGroups(roster, rules, rng)
  const activeMembers = collectMembers(roster, activeGroups)
  const deck = buildDeck(activeMembers, rules, rng)
  const bonusMemberIds = selectBonusMembers(deck, rules, rng)
  const { hands, wall } = deal(deck, rules)

  return { activeGroups, activeMembers, bonusMemberIds, hands, wall }
}
