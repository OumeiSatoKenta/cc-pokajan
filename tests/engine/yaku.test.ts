import { describe, expect, it } from 'vitest'

import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import { setupGame } from '../../src/engine/deck'
import { createRng } from '../../src/engine/rng'
import { bestYaku, computeWaits, findYaku, groupYakuKind } from '../../src/engine/yaku'
import { candidateFromSelection } from '../../src/engine/yakuSelection'
import type { Card, Group, YakuCandidate, YakuContext, YakuKind } from '../../src/engine/types'
import { card, context, describeCards, hand, TEST_GROUPS } from '../helpers/cards'

/** 選択ヘルパ: 手札から指定した位置のカードの uid を取り出す。 */
function uidsAt(cards: readonly Card[], ...positions: number[]): number[] {
  return positions.map((position) => cards[position].uid)
}

/** 役種が消費するはずの枚数。 */
function expectedCardCount(kind: YakuKind): number {
  return kind === 'triple' ? 3 : Number(kind.slice(-1))
}

function scores(candidates: readonly YakuCandidate[]): number[] {
  return candidates.map((candidate) => candidate.score).sort((a, b) => a - b)
}

/**
 * `findYaku` とは独立した素朴な実装。「どの役種がどの対象で成立しているか」だけを判定する。
 *
 * 構造的な整合性チェック（枚数・部分集合など）は「候補に入っているものの正しさ」しか見られず、
 * **本来成立すべき役を取りこぼす** 偽陰性を検出できない。別実装との突き合わせでそこを埋める。
 */
function naiveYakuKeys(cards: readonly Card[], ctx: YakuContext): Set<string> {
  const keys = new Set<string>()

  for (const memberId of new Set(cards.map((c) => c.memberId))) {
    if (cards.filter((c) => c.memberId === memberId).length >= 3) {
      keys.add(`triple:${memberId}`)
    }
  }
  for (const group of ctx.activeGroups) {
    if (group.memberIds.every((memberId) => cards.some((c) => c.memberId === memberId))) {
      keys.add(`group:${group.id}`)
    }
  }

  return keys
}

/** `findYaku` の候補から、`naiveYakuKeys` と比較できる形の集合を作る。 */
function foundYakuKeys(candidates: readonly YakuCandidate[], ctx: YakuContext): Set<string> {
  const keys = new Set<string>()

  for (const candidate of candidates) {
    if (candidate.kind === 'triple') {
      keys.add(`triple:${candidate.cards[0].memberId}`)
      continue
    }
    const members = new Set(candidate.cards.map((c) => c.memberId))
    const group = ctx.activeGroups.find(
      (g) => g.memberIds.length === members.size && g.memberIds.every((id) => members.has(id)),
    )
    if (group !== undefined) {
      keys.add(`group:${group.id}`)
    }
  }

  return keys
}

describe('groupYakuKind', () => {
  it('人数に対応する役種を返す', () => {
    expect(groupYakuKind(3)).toBe('group3')
    expect(groupYakuKind(4)).toBe('group4')
    expect(groupYakuKind(5)).toBe('group5')
  })

  it('3〜5人の範囲外なら RangeError を投げる（誤った役種を黙って返さない）', () => {
    expect(() => groupYakuKind(2)).toThrow(RangeError)
    expect(() => groupYakuKind(6)).toThrow(RangeError)
  })
})

describe('findYaku — 3カード', () => {
  it('同一メンバー3枚で成立する', () => {
    const candidates = findYaku(hand('a1:pink a1:blue a1:orange'), context())

    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('triple')
    expect(candidates[0].sameColor).toBe(false)
    expect(candidates[0].score).toBe(120)
    expect(candidates[0].cards).toHaveLength(3)
  })

  it('全て同色なら同色役になる（混色候補は重複除去で畳まれる）', () => {
    const candidates = findYaku(hand('a1:pink a1:pink a1:pink'), context())

    expect(candidates).toHaveLength(1)
    expect(candidates[0].sameColor).toBe(true)
    expect(candidates[0].score).toBe(840)
  })

  it('4枚持ちでも消費するのは3枚', () => {
    const candidates = findYaku(hand('a1:pink a1:pink a1:blue a1:blue'), context())

    expect(candidates).toHaveLength(1)
    expect(candidates[0].cards).toHaveLength(3)
    expect(candidates[0].sameColor).toBe(false)
  })

  it('4枚のうち3枚が同色なら同色役が成立する', () => {
    const candidates = findYaku(hand('a1:pink a1:pink a1:pink a1:blue'), context())

    expect(candidates).toHaveLength(1)
    expect(candidates[0].sameColor).toBe(true)
    expect(candidates[0].score).toBe(840)
  })

  it('2枚では成立しない', () => {
    expect(findYaku(hand('a1:pink a1:blue'), context())).toEqual([])
  })

  it('今局に登場していないメンバーでも3カードは成立する', () => {
    // 3カードはグループに依存しない役なので、activeGroups に無いメンバーでも成立する。
    const candidates = findYaku(hand('z1:pink z1:blue z1:orange'), context())
    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('triple')
  })
})

