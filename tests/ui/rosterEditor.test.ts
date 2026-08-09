import { describe, expect, it } from 'vitest'

import {
  nextId,
  rosterReducer,
  unassignedMembers,
  usedImageIds,
  type RosterAction,
} from '../../src/ui/rosterEditor'
import { EMPTY_AVATARS, setAvatar } from '../../src/ui/avatars'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import type { Roster } from '../../src/engine/types'

function roster(overrides: Partial<Roster> = {}): Roster {
  return {
    version: 1,
    members: [
      { id: 'mem_1', name: 'あ' },
      { id: 'mem_2', name: 'い' },
      { id: 'mem_3', name: 'う' },
    ],
    groups: [
      { id: 'grp_1', name: 'A組', memberIds: ['mem_1', 'mem_2'] },
      { id: 'grp_2', name: 'B組', memberIds: ['mem_3'] },
    ],
    ...overrides,
  }
}

function groupOf(state: Roster, memberId: string): string | null {
  return state.groups.find((group) => group.memberIds.includes(memberId))?.id ?? null
}

describe('グループの編集', () => {
  it('追加すると空のグループが増える', () => {
    const next = rosterReducer(roster(), { type: 'ADD_GROUP' })

    expect(next.groups).toHaveLength(3)
    expect(next.groups[2].memberIds).toEqual([])
  })

  it('追加したグループの ID は既存と衝突しない', () => {
    const next = rosterReducer(roster(), { type: 'ADD_GROUP' })
    const ids = next.groups.map((group) => group.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('リネームできる', () => {
    const next = rosterReducer(roster(), { type: 'RENAME_GROUP', groupId: 'grp_1', name: '新A組' })

    expect(next.groups[0].name).toBe('新A組')
  })

  /** 名前と画像を作り直させないため、グループを消してもメンバーは残す。 */
  it('削除してもメンバーは残る（未所属になる）', () => {
    const next = rosterReducer(roster(), { type: 'DELETE_GROUP', groupId: 'grp_1' })

    expect(next.groups).toHaveLength(1)
    expect(next.members).toHaveLength(3)
    expect(unassignedMembers(next).map((m) => m.id)).toEqual(['mem_1', 'mem_2'])
  })

  it('存在しないグループへの操作は何も変えない', () => {
    const before = roster()
    const next = rosterReducer(before, { type: 'RENAME_GROUP', groupId: 'nope', name: 'x' })

    expect(next.groups).toEqual(before.groups)
  })
})

describe('メンバーの編集', () => {
  it('グループを指定して追加すると、そのグループに入る', () => {
    const next = rosterReducer(roster(), { type: 'ADD_MEMBER', groupId: 'grp_2' })
    const added = next.members[next.members.length - 1]

    expect(groupOf(next, added.id)).toBe('grp_2')
  })

  it('グループ未指定で追加すると未所属になる', () => {
    const next = rosterReducer(roster(), { type: 'ADD_MEMBER', groupId: null })
    const added = next.members[next.members.length - 1]

    expect(groupOf(next, added.id)).toBeNull()
  })

  it('リネームできる', () => {
    const next = rosterReducer(roster(), { type: 'RENAME_MEMBER', memberId: 'mem_1', name: 'A' })

    expect(next.members[0].name).toBe('A')
  })

  /** 消し忘れると、存在しないメンバーを参照するグループが残って対局が落ちる。 */
  it('削除すると所属していたグループからも取り除かれる', () => {
    const next = rosterReducer(roster(), { type: 'DELETE_MEMBER', memberId: 'mem_1' })

    expect(next.members.map((m) => m.id)).toEqual(['mem_2', 'mem_3'])
    expect(next.groups[0].memberIds).toEqual(['mem_2'])
    expect(next.groups.flatMap((g) => g.memberIds)).not.toContain('mem_1')
  })
})

describe('所属の変更', () => {
  /**
   * 同じメンバーが複数グループに属すると、そのメンバーの3カードが
   * 2つのグループ役に同時に寄与し、役判定が意図しない重複候補を返す。
   */
  it('別のグループへ移すと元のグループからは外れる', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_MEMBER_GROUP',
      memberId: 'mem_1',
      groupId: 'grp_2',
    })

    expect(next.groups[0].memberIds).toEqual(['mem_2'])
    expect(next.groups[1].memberIds).toEqual(['mem_3', 'mem_1'])
  })

  it('どのグループにも二重に所属しない', () => {
    let state = roster()
    for (const groupId of ['grp_2', 'grp_1', 'grp_2', 'grp_1']) {
      state = rosterReducer(state, { type: 'SET_MEMBER_GROUP', memberId: 'mem_1', groupId })
    }

    const appearances = state.groups.filter((g) => g.memberIds.includes('mem_1'))
    expect(appearances).toHaveLength(1)
  })

  it('null を指定すると未所属になる', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_MEMBER_GROUP',
      memberId: 'mem_1',
      groupId: null,
    })

    expect(groupOf(next, 'mem_1')).toBeNull()
  })

  it('同じグループへ再度入れても重複しない', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_MEMBER_GROUP',
      memberId: 'mem_1',
      groupId: 'grp_1',
    })

    expect(next.groups[0].memberIds.filter((id) => id === 'mem_1')).toHaveLength(1)
  })
})

