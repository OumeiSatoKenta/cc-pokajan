/**
 * 役判定。
 *
 * ポカジャンの役は「同一メンバー3枚（triple）」と「グループ全員を1枚ずつ（groupN）」の
 * 2系統しかないため、探索ではなく素直な列挙で全候補を洗い出せる。
 *
 * 重要な性質として、**点数は「役種・同色可否・構成メンバー」だけで決まり、
 * どの色のカードを消費するかには依存しない**（`score.ts` 参照）。
 * そのため「点数を最大化するカードの選び方」を探索する必要がなく、
 * カードは手札順で決定的に選んでよい。どのカードを残すかという戦術判断は
 * Step 3 の CPU AI の責務であり、AI は `findYaku` の全候補から選び直せる。
 */

import { countBonusCards, scoreYaku } from './score'
import {
  MAX_YAKU_GROUP_SIZE,
  MIN_YAKU_GROUP_SIZE,
  type Card,
  type ColorId,
  type GroupId,
  type MemberId,
  type YakuCandidate,
  type YakuContext,
  type YakuKind,
} from './types'

/** 3カード役に必要な枚数。ルール設定ではなく役の定義そのものなので定数で持つ。 */
export const TRIPLE_SIZE = 3

export interface WaitEntry {
  readonly memberId: MemberId
  readonly color: ColorId
  /** そのカードを引いた（もらった）ときに成立する最良の役。 */
  readonly best: YakuCandidate
}

export interface WaitInfo {
  readonly waits: readonly WaitEntry[]
  /** 待ちに寄与している手札カードの uid。UI はこれを黄色枠でハイライトする。 */
  readonly contributingUids: ReadonlySet<number>
}

/**
 * グループの人数に対応する役種を返す。
 *
 * 対応範囲は `MIN_YAKU_GROUP_SIZE` 〜 `MAX_YAKU_GROUP_SIZE`。範囲外のロスターは
 * `validateRoster` が対局開始前に弾くため、ここに到達するのは内部不変条件の違反を意味する。
 */
export function groupYakuKind(size: number): YakuKind {
  switch (size) {
    case 3:
      return 'group3'
    case 4:
      return 'group4'
    case 5:
      return 'group5'
    default:
      throw new RangeError(
        `グループの人数は${MIN_YAKU_GROUP_SIZE}〜${MAX_YAKU_GROUP_SIZE}人である必要がありますが ${size} 人でした`,
      )
  }
}

/**
 * 候補の中間表現。
 *
 * `color` が `null` なら混色（通常役）、色が入っていれば同色役。
 * `targetId` は 3カードならメンバーID、N人組ならグループIDで、
 * ロン判定のシグネチャに使う。
 */
interface CandidateDraft {
  readonly kind: YakuKind
  readonly targetId: MemberId | GroupId
  readonly color: ColorId | null
  readonly cards: readonly Card[]
}

function signatureOf(draft: CandidateDraft): string {
  return `${draft.kind}:${draft.targetId}:${draft.color ?? 'mixed'}`
}

function cardSetKey(cards: readonly Card[]): string {
  return cards
    .map((card) => card.uid)
    .sort((a, b) => a - b)
    .join(',')
}

/** 3カード役の候補（通常 + 色ごとの同色）を列挙する。 */
function enumerateTriples(hand: readonly Card[], ctx: YakuContext): CandidateDraft[] {
  const drafts: CandidateDraft[] = []
  const byMember = new Map<MemberId, Card[]>()

  for (const card of hand) {
    const cards = byMember.get(card.memberId)
    if (cards === undefined) {
      byMember.set(card.memberId, [card])
    } else {
      cards.push(card)
    }
  }

  for (const [memberId, cards] of byMember) {
    if (cards.length < TRIPLE_SIZE) {
      continue
    }

    drafts.push({
      kind: 'triple',
      targetId: memberId,
      color: null,
      cards: cards.slice(0, TRIPLE_SIZE),
    })

    for (const color of ctx.rules.colors) {
      const sameColor = cards.filter((card) => card.color === color)
      if (sameColor.length >= TRIPLE_SIZE) {
        drafts.push({
          kind: 'triple',
          targetId: memberId,
          color,
          cards: sameColor.slice(0, TRIPLE_SIZE),
        })
      }
    }
  }

  return drafts
}

/**
 * 指定した色（`null` なら色を問わない）で、グループ全員分を1枚ずつ集める。
 * 1人でも欠けていれば `null`。
 */