describe('findYaku — N人組', () => {
  it('3人組が成立する', () => {
    const candidates = findYaku(hand('a1:pink a2:blue a3:orange'), context())

    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('group3')
    expect(candidates[0].score).toBe(180)
    expect(candidates[0].cards).toHaveLength(3)
  })

  it('4人組が成立する', () => {
    const candidates = findYaku(hand('b1:pink b2:blue b3:orange b4:blue'), context())

    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('group4')
    expect(candidates[0].score).toBe(300)
    expect(candidates[0].cards).toHaveLength(4)
  })

  it('5人組が成立する', () => {
    const candidates = findYaku(hand('c1:pink c2:blue c3:orange c4:pink c5:blue'), context())

    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('group5')
    expect(candidates[0].score).toBe(480)
    expect(candidates[0].cards).toHaveLength(5)
  })

  it('同色で揃えると大幅に加点される', () => {
    expect(findYaku(hand('b1:pink b2:pink b3:pink b4:pink'), context())[0]).toMatchObject({
      kind: 'group4',
      sameColor: true,
      score: 840,
    })
    expect(findYaku(hand('c1:blue c2:blue c3:blue c4:blue c5:blue'), context())[0]).toMatchObject({
      kind: 'group5',
      sameColor: true,
      score: 1800,
    })
  })

  it('全員揃わないと成立しない', () => {
    expect(findYaku(hand('a1:pink a2:blue'), context())).toEqual([])
    expect(findYaku(hand('b1:pink b2:blue b3:orange'), context())).toEqual([])
  })

  it('今局に登場していないグループでは成立しない', () => {
    const candidates = findYaku(hand('z1:pink z2:blue z3:orange'), context())
    expect(candidates).toEqual([])
  })

  it('活性グループに含めれば同じ手札で成立する', () => {
    const candidates = findYaku(
      hand('z1:pink z2:blue z3:orange'),
      context({ groups: [TEST_GROUPS.absent] }),
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('group3')
  })

  it('同色が複数色で成立しうるとき、その色数だけ候補が返る', () => {
    const candidates = findYaku(hand('a1:pink a1:blue a2:pink a2:blue a3:pink a3:blue'), context())

    expect(candidates).toHaveLength(2)
    for (const candidate of candidates) {
      expect(candidate.sameColor).toBe(true)
      expect(candidate.score).toBe(540)
    }
    expect(describeCards(candidates[0].cards)).not.toEqual(describeCards(candidates[1].cards))
  })
})

describe('findYaku — ボーナス加点', () => {
  it('グループ役ではグループ内のボーナスメンバー数だけ加算される', () => {
    const ctx = context({ bonusMemberIds: ['a2'] })
    const candidate = findYaku(hand('a1:pink a2:blue a3:orange'), ctx)[0]

    expect(candidate.bonusCount).toBe(1)
    expect(candidate.score).toBe(180 + 90)
  })

  it('ボーナスメンバーが複数含まれれば人数分加算される', () => {
    const ctx = context({ bonusMemberIds: ['a1', 'a3'] })
    expect(findYaku(hand('a1:pink a2:blue a3:orange'), ctx)[0].score).toBe(180 + 180)
  })

  it('3カードでボーナスメンバーを揃えると3枚分が加算される', () => {
    const ctx = context({ bonusMemberIds: ['a1'] })
    const candidate = findYaku(hand('a1:pink a1:blue a1:orange'), ctx)[0]

    expect(candidate.bonusCount).toBe(3)
    expect(candidate.score).toBe(120 + 270)
  })

  it('同色役にもボーナスが上乗せされる', () => {
    const ctx = context({ bonusMemberIds: ['a1'] })
    expect(findYaku(hand('a1:pink a1:pink a1:pink'), ctx)[0].score).toBe(840 + 270)
  })

  it('役に含まれないメンバーがボーナスでも加点されない', () => {
    const ctx = context({ bonusMemberIds: ['b1'] })
    expect(findYaku(hand('a1:pink a2:blue a3:orange'), ctx)[0].score).toBe(180)
  })
})

describe('findYaku — 候補の整合性', () => {
  it('消費カード枚数が役種と一致する', () => {
    const candidates = findYaku(
      hand('a1:pink a2:pink a3:pink b1:pink b2:pink b3:pink b4:pink'),
      context(),
    )

    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      expect(candidate.cards, candidate.kind).toHaveLength(expectedCardCount(candidate.kind))
    }
  })

  it('同一のカード集合を消費する候補は返らない', () => {
    const candidates = findYaku(
      hand('a1:pink a2:pink a3:pink b1:blue b2:blue b3:blue b4:blue'),
      context(),
    )

    const keys = candidates.map((candidate) =>
      candidate.cards
        .map((c) => c.uid)
        .sort((x, y) => x - y)
        .join(','),
    )
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('複数の役が同時に成立していれば全て返る', () => {
    // a1 の3カード（120）と 3人組（180）が同時に成立する手札。
    const candidates = findYaku(hand('a1:pink a1:blue a1:orange a2:blue a3:orange'), context())

    expect(scores(candidates)).toEqual([120, 180])
  })

  it('役が成立しない手札では空配列', () => {
    expect(findYaku(hand('a1:pink a2:blue b1:orange c1:pink'), context())).toEqual([])
  })

  it('空の手札でも例外を投げない', () => {
    expect(findYaku([], context())).toEqual([])
  })

  it('同色判定は点数の大小ではなく実際のカードの色から決まる', () => {
    // 同色の点数を通常と同じにしても、構成カードが全て同色なら sameColor になる。
    // 「重複除去が高得点側を残す」ことに依存していると、この設定で混色扱いに退行する。
    const rules = {
      ...DEFAULT_RULES,
      scores: { ...DEFAULT_RULES.scores, triple: { base: 900, sameColor: 900 } },
    }
    const candidates = findYaku(hand('a1:pink a1:pink a1:pink'), context({ rules }))

    expect(candidates).toHaveLength(1)
    expect(candidates[0].sameColor).toBe(true)
    expect(candidates[0].score).toBe(900)
  })

  it('グループ定義にメンバー重複があっても同じカードを二重に数えない', () => {
    // a1 を2回数えれば「3人組が成立した」と誤判定してしまうが、実際には2枚しかない。
    const broken: Group = { id: 'broken', name: '壊れた組', memberIds: ['a1', 'a1', 'a2'] }

    expect(findYaku(hand('a1:pink a2:pink'), context({ groups: [broken] }))).toEqual([])
  })

  it('メンバー重複があっても、実際に必要な枚数を持っていれば成立する', () => {
    const broken: Group = { id: 'broken', name: '壊れた組', memberIds: ['a1', 'a1', 'a2'] }
    const candidates = findYaku(hand('a1:pink a1:blue a2:pink'), context({ groups: [broken] }))

    expect(candidates).toHaveLength(1)
    expect(candidates[0].cards).toHaveLength(3)
    expect(new Set(candidates[0].cards.map((c) => c.uid)).size).toBe(3)
  })
})

describe('findYaku — ロン絞り込み', () => {
  it('その1枚で完成する役だけが返る', () => {
    const cards = hand('a1:pink a1:blue a1:orange')
    const required = cards[2]

    const candidates = findYaku(cards, context(), required)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].score).toBe(120)
    expect(candidates[0].cards.some((c) => c.uid === required.uid)).toBe(true)
  })

  it('手の内で既に成立している役ではロンできない', () => {
    // a1 が既に3枚あり、4枚目をもらっても「その1枚で完成した」わけではない。
    const cards = hand('a1:pink a1:blue a1:orange a1:pink')
    const required = cards[3]

    expect(findYaku(cards, context(), required)).toEqual([])
  })

  it('既に完成しているグループ役でもロンできない', () => {
    const cards = hand('a1:pink a2:pink a3:pink a1:blue a2:blue')
    const required = cards[4]

    expect(findYaku(cards, context(), required)).toEqual([])
  })

  it('混色で完成済みでも、その1枚で同色になるならロンできる', () => {
    // 3人組は既に混色で成立しているが、もらった a3:pink により「全員ピンク」が新たに成立する。
    const cards = hand('a1:pink a2:pink a3:blue a3:pink')
    const required = cards[3]

    const candidates = findYaku(cards, context(), required)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].sameColor).toBe(true)
    expect(candidates[0].score).toBe(540)
  })

  it('required が手札の先頭にあっても、予備カードがあればロンにならない', () => {
    // カードの選び方（手札順で先頭から）だけに頼ると、先頭の required が選ばれて
    // 誤ってロンが成立してしまう。シグネチャによる「その1枚がなくても成立するか」の
    // 判定が効いていることを担保する回帰テスト。
    const cards = hand('a1:pink a1:pink a1:pink a1:pink')
    const required = cards[0]

    expect(findYaku(cards, context(), required)).toEqual([])
  })

  it('required を使わない候補は返らない', () => {
    // a1 の3カードは手の内で完成済み。b の4人組は required で完成する。
    const cards = hand('a1:pink a1:blue a1:orange b1:pink b2:pink b3:pink b4:pink')
    const required = cards[6]

    const candidates = findYaku(cards, context(), required)

    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('group4')
    for (const candidate of candidates) {
      expect(candidate.cards.some((c) => c.uid === required.uid)).toBe(true)
    }
  })

  it('required があっても役が成立しなければ空配列', () => {
    const cards = hand('a1:pink a2:pink b1:orange')
    expect(findYaku(cards, context(), cards[2])).toEqual([])
  })

  it('required が hand に含まれていなければ RangeError を投げる', () => {
    expect(() =>
      findYaku(hand('a1:pink a1:blue a1:orange'), context(), card('a2:pink', 99)),
    ).toThrow(RangeError)
  })
})

