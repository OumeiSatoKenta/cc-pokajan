import { describe, expect, it } from 'vitest'

import {
  avatarImageIdOf,
  avatarImageIds,
  EMPTY_AVATARS,
  parseAvatars,
  setAvatar,
} from '../../src/ui/avatars'

describe('parseAvatars', () => {
  it('正しい形はそのまま読める', () => {
    expect(parseAvatars({ '0': 'img_1', '2': 'img_3' })).toEqual({ '0': 'img_1', '2': 'img_3' })
  })

  /** localStorage も書き出しファイルも外部入力。壊れていても落ちてはいけない。 */
  it('レコードでなければ空になる', () => {
    for (const value of [null, undefined, 42, 'x', [], [['0', 'img_1']]]) {
      expect(parseAvatars(value), JSON.stringify(value)).toEqual(EMPTY_AVATARS)
    }
  })

  /**
   * **1件の破損で全体を捨てない。** アバターは欠けても遊べるので、
   * 壊れた席だけを落として残りは活かす。
   */
  it('壊れた項目だけを落とす', () => {
    const parsed = parseAvatars({
      '0': 'img_1',
      '1': 42, // 値が文字列でない
      '2': '', // 空文字
      x: 'img_9', // 座席番号として読めない
      '-1': 'img_8', // 負の座席
      '1.5': 'img_7', // 整数でない
      '3': 'img_4',
    })

    expect(parsed).toEqual({ '0': 'img_1', '3': 'img_4' })
  })

  /**
   * 席数の上限は設けない。`playerCount` はルール値で可変であり、
   * この層はルールを知らない。描かれないだけで害がない。
   */
  it('席数を超えるキーも落とさない', () => {
    expect(parseAvatars({ '9': 'img_1' })).toEqual({ '9': 'img_1' })
  })
})

describe('setAvatar', () => {
  it('設定と差し替えができる', () => {
    const one = setAvatar(EMPTY_AVATARS, 0, 'img_1')
    const two = setAvatar(one, 0, 'img_2')

    expect(one).toEqual({ '0': 'img_1' })
    expect(two).toEqual({ '0': 'img_2' })
  })

  it('undefined を渡すと取り除かれる', () => {
    const set = setAvatar(setAvatar(EMPTY_AVATARS, 0, 'img_1'), 1, 'img_2')

    expect(setAvatar(set, 0, undefined)).toEqual({ '1': 'img_2' })
  })

  /** 元の値を書き換えない（React の state として持つため）。 */
  it('元のオブジェクトを変更しない', () => {
    const original = setAvatar(EMPTY_AVATARS, 0, 'img_1')
    setAvatar(original, 1, 'img_2')

    expect(original).toEqual({ '0': 'img_1' })
  })
})

describe('avatarImageIdOf / avatarImageIds', () => {
  const avatars = setAvatar(setAvatar(EMPTY_AVATARS, 0, 'img_1'), 2, 'img_3')

  it('座席から画像 ID を引ける', () => {
    expect(avatarImageIdOf(avatars, 0)).toBe('img_1')
    expect(avatarImageIdOf(avatars, 2)).toBe('img_3')
    expect(avatarImageIdOf(avatars, 1)).toBeUndefined()
  })

  /** 画像の掃除・書き出し・ID 採番がこの一覧を使う。取りこぼすと画像が消える。 */
  it('参照している画像 ID を全て返す', () => {
    expect(avatarImageIds(avatars).sort()).toEqual(['img_1', 'img_3'])
    expect(avatarImageIds(EMPTY_AVATARS)).toEqual([])
  })
})
