/**
 * `GameState` からの導出（クエリ）。状態を変更しない読み取り専用の計算だけを置く。
 *
 * 状態機械本体（`game.ts`）から分けているのは、CPU AI のように「状態を進めないが
 * 状態から値を引きたい」利用者が、リデューサ本体に依存せずに済むようにするため。
 */

import type { GameState, PlayerId, RulesConfig, YakuContext } from './types'

/**
 * 順位。点数降順・同点はプレイヤー ID 昇順（決定性のため）。
 *
 * **終局時（`finishGame`）と対局中の演出が同じ関数を使う。**
 * 順位はそのまま順位倍率＝精算額になるため、算出が2箇所にあると
 * 同点の扱いを変えた瞬間に「演出の順位と精算の順位が違う」という
 * もっとも分かりにくい不一致が起こる。
 *
 * 引数を最小の形にしているのは、`GameState['players']`（読み取り専用）と
 * リデューサ内部の可変な `Draft['players']` の**両方から呼べるようにする**ため。
 */
export function computeRanking(
  players: readonly { readonly id: PlayerId; readonly score: number }[],
): PlayerId[] {
  return players
    .map((player) => player.id)
    .sort((a, b) => (players[b]?.score ?? 0) - (players[a]?.score ?? 0) || a - b)
}

/** 状態から役判定用の文脈を組み立てる。 */
export function yakuContextOf(state: GameState, rules: RulesConfig): YakuContext {
  return {
    activeGroups: state.activeGroups,
    bonusMemberIds: state.bonusMemberIds,
    rules,
  }
}

/**
 * そのプレイヤーが今持っているべき手札枚数。
 *
 * 規定枚数より1枚多く持つのは「引いたカードをまだ捨てていないツモ中の手番プレイヤー」だけ。
 * `declarer === turn` の条件が要る点に注意: ロンによる連続宣言の最中はフェーズが
 * `selfDeclare` のまま `turn` が捨て終わったプレイヤーを指し続けるため、
 * フェーズと `turn` だけで判定すると既に規定枚数へ戻っている人に +1 を期待してしまう。
 *
 * `gameOver` では成立しない（山札が尽きて補充しきれなかった場合に手札が減るため）。
 */
export function expectedHandSize(state: GameState, playerId: PlayerId, rules: RulesConfig): number {
  const holdsDrawnCard =
    playerId === state.turn &&
    state.declarer === state.turn &&
    (state.phase === 'selfDeclare' || state.phase === 'discard')

  return rules.handSize + (holdsDrawnCard ? 1 : 0)
}
