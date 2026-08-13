/**
 * `PlayerView`（公開情報のみ）から UI が要る導出値を求める純関数群。
 *
 * Step 6（フロント transport seam）で、UI は生の `GameState` ではなく `PlayerView` を描画する。
 * ツモ／ロン候補・待ち・残枚数・各種フラグはいずれも「自分の手札＋公開情報」だけで決まるため、
 * `GameState` 版（`autoAction.ts` の `declarableFor` 等・`unseen.ts` の `toVisibleCards`）とは別に、
 * **`PlayerView` を受け取る薄い版**をここに置く。重い列挙・集計（`findYaku`/`computeWaits`/`countUnseen`）は
 * そのまま共有し、二重実装しない。
 *
 * **`GameState` 版のシグネチャは変えない**（`nextCpuAction` など engine 内部が使い続ける）。local transport は
 * `toPlayerView(state)` してからこの view 版を通すため、**実装は1つ・local の e2e/gate が view 版を検証する**。
 */

import { countUnseen, type UnseenCounts, type VisibleCards } from './unseen'
import { computeWaits, findYaku, type WaitInfo } from './yaku'
import type { PlayerView } from './playerView'
import type { YakuCandidate, YakuContext } from './types'

/**
 * `PlayerView` から役判定コンテキストを組む。`gameSelectors.ts` の `yakuContextOf`（`GameState` 版）と
 * 同じ3フィールドで、いずれも `PlayerView` にそのまま在る。
 */
export function yakuContextFromView(view: PlayerView, rules: YakuContext['rules']): YakuContext {
  return {
    activeGroups: view.activeGroups,
    bonusMemberIds: view.bonusMemberIds,
    rules,
  }
}

/**
 * 宣言できる役（ツモ）。`selfDeclare` で宣言権を持つとき以外は空。`autoAction.ts` の `declarableFor` と同判定を
 * `view.hand`（自席の手札は top-level）で行う。
 */
export function declarableFromView(view: PlayerView, rules: YakuContext['rules']): YakuCandidate[] {
  if (view.phase !== 'selfDeclare' || view.declarer !== view.selfId) {
    return []
  }
  return findYaku(view.hand, yakuContextFromView(view, rules))
}

/**
 * 割り込める役（ロン）。`claimWindow` 以外・捨て札なし・表明済みでは空。
 *
 * GameState 版 `claimableFor` の「未表明で割り込み対象」`claims[selfId] !== null` は、redact 後の view では
 * **`claims[selfId] === 'pending'`** と等価（'passed'/'claimed'=表明済み・キー不在〔=捨て札本人で対象外〕なら
 * view の claims に 'pending' で現れない）。
 */
export function claimableFromView(view: PlayerView, rules: YakuContext['rules']): YakuCandidate[] {
  if (view.phase !== 'claimWindow' || view.lastDiscard === null) {
    return []
  }
  if (view.claims[view.selfId] !== 'pending') {
    return []
  }
  return findYaku(
    [...view.hand, view.lastDiscard],
    yakuContextFromView(view, rules),
    view.lastDiscard,
  )
}

/**
 * `unseen.ts` の `VisibleCards`（自分の手札＋全員の河＋全員の成立済み役）を `PlayerView` から組む。
 * `toVisibleCards`（`GameState` 版）と同じ内容で、他家の手札を含む経路は無い。
 */
export function visibleCardsFromView(view: PlayerView): VisibleCards {
  return {
    hand: view.hand,
    discardsByPlayer: view.players.map((player) => player.discards),
    declaredByPlayer: view.players.map((player) => player.declared),
  }
}

/** 自席の待ち（テンパイ）。`computeWaits` を自席の手札＋view コンテキストで呼ぶ。 */
export function waitsFromView(view: PlayerView, rules: YakuContext['rules']): WaitInfo {
  return computeWaits(view.hand, yakuContextFromView(view, rules))
}

/** メンバー×色ごとの残枚数（上限）。`countUnseen` を view 由来の `VisibleCards` で呼ぶ。 */
export function unseenFromView(view: PlayerView, rules: YakuContext['rules']): UnseenCounts {
  return countUnseen(
    visibleCardsFromView(view),
    view.activeMembers.map((member) => member.id),
    rules,
  )
}

/** 手札をクリックして捨てられる状態か（自分の打牌番）。 */
export function canDiscardFromView(view: PlayerView): boolean {
  return view.phase === 'discard' && view.turn === view.selfId
}

/** 宣言の受付が開いていて、自分がまだ表明していないか。`isClaimWindowOpen`（`GameState` 版）の view 版。 */
export function isClaimWindowOpenFromView(view: PlayerView): boolean {
  return view.phase === 'claimWindow' && view.claims[view.selfId] === 'pending'
}

/**
 * まだ意思表示していない CPU（＝自席以外）の数。「CPU は人間を待たない」ことの観測用。
 *
 * GameState 版 `pendingCpuClaimIds(state,[human])` の「id≠human かつ claims[id]===null」を、view では
 * 「id≠selfId かつ status==='pending'」で数える（単一 human では非 human＝全 CPU なので等価）。
 */
export function pendingCpuClaimsFromView(view: PlayerView): number {
  let count = 0
  for (const key of Object.keys(view.claims)) {
    const id = Number(key)
    if (id !== view.selfId && view.claims[id] === 'pending') {
      count += 1
    }
  }
  return count
}
