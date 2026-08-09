/**
 * 画面に出す日本語ラベル。
 *
 * 複数のコンポーネントが同じ対応表を必要とするため1箇所にまとめる。
 * コンポーネントのファイルから export すると Fast Refresh が効かなくなる事情もある。
 */

import type { ColorId, GameOverReason, Group, MemberId, YakuKind } from '../engine/types'

export const COLOR_LABELS: Record<ColorId, string> = {
  pink: 'ピンク',
  blue: '青',
  orange: 'オレンジ',
}

export const YAKU_LABELS: Record<YakuKind, string> = {
  triple: '3カード',
  group3: '3人組',
  group4: '4人組',
  group5: '5人組',
}

export const REASON_LABELS: Record<GameOverReason, string> = {
  wallEmpty: '山切れ',
  bankrupt: '破産',
}

/** 席の呼び名。麻雀と同じく自分から見た相対位置で呼ぶ。 */
export const SEAT_NAMES = ['あなた', '下家', '対面', '上家'] as const

/**
 * 席の呼び名を**人間の席からの相対位置**で求める。
 *
 * `humanSeat` を無視して `playerId` で直接引くと、`humanSeat !== 0` の対局で
 * 人間自身が「下家」と表示され、別のプレイヤーが「あなた」になる。
 * `createGame` は既に任意の席を人間にできる API を公開しているため、
 * 「今はたまたま0番だから正しい」に依存させない。
 */
export function seatName(playerId: number, humanSeat: number, playerCount: number): string {
  const offset = (playerId - humanSeat + playerCount) % playerCount
  return SEAT_NAMES[offset] ?? `P${playerId}`
}

/** 卓の上での席の置き場所。`self` は自分（卓の手前）。 */
export type SeatOrientation = 'self' | 'right' | 'top' | 'left'

/**
 * 席が卓のどこに置かれるか。`SEAT_NAMES` と同じ並び（自分→下家→対面→上家）。
 *
 * 下家は自分の右、対面は上、上家は左。麻雀と同じ配置にする。
 */
const SEAT_ORIENTATIONS: readonly SeatOrientation[] = ['self', 'right', 'top', 'left']

/**
 * 席の置き場所を**人間の席からの相対位置**で求める。
 *
 * `seatName` と同じ理由で `playerId` から直接引かない。`createGame` は任意の席を
 * 人間にできるため、`playerId === 1` を「下家＝右」と決め打つと `humanSeat !== 0` の
 * 対局で卓が回転し、呼び名と置き場所が食い違う。
 *
 * `playerCount` が 4 以外だと対応する向きが無い。そのときは `'top'` に落とし、
 * 上段に横並びで積む（Step 7-1 以前と同じ見え方）。**落とし先を決めておかないと
 * 「4人でしか動かない」暗黙の前提が生まれる。**
 */
export function seatOrientation(
  playerId: number,
  humanSeat: number,
  playerCount: number,
): SeatOrientation {
  if (playerId === humanSeat) {
    return 'self'
  }
  const offset = (playerId - humanSeat + playerCount) % playerCount
  return SEAT_ORIENTATIONS[offset] ?? 'top'
}

/** メンバー名の解決。見つからなければ ID をそのまま出す。 */
export function nameOf(memberNameById: ReadonlyMap<MemberId, string>, id: MemberId): string {
  return memberNameById.get(id) ?? id
}

/**
 * カードの角に出すグループの記号。トランプのスートにあたる。
 *
 * 明示された `symbol` を優先し、無ければ名前の1文字目を使う。
 * **`slice(0, 1)` ではなく配列展開で取る。** 絵文字や結合文字を1文字目に置くと
 * `slice` はサロゲートペアの片側だけを切り出し、文字化けした記号になる。
 */
export function groupSymbolOf(group: Group): string {
  const explicit = group.symbol?.trim()
  if (explicit !== undefined && explicit !== '') {
    return explicit
  }

  return [...group.name.trim()][0] ?? '?'
}

/** メンバー ID から所属グループの記号を引く対応表を作る。 */
export function groupSymbolsByMember(groups: readonly Group[]): ReadonlyMap<MemberId, string> {
  const symbols = new Map<MemberId, string>()

  for (const group of groups) {
    const symbol = groupSymbolOf(group)
    for (const memberId of group.memberIds) {
      symbols.set(memberId, symbol)
    }
  }

  return symbols
}