describe('bestYaku', () => {
  it('点数が最大の候補を返す', () => {
    const cards = hand('a1:pink a1:blue a1:orange a2:blue a3:orange')
    const best = bestYaku(findYaku(cards, context()), cards, context())

    expect(best?.kind).toBe('group3')
    expect(best?.score).toBe(180)
  })

  it('同色役があればそちらを選ぶ', () => {
    const cards = hand('a1:pink a2:pink a3:pink a1:blue a2:blue a3:blue')
    const best = bestYaku(findYaku(cards, context()), cards, context())

    expect(best?.sameColor).toBe(true)
    expect(best?.score).toBe(540)
  })

  it('同点なら残り手札の価値が高い方を選ぶ', () => {
    // a1 の3カードと a2 の3カードはどちらも120点。
    // a1 を消費すると a2 が4枚残り（次の3カードに繋がる）、a2 を消費すると a1 は3枚しか残らない。
    const cards = hand('a1:pink a1:blue a1:orange a2:pink a2:blue a2:orange a2:pink')
    const best = bestYaku(findYaku(cards, context()), cards, context())

    expect(best?.score).toBe(120)
    expect(new Set(best?.cards.map((c) => c.memberId))).toEqual(new Set(['a1']))
  })

  it('候補がなければ null', () => {
    expect(bestYaku([], hand('a1:pink'), context())).toBeNull()
  })

  it('同じ入力に対して決定的である', () => {
    const cards = hand('a1:pink a2:pink a3:pink a1:blue a2:blue a3:blue b1:pink')
    const first = bestYaku(findYaku(cards, context()), cards, context())
    const second = bestYaku(findYaku(cards, context()), cards, context())

    expect(describeCards(first?.cards ?? [])).toEqual(describeCards(second?.cards ?? []))
  })
})

