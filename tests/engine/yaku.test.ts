import { describe, expect, it } from 'vitest'

import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import { setupGame } from '../../src/engine/deck'
import { createRng } from '../../src/engine/rng'
import { bestYaku, computeWaits, findYaku, groupYakuKind } from '../../src/engine/yaku'
import type { Card, Group, YakuCandidate, YakuContext, YakuKind } from '../../src/engine/types'
import { card, context, describeCards, hand, TEST_GROUPS } from '../helpers/cards'

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
