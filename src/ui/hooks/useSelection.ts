/**
 * 絵札の組み替え（選択からのツモ／ロン）の配線。
 *
 * **選択は一局中の一時 UI 状態**で、`TableScreen` が持っていたものをここへ集約する。
 * ツモ（`selfDeclare`）とロン（`claimWindow`）の差分は「対象の手札」「固定の捨て札」
 * 「確定先（declare/claim）」「確定ボタンの種別」の4点だけで、残りは共通なので1フックにまとめる。
 * これにより `TableScreen` を 400 行未満に保ち、`canDiscard`（`useGameLoop`）と選択可否の非対称も解消する。
 *
 * Step 6 で `useGameLoop` は `PlayerView` を返すため、選択も `loop.view`（自席の手札は `view.hand`）から組む。
 *
 * **和了演出中は選べない**（`pendingWin !== null`）。演出中も view は連続宣言で次の `selfDeclare`/`discard` へ
 * 進みうるため、`.overlay` が奪えないキーボード経路で手札を触れてしまう。ゲート判定は純関数 `interactionGate`
 * （`../selection`）に出し、操作バー側（`actionBarItems` の `isPaused`）と**同じ `pendingWin` 判定を共有**して、
 * 7-4 の「効果を止めるだけでは足りない＝両層で止める」を手札とボタンの両方で漏れなく閉じる。
 */

import { useEffect, useMemo, useState } from 'react'

import { candidateFromSelection } from '../../engine/yakuSelection'
import { yakuContextFromView } from '../../engine/viewDerive'
import type { RulesConfig, YakuCandidate } from '../../engine/types'
import type { SelectionPreviewProps } from '../components/SelectionPreview'
import type { GameLoop } from './useGameLoop'
import { interactionGate, resetKeyOf, toggleUid } from '../selection'

export interface HandSelection {
  /** `Hand` に渡すタップの意味（`discard` は `useGameLoop` の判定をそのまま透過する）。 */
  readonly interaction: 'discard' | 'select' | 'none'
  /** `Hand` のハイライト対象。**手札 uid のみ**（ロンの捨て札は手札に無いので入らない）。 */
  readonly selectedSet: ReadonlySet<number>
  /**
   * `data-selected-count`（局面をまたいだリセットを直接観測するフック）。
   * **ロンは捨て札を含まないため役の構成枚数より常に 1 小さい**
   * （triple ロンは手札2枚＝count 2／`.card--selected` も2枚。
   * `data-selected-count === candidate.cards.length` を前提にしないこと）。
   */
  readonly selectedCount: number
  /** `ActionBar` に渡すライブプレビュー＋確定。選択できない局面では `null`。 */
  readonly selection: SelectionPreviewProps | null
  /** 手札タップのトグル。 */
  readonly onSelect: (uid: number) => void
  /** おまかせ候補のプレフィル。**ロンでは捨て札 uid を除外**して手札分だけを入れる。 */
  readonly onPrefill: (candidate: YakuCandidate) => void
}

/**
 * ツモ／ロン共通の選択配線を返す。
 *
 * ロンの役は `[...自分の手札, 捨て札]` から `required = 捨て札` で再導出する（Step 1・`game.ts` の
 * CLAIM と同一規則）。**捨て札は手札に無い**ので手札選択（`selectedUids`）には入れず、確定時に
 * `lastDiscard.uid` を固定要素として合流させる（選択にも入れると `resolveSelection` が重複 uid を
 * `null` にするため、常に役にならなくなる）。
 */