describe('computeWaits', () => {
  it('3カードの待ちを検出する', () => {
    const cards = hand('a1:pink a1:blue')
    const info = computeWaits(cards, context())

    expect(info.waits.map((wait) => `${wait.memberId}:${wait.color}`).sort()).toEqual([
      'a1:blue',
      'a1:orange',
      'a1:pink',
    ])
    expect([...info.contributingUids].sort()).toEqual([0, 1])
  })

  it('同色になる待ちは点数が高い', () => {
    const info = computeWaits(hand('a1:pink a1:pink'), context())

    const pink = info.waits.find((wait) => wait.color === 'pink')
    const blue = info.waits.find((wait) => wait.color === 'blue')

    expect(pink?.best.score).toBe(840)
    expect(pink?.best.sameColor).toBe(true)
    expect(blue?.best.score).toBe(120)
  })

  it('N人組の待ちを検出する', () => {
    const info = computeWaits(hand('a1:pink a2:pink'), context())

    expect(info.waits.map((wait) => wait.memberId)).toEqual(['a3', 'a3', 'a3'])
    const pink = info.waits.find((wait) => wait.color === 'pink')
    expect(pink?.best.score).toBe(540)
    expect(info.waits.find((wait) => wait.color === 'blue')?.best.score).toBe(180)
  })

  it('待ちがなければ空になる', () => {
    const info = computeWaits(hand('a1:pink b1:pink c1:pink'), context())

    expect(info.waits).toEqual([])
    expect(info.contributingUids.size).toBe(0)
  })

  it('既に役が成立している手札では待ちを返さない', () => {
    // 3人組が同色で完成済み。どのカードを1枚足しても「その1枚で新たに完成する役」は無い。
    // 例外を投げないことだけを見ていると、幻の待ちを返す退行を検知できないため中身も固定する。
    const info = computeWaits(hand('a1:pink a2:pink a3:pink'), context())

    expect(info.waits).toEqual([])
    expect(info.contributingUids.size).toBe(0)
  })

  it('役が成立済みでも、別の役の待ちがあれば検出する', () => {
    // 3人組は完成済みだが、b1 が2枚あるので b1 の3枚目は依然として待ち。
    const info = computeWaits(hand('a1:pink a2:pink a3:pink b1:blue b1:blue'), context())

    expect(info.waits.map((wait) => wait.memberId)).toEqual(['b1', 'b1', 'b1'])
    expect(info.waits.find((wait) => wait.color === 'blue')?.best.score).toBe(840)
  })

  it('contributingUids は手札の uid の部分集合である', () => {
    const cards = hand('a1:pink a2:pink b1:blue b2:blue b3:blue')
    const info = computeWaits(cards, context())
    const handUids = new Set(cards.map((c) => c.uid))

    for (const uid of info.contributingUids) {
      expect(handUids.has(uid)).toBe(true)
    }
  })

  it('待ちに寄与しないカードはハイライトされない', () => {
    // a1 / a2 は 3人組テンパイに寄与するが、c1 は単独で何にも繋がらない。
    const cards = hand('a1:pink a2:pink c1:orange')
    const info = computeWaits(cards, context())

    expect(info.contributingUids.has(0)).toBe(true)
    expect(info.contributingUids.has(1)).toBe(true)
    expect(info.contributingUids.has(2)).toBe(false)
  })

  it('今局に登場していないメンバーは待ちの候補にならない', () => {
    // z1 は activeGroups に含まれないため、3カード待ちでも列挙されない。
    const info = computeWaits(hand('z1:pink z1:blue'), context())
    expect(info.waits).toEqual([])
  })
})

