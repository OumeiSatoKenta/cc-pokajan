/**
 * 画像の object URL をまとめて作り、まとめて解放する。
 *
 * **カードごとにフックを呼ばない。** 1局の手札・河・成立済みの役を合わせると
 * 表示されるカードは数十枚になり、そのたびに `createObjectURL` を呼ぶと
 * 解放されない URL が積み上がる。画面レベルで1つの対応表を作る。
 */

import { useEffect, useState } from 'react'

import { getImage } from '../../storage/assets'
import type { MemberId, Roster } from '../../engine/types'

/**
 * ロスターの画像を読み、`memberId → objectURL` を返す。
 *
 * 読み込み中と失敗時は空の対応表を返す。**画像が無いことは異常ではない**ため、
 * エラーを表に出さず、呼び出し側は従来の名前表示にフォールバックする。
 */
export function useAssetUrls(roster: Roster): ReadonlyMap<MemberId, string> {
  const [urls, setUrls] = useState<ReadonlyMap<MemberId, string>>(new Map())

  // 依存を「どのメンバーがどの画像を使うか」だけにする。ロスターの参照が
  // 変わるたびに読み直すと、名前を1文字変えただけで全画像を読み直すことになる。
  const key = roster.members.map((member) => `${member.id}:${member.imageId ?? ''}`).join(',')

  useEffect(() => {
    let cancelled = false
    const created: string[] = []

    async function load(): Promise<void> {
      const map = new Map<MemberId, string>()

      for (const member of roster.members) {
        if (member.imageId === undefined) {
          continue
        }
        const blob = await getImage(member.imageId)
        if (blob === null) {
          continue
        }
        const url = URL.createObjectURL(blob)
        created.push(url)
        map.set(member.id, url)
      }

      if (cancelled) {
        // 待っている間にアンマウント・再実行された分もここで解放する。
        created.forEach((url) => URL.revokeObjectURL(url))
        return
      }
      setUrls(map)
    }

    void load()

    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
    }
    // `roster` そのものではなく、画像の割り当てが変わったときだけ読み直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return urls
}
