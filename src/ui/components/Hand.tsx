import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'

import type { Card, MemberId } from '../../engine/types'
import { colorCountsOf, type UnseenCounts } from '../../engine/unseen'
import { CARD_COUNTS_ID, CardCounts } from './CardCounts'
import { CardView } from './CardView'
import { nameOf } from '../labels'

export interface HandProps {
  /** **並べ替え済みの手札**を受け取る。並び順の決定は `handOrder.ts` の責務。 */
  readonly cards: readonly Card[]
  readonly memberNameById: ReadonlyMap<MemberId, string>
  /** 設定済みの画像。無いメンバーは名前表示になる。 */
  readonly imageUrlById: ReadonlyMap<MemberId, string>
  /** 所属グループの記号。カードの角に出す。 */
  readonly groupSymbolById: ReadonlyMap<MemberId, string>
  readonly bonusMemberIds: readonly MemberId[]
  /** 待ちに寄与している手札カードの uid。黄色枠で強調する。 */
  readonly waitingUids: ReadonlySet<number>
  /** メンバー × 色ごとの残枚数。ホバー中の1枚について取り出して見せる。 */
  readonly unseen: UnseenCounts
  /** 今引いた1枚。整列した手札から離して見せる。 */
  readonly drawnUid: number | null
  /**
   * タップが何をするか。**分岐はここ1箇所に集約する。**
   * - `discard`: タップで捨てる（自分の捨てる番。現状維持）
   * - `select`: タップで役の構成を選ぶ（自分の宣言番。絵札の組み替え）
   * - `none`: 触れない（無効ボタン。残枚数ホバーは `<li>` が受ける）
   */
  readonly interaction: 'discard' | 'select' | 'none'
  /** `select` のとき選ばれている uid。 */
  readonly selectedUids: ReadonlySet<number>
  readonly onDiscard: (uid: number) => void
  readonly onSelect: (uid: number) => void
}

/** 自分の手札。捨てられるのは自分の手番の捨てるフェーズだけ。 */
export function Hand({
  cards,
  memberNameById,
  imageUrlById,
  groupSymbolById,
  bonusMemberIds,
  waitingUids,
  unseen,
  drawnUid,
  interaction,
  selectedUids,
  onDiscard,
  onSelect,
}: HandProps) {
  const reduced = useReducedMotion()
  const duration = reduced === true ? 0 : 0.22

  // タップの意味と有効/無効を1箇所で決める。以降のカードはこの判断を共有する。
  const isSelectMode = interaction === 'select'
  const isCardDisabled = interaction === 'none'

  /*
   * ホバー中の札はここで持つ。親に上げると、対局が1手進むたびに
   * 走る再描画の経路にホバーが乗ることになる。
   *
   * **メンバーではなく `uid`（その1枚）で持つ。** メンバーで持つと、
   * 捨てたあとに同じメンバーの別の札を引いたとき、**マウスを動かしていないのに
   * ツールチップが勝手に戻ってくる**（下記の判定が再び真になるため）。
   * `uid` は1局を通じて一意で、消えた札が戻ることはない。
   */
  const [hoveredUid, setHoveredUid] = useState<number | null>(null)

  /*
   * 手札から居なくなった札のツールチップは出さない。
   *
   * 捨てた瞬間、その札の `<li>` は消えるが**マウスは動いていない**ので
   * `mouseleave` が起きない。素直に描くと、捨てたばかりの札の枚数が
   * 別の札の上に出たままになる。状態を効果で消しに行くのではなく、
   * 描くときに今の手札と突き合わせる。
   */
  const hovered = cards.find((card) => card.uid === hoveredUid) ?? null

  return (
    <div className="hand-area">
      {/*
        ツールチップは**手札全体を基準に**絶対配置する（`hints.css`）。
        カード単位に置くと、375px では端の札の中央から左へはみ出す。
      */}
      {hovered !== null && (
        <CardCounts
          memberName={nameOf(memberNameById, hovered.memberId)}
          counts={colorCountsOf(unseen, hovered.memberId)}
        />
      )}

      <ul className="hand" data-testid="hand">
        <AnimatePresence initial={false} mode="popLayout">
          {cards.map((card) => (
            /*
             * **ホバーの受け口は `<li>` に置く。`CardView` には置かない。**
             * 捨てられない局面では `CardView` は `disabled` の `<button>` になり、
             * 無効化されたボタンにはマウスイベントが来ない。カード側に付けると
             * 「自分の捨てる番のときしか調べられない」機能になる。
             *
             * 焦点でも出すが、`disabled` のボタンは焦点も取れないため、
             * キーボードから調べられるのは自分の手番のときだけ。
             * その2つの経路は待ち一覧（`WaitPanel`）が受け持つ。
             */
            <motion.li
              key={card.uid}
              className={card.uid === drawnUid ? 'hand__drawn' : undefined}
              layout
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -18 }}
              transition={{ duration }}
              onMouseEnter={() => setHoveredUid(card.uid)}
              onMouseLeave={() => setHoveredUid(null)}
              onFocus={() => setHoveredUid(card.uid)}
              onBlur={() => setHoveredUid(null)}
            >
              <CardView
                card={card}
                memberName={nameOf(memberNameById, card.memberId)}
                imageUrl={imageUrlById.get(card.memberId)}
                groupSymbol={groupSymbolById.get(card.memberId)}
                isBonus={bonusMemberIds.includes(card.memberId)}
                isWaiting={waitingUids.has(card.uid)}
                isSelected={isSelectMode && selectedUids.has(card.uid)}
                onClick={isSelectMode ? onSelect : onDiscard}
                disabled={isCardDisabled}
                actionKind={isSelectMode ? 'select' : 'discard'}
                /*
                 * 焦点を当てた札だけがツールチップを指す。読み上げは
                 * 「今どれを見ているか」に結びついていないと意味がない。
                 */
                describedById={card.uid === hovered?.uid ? CARD_COUNTS_ID : undefined}
              />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </div>
  )
}