describe('candidateFromSelection — 選択からの再導出', () => {
  it('有効な triple を再導出する', () => {
    const cards = hand('a1:pink a1:blue a1:orange')
    const result = candidateFromSelection(cards, uidsAt(cards, 0, 1, 2), context())

    expect(result?.kind).toBe('triple')
    expect(result?.sameColor).toBe(false)
    expect(result?.score).toBe(120)
    expect(result?.cards).toHaveLength(3)
  })

  it('有効な groupN を再導出する', () => {
    const cards = hand('a1:pink a2:blue a3:orange')
    const result = candidateFromSelection(cards, uidsAt(cards, 0, 1, 2), context())

    expect(result?.kind).toBe('group3')
    expect(result?.score).toBe(180)
  })

  it('正準以外の合法選択を受理する（同一メンバー4枚のうち別の3枚）', () => {
    // findYaku は先頭3枚(slice(0,3) = uid 0,1,2)を正準として選ぶ。
    // 末尾3枚(uid 1,2,3)を選んでも triple として受理されなければならない。
    // 「正準のみ受理（先頭 N 枚固定）」に壊すとこのテストが落ちる。
    const cards = hand('a1:pink a1:blue a1:orange a1:pink')
    const result = candidateFromSelection(cards, uidsAt(cards, 1, 2, 3), context())

    expect(result?.kind).toBe('triple')
    expect([...(result?.cards ?? [])].map((c) => c.uid).sort((a, b) => a - b)).toEqual([1, 2, 3])
  })

  it('色の取り方で同色・点数が変わる（同一の役対象でも選択次第）', () => {
    // a1/a2/a3 それぞれ pink と blue を持つ。3人組を pink で揃えれば同色540点、
    // 混色に取れば180点。どのカードを選ぶかで役の価値が変わる（本機能の狙い）。
    const cards = hand('a1:pink a1:blue a2:pink a2:blue a3:pink a3:blue')

    const same = candidateFromSelection(cards, uidsAt(cards, 0, 2, 4), context())
    expect(same?.sameColor).toBe(true)
    expect(same?.score).toBe(540)

    const mixed = candidateFromSelection(cards, uidsAt(cards, 0, 3, 4), context())
    expect(mixed?.sameColor).toBe(false)
    expect(mixed?.score).toBe(180)
  })

  it('ボーナス加点も選択カードから再計算する', () => {
    const ctx = context({ bonusMemberIds: ['a1'] })
    const cards = hand('a1:pink a1:blue a1:orange')
    const result = candidateFromSelection(cards, uidsAt(cards, 0, 1, 2), ctx)

    expect(result?.bonusCount).toBe(3)
    expect(result?.score).toBe(120 + 270)
  })

  it('今局に登場していないメンバーでも triple は成立する（findYaku と同じ扱い）', () => {
    const cards = hand('z1:pink z1:blue z1:orange')
    expect(candidateFromSelection(cards, uidsAt(cards, 0, 1, 2), context())?.kind).toBe('triple')
  })

  it('メンバー重複のある壊れたグループでも多重集合が一致すれば成立する', () => {
    const broken: Group = { id: 'broken', name: '壊れた組', memberIds: ['a1', 'a1', 'a2'] }
    const cards = hand('a1:pink a1:blue a2:pink')
    const result = candidateFromSelection(
      cards,
      uidsAt(cards, 0, 1, 2),
      context({ groups: [broken] }),
    )

    expect(result?.kind).toBe('group3')
    expect(result?.cards).toHaveLength(3)
  })

  it('全メンバーが同一の壊れたグループでも triple 判定が groupN より優先される', () => {
    // classifySelection は triple を先に判定する。判定順を入れ替えるリファクタで
    // この優先順位が壊れたら落ちるようにしておく（設計の明文化された不変を機械的に守る）。
    const broken: Group = { id: 'broken', name: '壊れた組', memberIds: ['a1', 'a1', 'a1'] }
    const cards = hand('a1:pink a1:blue a1:orange')
    const result = candidateFromSelection(
      cards,
      uidsAt(cards, 0, 1, 2),
      context({ groups: [broken] }),
    )

    expect(result?.kind).toBe('triple')
  })

  it('枚数が足りない選択は null', () => {
    const cards = hand('a1:pink a1:blue a1:orange')
    expect(candidateFromSelection(cards, uidsAt(cards, 0, 1), context())).toBeNull()
  })

  it('同一メンバー4枚の選択は triple にならない（枚数過多で null）', () => {
    const cards = hand('a1:pink a1:blue a1:orange a1:pink')
    expect(candidateFromSelection(cards, uidsAt(cards, 0, 1, 2, 3), context())).toBeNull()
  })

  it('手札にない uid を含む選択は null（未所持カードの偽装を弾く）', () => {
    const cards = hand('a1:pink a1:blue a1:orange')
    expect(
      candidateFromSelection(cards, [uidsAt(cards, 0)[0], uidsAt(cards, 1)[0], 999], context()),
    ).toBeNull()
  })

  it('同じ uid を2度含む選択は null（1枚を二重消費できない）', () => {
    const cards = hand('a1:pink a1:blue a1:orange')
    const first = cards[0].uid
    expect(candidateFromSelection(cards, [first, first, cards[1].uid], context())).toBeNull()
  })

  it('役にならない混在の選択は null', () => {
    const cards = hand('a1:pink a2:blue b1:orange')
    expect(candidateFromSelection(cards, uidsAt(cards, 0, 1, 2), context())).toBeNull()
  })

  it('空の選択は null', () => {
    const cards = hand('a1:pink a1:blue a1:orange')
    expect(candidateFromSelection(cards, [], context())).toBeNull()
  })

  it('今局に登場していないグループでは groupN にならない', () => {
    const cards = hand('z1:pink z2:blue z3:orange')
    expect(candidateFromSelection(cards, uidsAt(cards, 0, 1, 2), context())).toBeNull()
  })

  describe('ロン規則（required）', () => {
    it('required が hand に含まれていなければ RangeError を投げる（findYaku と同じ扱い）', () => {
      // 「required を選択に含まない」（合法な非ロン → null）と「required が手札に存在しない」
      // （内部の誤用 → RangeError）を区別する。null を返すのが resolveSelection の実装詳細に
      // 依存した副産物にならないよう、明示的なガードをピン留めする。
      const combined = hand('a1:pink a1:blue a1:orange')
      const foreign = card('a2:pink', 99)
      expect(() =>
        candidateFromSelection(combined, uidsAt(combined, 0, 1, 2), context(), foreign),
      ).toThrow(RangeError)
    })

    it('required を消費しない選択は null（ロンは捨て札で完成して初めて成立）', () => {
      // 手札に a1 の3カードが完成済み、捨て札 a2:pink をもらう。
      // a1 triple は合法な役だが required(a2) を使わないのでロンにならない。
      const combined = hand('a1:pink a1:blue a1:orange a2:pink')
      const required = combined[3]
      expect(
        candidateFromSelection(combined, uidsAt(combined, 0, 1, 2), context(), required),
      ).toBeNull()
    })

    it('その1枚で新たに完成する役はロンできる', () => {
      // 手札 a1:pink a1:blue に捨て札 a1:orange をもらって triple 完成。
      const combined = hand('a1:pink a1:blue a1:orange')
      const required = combined[2]
      const result = candidateFromSelection(
        combined,
        uidsAt(combined, 0, 1, 2),
        context(),
        required,
      )

      expect(result?.kind).toBe('triple')
      expect(result?.score).toBe(120)
    })

    it('手の内で既に成立している役ではロンできない（null）', () => {
      // a1 が既に3枚(uid 0,1,2)で完成。4枚目 a1:pink(uid 3)をもらっても新たな完成ではない。
      // 「required を除いた手札で同シグネチャが成立する」ためロン不可。
      const combined = hand('a1:pink a1:blue a1:orange a1:pink')
      const required = combined[3]
      expect(
        candidateFromSelection(combined, uidsAt(combined, 1, 2, 3), context(), required),
      ).toBeNull()
    })

    it('混色で完成済みでも、その1枚で同色になるならロンできる', () => {
      // 3人組は混色(a1:pink a2:pink a3:blue)で成立済みだが、a3:pink をもらうと
      // 「全員ピンク」の同色役が新たに成立する。findYaku のロン絞り込みと同じ判定。
      const combined = hand('a1:pink a2:pink a3:blue a3:pink')
      const required = combined[3]
      const result = candidateFromSelection(
        combined,
        uidsAt(combined, 0, 1, 3),
        context(),
        required,
      )

      expect(result?.sameColor).toBe(true)
      expect(result?.score).toBe(540)
    })
  })

  describe('差分オラクル: findYaku の列挙候補は必ず再導出できる', () => {
    it('シード 0〜99 の全手札で、列挙候補のカードを選ぶと同じ役に再導出される', () => {
      for (let seed = 0; seed < 100; seed++) {
        const setup = setupGame(DEFAULT_ROSTER, DEFAULT_RULES, createRng(seed))
        const ctx: YakuContext = {
          activeGroups: setup.activeGroups,
          bonusMemberIds: setup.bonusMemberIds,
          rules: DEFAULT_RULES,
        }

        for (const [playerIndex, playerHand] of setup.hands.entries()) {
          const where = `seed=${seed} player=${playerIndex}`
          const cards: readonly Card[] = playerHand

          for (const candidate of findYaku(cards, ctx)) {
            const uids = candidate.cards.map((c) => c.uid)
            const rederived = candidateFromSelection(cards, uids, ctx)

            // 列挙で見つかった役は、そのカードを選択として渡せば必ず同じ役として再導出できる。
            // ここが null になると AI 経路（列挙候補を渡す）が reduce で弾かれ、不変条件が壊れる。
            expect(rederived, `${where} kind=${candidate.kind}`).not.toBeNull()
            expect(rederived?.kind, where).toBe(candidate.kind)
            expect(rederived?.sameColor, where).toBe(candidate.sameColor)
            expect(rederived?.bonusCount, where).toBe(candidate.bonusCount)
            expect(rederived?.score, where).toBe(candidate.score)
          }
        }
      }
    })

    it('ロン: probe した捨て札での列挙候補も再導出で一致する（required 付き）', () => {
      // required あり（ロン）でのみ signature の achievableWithout 照合が働く。
      // design.md の「混色は任意の単色より緩い → ロン規則が findYaku と一致」という論証は
      // この経路にしか関係しないため、100 局規模で機械的に検証する。
      // computeWaits と同じ手法で「実在しない負の uid の仮カード」を捨て札として1枚足し、
      // findYaku(probed, ctx, probe) の各候補が candidateFromSelection で同一に再導出できることを確かめる。
      for (let seed = 0; seed < 100; seed++) {
        const setup = setupGame(DEFAULT_ROSTER, DEFAULT_RULES, createRng(seed))
        const ctx: YakuContext = {
          activeGroups: setup.activeGroups,
          bonusMemberIds: setup.bonusMemberIds,
          rules: DEFAULT_RULES,
        }
        const memberIds = [...new Set(ctx.activeGroups.flatMap((group) => group.memberIds))]

        for (const [playerIndex, playerHand] of setup.hands.entries()) {
          const cards: readonly Card[] = playerHand
          const probeUid = cards.reduce((min, c) => Math.min(min, c.uid), 0) - 1

          for (const memberId of memberIds) {
            for (const color of DEFAULT_RULES.colors) {
              const probe: Card = { uid: probeUid, memberId, color }
              const probed = [...cards, probe]
              const where = `seed=${seed} player=${playerIndex} probe=${memberId}:${color}`

              for (const candidate of findYaku(probed, ctx, probe)) {
                const uids = candidate.cards.map((c) => c.uid)
                const rederived = candidateFromSelection(probed, uids, ctx, probe)

                // ロンで列挙された候補は、そのカードを選択として渡せば必ず同じ役に再導出できる。
                // ここが null になると AI のロン経路が reduce で弾かれ、100 局不変条件が壊れる。
                expect(rederived, `${where} kind=${candidate.kind}`).not.toBeNull()
                expect(rederived?.kind, where).toBe(candidate.kind)
                expect(rederived?.sameColor, where).toBe(candidate.sameColor)
                expect(rederived?.bonusCount, where).toBe(candidate.bonusCount)
                expect(rederived?.score, where).toBe(candidate.score)
              }
            }
          }
        }
      }
    })
  })
})

