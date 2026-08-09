import { describe, expect, it } from 'vitest'

import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import {
  buildCardPool,
  buildDeck,
  cardsPerMember,
  collectMembers,
  deal,
  RosterValidationError,
  selectBonusMembers,
  selectGroups,
  setupGame,
  validateRoster,
} from '../../src/engine/deck'
import { createRng } from '../../src/engine/rng'
import type { Card, Group, Roster } from '../../src/engine/types'

const RULES = DEFAULT_RULES
const CARDS_PER_MEMBER = cardsPerMember(RULES)

function rosterWith(groups: Group[]): Roster {
  return { ...DEFAULT_ROSTER, groups }
}

function uids(cards: readonly Card[]): number[] {
  return cards.map((card) => card.uid).sort((a, b) => a - b)
}

/** メンバーIDごとの枚数を数える。 */
function countByMember(cards: readonly Card[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    counts.set(card.memberId, (counts.get(card.memberId) ?? 0) + 1)
  }
  return counts
}

/** 「メンバーID:色」ごとの枚数を数える。 */
function countByMemberColor(cards: readonly Card[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = `${card.memberId}:${card.color}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

describe('validateRoster', () => {
  it('デフォルトロスターは検証を通過する', () => {
    const result = validateRoster(DEFAULT_ROSTER, RULES)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it('グループ数が groupsPerGame 未満なら検出する', () => {
    const result = validateRoster(rosterWith(DEFAULT_ROSTER.groups.slice(0, 3) as Group[]), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('グループが4個以上必要'))).toBe(true)
  })

  it('グループ人数が下限未満なら検出する', () => {
    const groups = [...DEFAULT_ROSTER.groups] as Group[]
    groups[0] = { id: 'tiny', name: 'タイニー組', memberIds: ['nova', 'lux'] }
    const result = validateRoster(rosterWith(groups), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('3〜5人である必要'))).toBe(true)
  })

  it('グループ人数が上限超過なら検出する', () => {
    const groups = [...DEFAULT_ROSTER.groups] as Group[]
    groups[0] = {
      id: 'huge',
      name: 'ヒュージ組',
      memberIds: ['nova', 'lux', 'vega', 'sol', 'aurora', 'helio'],
    }
    const result = validateRoster(rosterWith(groups), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('3〜5人である必要'))).toBe(true)
  })

  it('ロスターに存在しないメンバーを参照していたら検出する', () => {
    const groups = [...DEFAULT_ROSTER.groups] as Group[]
    groups[0] = { id: 'stella', name: 'ステラ組', memberIds: ['nova', 'lux', 'ghost'] }
    const result = validateRoster(rosterWith(groups), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('未知のメンバー'))).toBe(true)
  })

  it('同一グループ内でメンバーが重複していたら検出する', () => {
    const groups = [...DEFAULT_ROSTER.groups] as Group[]
    groups[0] = { id: 'stella', name: 'ステラ組', memberIds: ['nova', 'nova', 'lux'] }
    const result = validateRoster(rosterWith(groups), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('同じメンバーが複数含まれ'))).toBe(true)
  })

  it('1メンバーが複数グループに所属していたら検出する', () => {
    const groups = [...DEFAULT_ROSTER.groups] as Group[]
    groups[1] = { id: 'soleil', name: 'ソレイユ組', memberIds: ['sol', 'aurora', 'nova'] }
    const result = validateRoster(rosterWith(groups), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('重複所属'))).toBe(true)
  })

  it('メンバーIDが重複していたら検出する', () => {
    const roster: Roster = {
      ...DEFAULT_ROSTER,
      members: [...DEFAULT_ROSTER.members, { id: 'nova', name: '偽ノヴァ' }],
    }
    const result = validateRoster(roster, RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('メンバーIDが重複'))).toBe(true)
  })

  it('グループIDが重複していたら検出する', () => {
    const groups = [...DEFAULT_ROSTER.groups] as Group[]
    groups[1] = { ...groups[1], id: 'stella' }
    const result = validateRoster(rosterWith(groups), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('グループIDが重複'))).toBe(true)
  })

  it('最小構成のグループ選出で山札が組めないなら検出する', () => {
    // 最悪ケース（3+3+3+4=13人 = 117枚）では組めないが、
    // 最良ケース（4+4+5+3=16人 = 144枚）なら組める値を使う。
    // 「合計枚数」ではなく「人数最小の4グループ」を見ていることを担保するための境界値。
    const result = validateRoster(DEFAULT_ROSTER, { ...RULES, deckSize: 130 })
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('山札130枚を組めません'))).toBe(true)
  })

  it('最悪ケースちょうど（117枚）なら通過する', () => {
    expect(validateRoster(DEFAULT_ROSTER, { ...RULES, deckSize: 117 }).ok).toBe(true)
  })

  it('複数の不正が同時にある場合、すべてのエラーを収集する', () => {
    const groups = [...DEFAULT_ROSTER.groups] as Group[]
    groups[0] = { id: 'soleil', name: '重複ID組', memberIds: ['nova', 'lux'] }
    const result = validateRoster(rosterWith(groups), RULES)

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('グループIDが重複'))).toBe(true)
    expect(result.errors.some((error) => error.includes('3〜5人である必要'))).toBe(true)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('どのグループにも属さないメンバーを警告として報告する（エラーにはしない）', () => {
    const roster: Roster = {
      ...DEFAULT_ROSTER,
      members: [...DEFAULT_ROSTER.members, { id: 'hermit', name: 'ハーミット' }],
    }
    const result = validateRoster(roster, RULES)

    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.warnings.some((warning) => warning.includes('hermit'))).toBe(true)
  })

  it('デフォルトロスターには警告が出ない', () => {
    expect(validateRoster(DEFAULT_ROSTER, RULES).warnings).toEqual([])
  })

  it('グループ人数の設定が役判定の対応範囲を超えていたら検出する', () => {
    // 役種は group3/group4/group5 しかないため、6人グループを許すと
    // ロスター検証と配牌は通るのに最初の役判定で落ちる。対局前に弾く。
    const result = validateRoster(DEFAULT_ROSTER, { ...RULES, maxGroupSize: 6 })

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('3〜5人の範囲内'))).toBe(true)
  })

  it('グループ人数の下限が役判定の対応範囲を下回っていたら検出する', () => {
    const result = validateRoster(DEFAULT_ROSTER, { ...RULES, minGroupSize: 2 })

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('3〜5人の範囲内'))).toBe(true)
  })

  it('minGroupSize が maxGroupSize を超えていたら検出する', () => {
    const result = validateRoster(DEFAULT_ROSTER, { ...RULES, minGroupSize: 5, maxGroupSize: 3 })

    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('を超えています'))).toBe(true)
  })
})

describe('validateRoster（型システムの保証が効かない壊れた入力）', () => {
  // Step 6 ではユーザー提供の JSON をそのまま Roster として読み込むため、
  // 構造が壊れた入力でも TypeError を投げずエラーとして返す必要がある。
  function broken(value: unknown): Roster {
    return value as Roster
  }

  it('roster が null でも例外を投げずエラーを返す', () => {
    const result = validateRoster(broken(null), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('members が配列でないなら例外を投げずエラーを返す', () => {
    const result = validateRoster(broken({ version: 1, members: undefined, groups: [] }), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('members が配列ではありません'))).toBe(true)
  })

  it('groups が配列でないなら例外を投げずエラーを返す', () => {
    const result = validateRoster(broken({ version: 1, members: [], groups: 'nope' }), RULES)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('groups が配列ではありません'))).toBe(true)
  })

  it('memberIds が欠けているグループがあっても例外を投げずエラーを返す', () => {
    const result = validateRoster(
      broken({
        version: 1,
        members: [{ id: 'nova', name: 'ノヴァ' }],
        groups: [{ id: 'g', name: 'G組', memberIds: undefined }],
      }),
      RULES,
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('memberIds が文字列の配列'))).toBe(true)
  })

  it('memberIds に文字列以外が混ざっていても例外を投げずエラーを返す', () => {
    const result = validateRoster(
      broken({
        version: 1,
        members: [{ id: 'nova', name: 'ノヴァ' }],
        groups: [{ id: 'g', name: 'G組', memberIds: ['nova', 42, null] }],
      }),
      RULES,
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('memberIds が文字列の配列'))).toBe(true)
  })

  it('メンバーの id が文字列でないなら例外を投げずエラーを返す', () => {
    const result = validateRoster(
      broken({ version: 1, members: [{ id: 123, name: 'X' }], groups: [] }),
      RULES,
    )
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('メンバーの id'))).toBe(true)
  })

  it('setupGame は壊れた入力でも TypeError ではなく RosterValidationError を投げる', () => {
    expect(() => setupGame(broken({ version: 1 }), RULES, createRng(1))).toThrow(
      RosterValidationError,
    )
  })
})

describe('selectGroups', () => {
  it('重複なくちょうど groupsPerGame 個を返す', () => {
    const groups = selectGroups(DEFAULT_ROSTER, RULES, createRng(1))
    expect(groups).toHaveLength(RULES.groupsPerGame)
    expect(new Set(groups.map((group) => group.id)).size).toBe(RULES.groupsPerGame)
  })

  it('返されるグループはすべてロスターに存在する', () => {
    const knownIds = new Set(DEFAULT_ROSTER.groups.map((group) => group.id))
    for (const group of selectGroups(DEFAULT_ROSTER, RULES, createRng(9))) {
      expect(knownIds.has(group.id)).toBe(true)
    }
  })

  it('同一シードなら同一のグループ構成を返す', () => {
    expect(selectGroups(DEFAULT_ROSTER, RULES, createRng(5))).toEqual(
      selectGroups(DEFAULT_ROSTER, RULES, createRng(5)),
    )
  })

  it('シードが変われば構成も変わりうる', () => {
    const combinations = new Set(
      Array.from({ length: 30 }, (_, seed) =>
        selectGroups(DEFAULT_ROSTER, RULES, createRng(seed))
          .map((group) => group.id)
          .sort()
          .join(','),
      ),
    )
    expect(combinations.size).toBeGreaterThan(1)
  })
})

describe('collectMembers', () => {
  it('選出グループの全メンバーを解決する', () => {
    const groups = selectGroups(DEFAULT_ROSTER, RULES, createRng(3))
    const members = collectMembers(DEFAULT_ROSTER, groups)
    const expectedCount = groups.reduce((sum, group) => sum + group.memberIds.length, 0)

    expect(members).toHaveLength(expectedCount)
    expect(new Set(members.map((member) => member.id)).size).toBe(expectedCount)
  })

  it('4グループ選出時の人数が 13〜16 人に収まる', () => {
    for (let seed = 0; seed < 50; seed++) {
      const groups = selectGroups(DEFAULT_ROSTER, RULES, createRng(seed))
      const members = collectMembers(DEFAULT_ROSTER, groups)
      expect(members.length).toBeGreaterThanOrEqual(13)
      expect(members.length).toBeLessThanOrEqual(16)
    }
  })

  it('ロスターに存在しないメンバーを参照していたら例外を投げる', () => {
    const group: Group = { id: 'x', name: 'X組', memberIds: ['ghost'] }
    expect(() => collectMembers(DEFAULT_ROSTER, [group])).toThrow(/ghost/)
  })
})

describe('buildCardPool', () => {
  const groups = selectGroups(DEFAULT_ROSTER, RULES, createRng(1))
  const members = collectMembers(DEFAULT_ROSTER, groups)
  const pool = buildCardPool(members, RULES)

  it('枚数が メンバー数 × 9 になる', () => {
    expect(CARDS_PER_MEMBER).toBe(9)
    expect(pool).toHaveLength(members.length * CARDS_PER_MEMBER)
  })

  it('uid が 0 から連番で一意に振られている', () => {
    expect(uids(pool)).toEqual(Array.from({ length: pool.length }, (_, i) => i))
  })

  it('各メンバー各色がちょうど copiesPerMemberColor 枚ある', () => {
    const counts = countByMemberColor(pool)
    expect(counts.size).toBe(members.length * RULES.colors.length)
    for (const count of counts.values()) {
      expect(count).toBe(RULES.copiesPerMemberColor)
    }
  })
})

describe('buildDeck', () => {
  const groups = selectGroups(DEFAULT_ROSTER, RULES, createRng(1))
  const members = collectMembers(DEFAULT_ROSTER, groups)

  it('ちょうど deckSize 枚を返す', () => {
    expect(buildDeck(members, RULES, createRng(1))).toHaveLength(RULES.deckSize)
  })

  it('1メンバーあたり9枚以下、1メンバー1色あたり3枚以下に収まる', () => {
    const deck = buildDeck(members, RULES, createRng(2))

    for (const count of countByMember(deck).values()) {
      expect(count).toBeLessThanOrEqual(CARDS_PER_MEMBER)
    }
    for (const count of countByMemberColor(deck).values()) {
      expect(count).toBeLessThanOrEqual(RULES.copiesPerMemberColor)
    }
  })

  it('選出メンバー以外のカードを含まない', () => {
    const memberIds = new Set(members.map((member) => member.id))
    for (const card of buildDeck(members, RULES, createRng(3))) {
      expect(memberIds.has(card.memberId)).toBe(true)
    }
  })

  it('uid が一意である', () => {
    const deck = buildDeck(members, RULES, createRng(4))
    expect(new Set(deck.map((card) => card.uid)).size).toBe(deck.length)
  })

  it('プールの一部だけが山札になる（残りは局中に登場しない）', () => {
    const poolSize = buildCardPool(members, RULES).length
    expect(poolSize).toBeGreaterThan(RULES.deckSize)
  })

  it('同一シードなら同一の山札を返す', () => {
    expect(buildDeck(members, RULES, createRng(7))).toEqual(buildDeck(members, RULES, createRng(7)))
  })

  it('シードが変われば山札も変わる', () => {
    expect(buildDeck(members, RULES, createRng(1))).not.toEqual(
      buildDeck(members, RULES, createRng(2)),
    )
  })

  it('プールが deckSize に満たない場合は RangeError を投げる', () => {
    expect(() => buildDeck(members.slice(0, 2), RULES, createRng(1))).toThrow(RangeError)
  })

  it('プール枚数と deckSize がちょうど一致する場合は成功する（境界値）', () => {
    const poolSize = buildCardPool(members, RULES).length
    const deck = buildDeck(members, { ...RULES, deckSize: poolSize }, createRng(1))

    expect(deck).toHaveLength(poolSize)
    // プール全体が山札になるので、抜け落ちるカードは存在しない。
    expect(new Set(deck.map((card) => card.uid)).size).toBe(poolSize)
  })
})

describe('selectBonusMembers', () => {
  const groups = selectGroups(DEFAULT_ROSTER, RULES, createRng(1))
  const members = collectMembers(DEFAULT_ROSTER, groups)
  const deck = buildDeck(members, RULES, createRng(1))

  it('重複なく bonusMemberCount 人を返す', () => {
    const bonus = selectBonusMembers(deck, RULES, createRng(1))
    expect(bonus).toHaveLength(RULES.bonusMemberCount)
    expect(new Set(bonus).size).toBe(RULES.bonusMemberCount)
  })

  it('山札に実際に含まれるメンバーからのみ選ぶ（死にボーナスを作らない）', () => {
    const presentMemberIds = new Set(deck.map((card) => card.memberId))
    for (let seed = 0; seed < 50; seed++) {
      for (const memberId of selectBonusMembers(deck, RULES, createRng(seed))) {
        expect(presentMemberIds.has(memberId)).toBe(true)
      }
    }
  })

  it('同一シードなら同一のボーナスを返す', () => {
    expect(selectBonusMembers(deck, RULES, createRng(8))).toEqual(
      selectBonusMembers(deck, RULES, createRng(8)),
    )
  })

  it('山札の登場メンバー数より多く要求されたら RangeError を投げる', () => {
    expect(() =>
      selectBonusMembers(deck, { ...RULES, bonusMemberCount: 99 }, createRng(1)),
    ).toThrow(RangeError)
  })

  it('要求数が山札の登場メンバー数ちょうどなら全員を返す（境界値）', () => {
    const presentCount = new Set(deck.map((card) => card.memberId)).size
    const bonus = selectBonusMembers(
      deck,
      { ...RULES, bonusMemberCount: presentCount },
      createRng(1),
    )

    expect(bonus).toHaveLength(presentCount)
    expect(new Set(bonus).size).toBe(presentCount)
  })
})

describe('deal', () => {
  const groups = selectGroups(DEFAULT_ROSTER, RULES, createRng(1))
  const members = collectMembers(DEFAULT_ROSTER, groups)
  const deck = buildDeck(members, RULES, createRng(1))

  it('playerCount 人へ handSize 枚ずつ配る', () => {
    const { hands } = deal(deck, RULES)
    expect(hands).toHaveLength(RULES.playerCount)
    for (const hand of hands) {
      expect(hand).toHaveLength(RULES.handSize)
    }
  })

  it('配牌後の壁が 72 枚になる', () => {
    const { wall } = deal(deck, RULES)
    expect(wall).toHaveLength(RULES.deckSize - RULES.playerCount * RULES.handSize)
    expect(wall).toHaveLength(72)
  })

  it('手札と壁を合わせると元の山札と完全に一致する（消失も複製もない）', () => {
    const { hands, wall } = deal(deck, RULES)
    expect(uids([...hands.flat(), ...wall])).toEqual(uids(deck))
  })

  it('同じカードが2人の手札に現れない', () => {
    const { hands } = deal(deck, RULES)
    const allHandUids = hands.flat().map((card) => card.uid)
    expect(new Set(allHandUids).size).toBe(allHandUids.length)
  })

  it('山札が配牌に足りない場合は RangeError を投げる', () => {
    expect(() => deal(deck.slice(0, 10), RULES)).toThrow(RangeError)
  })

  it('山札が配牌にちょうど足りる場合は壁が空になる（境界値）', () => {
    const needed = RULES.playerCount * RULES.handSize
    const { hands, wall } = deal(deck.slice(0, needed), RULES)

    expect(wall).toEqual([])
    expect(hands.flat()).toHaveLength(needed)
  })
})

describe('setupGame', () => {
  it('不正なロスターなら RosterValidationError を投げる', () => {
    const broken = rosterWith(DEFAULT_ROSTER.groups.slice(0, 2) as Group[])
    expect(() => setupGame(broken, RULES, createRng(1))).toThrow(RosterValidationError)
  })

  it('RosterValidationError がエラー一覧を保持する', () => {
    const broken = rosterWith(DEFAULT_ROSTER.groups.slice(0, 2) as Group[])
    try {
      setupGame(broken, RULES, createRng(1))
      expect.unreachable('RosterValidationError が投げられるはず')
    } catch (error) {
      expect(error).toBeInstanceOf(RosterValidationError)
      expect((error as RosterValidationError).name).toBe('RosterValidationError')
      expect((error as RosterValidationError).errors.length).toBeGreaterThan(0)
      // メッセージにエラー内容が含まれ、ログだけ見ても原因が分かること。
      expect((error as RosterValidationError).message).toContain('グループが4個以上必要')
    }
  })

  it('同一シードなら完全に同一のセットアップを返す', () => {
    expect(setupGame(DEFAULT_ROSTER, RULES, createRng(42))).toEqual(
      setupGame(DEFAULT_ROSTER, RULES, createRng(42)),
    )
  })

  it('シード 0〜99 のすべてで不変条件を満たす', () => {
    for (let seed = 0; seed < 100; seed++) {
      const setup = setupGame(DEFAULT_ROSTER, RULES, createRng(seed))
      const allCards = [...setup.hands.flat(), ...setup.wall]
      const activeMemberIds = new Set(setup.activeMembers.map((member) => member.id))

      // 枚数
      expect(setup.activeGroups).toHaveLength(RULES.groupsPerGame)
      expect(setup.hands).toHaveLength(RULES.playerCount)
      expect(allCards).toHaveLength(RULES.deckSize)
      for (const hand of setup.hands) {
        expect(hand).toHaveLength(RULES.handSize)
      }

      // 一意性
      expect(new Set(allCards.map((card) => card.uid)).size).toBe(RULES.deckSize)

      // 所属
      for (const card of allCards) {
        expect(activeMemberIds.has(card.memberId)).toBe(true)
      }

      // 枚数上限
      for (const count of countByMember(allCards).values()) {
        expect(count).toBeLessThanOrEqual(CARDS_PER_MEMBER)
      }
      for (const count of countByMemberColor(allCards).values()) {
        expect(count).toBeLessThanOrEqual(RULES.copiesPerMemberColor)
      }

      // ボーナスは山札に実在するメンバーから選ばれる
      const presentMemberIds = new Set(allCards.map((card) => card.memberId))
      expect(setup.bonusMemberIds).toHaveLength(RULES.bonusMemberCount)
      for (const memberId of setup.bonusMemberIds) {
        expect(presentMemberIds.has(memberId)).toBe(true)
      }
    }
  })
})
