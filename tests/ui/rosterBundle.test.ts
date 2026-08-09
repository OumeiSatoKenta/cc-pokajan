import { describe, expect, it } from 'vitest'

import {
  BUNDLE_FORMAT,
  buildBundle,
  bundleByteSize,
  formatByteSize,
  parseBundle,
} from '../../src/ui/rosterBundle'
import { EMPTY_AVATARS } from '../../src/ui/avatars'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'

const IMAGE = 'data:image/webp;base64,AAAA'

describe('書き出しと読み込みの往復', () => {
  it('ロスターがそのまま復元される', () => {
    const json = buildBundle(DEFAULT_ROSTER, {}, EMPTY_AVATARS)
    const result = parseBundle(json)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.bundle.roster).toEqual(DEFAULT_ROSTER)
    }
  })

  it('画像も復元される', () => {
    const json = buildBundle(DEFAULT_ROSTER, { img_1: IMAGE }, EMPTY_AVATARS)
    const result = parseBundle(json)

    expect(result.ok && result.bundle.images).toEqual({ img_1: IMAGE })
  })

  it('imageId や accent を落とさない', () => {
    const roster = {
      version: 1,
      members: [{ id: 'm1', name: 'あ', imageId: 'img_1', accent: '#fff' }],
      groups: [{ id: 'g1', name: 'A', memberIds: ['m1'] }],
    }
    const result = parseBundle(buildBundle(roster, {}, EMPTY_AVATARS))

    expect(result.ok && result.bundle.roster).toEqual(roster)
  })

  it('書き出した JSON は人が読める形になっている', () => {
    expect(buildBundle(DEFAULT_ROSTER, {}, EMPTY_AVATARS)).toContain('\n')
  })
})

describe('アバター', () => {
  const AVATARS = { '0': 'avt_1', '2': 'avt_2' }

  it('アバターが往復で保たれる', () => {
    const result = parseBundle(buildBundle(DEFAULT_ROSTER, { avt_1: IMAGE }, AVATARS))

    expect(result.ok && result.bundle.avatars).toEqual(AVATARS)
    expect(result.ok && result.bundle.images).toEqual({ avt_1: IMAGE })
  })

  /**
   * **旧形式との互換。** `BUNDLE_VERSION` を上げずに `avatars` を足しているので、
   * これを持たないファイル（Step 6 までに書き出したもの）はそのまま読めなければならない。
   * 上げると読めなくなるファイルが増えるだけで、得るものが無い。
   */
  it('avatars を持たないファイルも読める', () => {
    const json = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      roster: DEFAULT_ROSTER,
      images: {},
    })
    const result = parseBundle(json)

    expect(result.ok).toBe(true)
    expect(result.ok && result.bundle.avatars).toEqual({})
  })

  /** 壊れた項目だけを落とす（1席の破損で全体を捨てない）。 */
  it('壊れたアバターの項目は落とす', () => {
    const json = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      roster: DEFAULT_ROSTER,
      images: {},
      avatars: { '0': 'avt_1', '1': 42, x: 'avt_9' },
    })
    const result = parseBundle(json)

    expect(result.ok && result.bundle.avatars).toEqual({ '0': 'avt_1' })
  })

  it('アバターが配列でも落ちない', () => {
    const json = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      roster: DEFAULT_ROSTER,
      images: {},
      avatars: ['avt_1'],
    })
    const result = parseBundle(json)

    expect(result.ok && result.bundle.avatars).toEqual({})
  })
})

describe('形式の判定', () => {
  /**
   * `format` を確かめないと、別アプリの JSON に「たまたま roster というキーがある」
   * だけで一部を取り込んでしまう。読み込みは既存データを置き換える操作なので、
   * 自分が書いたファイルかをまず確定させる。
   */
  it('format が違うファイルは受け付けない', () => {
    const alien = JSON.stringify({
      format: 'other-app',
      version: 1,
      roster: DEFAULT_ROSTER,
      images: {},
    })
    const result = parseBundle(alien)

    expect(result.ok).toBe(false)
  })

  it('format が無いファイルは受け付けない', () => {
    const result = parseBundle(JSON.stringify({ roster: DEFAULT_ROSTER }))

    expect(result.ok).toBe(false)
  })

  it('対応していないバージョンは受け付けない', () => {
    const future = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 99,
      roster: DEFAULT_ROSTER,
      images: {},
    })

    expect(parseBundle(future).ok).toBe(false)
  })
})