describe('実際の配牌に対する不変条件', () => {
  it('シード 0〜99 の全プレイヤー手札で破綻しない', () => {
    for (let seed = 0; seed < 100; seed++) {
      const setup = setupGame(DEFAULT_ROSTER, DEFAULT_RULES, createRng(seed))
      const ctx: YakuContext = {
        activeGroups: setup.activeGroups,
        bonusMemberIds: setup.bonusMemberIds,
        rules: DEFAULT_RULES,
      }

      for (const [playerIndex, playerHand] of setup.hands.entries()) {
        // 失敗時に局を再現できるよう、シードとプレイヤーをアサーションに添える。
        const where = `seed=${seed} player=${playerIndex}`
        const cards: readonly Card[] = playerHand
        const handUids = new Set(cards.map((c) => c.uid))
        const candidates = findYaku(cards, ctx)

        for (const candidate of candidates) {
          // 枚数が役種と一致する
          expect(candidate.cards, `${where} kind=${candidate.kind}`).toHaveLength(
            expectedCardCount(candidate.kind),
          )
          // 消費カードは必ず手札の部分集合
          for (const consumed of candidate.cards) {
            expect(handUids.has(consumed.uid), `${where} uid=${consumed.uid}`).toBe(true)
          }
          // 点数は score.ts の計算と整合する
          expect(candidate.score, where).toBeGreaterThan(0)
          expect(candidate.bonusCount, where).toBeGreaterThanOrEqual(0)
        }

        const best = bestYaku(candidates, cards, ctx)
        if (candidates.length === 0) {
          expect(best, where).toBeNull()
        } else {
          expect(best?.score, where).toBe(Math.max(...candidates.map((c) => c.score)))
        }

        // 別実装との突き合わせ。取りこぼし（偽陰性）と過検出（偽陽性）の両方を検出する。
        expect(foundYakuKeys(candidates, ctx), where).toEqual(naiveYakuKeys(cards, ctx))

        const info = computeWaits(cards, ctx)
        for (const uid of info.contributingUids) {
          expect(handUids.has(uid), `${where} uid=${uid}`).toBe(true)
        }
        for (const wait of info.waits) {
          expect(wait.best.cards, `${where} wait=${wait.memberId}:${wait.color}`).toHaveLength(
            expectedCardCount(wait.best.kind),
          )
        }
      }
    }
  })
})
