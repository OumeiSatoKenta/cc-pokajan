import type { Card, Group, MemberId } from '../../engine/types'
import { MemberTile } from './MemberTile'
import { nameOf } from '../labels'

export interface BoardCenterProps {
  readonly wallCount: number
  readonly bonusMemberIds: readonly MemberId[]
  readonly activeGroups: readonly Group[]
  readonly memberNameById: ReadonlyMap<MemberId, string>
  /** 設定済みの画像。ボーナスのタイルに出す。 */
  readonly imageUrlById?: ReadonlyMap<MemberId, string>
  /** 達成状況の計算対象となる手札（自分の手札）。 */
  readonly hand: readonly Card[]
}

/**
 * 卓の中央。麻雀でいうと山と王牌の置き場にあたる。
 *
 * 「今局の登場グループ」「ボーナスメンバー」「山札残り」は判断に直結するため常時表示する。
 *
 * **各グループの構成メンバーを名前で列挙するのが要点。** グループ名と達成数
 * （`3/4` など）だけでは「あと誰を集めればいいか」が分からず、グループ役
 * （最大1800点）を狙う判断ができない。Step 4 のプレイテストで、これが無いと
 * 3カードしか成立させられず戦術の半分が死ぬことが分かった。
 */
export function BoardCenter({
  wallCount,
  bonusMemberIds,
  activeGroups,
  memberNameById,
  imageUrlById,
  hand,
}: BoardCenterProps) {
  const heldMemberIds = new Set(hand.map((card) => card.memberId))
  const bonusIds = new Set(bonusMemberIds)

  return (
    <section className="board" aria-label="場の情報">
      <dl className="board__stats">
        <div className="board__stat">
          <dt>山札</dt>
          <dd data-testid="wall-count">{wallCount}枚</dd>
        </div>
      </dl>

      {/*
        ボーナスは麻雀のドラ表示牌にあたる情報。テキストで並べると埋もれるため、
        カード型のタイルで出す。`bonusMemberCount` は可変なので複数でも並べられる。
      */}
      <div className="board__bonus" data-testid="bonus-members">
        {bonusMemberIds.map((id) => (
          <MemberTile
            key={id}
            name={nameOf(memberNameById, id)}
            imageUrl={imageUrlById?.get(id)}
            label="ボーナス"
            testId="bonus-tile"
          />
        ))}
      </div>

      <ul className="board__groups">
        {activeGroups.map((group) => {
          const held = group.memberIds.filter((id) => heldMemberIds.has(id)).length
          const complete = held === group.memberIds.length

          return (
            <li
              key={group.id}
              className={complete ? 'board__group board__group--done' : 'board__group'}
              data-testid="board-group"
            >
              <div className="board__group-head">
                <span className="board__group-name">{group.name}</span>
                <span className="board__group-count">
                  {held}/{group.memberIds.length}
                </span>
              </div>

              <ul className="board__members">
                {group.memberIds.map((id) => (
                  <li
                    key={id}
                    className={memberClass(heldMemberIds.has(id), bonusIds.has(id))}
                    data-testid="group-member"
                    data-held={heldMemberIds.has(id)}
                  >
                    {nameOf(memberNameById, id)}
                    {bonusIds.has(id) && (
                      <span className="board__member-bonus" aria-label="ボーナス">
                        ★
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function memberClass(held: boolean, bonus: boolean): string {
  const classes = ['board__member']
  if (held) {
    classes.push('board__member--held')
  }
  if (bonus) {
    classes.push('board__member--bonus')
  }
  return classes.join(' ')
}
