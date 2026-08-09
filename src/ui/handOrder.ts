/**
 * 手札の並べ替え。**表示のためだけの処理**で、エンジンには一切影響しない。
 *
 * `GameState` が持つ手札の順序は絶対に変えない。あちらの順序を変えると
 * カード保存則の検査（`tests/engine/autoplay.test.ts`）とリプレイの再現性に影響する。
 * 並べ替えはこの関数を通した「表示用のコピー」に閉じる。
 */

import type { Card, ColorId, Group } from '../engine/types'

export interface HandOrderContext {
  /** 今局に登場するグループ。**配列の順序をそのまま表示順に使う**。 */
  readonly activeGroups: readonly Group[]
  /** 色の並び順。`RulesConfig.colors` をそのまま渡す。 */
  readonly colors: readonly ColorId[]
  /** 今引いているカード。末尾に固定して他と区別する。 */
  readonly drawnUid: number | null
}

/** 並べ替えの基準を1枚分の数値組にする。 */
interface SortKey {
  readonly group: number
  readonly member: number
  readonly color: number
  readonly uid: number
}

/**
 * グループ順 → グループ内のメンバー順 → 色順 → `uid` で並べ替える。
 *
 * これにより**同じメンバーのカードは必ず隣接し、同じグループのカードはまとまる**。
 * 揃いかけの組を目で追えるようにするのが目的で、Step 4 のプレイテストで
 * 「関連するカードが離れていて状況を把握できない」と分かったことへの対応。
 *
 * 引いた1枚は並べ替えに混ぜず末尾に置く。整列に紛れさせると「今引いた1枚」が
 * 見失われ、ツモ切りするかどうかの判断ができなくなる。
 *
 * `activeGroups` は局ごとにシャッフルされるが、**1局の間は不変**なので
 * 表示順が対局中に勝手に入れ替わることはない。
 */
export function sortHand(cards: readonly Card[], ctx: HandOrderContext): readonly Card[] {
  const keys = buildKeyTable(ctx)

  const drawn = cards.filter((card) => card.uid === ctx.drawnUid)
  const rest = cards.filter((card) => card.uid !== ctx.drawnUid)

  const sorted = [...rest].sort((a, b) => {
    const ka = keyOf(a, keys)
    const kb = keyOf(b, keys)

    return ka.group - kb.group || ka.member - kb.member || ka.color - kb.color || ka.uid - kb.uid
  })

  return [...sorted, ...drawn]
}

interface KeyTable {
  /** メンバー ID → グループ順・グループ内順。 */
  readonly members: ReadonlyMap<string, { group: number; member: number }>
  readonly colors: ReadonlyMap<ColorId, number>
  /** どのグループにも属さないメンバーを送る先。 */
  readonly unknown: number
}

function buildKeyTable(ctx: HandOrderContext): KeyTable {
  const members = new Map<string, { group: number; member: number }>()

  ctx.activeGroups.forEach((group, groupIndex) => {
    group.memberIds.forEach((memberId, memberIndex) => {
      members.set(memberId, { group: groupIndex, member: memberIndex })
    })
  })

  return {
    members,
    colors: new Map(ctx.colors.map((color, index) => [color, index])),
    unknown: ctx.activeGroups.length,
  }
}

/**
 * 未知のメンバー・未知の色は末尾に送る。**例外を投げない。**
 *
 * 山札は `activeGroups` の構成メンバーからしか作られないため実際には起こらないが、
 * 起こったときに落ちるべきなのは対局であって並べ替えではない。
 * 表示のための整列がゲームを終わらせる理由にはならない。
 */
function keyOf(card: Card, keys: KeyTable): SortKey {
  const place = keys.members.get(card.memberId)

  return {
    group: place?.group ?? keys.unknown,
    member: place?.member ?? 0,
    color: keys.colors.get(card.color) ?? keys.colors.size,
    uid: card.uid,
  }
}