describe('壊れた入力', () => {
  function errorsOf(json: string): readonly string[] {
    const result = parseBundle(json)
    return result.ok ? [] : result.errors
  }

  it('JSON として読めなければ理由を返す', () => {
    expect(errorsOf('{ 壊れている').length).toBeGreaterThan(0)
  })

  it('配列や文字列を渡しても落ちない', () => {
    expect(() => parseBundle('[]')).not.toThrow()
    expect(() => parseBundle('"文字列"')).not.toThrow()
    expect(() => parseBundle('null')).not.toThrow()
    expect(parseBundle('[]').ok).toBe(false)
  })

  it('roster が無ければ受け付けない', () => {
    const json = JSON.stringify({ format: BUNDLE_FORMAT, version: 1, images: {} })

    expect(parseBundle(json).ok).toBe(false)
  })

  it('メンバーの形が違えば受け付けない', () => {
    const json = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      roster: { version: 1, members: [{ id: 1, name: 'あ' }], groups: [] },
      images: {},
    })

    expect(parseBundle(json).ok).toBe(false)
  })

  it('グループの memberIds が文字列配列でなければ受け付けない', () => {
    const json = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      roster: { version: 1, members: [], groups: [{ id: 'g', name: 'A', memberIds: [1, 2] }] },
      images: {},
    })

    expect(parseBundle(json).ok).toBe(false)
  })

  /** 1枚の欠けで全体を捨てると、ほぼ復元できるファイルが使えなくなる。 */
  it('壊れた画像だけを落として残りは活かす', () => {
    const json = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      roster: DEFAULT_ROSTER,
      images: { good: IMAGE, bad: 12345, alsoBad: 'http://example.com/x.png' },
    })
    const result = parseBundle(json)

    expect(result.ok && Object.keys(result.bundle.images)).toEqual(['good'])
  })

  it('images が無くても読める', () => {
    const json = JSON.stringify({ format: BUNDLE_FORMAT, version: 1, roster: DEFAULT_ROSTER })
    const result = parseBundle(json)

    expect(result.ok && result.bundle.images).toEqual({})
  })
})

describe('ファイルサイズの表示', () => {
  it('バイト数を数える', () => {
    expect(bundleByteSize('abc')).toBe(3)
    // 日本語は UTF-8 で3バイト
    expect(bundleByteSize('あ')).toBe(3)
  })

  it('単位を切り替える', () => {
    expect(formatByteSize(512)).toBe('512 B')
    expect(formatByteSize(2048)).toBe('2.0 KB')
    expect(formatByteSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('境界で単位が切り替わる', () => {
    expect(formatByteSize(1023)).toContain('B')
    expect(formatByteSize(1024)).toContain('KB')
    expect(formatByteSize(1024 * 1024 - 1)).toContain('KB')
    expect(formatByteSize(1024 * 1024)).toContain('MB')
  })
})

describe('グループの記号', () => {
  it('記号が往復で保たれる', () => {
    const roster = {
      version: 1,
      members: [{ id: 'm1', name: 'あ' }],
      groups: [{ id: 'g1', name: 'A組', symbol: '★', memberIds: ['m1'] }],
    }
    const result = parseBundle(buildBundle(roster, {}, EMPTY_AVATARS))

    expect(result.ok && result.bundle.roster.groups[0].symbol).toBe('★')
  })

  it('記号が無いロスターも読める（旧形式との互換）', () => {
    const roster = {
      version: 1,
      members: [{ id: 'm1', name: 'あ' }],
      groups: [{ id: 'g1', name: 'A組', memberIds: ['m1'] }],
    }
    const result = parseBundle(buildBundle(roster, {}, EMPTY_AVATARS))

    expect(result.ok && 'symbol' in result.bundle.roster.groups[0]).toBe(false)
  })

  it('記号が文字列でなければ落とす', () => {
    const json = JSON.stringify({
      format: BUNDLE_FORMAT,
      version: 1,
      roster: {
        version: 1,
        members: [],
        groups: [{ id: 'g', name: 'A', memberIds: [], symbol: 42 }],
      },
      images: {},
    })
    const result = parseBundle(json)

    expect(result.ok && 'symbol' in result.bundle.roster.groups[0]).toBe(false)
  })
})
