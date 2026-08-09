/**
 * ロスター編集の純粋ロジック。
 *
 * `createLoopReducer` / `createAppReducer` と同じくリデューサの形にそろえる。
 *
 * **リデューサは妥当性を検査しない。** 編集の途中は一時的に不正になる
 * （グループを作った直後は0人）。保存できるかは `validateRoster` が別に判定する。
 * 「編集できない」と「保存できない」を混同すると、作りかけの状態を作れなくなる。
 */

import type { GroupId, MemberId, Roster } from '../engine/types'
import { avatarImageIds, type AvatarMap } from './avatars'

export type RosterAction =
  | { readonly type: 'ADD_GROUP' }
  | { readonly type: 'RENAME_GROUP'; readonly groupId: GroupId; readonly name: string }
  | { readonly type: 'DELETE_GROUP'; readonly groupId: GroupId }
  | {
      readonly type: 'SET_GROUP_SYMBOL'
      readonly groupId: GroupId
      readonly symbol: string
    }
  | { readonly type: 'ADD_MEMBER'; readonly groupId: GroupId | null }
  | { readonly type: 'RENAME_MEMBER'; readonly memberId: MemberId; readonly name: string }
  | { readonly type: 'DELETE_MEMBER'; readonly memberId: MemberId }
  | {
      readonly type: 'SET_MEMBER_GROUP'
      readonly memberId: MemberId
      readonly groupId: GroupId | null
    }
  | {
      readonly type: 'SET_MEMBER_IMAGE'
      readonly memberId: MemberId
      readonly imageId: string | undefined
    }
  | { readonly type: 'REPLACE'; readonly roster: Roster }

export function rosterReducer(roster: Roster, action: RosterAction): Roster {
  switch (action.type) {
    case 'ADD_GROUP': {
      const id = nextId(
        'grp',
        roster.groups.map((group) => group.id),
      )
      return {
        ...roster,
        groups: [
          ...roster.groups,
          { id, name: `新しいグループ${roster.groups.length + 1}`, memberIds: [] },
        ],
      }
    }

    case 'RENAME_GROUP':
      return {
        ...roster,
        groups: roster.groups.map((group) =>
          group.id === action.groupId ? { ...group, name: action.name } : group,
        ),
      }

    /**
     * 記号は**空文字なら未設定に戻す**。空のまま持たせると、
     * 名前を変えても角の表示が空白のまま追随しなくなる。
     */
    case 'SET_GROUP_SYMBOL':
      return {
        ...roster,
        groups: roster.groups.map((group) =>
          group.id === action.groupId ? withSymbol(group, action.symbol) : group,
        ),
      }

    /**
     * グループを消してもメンバーは残す。
     * 名前と画像を作り直させないため。所属なしのメンバーは警告になるだけで、
     * 別のグループへ入れ直せる。
     */
    case 'DELETE_GROUP':
      return { ...roster, groups: roster.groups.filter((group) => group.id !== action.groupId) }

    case 'ADD_MEMBER': {
      const id = nextId(
        'mem',
        roster.members.map((member) => member.id),
      )
      const member = { id, name: `新しいメンバー${roster.members.length + 1}` }
      const added = { ...roster, members: [...roster.members, member] }

      return action.groupId === null ? added : assignToGroup(added, id, action.groupId)
    }

    case 'RENAME_MEMBER':
      return {
        ...roster,
        members: roster.members.map((member) =>
          member.id === action.memberId ? { ...member, name: action.name } : member,
        ),
      }

    /** メンバーを消したら、所属していたグループからも必ず取り除く。 */
    case 'DELETE_MEMBER':
      return {
        ...roster,
        members: roster.members.filter((member) => member.id !== action.memberId),
        groups: roster.groups.map((group) => ({
          ...group,
          memberIds: group.memberIds.filter((id) => id !== action.memberId),
        })),
      }

    case 'SET_MEMBER_GROUP':
      return action.groupId === null
        ? detachFromGroups(roster, action.memberId)
        : assignToGroup(roster, action.memberId, action.groupId)

    case 'SET_MEMBER_IMAGE':
      return {
        ...roster,
        members: roster.members.map((member) =>
          member.id === action.memberId ? withImage(member, action.imageId) : member,
        ),
      }

    case 'REPLACE':
      return action.roster

    default: {
      const exhaustive: never = action
      throw new Error(`未知のロスター編集アクションです: ${JSON.stringify(exhaustive)}`)
    }
  }
}