describe('画像の割り当て', () => {
  it('画像 ID を設定できる', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_MEMBER_IMAGE',
      memberId: 'mem_1',
      imageId: 'img_1',
    })

    expect(next.members[0].imageId).toBe('img_1')
  })

  /** `imageId: undefined` をキーとして残すと、書き出した JSON に無駄が残る。 */
  it('undefined を渡すとキーごと消える', () => {
    const withImage = rosterReducer(roster(), {
      type: 'SET_MEMBER_IMAGE',
      memberId: 'mem_1',
      imageId: 'img_1',
    })
    const cleared = rosterReducer(withImage, {
      type: 'SET_MEMBER_IMAGE',
      memberId: 'mem_1',
      imageId: undefined,
    })

    expect('imageId' in cleared.members[0]).toBe(false)
  })

  it('使用中の画像 ID を列挙できる', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_MEMBER_IMAGE',
      memberId: 'mem_2',
      imageId: 'img_9',
    })

    expect(usedImageIds(next, EMPTY_AVATARS)).toEqual(['img_9'])
  })

  /**
   * **アバターを取りこぼすと画像が消える。**
   *
   * この一覧は `pruneImages`（渡された ID 以外を削除）にそのまま渡される。
   * ロスターぶんしか返さないと、ロスターを保存しただけで全アバターが消える。
   */
  it('アバターが参照する画像も含む', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_MEMBER_IMAGE',
      memberId: 'mem_2',
      imageId: 'img_9',
    })
    const avatars = setAvatar(setAvatar(EMPTY_AVATARS, 0, 'avt_1'), 2, 'avt_2')

    expect(usedImageIds(next, avatars).sort()).toEqual(['avt_1', 'avt_2', 'img_9'])
  })

  it('ロスターに画像が無くてもアバターだけ返せる', () => {
    expect(usedImageIds(roster(), setAvatar(EMPTY_AVATARS, 1, 'avt_1'))).toEqual(['avt_1'])
  })
})

describe('リデューサの性質', () => {
  it('入力を破壊しない', () => {
    const before = roster()
    const snapshot = structuredClone(before)

    rosterReducer(before, { type: 'DELETE_MEMBER', memberId: 'mem_1' })
    rosterReducer(before, { type: 'ADD_GROUP' })

    expect(before).toEqual(snapshot)
  })

  it('REPLACE で丸ごと差し替えられる', () => {
    const next = rosterReducer(roster(), { type: 'REPLACE', roster: DEFAULT_ROSTER })

    expect(next).toBe(DEFAULT_ROSTER)
  })

  it('未知のアクションは黙って無視されず例外になる', () => {
    const unknown = { type: 'EXPLODE' } as unknown as RosterAction

    expect(() => rosterReducer(roster(), unknown)).toThrow(/未知のロスター編集アクション/)
  })

  /**
   * 編集の途中は不正でよい（グループを作った直後は0人）。
   * 保存できるかは `validateRoster` が別に判定する。
   */
  it('不正な状態も作れる（検証はリデューサの責務ではない）', () => {
    const next = rosterReducer(roster(), { type: 'ADD_GROUP' })

    expect(next.groups[2].memberIds).toEqual([])
  })
})

describe('nextId', () => {
  /**
   * 件数から採番すると、途中を消して追加したときに既存 ID とぶつかる。
   * 同じ ID のメンバーが2人いると、グループの参照がどちらを指すか決まらない。
   */
  it('空いている番号を使い、既存と衝突しない', () => {
    expect(nextId('mem', ['mem_1', 'mem_3'])).toBe('mem_2')
    expect(nextId('mem', ['mem_1', 'mem_2'])).toBe('mem_3')
    expect(nextId('mem', [])).toBe('mem_1')
  })

  it('削除してから追加しても衝突しない', () => {
    let state = roster()
    state = rosterReducer(state, { type: 'DELETE_MEMBER', memberId: 'mem_2' })
    state = rosterReducer(state, { type: 'ADD_MEMBER', groupId: null })

    const ids = state.members.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('無関係な ID は無視する', () => {
    expect(nextId('grp', ['mem_1', 'mem_2'])).toBe('grp_1')
  })
})

describe('unassignedMembers', () => {
  it('どのグループにも属さないメンバーを返す', () => {
    const next = rosterReducer(roster(), { type: 'ADD_MEMBER', groupId: null })

    expect(unassignedMembers(next)).toHaveLength(1)
  })

  it('全員が所属していれば空', () => {
    expect(unassignedMembers(roster())).toEqual([])
  })

  it('同梱ロスターは全員が所属している', () => {
    expect(unassignedMembers(DEFAULT_ROSTER)).toEqual([])
  })
})

describe('グループの記号', () => {
  it('記号を設定できる', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_GROUP_SYMBOL',
      groupId: 'grp_1',
      symbol: '★',
    })

    expect(next.groups[0].symbol).toBe('★')
  })

  /**
   * 空文字を保存すると、名前を変えても角の表示が空白のまま追随しなくなる。
   * 未設定に戻して名前からの導出に任せる。
   */
  it('空文字を設定するとキーごと消える', () => {
    const set = rosterReducer(roster(), {
      type: 'SET_GROUP_SYMBOL',
      groupId: 'grp_1',
      symbol: '★',
    })
    const cleared = rosterReducer(set, {
      type: 'SET_GROUP_SYMBOL',
      groupId: 'grp_1',
      symbol: '',
    })

    expect('symbol' in cleared.groups[0]).toBe(false)
  })

  it('空白だけでも未設定に戻る', () => {
    const set = rosterReducer(roster(), {
      type: 'SET_GROUP_SYMBOL',
      groupId: 'grp_1',
      symbol: '★',
    })
    const cleared = rosterReducer(set, {
      type: 'SET_GROUP_SYMBOL',
      groupId: 'grp_1',
      symbol: '  ',
    })

    expect('symbol' in cleared.groups[0]).toBe(false)
  })

  it('他のグループの記号は変わらない', () => {
    const next = rosterReducer(roster(), {
      type: 'SET_GROUP_SYMBOL',
      groupId: 'grp_1',
      symbol: '★',
    })

    expect('symbol' in next.groups[1]).toBe(false)
  })
})
