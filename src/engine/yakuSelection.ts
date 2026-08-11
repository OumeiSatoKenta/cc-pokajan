/**
 * 選択されたカードからの役の「再導出」。
 *
 * `yaku.ts` の `findYaku` が「手札から成立しうる役を全列挙し、カードを決定的に自動選択する」
 * のに対し、こちらは**プレイヤーが選んだカードそのもの**から役種・同色・点数を決める。
 * これにより「同一メンバー4枚のうちどの3枚を使うか」「同じ役を混色で取るか同色で取るか」
 * といった**正準以外の合法選択**を受理でき、色の取り方で役種・点数が変わる戦術が成立する。
 *
 * 宣言（ツモ）／割り込み（ロン）の検証（`claims.ts` の `verifyCandidate`）はこのモジュールを
 * 単一の真実として使う。判定規則・シグネチャ計算・点数計算は `yaku.ts` の私的プリミティブ
 * （`toCandidate` / `signatureOf` / `achievableSignaturesWithout` / `CandidateDraft`）を共有し、
 * 列挙側と二重の真実を作らない。エンジン層の他ファイルと同じく React / config / `Math.random` /
 * `Date` には依存しない。
 */

import {
  TRIPLE_SIZE,
  achievableSignaturesWithout,
  groupYakuKind,
  signatureOf,
  toCandidate,
  type CandidateDraft,
} from './yaku'
import type { Card, MemberId, YakuCandidate, YakuContext } from './types'

/**
 * 選択された uid を手札のカードへ解決する。
 *
 * 同じ uid を2度選ぶ・手札にない uid を選ぶといった不正な選択は黙って無視せず `null` を返し、
 * 以降の役判定に進ませない。
 */
function resolveSelection(hand: readonly Card[], selectedUids: readonly number[]): Card[] | null {
  const byUid = new Map(hand.map((card) => [card.uid, card]))
  const seen = new Set<number>()
  const cards: Card[] = []

  for (const uid of selectedUids) {
    // 同じカードを2度は消費できない。
    if (seen.has(uid)) {
      return null
    }
    const card = byUid.get(uid)
    // 手札に存在しない uid（未所持カードの偽装）。
    if (card === undefined) {
      return null
    }
    seen.add(uid)
    cards.push(card)
  }

  return cards
}

/** メンバーIDの多重集合を数える。壊れたグループ（メンバー重複）も正しく扱うため集合ではなく多重集合。 */
function memberCounts(memberIds: readonly MemberId[]): Map<MemberId, number> {
  const counts = new Map<MemberId, number>()
  for (const memberId of memberIds) {
    counts.set(memberId, (counts.get(memberId) ?? 0) + 1)
  }
  return counts
}

function isMultisetEqual(a: Map<MemberId, number>, b: Map<MemberId, number>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const [key, value] of a) {
    if (b.get(key) !== value) {
      return false
    }
  }
  return true
}

/**
 * 選択されたカードがちょうど1つの役を構成しているかを判定し、中間表現に落とす。
 *
 * `enumerateDrafts`（列挙）が「手札から成立しうる役を全列挙する」のに対し、これは
 * 「この特定のカード集合が役になっているか」だけを見る。判定規則は列挙と同一
 * （triple = 同一メンバー `TRIPLE_SIZE` 枚 / groupN = グループのメンバー多重集合と一致）に揃える。
 *
 * **triple 判定を groupN より常に優先する。** 正規のロスター（`validateRoster` 済み）では
 * 両者が曖昧になることはないが、メンバー全重複の壊れたグループ（例 `['a1','a1','a1']`）を
 * 直接構築した `YakuContext` では同じ3枚が triple とも groupN とも解釈できる。列挙側の
 * `dedupeByCardSet` は点数の高い方を残すため、この優先順位はスコアに依存せず固定する。
 *
 * `color` は `signatureOf`（ロン規則）用で、既存の draft と同じく全同色なら共有色・混色なら `null`。
 * 最終候補の `sameColor` は `toCandidate` がカードから独立に再計算する（ここでの `color` は
 * シグネチャ照合専用の中間値）。
 */
function classifySelection(cards: readonly Card[], ctx: YakuContext): CandidateDraft | null {
  if (cards.length === 0) {
    return null
  }

  const sameColor = new Set(cards.map((card) => card.color)).size === 1
  const color = sameColor ? cards[0].color : null

  // triple: 全カードが同一メンバーで、ちょうど TRIPLE_SIZE 枚。
  const memberIds = new Set(cards.map((card) => card.memberId))
  if (memberIds.size === 1 && cards.length === TRIPLE_SIZE) {
    return { kind: 'triple', targetId: cards[0].memberId, color, cards }
  }

  // groupN: あるアクティブグループのメンバー多重集合とちょうど一致（過不足・混在なし）。
  const selected = memberCounts(cards.map((card) => card.memberId))
  for (const group of ctx.activeGroups) {
    if (isMultisetEqual(selected, memberCounts(group.memberIds))) {
      return {
        kind: groupYakuKind(group.memberIds.length),
        targetId: group.id,
        color,
        cards,
      }
    }
  }

  return null
}

/**
 * 選択された uid 集合から役を「再導出」する。
 *
 * `findYaku` が正準の1組を自動選択して列挙するのに対し、この関数は**プレイヤーが選んだ
 * カードそのもの**から役種・同色・ボーナス・点数を決める。宣言（ツモ）／割り込み（ロン）の
 * 検証はこの関数を単一の真実として使う。
 *
 * `required` はロンで必須の捨て札。指定すると次の2条件を課す（`findYaku(..., required)` と同一規則）:
 *
 * 1. 選択がその1枚を消費する
 * 2. その1枚を除いた手札では**同じ役（役種・対象・色の組み合わせ）が成立しない**
 *
 * `required` が `hand` に存在しない呼び出しは内部の誤用なので、`findYaku` と揃えて `RangeError` を
 * 投げる（「選択が `required` を含まない」＝合法な非ロンの `null` とは区別する）。
 *
 * 有効な役でなければ `null`（枚数過不足・未所持 uid・重複 uid・不要牌ロンなどをすべて黙って
 * 通さない）。点数はカードの色ではなく役種・同色・ボーナスで決まるため、`toCandidate` が
 * 既存の `scoreYaku` / `countBonusCards` で再計算する。
 */
export function candidateFromSelection(
  hand: readonly Card[],
  selectedUids: readonly number[],
  ctx: YakuContext,
  required?: Card,
): YakuCandidate | null {
  if (required !== undefined && !hand.some((card) => card.uid === required.uid)) {
    throw new RangeError(
      `required に指定されたカード（uid: ${required.uid}）が hand に含まれていません`,
    )
  }

  const cards = resolveSelection(hand, selectedUids)
  if (cards === null) {
    return null
  }

  const draft = classifySelection(cards, ctx)
  if (draft === null) {
    return null
  }

  if (required !== undefined) {
    // ロンは捨て札を消費して初めて成立する。選択に含まれていなければロンできない。
    if (!cards.some((card) => card.uid === required.uid)) {
      return null
    }

    // その1枚を除いた手札で同じシグネチャの役が既に成立するなら、ロンでは受理しない
    // （手の内で完成済みの役を割り込みで主張させない。findYaku のロン絞り込みと同一）。
    if (achievableSignaturesWithout(hand, required.uid, ctx).has(signatureOf(draft))) {
      return null
    }
  }

  return toCandidate(draft, ctx)
}
