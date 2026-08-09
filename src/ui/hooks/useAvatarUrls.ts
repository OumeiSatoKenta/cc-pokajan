/**
 * 座席アバターの object URL をまとめて作り、まとめて解放する。
 *
 * `useAssetUrls`（メンバー画像）と同じ形。**画面レベルで1つの対応表を作り、
 * 席ごとにフックを呼ばない。** 席ごとに呼ぶと解放されない URL が積み上がる。
 */

import { useEffect, useState } from 'react'

import { getImage } from '../../storage/assets'
import type { PlayerId } from '../../engine/types'
import type { AvatarMap } from '../avatars'

/**
 * 座席 → object URL を返す。
 *
 * 読み込み中と失敗時は空の対応表を返す。**アバターが無いことは異常ではない**ため、
 * エラーを表に出さず、呼び出し側は席名だけの表示にフォールバックする。
 */
export function useAvatarUrls(avatars: AvatarMap): ReadonlyMap<PlayerId, string> {
  const [urls, setUrls] = useState<ReadonlyMap<PlayerId, string>>(new Map())

  // 依存を「どの席がどの画像を使うか」だけにする。`avatars` の参照が変わるたびに
  // 読み直すと、無関係な再描画のたびに Blob を読み直すことになる。
  const key = Object.entries(avatars)
    .map(([seat, imageId]) => `${seat}:${imageId}`)
    .sort()
    .join(',')

  useEffect(() => {
    let cancelled = false
    const created: string[] = []

    async function load(): Promise<void> {
      const map = new Map<PlayerId, string>()

      for (const [seat, imageId] of Object.entries(avatars)) {
        const blob = await getImage(imageId)
        if (blob === null) {
          continue
        }
        const url = URL.createObjectURL(blob)
        created.push(url)
        map.set(Number(seat), url)
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
    // `avatars` そのものではなく、割り当てが変わったときだけ読み直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return urls
}
