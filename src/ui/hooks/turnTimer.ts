/**
 * 人間の持ち時間と時間切れの判断。
 *
 * **エンジンは時計を持たない**ため、時間の権威は UI 層にある。
 * ここは純粋関数だけを置き、実際のカウントダウンは `useGameLoop` が
 * `setTimeout` で駆動する。
 */

import type { Action, Card, GameState, PlayerId, RulesConfig } from '../../engine/types'

// --- 持ち時間 -----------------------------------------------------------------

/**
 * 使い切ったあとの持ち時間。下限で飽和する。
 *
 * `20000 → 15000 → 10000 → 5000 → 5000 → …`
 */
export function nextTimeLimitMs(current: number, rules: RulesConfig): number {
  return Math.max(rules.turnTimer.minMs, current - rules.turnTimer.decrementMs)
}

/**
 * 時間切れで捨てるカード（ツモ切り）。手札が空なら `null`。
 *
 * 引いたカードが手札に残っていればそれを捨てる。連続宣言でそのカードが役に
 * 消費されている場合は「引いたカード」が存在しないため、最後に加わったカード
 * （＝直近の補充分）を捨てる。どちらの場合も必ず手札にあるカードを返す。
 */
export function autoDiscardUid(hand: readonly Card[], drawnUid: number | null): number | null {
  if (drawnUid !== null && hand.some((card) => card.uid === drawnUid)) {
    return drawnUid
  }
  return hand.at(-1)?.uid ?? null
}

// --- 時間切れの判断 -----------------------------------------------------------

/** 人間が持ち時間を消費している場面の種別。 */
export type TimedDecision = 'claim' | 'discard' | 'declare'

export interface HumanTimeout {
  readonly kind: TimedDecision
  /** 時間切れになったときにエンジンへ送る手。 */
  readonly action: Action
  /**
   * タイマーを張り直すべき境界。`useEffect` の依存に使う。
   *
   * **同じ判断を待っている間は変化しないこと**が最も重要な性質。
   * 詳細は `decideTimeout` の説明を参照。
   */
  readonly key: string
}

/**
 * 人間が時計に乗っている場面かを判定し、時間切れ時の手を返す。`null` なら計時しない。
 *
 * `key` に `claims` や `game` そのものを混ぜてはいけない。人間が割り込みを考えている間、
 * CPU は次々と意思表示して `game` を書き換える。それを依存に含めると
 * **CPU が1人表明するたびに人間のタイマーが破棄・再予約され、永久に時間切れにならない**。
 * Step 4 で自動進行の側に入れた同じ対策と対になっている。
 *
 * 逆に `chainCount` は含める。連続宣言では同じフェーズ・同じ宣言権者のまま
 * 判断の機会だけが新しくなるため、ここが変わらないと2回目以降の判断に時間が与えられない。
 */
export function decideTimeout(
  game: GameState,
  humanSeat: PlayerId,
  drawnUid: number | null,
  rules: RulesConfig,
): HumanTimeout | null {
  switch (game.phase) {
    case 'claimWindow': {
      // キーが無い（＝捨てた本人で割り込みの対象外）場合は `undefined` になり、
      // 「まだ未表明」の `null` と区別される。
      if (game.claims[humanSeat] !== null || game.lastDiscard === null) {
        return null
      }

      return {
        kind: 'claim',
        // **経過時間ではなく上限値を送る。** エンジンの `claimTimerMs` は上限で
        // 初期化されているため、摩耗した持ち時間（最短5秒）を渡すとカウンタが0にならず、
        // 自動パスが発火せずに対局が固まる。ここは「窓を閉じる」意図の通知である。
        action: { type: 'TICK', deltaMs: rules.turnTimer.initialMs },
        key: `claim:${game.lastDiscard.uid}`,
      }
    }

    case 'discard': {
      if (game.turn !== humanSeat) {
        return null
      }

      const uid = autoDiscardUid(game.players[humanSeat].hand, drawnUid)
      if (uid === null) {
        return null
      }

      return {
        kind: 'discard',
        action: { type: 'DISCARD', uid },
        key: `discard:${game.turn}:${game.chainCount}`,
      }
    }

    case 'selfDeclare': {
      // 要求は「ロンと打牌」だが、ここも人間の入力を無期限に待つ状態である。
      // 計時しないと放置で対局が止まり、持ち時間を入れた意味がなくなる。
      // フリテンがないため、自動で見送られても次巡に同じ役を宣言し直せる。
      if (game.declarer !== humanSeat) {
        return null
      }

      return {
        kind: 'declare',
        action: { type: 'SKIP_DECLARE' },
        key: `declare:${game.declarer}:${game.chainCount}`,
      }
    }

    // 引くのは自動で行われ、終局後は待つものがない。
    case 'draw':
    case 'gameOver':
      return null

    default: {
      const exhaustive: never = game.phase
      throw new Error(`未知のフェーズです: ${String(exhaustive)}`)
    }
  }
}
