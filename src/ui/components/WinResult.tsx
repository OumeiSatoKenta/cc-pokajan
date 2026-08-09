import { motion, useReducedMotion } from 'framer-motion'

import type { MemberId, PlayerId } from '../../engine/types'
import type { WinPresentation } from '../hooks/loopReducer'
import { CardView } from './CardView'
import { WinRanking } from './WinRanking'
import { YAKU_LABELS, nameOf } from '../labels'

export interface WinResultProps {
  readonly win: WinPresentation
  readonly seatLabels: ReadonlyMap<PlayerId, string>
  readonly memberNameById: ReadonlyMap<MemberId, string>
  /** 設定済みの画像。無いメンバーは名前表示になる。 */
  readonly imageUrlById: ReadonlyMap<MemberId, string>
  /** 所属グループの記号。カードの角に出す。 */
  readonly groupSymbolById: ReadonlyMap<MemberId, string>
  readonly bonusMemberIds: readonly MemberId[]
  readonly onDismiss: () => void
}

/**
 * 和了演出の2段目。**何が起きたか**を見せる。
 *
 * 出すのは3つ。
 * 1. 役の絵札（どのカードで和了したか）
 * 2. 獲得点（いくら動いたか）
 * 3. 順位の移動（その結果どうなったか）
 *
 * **アバターは出さない。** 直前の段で見せたばかりで、この段の新しい情報は絵札と点数。
 */
export function WinResult({
  win,
  seatLabels,
  memberNameById,
  imageUrlById,
  groupSymbolById,
  bonusMemberIds,
  onDismiss,
}: WinResultProps) {
  const reduced = useReducedMotion() === true
  const name = seatLabels.get(win.playerId) ?? `P${win.playerId}`

  /*
   * 獲得点は候補の `score` ではなく**実際に動いた差分**を出す。
   * 相手が残高不足のときは徴収額が候補の点数より少なくなるため、
   * 候補の点数を出すと、すぐ下に並ぶ順位表の点数と食い違う。
   */
  const gained = (win.scoresAfter[win.playerId] ?? 0) - (win.scoresBefore[win.playerId] ?? 0)

  return (
    <motion.div
      className="win-result"
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: reduced ? 0 : 0.24 }}
      data-testid="win-result"
    >
      <p className="win-result__yaku" data-testid="win-yaku">
        <span className="win-result__who">{name}</span>
        {YAKU_LABELS[win.candidate.kind]}
        {win.candidate.sameColor && <span className="tag">同色</span>}
        {/*
          `.card--small` は BONUS の帯を隠す（App.css）ため、
          絵札を見てもボーナスが効いているか分からない。点数の内訳として文字で出す。
        */}
        {win.candidate.bonusCount > 0 && (
          <span className="win-result__bonus" data-testid="win-bonus">
            ボーナス×{win.candidate.bonusCount}
          </span>
        )}
      </p>

      {/*
        役の構成カード。**`MemberTile` ではなく `CardView` を使う。**
        同色役かどうかが色で分かることに意味がある。
      */}
      <ul className="win-result__cards" data-testid="win-cards">
        {win.candidate.cards.map((card) => (
          <li key={card.uid}>
            <CardView
              card={card}
              memberName={nameOf(memberNameById, card.memberId)}
              imageUrl={imageUrlById.get(card.memberId)}
              groupSymbol={groupSymbolById.get(card.memberId)}
              isBonus={bonusMemberIds.includes(card.memberId)}
              size="small"
              testId="win-card"
            />
          </li>
        ))}
      </ul>

      <motion.p
        className="win-result__score"
        initial={reduced ? false : { opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: reduced ? 0 : 0.3, delay: reduced ? 0 : 0.1 }}
        data-testid="win-score"
      >
        +{gained.toLocaleString('ja-JP')}
      </motion.p>

      <WinRanking
        scoresBefore={win.scoresBefore}
        scoresAfter={win.scoresAfter}
        seatLabels={seatLabels}
        winnerId={win.playerId}
      />

      {/*
        自動で閉じるので、このボタンは「早く進めたい人のための出口」。
        **`onDismiss` はオーバーレイ側のクリックとも競合するが、
        `DISMISS_WIN` が鍵で照合するため二重に落ちることはない。**
      */}
      <button
        type="button"
        className="button button--primary"
        onClick={onDismiss}
        data-testid="dismiss-win"
      >
        閉じる
      </button>
    </motion.div>
  )
}
