/**
 * 座席ごとのプレイヤー画像。
 *
 * 画像そのものは既存の IndexedDB（`src/storage/assets.ts`）に置き、
 * ここが持つのは**座席 → 画像 ID の対応だけ**。
 */

import type { PlayerId } from '../engine/types'

/**
 * 座席番号（文字列化した `PlayerId`）→ 画像 ID。
 *
 * **席名（あなた / 下家 / 対面 / 上家）をキーにしない。** 席名は `humanSeat` からの
 * 相対表示なので、そちらで持つとアバターが対局ごとに別人へ移る。
 * `seatOrientation` を相対で求めるのと対になっていて、**保存は絶対・表示は相対**にする。
 *
 * キーが `string` なのは、`Record<number, …>` を JSON にするとどのみち
 * 文字列キーになるため。`number` を名乗って往復で崩れるより正直な型にしておく。
 */
export type AvatarMap = Readonly<Record<string, string>>

export const EMPTY_AVATARS: AvatarMap = {}

/** 座席に設定された画像 ID。未設定なら `undefined`。 */
export function avatarImageIdOf(avatars: AvatarMap, playerId: PlayerId): string | undefined {
  return avatars[String(playerId)]
}

/**
 * アバターが参照している画像 ID の一覧。
 *
 * `usedImageIds`（`src/ui/rosterEditor.ts`）に合流させて、
 * 画像の掃除・書き出し・ID 採番のすべてで同じ集合を使う。
 */
export function avatarImageIds(avatars: AvatarMap): string[] {
  return Object.values(avatars)
}

/** 座席の画像を差し替える。`imageId` が `undefined` なら取り除く。 */
export function setAvatar(
  avatars: AvatarMap,
  playerId: PlayerId,
  imageId: string | undefined,
): AvatarMap {
  const next: Record<string, string> = { ...avatars }

  if (imageId === undefined) {
    delete next[String(playerId)]
  } else {
    next[String(playerId)] = imageId
  }

  return next
}

/**
 * 保存値から読み戻す。**読めなければ空、壊れた項目だけを落とす。**
 *
 * localStorage も書き出しファイルも外部入力なので、形を確かめてから使う。
 * ただし1件の破損で全体を捨てない（アバターは欠けても遊べる。
 * `rosterBundle` の `parseImages` と同じ方針）。
 */
export function parseAvatars(value: unknown): AvatarMap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return EMPTY_AVATARS
  }

  const avatars: Record<string, string> = {}

  for (const [seat, imageId] of Object.entries(value as Record<string, unknown>)) {
    if (!isSeatKey(seat) || typeof imageId !== 'string' || imageId === '') {
      continue
    }
    avatars[seat] = imageId
  }

  return avatars
}

/**
 * 座席キーとして読めるか。0 以上の整数だけを受け入れる。
 *
 * 上限は設けない。`playerCount` はルール値で可変であり、この層はルールを知らない。
 * 席数を超えるキーは**どこにも描かれない**（画面は席の数だけ引くため）ので、
 * ここで落とす必要がない。
 */
function isSeatKey(seat: string): boolean {
  const parsed = Number(seat)
  return seat !== '' && Number.isInteger(parsed) && parsed >= 0
}
