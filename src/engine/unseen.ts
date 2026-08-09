/**
 * 「まだ見えていない枚数」の算出。
 *
 * 見えているカード = **自分の手札 + 全員の河 + 全員の成立済みの役**。
 * 残枚数はその補数で、`rules.copiesPerMemberColor` から引いて求める。
 *
 * **これは上限であって確定値ではない。** `buildDeck` はプールから `deckSize` 枚しか
 * 抜かないため、残枚数の内訳は次の3つになる。
 *
 * ```
 * 残枚数 = 山札に残っている枚数 + 他家の手札にある枚数 + そもそも山札に入らなかった枚数
 * ```
 *
 * 画面のラベルもそのように書くこと（「山に残り N 枚」と言い切らない）。
 */

import type {
  Card,
  ColorId,
  GameState,
  MemberId,
  PlayerId,
  RulesConfig,
  YakuCandidate,
} from './types'

/**
 * 見えているカードの出どころ。**公開情報だけ**で構成する。
 *
 * `countUnseen` が `GameState` ではなくこれを受け取るのが要点で、
 * **他家の手札へ到達する経路が型として存在しない**。`ai.ts` の `AiView` と同じ考え方で、
 * カンニングは実行時の約束ではなく型で防ぐ。
 */
export interface VisibleCards {
  /** 数える人自身の手札。他家の手札はここには入らない。 */
  readonly hand: readonly Card[]
  readonly discardsByPlayer: readonly (readonly Card[])[]
  readonly declaredByPlayer: readonly (readonly YakuCandidate[])[]
}

export interface ColorCount {
  readonly color: ColorId
  readonly unseen: number
}

/** メンバーごとの、色別の残枚数。並びは `rules.colors` の順。 */
export type UnseenCounts = ReadonlyMap<MemberId, readonly ColorCount[]>

/** 集計キー。`yaku.ts` の `countBy` と同じ慣習に合わせる。 */
function keyOf(memberId: MemberId, color: ColorId): string {
  return `${memberId}:${color}`
}

/**
 * **状態に触る唯一の場所。**
 *
 * ここで手札を1人分に絞ることで、以降の計算は公開情報だけで完結する。
 * 河は誰のものも見えているので全員分を、成立済みの役も同様に全員分を渡す。
 */
export function toVisibleCards(state: GameState, playerId: PlayerId): VisibleCards {
  const me = state.players[playerId]
  if (me === undefined) {
    throw new RangeError(`プレイヤー ${playerId} は対局に参加していません`)
  }

  return {
    hand: me.hand,
    discardsByPlayer: state.players.map((player) => player.discards),
    declaredByPlayer: state.players.map((player) => player.declared),
  }
}

/**
 * 見えているカードから、メンバー × 色ごとの残枚数を数える。
 *
 * **`GameState` を受け取らない。** 渡す設計にすると他家の手札に到達でき、
 * 情報の隠蔽が型ではなく規律の問題に落ちる。
 *
 * ロンで取られた捨て札は河から取り除かれて `declared` へ移る（`win.ts` の
 * `consumeAndRefill`）ため、河と成立済みの役を両方数えても二重にならない。
 * `lastDiscard` は捨てた本人の `discards` にも入っているので別に数えない。
 *
 * 残枚数を 0 でクランプ**しない**。負になったらそれは数え方の欠陥であり、
 * 隠すと自動対局との突き合わせが通ってしまう。
 */
export function countUnseen(
  visible: VisibleCards,
  memberIds: readonly MemberId[],
  rules: RulesConfig,
): UnseenCounts {
  const knownMembers = new Set(memberIds)
  const knownColors = new Set<ColorId>(rules.colors)
  const seen = new Map<string, number>()

  /*
   * 数える対象の外にあるカードは黙って捨てず例外にする。
   *
   * 捨てると**そのカードの分だけ見えている枚数が過小になり、残枚数が過大になる**。
   * 「まだ引ける」と言い続けることになり、この機能が解こうとしている誤りそのものを生む。
   * 今のロスター検証と `buildCardPool` の構造では到達しない（登場メンバー・
   * ルールの色からしかカードを作らない）ので、到達は内部不変条件の違反を意味する。
   */
  const countCard = (card: Card): void => {
    if (!knownMembers.has(card.memberId)) {
      throw new RangeError(`メンバー ${card.memberId} は数える対象に含まれていません`)
    }
    if (!knownColors.has(card.color)) {
      throw new RangeError(`色 ${card.color} はルールの色に含まれていません`)
    }

    const key = keyOf(card.memberId, card.color)
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }

  for (const card of visible.hand) {
    countCard(card)
  }
  for (const discards of visible.discardsByPlayer) {
    for (const card of discards) {
      countCard(card)
    }
  }
  for (const declared of visible.declaredByPlayer) {
    for (const candidate of declared) {
      for (const card of candidate.cards) {
        countCard(card)
      }
    }
  }

  const counts = new Map<MemberId, readonly ColorCount[]>()
  for (const memberId of memberIds) {
    counts.set(
      memberId,
      rules.colors.map((color) => ({
        color,
        unseen: rules.copiesPerMemberColor - (seen.get(keyOf(memberId, color)) ?? 0),
      })),
    )
  }

  return counts
}

/**
 * メンバー1人分の全色を取り出す。
 *
 * **0 を返すフォールバックを置かない。** この画面で「残0」は
 * 「その札はもう場に無いので、その待ちは捨てろ」という意味を持つ。
 * 数え落としを 0 として黙って表示すると、最も誤解を招く形の嘘になる。
 * `groupYakuKind` が範囲外のグループ人数で `RangeError` を投げるのと同じ扱い。
 */
export function colorCountsOf(counts: UnseenCounts, memberId: MemberId): readonly ColorCount[] {
  const entry = counts.get(memberId)
  if (entry === undefined) {
    throw new RangeError(`メンバー ${memberId} の残枚数が数えられていません`)
  }
  return entry
}

/** 1つの (メンバー, 色) の残枚数。 */
export function unseenOf(counts: UnseenCounts, memberId: MemberId, color: ColorId): number {
  const entry = colorCountsOf(counts, memberId).find((count) => count.color === color)
  if (entry === undefined) {
    throw new RangeError(`メンバー ${memberId} の ${color} の残枚数が数えられていません`)
  }
  return entry.unseen
}
