/**
 * CPU の思考。
 *
 * **AI は `GameState` を受け取らない。** 他家の手札や山札の中身に触れる経路が
 * 型として存在しないため、カンニングは実装ミスではなく型エラーになる。
 * `toAiView` が `GameState` に触れる唯一の場所であり、そこで公開情報だけを切り出す。
 *
 * AI は乱数を使わない。同じ `AiView` と `AiConfig` に対して常に同じ判断を返すため、
 * 自動対局はシードだけで完全に再現できる。
 */

import { TRIPLE_SIZE, groupYakuKind, bestYaku, findYaku } from './yaku'
import { scoreYaku } from './score'
import { yakuContextOf } from './gameSelectors'
import type {
  Card,
  ColorId,
  GameState,
  GroupId,
  MemberId,
  PlayerId,
  RulesConfig,
  YakuCandidate,
  YakuContext,
} from './types'

/**
 * CPU に見せてよい情報だけを集めたビュー。
 *
 * 山札は `wallCount`（残り枚数）のみで、中身の配列は含めない。
 * 他家の手札に相当するフィールドは存在しない。
 */
export interface AiView {
  readonly selfId: PlayerId
  readonly hand: readonly Card[]
  readonly ctx: YakuContext
  /** 河。全員に見えている公開情報。 */
  readonly discardsByPlayer: readonly (readonly Card[])[]
  /** 山札の残り枚数。中身は見えない。 */
  readonly wallCount: number
  readonly scores: readonly number[]
}

export interface AiConfig {
  /**
   * 遠い役をどれだけ割り引くか。大きいほど「あと1枚」の役を優先し、
   * 高得点でも遠い役を追わなくなる。
   */
  readonly patience: number
  /** 終盤の放銃回避の強さ。0 で無効。 */
  readonly safety: number
}

export const AI_PRESETS = {
  /** 目先の役だけを見る。安全牌を考えない。 */
  easy: { patience: 2, safety: 0 },
  /** 既定。遠い役もある程度追い、終盤は放銃を避ける。 */
  normal: { patience: 1.5, safety: 1 },
  /** 高得点の役を粘り強く狙い、終盤の危険牌を強く避ける。 */
  hard: { patience: 1, safety: 2 },
} as const satisfies Record<string, AiConfig>

export const DEFAULT_AI_CONFIG: AiConfig = AI_PRESETS.normal

/**
 * 終盤とみなす山札残量の割合。この割合を下回ると `safety` が効き始める。
 * 恣意的な絶対枚数を埋め込まず、`rules.deckSize` からの割合で導出する。
 */
const ENDGAME_WALL_RATIO = 0.2

/** 狙える役1つ分の評価。 */
export interface TargetEvaluation {
  readonly kind: 'triple' | 'group'
  readonly targetId: MemberId | GroupId
  /** 同色を狙う場合の色。`null` なら色を問わない（通常役）。 */
  readonly color: ColorId | null
  /** 完成までにあと何枚必要か。0 なら成立済み。 */
  readonly need: number
  /** 成立したときの点数。 */
  readonly score: number
  /** 遠さで割り引いた価値。捨て札の判断に使う。 */
  readonly value: number
  /** この役に寄与している手札カードの uid。 */
  readonly contributingUids: ReadonlySet<number>
}

/**
 * `GameState` から公開情報だけを切り出す。AI が状態に触れる唯一の経路。
 *
 * ここが情報の境界そのものなので、`playerId` の範囲も確かめる。現在の呼び出し元は
 * 必ず正当な ID を渡すが、Step 4 以降で UI から渡るようになったときに
 * `undefined` の手札を読んで分かりにくく壊れるのを防ぐ。
 */
export function toAiView(state: GameState, playerId: PlayerId, rules: RulesConfig): AiView {
  if (!Number.isInteger(playerId) || playerId < 0 || playerId >= state.players.length) {
    throw new RangeError(
      `playerId は 0〜${state.players.length - 1} の整数である必要がありますが ${playerId} でした`,
    )
  }

  return {
    selfId: playerId,
    hand: state.players[playerId].hand,
    ctx: yakuContextOf(state, rules),
    discardsByPlayer: state.players.map((player) => player.discards),
    wallCount: state.wall.length,
    scores: state.players.map((player) => player.score),
  }
}

/**
 * 3カード役の評価。
 *
 * 同じメンバーのカードを何枚持っているかを数え、通常版と各色の同色版を別ターゲットとする。
 */
function evaluateTriples(
  hand: readonly Card[],
  ctx: YakuContext,
  config: AiConfig,
): TargetEvaluation[] {
  const byMember = new Map<MemberId, Card[]>()
  for (const card of hand) {
    const bucket = byMember.get(card.memberId)
    if (bucket === undefined) {
      byMember.set(card.memberId, [card])
    } else {
      bucket.push(card)
    }
  }

  const evaluations: TargetEvaluation[] = []

  for (const [memberId, cards] of byMember) {
    // 通常の3カード。ボーナス加点は成立時の枚数（= 3枚すべて）で決まる。
    const isBonus = ctx.bonusMemberIds.includes(memberId)
    const bonusCount = isBonus ? TRIPLE_SIZE : 0

    evaluations.push(
      makeEvaluation(
        'triple',
        memberId,
        null,
        Math.max(0, TRIPLE_SIZE - cards.length),
        scoreYaku('triple', false, bonusCount, ctx.rules),
        cards.map((card) => card.uid),
        config,
      ),
    )

    for (const color of ctx.rules.colors) {
      const sameColorCards = cards.filter((card) => card.color === color)
      if (sameColorCards.length === 0) {
        continue
      }
      evaluations.push(
        makeEvaluation(
          'triple',
          memberId,
          color,
          Math.max(0, TRIPLE_SIZE - sameColorCards.length),
          scoreYaku('triple', true, bonusCount, ctx.rules),
          sameColorCards.map((card) => card.uid),
          config,
        ),
      )
    }
  }

  return evaluations
}

