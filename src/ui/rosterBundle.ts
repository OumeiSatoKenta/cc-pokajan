/**
 * ロスターの書き出し・読み込み。
 *
 * 画像を含めて1ファイルで受け渡せるようにする。依存ライブラリは追加しない。
 * Blob ↔ data URL の変換は呼び出し側（DOM 層）が行い、ここは組み立てと検査だけを持つ。
 */

import type { Roster } from '../engine/types'
import { parseAvatars, type AvatarMap } from './avatars'

/** 自分の形式であることを示す印。 */
export const BUNDLE_FORMAT = 'cc-pokajan.roster'
export const BUNDLE_VERSION = 1

export interface RosterBundle {
  readonly format: typeof BUNDLE_FORMAT
  readonly version: number
  readonly roster: Roster
  /** imageId → data URL。ロスターの画像とアバターの画像を同じ対応表に入れる。 */
  readonly images: Readonly<Record<string, string>>
  /**
   * 座席 → 画像 ID。
   *
   * **省略可能。** `BUNDLE_VERSION` を上げずに足しているので、
   * これを持たない既存の書き出しファイルはそのまま読める（空として扱う）。
   */
  readonly avatars: AvatarMap
}

export type ParseResult =
  | { readonly ok: true; readonly bundle: RosterBundle }
  | { readonly ok: false; readonly errors: readonly string[] }

export function buildBundle(
  roster: Roster,
  images: Readonly<Record<string, string>>,
  avatars: AvatarMap,
): string {
  const bundle: RosterBundle = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    roster,
    images,
    avatars,
  }

  return JSON.stringify(bundle, null, 2)
}

/**
 * 書き出したファイルを読み戻す。
 *
 * **`format` を確かめてから中身を見る。** これが無いと、別アプリの JSON を
 * 読み込んだときに「たまたま `roster` というキーがある」だけで
 * 一部を取り込んでしまう。読み込みは既存のデータを置き換える操作なので、
 * 「自分が書いたファイルか」をまず確定させる。
 */
export function parseBundle(json: string): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, errors: ['ファイルの形式が正しくありません（JSON として読めません）'] }
  }

  if (!isRecord(parsed)) {
    return { ok: false, errors: ['ファイルの形式が正しくありません'] }
  }
  if (parsed.format !== BUNDLE_FORMAT) {
    return {
      ok: false,
      errors: ['このファイルはポカジャンのロスターではありません'],
    }
  }
  if (parsed.version !== BUNDLE_VERSION) {
    return {
      ok: false,
      errors: [`対応していないバージョンです: ${String(parsed.version)}`],
    }
  }

  const roster = parseRoster(parsed.roster)
  if (roster === null) {
    return { ok: false, errors: ['ロスターの内容が壊れています'] }
  }

  return {
    ok: true,
    bundle: {
      format: BUNDLE_FORMAT,
      version: BUNDLE_VERSION,
      roster,
      images: parseImages(parsed.images),
      // 旧形式（`avatars` なし）は空として読む。読めなくなるファイルを増やさない。
      avatars: parseAvatars(parsed.avatars),
    },
  }
}

/**
 * ロスターの**形**だけを確かめる。
 *
 * 妥当性（グループ数・人数・プール枚数）は `validateRoster` の仕事なので、
 * ここでは「型として読めるか」に絞る。両方をここでやると、
 * ルール値に依存する判断がこの層に紛れ込む。
 */
function parseRoster(value: unknown): Roster | null {
  if (!isRecord(value) || !Array.isArray(value.members) || !Array.isArray(value.groups)) {
    return null
  }

  const members = value.members.map(parseMember)
  const groups = value.groups.map(parseGroup)

  if (members.includes(null) || groups.includes(null)) {
    return null
  }

  return {
    version: typeof value.version === 'number' ? value.version : 1,
    members: members as NonNullable<(typeof members)[number]>[],
    groups: groups as NonNullable<(typeof groups)[number]>[],
  }
}

function parseMember(value: unknown): Roster['members'][number] | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    ...(typeof value.imageId === 'string' ? { imageId: value.imageId } : {}),
    ...(typeof value.accent === 'string' ? { accent: value.accent } : {}),
  }
}

function parseGroup(value: unknown): Roster['groups'][number] | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.memberIds) ||
    !value.memberIds.every((id): id is string => typeof id === 'string')
  ) {
    return null
  }

  return {
    id: value.id,
    name: value.name,
    memberIds: value.memberIds,
    ...(typeof value.symbol === 'string' ? { symbol: value.symbol } : {}),
  }
}

/** 画像は壊れている項目だけを落とす（1枚の欠けで全体を捨てない）。 */
function parseImages(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {}
  }

  const images: Record<string, string> = {}
  for (const [id, dataUrl] of Object.entries(value)) {
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      images[id] = dataUrl
    }
  }

  return images
}

/** 書き出しファイルのおおよそのサイズ（バイト）。画面に目安として出す。 */
export function bundleByteSize(json: string): number {
  return new TextEncoder().encode(json).length
}

/** バイト数を読みやすい単位にする。 */
export function formatByteSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