export function useSelection(loop: GameLoop, rules: RulesConfig): HandSelection {
  const view = loop.view
  const lastDiscard = view?.lastDiscard ?? null

  /*
   * 手札操作のゲート。ツモ／ロンの選択可否と手札タップの意味を純関数で一括判定する
   * （`decideAutoAction`/`decideTimeoutFromView` と同じく、判断を `useState`/`useEffect` から切り離して
   * 単体テスト可能にする）。**和了演出中（`pendingWin !== null`）は全操作を止める**（`interactionGate` が
   * canDeclare/canClaim/interaction を一斉に落とす）。view 未取得（remote の create 前）も全操作を落とす。
   */
  const { canDeclare, canClaim, interaction } =
    view === null
      ? { canDeclare: false, canClaim: false, interaction: 'none' as const }
      : interactionGate({
          phase: view.phase,
          declarer: view.declarer,
          humanSeat: loop.humanSeat,
          isPaused: loop.pendingWin !== null,
          isClaimWindowOpen: loop.isClaimWindowOpen,
          claimableCount: loop.claimable.length,
          hasLastDiscard: lastDiscard !== null,
          canDiscard: loop.canDiscard,
        })
  const canSelect = canDeclare || canClaim

  const [selectedUids, setSelectedUids] = useState<readonly number[]>([])
  const selectedSet = useMemo(() => new Set(selectedUids), [selectedUids])
  const selectedCount = selectedUids.length

  /*
   * 選択が作る役。**プレビューと確定活性の単一の真実**。無効なら `null`。
   * `candidateFromSelection`（エンジン）が選んだカードから役種・同色・点数を再導出する。
   * 依存に `view` を丸ごと置く（`yakuContextFromView` が `activeGroups` 等を読むため）。ツモでは他家が
   * 動かないので再計算は自分の手札・選択だけで起きるが、ロン受付中は他家 CPU の claim/pass 確定で
   * view が変わりうる。ただし `canClaim`/`hand`/`lastDiscard`/`selectedUids` が同じ限り
   * **再計算しても結果は同じ値**になるだけなので、`composed` は安定する。
   */
  const composed = useMemo(() => {
    if (view === null) {
      return null
    }
    if (canDeclare) {
      return candidateFromSelection(view.hand, selectedUids, yakuContextFromView(view, rules))
    }
    if (canClaim && view.lastDiscard !== null) {
      // 捨て札を固定要素として合流。required=捨て札 で「反手内成立でロン不可」も課す。
      return candidateFromSelection(
        [...view.hand, view.lastDiscard],
        [...selectedUids, view.lastDiscard.uid],
        yakuContextFromView(view, rules),
        view.lastDiscard,
      )
    }
    return null
  }, [view, canDeclare, canClaim, selectedUids, rules])

  /*
   * 局面が変わった瞬間に選択を空へ戻す（`WaitPanel` の pinned 生存バグと同型。「常にマウントされ
   * 続ける」に依存した正しさは崩れる）。境界は `resetKeyOf`（`phase/turn/declarer/chainCount`）に畳んで
   * 純関数として単体検証する。`resetKeyOf` は `Pick<GameState,…>` で受けるため `PlayerView` を無改修で渡せる。
   * **この鍵が境界を尽くせるのは、エンジンが連続宣言／ロン確定で `declarer`/`chainCount` を演出キュー投入より
   * 先に同期更新するため**（`win.ts`・`game.ts` の `resolveClaims`）。将来この順序が変わると鍵が遅れる。
   */
  const resetKey = view === null ? 'none' : resetKeyOf(view)
  useEffect(() => {
    setSelectedUids([])
  }, [resetKey])

  const onSelect = (uid: number) => setSelectedUids((current) => toggleUid(current, uid))

  /*
   * おまかせ候補の構成カードを選択欄へ入れる。ロンの候補（`claimableFor`）の `cards` は
   * 捨て札を含むため、それを除外して手札分だけを入れる（捨て札は `composed` 側で固定合流するので、
   * 選択にも持たせると重複 uid になり常に `null` になる）。ツモでは `fixed` が `null` で除外は起きない。
   */
  const onPrefill = (candidate: YakuCandidate) => {
    const fixed = canClaim && lastDiscard !== null ? lastDiscard.uid : null
    setSelectedUids(candidate.cards.map((card) => card.uid).filter((uid) => uid !== fixed))
  }

  const selection: SelectionPreviewProps | null = canSelect
    ? {
        composed,
        selectionCount: selectedCount,
        kind: canClaim ? 'ron' : 'tsumo',
        onConfirm: () => {
          if (composed === null) {
            return
          }
          // ツモとロンは局面が排他（フェーズが違う）なので、どちらか一方だけが真。
          if (canClaim) {
            loop.claim(composed)
          } else {
            loop.declare(composed)
          }
        },
      }
    : null

  return {
    interaction,
    selectedSet,
    selectedCount,
    selection,
    onSelect,
    onPrefill,
  }
}