/**
 * N人組役の評価。
 *
 * グループの各メンバーを1枚以上持っているかを数える。`need` は「まだ持っていないメンバー数」。
 */
function evaluateGroups(
  hand: readonly Card[],
  ctx: YakuContext,
  config: AiConfig,
): TargetEvaluation[] {
  const evaluations: TargetEvaluation[] = []

  for (const group of ctx.activeGroups) {
    const kind = groupYakuKind(group.memberIds.length)
    const bonusCount = group.memberIds.filter((id) => ctx.bonusMemberIds.includes(id)).length

    // 色を問わない版と、色ごとの同色版をまとめて数える。
    const variants: { color: ColorId | null; sameColor: boolean }[] = [
      { color: null, sameColor: false },
      ...ctx.rules.colors.map((color) => ({ color, sameColor: true })),
    ]

    for (const variant of variants) {
      const uids: number[] = []
      let held = 0

      for (const memberId of group.memberIds) {
        const card = hand.find(
          (candidate) =>
            candidate.memberId === memberId &&
            (variant.color === null || candidate.color === variant.color),
        )
        if (card !== undefined) {
          held += 1
          uids.push(card.uid)
        }
      }

      // 1枚も寄与していない候補は落とす。`contributingUids` が空なので捨て札の判断には
      // 影響しないが、「評価対象 = 手札が何かしら寄与しているもの」という戻り値の意味を
      // 揃えておく（UI 表示などに転用したときに誤解しないため）。
      if (held === 0) {
        continue
      }

      evaluations.push(
        makeEvaluation(
          'group',
          group.id,
          variant.color,
          group.memberIds.length - held,
          scoreYaku(kind, variant.sameColor, bonusCount, ctx.rules),
          uids,
          config,
        ),
      )
    }
  }

  return evaluations
}

function makeEvaluation(
  kind: 'triple' | 'group',
  targetId: MemberId | GroupId,
  color: ColorId | null,
  need: number,
  score: number,
  uids: readonly number[],
  config: AiConfig,
): TargetEvaluation {
  return {
    kind,
    targetId,
    color,
    need,
    score,
    // 遠い役ほど実現しにくいので割り引く。`patience` が小さいほど遠い役も評価される。
    value: score / Math.pow(need + 1, config.patience),
    contributingUids: new Set(uids),
  }
}

/** 手札から狙える役をすべて評価する。 */
export function evaluateTargets(view: AiView, config: AiConfig): TargetEvaluation[] {
  return [
    ...evaluateTriples(view.hand, view.ctx, config),
    ...evaluateGroups(view.hand, view.ctx, config),
  ]
}

/**
 * 河に出ているカードから、そのメンバーの「見えている枚数」を数える。
 *
 * 他家がよく捨てているメンバーは他家にとって不要である可能性が高く、放銃しにくい。
 * 参照するのは河だけで、他家の手札は見ない。
 */
function countInDiscards(view: AiView, memberId: MemberId): number {
  let count = 0
  for (const discards of view.discardsByPlayer) {
    for (const card of discards) {
      if (card.memberId === memberId) {
        count += 1
      }
    }
  }
  return count
}

/**
 * 捨てるカードを決める。
 *
 * 各カードについて「それを捨てたときに失われるターゲット価値」を求め、損失が最小のものを選ぶ。
 * 同点は uid 昇順で決定的に決める。
 */
export function chooseDiscard(view: AiView, config: AiConfig = DEFAULT_AI_CONFIG): Card {
  if (view.hand.length === 0) {
    throw new RangeError('手札が空のため捨てるカードを選べません')
  }

  const targets = evaluateTargets(view, config)
  const isEndgame = view.wallCount < view.ctx.rules.deckSize * ENDGAME_WALL_RATIO

  let choice = view.hand[0]
  let lowestCost = Number.POSITIVE_INFINITY

  for (const card of view.hand) {
    // そのカードが寄与しているターゲットの価値の合計 = 捨てたときの損失。
    let cost = 0
    for (const target of targets) {
      if (target.contributingUids.has(card.uid)) {
        cost += target.value
      }
    }

    // 終盤は、河に出ていないメンバーほど他家に当たりやすいとみなして避ける。
    if (isEndgame && config.safety > 0) {
      cost += config.safety * (view.ctx.rules.colors.length - countInDiscards(view, card.memberId))
    }

    if (cost < lowestCost || (cost === lowestCost && card.uid < choice.uid)) {
      choice = card
      lowestCost = cost
    }
  }

  return choice
}

/**
 * 自分の手番での宣言（ツモ）を判断する。
 *
 * v1 は攻略定石どおり「役が揃ったら即宣言」。伏せて同色を狙う「ダマポカジャン」は v2 以降。
 * 複数成立していれば `bestYaku` が点数最大のものを選ぶ。
 */
export function decideDeclare(view: AiView): YakuCandidate | null {
  const candidates = findYaku(view.hand, view.ctx)
  return bestYaku(candidates, view.hand, view.ctx)
}

/**
 * 他家の捨て札への割り込み（ロン）を判断する。
 *
 * `findYaku` に `discard` を `required` として渡すため、「その捨て札がなければ成立しない役」
 * だけが返る。手の内で既に成立している役でロンを主張することはない。
 */
export function decideClaim(view: AiView, discard: Card): YakuCandidate | null {
  const probed = [...view.hand, discard]
  const candidates = findYaku(probed, view.ctx, discard)
  return bestYaku(candidates, probed, view.ctx)
}
