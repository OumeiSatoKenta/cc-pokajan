/**
 * 人間の持ち時間と時間切れの判断。
 *
 * **エンジンは時計を持たない**ため、時間の権威は UI 層にある。
 * ここは純粋関数だけを置き、実際のカウントダウンは `useGameLoop` が
 * `setTimeout` で駆動する。
 */

import type { PlayerView } from '../../engine/playerView'
import type { Action, Card, PlayerId, RulesConfig } from '../../engine/types'

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
 * Step 6 で UI は `PlayerView` を描画するため、判定も view から行う（自席の手札は `view.hand`、割り込み状態は
 * redact 済みの `view.claims`）。**返す `action` は engine の `Action`**（claim は `TICK`）で、local は `reduce` に
 * そのまま渡し、remote は `remoteTransport` が `TICK→PASS` に変換する。
 *
 * `key` に `claims` や `view` そのものを混ぜてはいけない。人間が割り込みを考えている間、CPU は次々と意思表示して
 * view を書き換える。それを依存に含めると **CPU が1人表明するたびに人間のタイマーが破棄・再予約され、
 * 永久に時間切れにならない**。逆に `chainCount` は含める（連続宣言で判断の機会だけが新しくなるため）。
 */
export function decideTimeoutFromView(
  view: PlayerView,
  humanSeat: PlayerId,
  drawnUid: number | null,
  rules: RulesConfig,
): HumanTimeout | null {
  switch (view.phase) {
    case 'claimWindow': {
      // 未表明（'pending'）かつ割り込み対象のときだけ計時する。'passed'/'claimed'（表明済み）・
      // キー不在（捨てた本人で対象外）は redact 後 'pending' 以外になるので、まとめて弾ける。
      if (view.claims[humanSeat] !== 'pending' || view.lastDiscard === null) {
        return null
      }

      return {
        kind: 'claim',
        // **経過時間ではなく上限値を送る。** エンジンの `claimTimerMs` は上限で初期化されているため、
        // 摩耗した持ち時間（最短5秒）を渡すとカウンタが0にならず自動パスが発火せずに対局が固まる。
        // ここは「窓を閉じる」意図の通知（remoteTransport が PASS へ変換する）。
        action: { type: 'TICK', deltaMs: rules.turnTimer.initialMs },
        key: `claim:${view.lastDiscard.uid}`,
      }
    }

    case 'discard': {
      if (view.turn !== humanSeat) {
        return null
      }

      const uid = autoDiscardUid(view.hand, drawnUid)
      if (uid === null) {
        return null
      }

      return {
        kind: 'discard',
        action: { type: 'DISCARD', uid },
        key: `discard:${view.turn}:${view.chainCount}`,
      }
    }

    case 'selfDeclare': {
      // 要求は「ロンと打牌」だが、ここも人間の入力を無期限に待つ状態である。
      // 計時しないと放置で対局が止まり、持ち時間を入れた意味がなくなる。
      // フリテンがないため、自動で見送られても次巡に同じ役を宣言し直せる。
      if (view.declarer !== humanSeat) {
        return null
      }

      return {
        kind: 'declare',
        action: { type: 'SKIP_DECLARE' },
        key: `declare:${view.declarer}:${view.chainCount}`,
      }
    }

    // 引くのは自動で行われ、終局後は待つものがない。
    case 'draw':
    case 'gameOver':
      return null

    default: {
      const exhaustive: never = view.phase
      throw new Error(`未知のフェーズです: ${String(exhaustive)}`)
    }
  }
}
