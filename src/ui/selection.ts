/**
 * 手札選択（絵札の組み替え）の一時 UI 状態を扱う小さな純関数。
 *
 * 選択は「役に使う uid の集合」。`candidateFromSelection`（エンジン）がこの集合から役を
 * 再導出するため、UI 側は集合の出し入れだけを担う。純関数に切り出して
 * `renderToStaticMarkup` を使わずに単体で検証できるようにする。
 *
 * ゲート判定（`interactionGate`）とリセット鍵（`resetKeyOf`）もここに置く。
 * `useSelection` フックの中に閉じ込めると `useState`/`useEffect` と絡んで単体テストできず、
 * 正しさの担保が E2E だけになる。`autoAction`/`turnTimer` と同じく判断は純関数へ出す。
 */

import type { GameState, ObservablePhase, PlayerId } from '../engine/types'

/**
 * uid の選択をトグルする。含まれていれば外し、無ければ末尾に足す。
 *
 * 同じ uid は二度入らない（`candidateFromSelection` は重複 uid を `null` にするが、
 * UI 状態の時点で一意にしておけば「選択したのに反応しない」状態を作らない）。
 * 順序は選んだ順を保つ（プレフィルとの見た目の一貫性のため）。
 */
export function toggleUid(selected: readonly number[], uid: number): number[] {
  return selected.includes(uid) ? selected.filter((value) => value !== uid) : [...selected, uid]
}

export interface InteractionGateInput {
  readonly phase: ObservablePhase
  readonly declarer: PlayerId
  readonly humanSeat: PlayerId
  /** 和了演出中か（`pendingWin !== null`）。真なら**すべての手札操作を止める**。 */
  readonly isPaused: boolean
  readonly isClaimWindowOpen: boolean
  /** 人間が割り込める役の数。0 ならロン構成に入らない。 */
  readonly claimableCount: number
  readonly hasLastDiscard: boolean
  readonly canDiscard: boolean
}

export interface InteractionGate {
  /** ツモ構成できる（自分の宣言番・宣言権者が自分）。 */
  readonly canDeclare: boolean
  /** ロン構成できる（割り込める役を持つ受付中）。 */
  readonly canClaim: boolean
  /** 手札タップの意味。`Hand` に渡す。 */
  readonly interaction: 'discard' | 'select' | 'none'
}

/**
 * 手札操作のゲート判定。ツモ／ロンの選択可否と手札タップの意味を1箇所で決める。
 *
 * **和了演出中（`isPaused`）はすべての操作を止める。** 手札タップ（`interaction`）も
 * 選択可否（`canDeclare`/`canClaim`）も全部落とす。演出の裏でも `game.state` は連続宣言で
 * 次の `selfDeclare`/`discard` へ進みうる（`applyWin` が同じ `reduce()` 内で遷移させる）ため、
 * `pendingWin` を見ずに `phase`/`declarable` だけで affordance を出すと、`.overlay` が奪えない
 * **キーボード経路**で見送り・捨て・選択が押せてしまう。7-4 の「効果を止めるだけでは
 * クリックが止まらない＝両層で止める」を、手札側でも操作バー側（`actionBarItems` の `isPaused`）でも
 * 同じ `isPaused` で閉じる。
 */
export function interactionGate(input: InteractionGateInput): InteractionGate {
  if (input.isPaused) {
    return { canDeclare: false, canClaim: false, interaction: 'none' }
  }

  const canDeclare = input.phase === 'selfDeclare' && input.declarer === input.humanSeat
  const canClaim = input.isClaimWindowOpen && input.claimableCount > 0 && input.hasLastDiscard
  const interaction = input.canDiscard ? 'discard' : canDeclare || canClaim ? 'select' : 'none'

  return { canDeclare, canClaim, interaction }
}

/**
 * 選択をリセットする境界を1つの文字列に畳む。局面が変わった瞬間に選択を空へ戻すための鍵。
 *
 * `claimWindow` では `turn`＝捨てた本人なので、別の捨て札＝別の `turn` で受付が移るたびに
 * 鍵が変わる（同一受付中は不変なので構成中に消えない）。`chainCount` を含めるのは、同じ局面内で
 * 1回宣言した直後の連続宣言でも選択を持ち越さないため。**この4フィールドで境界を尽くせるのは、
 * エンジンが連続宣言／ロン確定で `declarer`/`chainCount` を演出キュー投入より先に同期更新するため**
 * （`win.ts`・`game.ts` の `resolveClaims`）。将来この順序が変わると鍵が遅れる点は
 * `useSelection` のコメントに残す。
 */
export function resetKeyOf(
  state: Pick<GameState, 'phase' | 'turn' | 'declarer' | 'chainCount'>,
): string {
  return `${state.phase}:${state.turn}:${state.declarer}:${state.chainCount}`
}