function pickGroupCards(
  hand: readonly Card[],
  memberIds: readonly MemberId[],
  color: ColorId | null,
): Card[] | null {
  const picked: Card[] = []
  // 同じカードを2度数えないよう、選択済みの uid を除外する。
  // 正規のロスターでは `validateRoster` がグループ内のメンバー重複を弾くが、
  // `YakuContext` は検証を経ずに直接渡せる公開 API なので、ここでも防御しておく。
  const usedUids = new Set<number>()

  for (const memberId of memberIds) {
    const found = hand.find(
      (card) =>
        !usedUids.has(card.uid) &&
        card.memberId === memberId &&
        (color === null || card.color === color),
    )
    if (found === undefined) {
      return null
    }
    picked.push(found)
    usedUids.add(found.uid)
  }

  return picked
}

/** N人組役の候補（通常 + 色ごとの同色）を列挙する。 */
function enumerateGroups(hand: readonly Card[], ctx: YakuContext): CandidateDraft[] {
  const drafts: CandidateDraft[] = []

  for (const group of ctx.activeGroups) {
    const kind = groupYakuKind(group.memberIds.length)

    const mixed = pickGroupCards(hand, group.memberIds, null)
    if (mixed !== null) {
      drafts.push({ kind, targetId: group.id, color: null, cards: mixed })
    }

    for (const color of ctx.rules.colors) {
      const sameColor = pickGroupCards(hand, group.memberIds, color)
      if (sameColor !== null) {
        drafts.push({ kind, targetId: group.id, color, cards: sameColor })
      }
    }
  }

  return drafts
}

function enumerateDrafts(hand: readonly Card[], ctx: YakuContext): CandidateDraft[] {
  return [...enumerateTriples(hand, ctx), ...enumerateGroups(hand, ctx)]
}

function toCandidate(draft: CandidateDraft, ctx: YakuContext): YakuCandidate {
  const bonusCount = countBonusCards(draft.cards, ctx.bonusMemberIds)

  // 「どちらの列挙ループから来たか」ではなく、実際に消費するカードの色から判定する。
  // 混色候補として選んだカードがたまたま全て同色だった場合もその場で同色役と分かるため、
  // 正しさが「同色の点数 > 通常の点数」という（RulesConfig では強制されていない）
  // 大小関係や重複除去の挿入順に依存しなくなる。
  const sameColor = new Set(draft.cards.map((card) => card.color)).size === 1

  return {
    kind: draft.kind,
    sameColor,
    cards: draft.cards,
    bonusCount,
    score: scoreYaku(draft.kind, sameColor, bonusCount, ctx.rules),
  }
}

/**
 * 消費カード集合が同一の候補を1つに畳む。点数が高い方を残す。
 *
 * 混色候補として選ばれたカードがたまたま全て同色だった場合、同色候補と
 * 全く同じカード集合になる。そのときは同色（高得点）の方が正しい判定なので、
 * この重複除去によって混色版が落ちる。
 */
function dedupeByCardSet(candidates: readonly YakuCandidate[]): YakuCandidate[] {
  const best = new Map<string, YakuCandidate>()

  for (const candidate of candidates) {
    const key = cardSetKey(candidate.cards)
    const current = best.get(key)
    if (current === undefined || candidate.score > current.score) {
      best.set(key, candidate)
    }
  }

  return [...best.values()]
}

function removeFirstByUid(hand: readonly Card[], uid: number): Card[] {
  const index = hand.findIndex((card) => card.uid === uid)
  return index < 0 ? [...hand] : [...hand.slice(0, index), ...hand.slice(index + 1)]
}

/**
 * 成立している役の候補をすべて列挙する。
 *
 * `hand` は**判定対象のカード全体**であり、ロン判定では「自分の手札 + 相手の捨て札」を渡す。
 * `required` はその捨て札で、指定すると次の2条件を満たす候補だけに絞られる。
 *
 * 1. その1枚を消費する
 * 2. その1枚を除いた手札では**同じ役（役種・対象・色の組み合わせ）が成立しない**
 *
 * 条件2がないと、同じメンバー・同じ色の予備カードを持っている場合に
 * 「手の内で既に成立している役」でロンを主張できてしまう。
 */
export function findYaku(
  hand: readonly Card[],
  ctx: YakuContext,
  required?: Card,
): YakuCandidate[] {
  const drafts = enumerateDrafts(hand, ctx)

  if (required === undefined) {
    return dedupeByCardSet(drafts.map((draft) => toCandidate(draft, ctx)))
  }

  if (!hand.some((card) => card.uid === required.uid)) {
    throw new RangeError(
      `required に指定されたカード（uid: ${required.uid}）が hand に含まれていません`,
    )
  }

  const withoutRequired = removeFirstByUid(hand, required.uid)
  const achievableWithout = new Set(enumerateDrafts(withoutRequired, ctx).map(signatureOf))

  const ronDrafts = drafts.filter(
    (draft) =>
      draft.cards.some((card) => card.uid === required.uid) &&
      !achievableWithout.has(signatureOf(draft)),
  )

  return dedupeByCardSet(ronDrafts.map((draft) => toCandidate(draft, ctx)))
}

function countBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, number> {
  const counts = new Map<string, number>()
  for (const item of items) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * 役を消費した後に手札に残るカードの「次の役への繋がりやすさ」を粗く見積もる。
 *
 * 厳密な期待値計算ではなく、同点の候補を決定的に順序付けるための近似。
 * より精密な判断が必要な CPU AI（Step 3）は `findYaku` の全候補を直接評価できる。
 */
function remainingValue(rest: readonly Card[], ctx: YakuContext): number {
  let value = 0

  const byMember = countBy(rest, (card) => card.memberId)
  for (const count of byMember.values()) {
    value += count * (count - 1)
  }

  const byMemberColor = countBy(rest, (card) => `${card.memberId}:${card.color}`)
  for (const count of byMemberColor.values()) {
    value += count * (count - 1)
  }

  for (const group of ctx.activeGroups) {
    const held = group.memberIds.filter((memberId) => byMember.has(memberId)).length
    if (held >= 2) {
      value += held
    }
  }

  return value
}

/** uid 列を辞書順（数値昇順）で比較する。同点候補を決定的に並べるためのタイブレーク。 */
function compareUids(a: readonly Card[], b: readonly Card[]): number {
  const left = a.map((card) => card.uid).sort((x, y) => x - y)
  const right = b.map((card) => card.uid).sort((x, y) => x - y)

  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    if (left[i] !== right[i]) {
      return left[i] - right[i]
    }
  }
  return left.length - right.length
}

/**
 * 最良の候補を選ぶ。
 *
 * 1. 点数が最大のもの
 * 2. 同点なら消費後の残り手札の価値が高いもの
 * 3. それも同点なら uid 列が小さいもの（決定性のため）
 */
export function bestYaku(
  candidates: readonly YakuCandidate[],
  hand: readonly Card[],
  ctx: YakuContext,
): YakuCandidate | null {
  let best: YakuCandidate | null = null
  let bestRemaining = -1

  for (const candidate of candidates) {
    const consumed = new Set(candidate.cards.map((card) => card.uid))
    const rest = hand.filter((card) => !consumed.has(card.uid))
    const remaining = remainingValue(rest, ctx)

    if (best === null || candidate.score > best.score) {
      best = candidate
      bestRemaining = remaining
      continue
    }
    if (candidate.score < best.score) {
      continue
    }

    if (remaining > bestRemaining) {
      best = candidate
      bestRemaining = remaining
      continue
    }
    if (remaining === bestRemaining && compareUids(candidate.cards, best.cards) < 0) {
      best = candidate
      bestRemaining = remaining
    }
  }

  return best
}

/**
 * リーチ表示用の待ち計算。
 *
 * 探索対象は `ctx.activeGroups` に属するメンバーのみ。`deck.ts` の `buildCardPool` が
 * 登場グループのメンバーのカードしか山札に入れないため、手札はこの集合に必ず収まる。
 * （`findYaku` 自体は 3カード役に限りグループ外のメンバーでも成立を認めるが、
 * 山札の作られ方からそのようなカードが手札に来ることはない。）
 *
 * 「今局の登場メンバー × 色数」を総当たりし、1枚足したら役が完成するカードの種類を洗い出す。
 * 試行回数の上限は `groupsPerGame × maxGroupSize × colors.length`（既定値では 4 × 5 × 3 = 60）で、
 * 軽量判定を数十回繰り返すだけで済む。最適化するより判定ロジックを `findYaku` の1箇所に
 * 集約できる利点の方が大きい。
 */
export function computeWaits(hand: readonly Card[], ctx: YakuContext): WaitInfo {
  // 実カードの uid と絶対に衝突しない仮 uid を作る。
  const probeUid = hand.reduce((min, card) => Math.min(min, card.uid), 0) - 1

  const memberIds = [...new Set(ctx.activeGroups.flatMap((group) => group.memberIds))]
  const waits: WaitEntry[] = []
  const contributingUids = new Set<number>()

  for (const memberId of memberIds) {
    for (const color of ctx.rules.colors) {
      const probe: Card = { uid: probeUid, memberId, color }
      const probed = [...hand, probe]
      const best = bestYaku(findYaku(probed, ctx, probe), probed, ctx)

      if (best === null) {
        continue
      }

      waits.push({ memberId, color, best })
      for (const card of best.cards) {
        if (card.uid !== probeUid) {
          contributingUids.add(card.uid)
        }
      }
    }
  }

  return { waits, contributingUids }
}