/**
 * メンバーを1つのグループにだけ所属させる。
 *
 * **必ず他のグループから外してから追加する。** 同じメンバーが複数グループに属すると、
 * そのメンバーの3カードが2つのグループ役に同時に寄与し、
 * `findYaku` が意図しない重複候補を返す。
 */
function assignToGroup(roster: Roster, memberId: MemberId, groupId: GroupId): Roster {
  const detached = detachFromGroups(roster, memberId)

  return {
    ...detached,
    groups: detached.groups.map((group) =>
      group.id === groupId ? { ...group, memberIds: [...group.memberIds, memberId] } : group,
    ),
  }
}

function detachFromGroups(roster: Roster, memberId: MemberId): Roster {
  return {
    ...roster,
    groups: roster.groups.map((group) => ({
      ...group,
      memberIds: group.memberIds.filter((id) => id !== memberId),
    })),
  }
}

/** 記号は未設定のときキーごと落とす。空文字を保存しない。 */
function withSymbol(group: Roster['groups'][number], symbol: string): Roster['groups'][number] {
  if (symbol.trim() === '') {
    const { symbol: _removed, ...rest } = group
    return rest
  }
  return { ...group, symbol }
}

/** `imageId` は未設定のときキーごと落とす（`undefined` を持ち回らない）。 */
function withImage(
  member: Roster['members'][number],
  imageId: string | undefined,
): Roster['members'][number] {
  if (imageId === undefined) {
    const { imageId: _removed, ...rest } = member
    return rest
  }
  return { ...member, imageId }
}

/**
 * 既存と衝突しない ID を作る。
 *
 * 件数から採番すると、削除して追加したときに既存 ID とぶつかる
 * （3人中2人目を消して追加すると `mem_3` が二重になる）。
 * 空いている番号を探すことで、削除と追加の順序に依存しなくなる。
 */
export function nextId(prefix: string, existing: readonly string[]): string {
  const used = new Set(existing)

  for (let n = 1; ; n++) {
    const candidate = `${prefix}_${n}`
    if (!used.has(candidate)) {
      return candidate
    }
  }
}

/**
 * **画像を参照しうるものを全部数えた** ID の一覧。
 *
 * 使われなくなった画像の掃除・書き出しの収集・新しい ID の採番が、いずれも
 * この集合を必要とする。ロスターだけを数えると次の3つが同時に壊れる。
 *
 * - `pruneImages` が**アバターを全部消す**（渡された ID 以外を削除するため）
 * - `nextId` がアバターの ID と衝突し、**別人の画像を上書きする**
 * - 書き出しファイルにアバターの画像が入らない
 *
 * **`avatars` を必須の引数にしているのはそのため。** 省略可能にすると、
 * 呼び忘れても型が通ってしまい、上の3つが静かに再発する。
 * 画像の持ち主が今後さらに増えたときも、ここに引数を足せば全呼び出しが型エラーになる。
 */
export function usedImageIds(roster: Roster, avatars: AvatarMap): string[] {
  const fromRoster = roster.members
    .map((member) => member.imageId)
    .filter((id): id is string => id !== undefined)

  return [...fromRoster, ...avatarImageIds(avatars)]
}

/** どのグループにも属していないメンバー。画面の「未所属」欄に出す。 */
export function unassignedMembers(roster: Roster): readonly Roster['members'][number][] {
  const assigned = new Set(roster.groups.flatMap((group) => group.memberIds))
  return roster.members.filter((member) => !assigned.has(member.id))
}
