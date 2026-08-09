/**
 * アップロード画像の縮小。
 *
 * 判断を含むのは切り出し矩形の計算だけなので、そこを純粋関数として切り出す。
 * canvas を触る部分には分岐を書かない（テスト環境に DOM が無いため）。
 */

/** 保存する画像の長辺の上限。 */
export const IMAGE_SIZE = 256

/** 縮小後の寸法。 */
export interface FitSize {
  readonly width: number
  readonly height: number
}

/**
 * 縦横比を保ったまま、長辺が `max` に収まるよう縮小する寸法を求める。
 *
 * **切り取らない。** 正方形へ収めるために中央を切り出すと、
 * 集合写真の端の人が消えるなど、利用者が選んだ画像と違うものになる。
 * 画像全体を残し、縦横比もそのまま保つ。
 *
 * 元画像が `max` より小さい場合は拡大しない（粗くなるだけで情報は増えない）。
 */
export function fitWithin(width: number, height: number, max = IMAGE_SIZE): FitSize {
  if (width <= 0 || height <= 0) {
    return { width: 1, height: 1 }
  }

  const scale = Math.min(1, max / Math.max(width, height))

  // 1px 未満に潰さない。極端に細長い画像でも描画できる寸法を返す。
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * 画像ファイルを webp（非対応環境では png）に変換する。
 *
 * **縦横比を保ち、切り取らない。** 元画像の全体がそのまま残る。
 * ここには判断を書かない。寸法は `fitWithin` が決める。
 *
 * 変換に失敗した場合は例外を投げ、呼び出し側がエラーとして表示する
 * （画像が壊れていることは利用者に伝えるべき情報で、黙って無視してはいけない）。
 */
export async function fileToStoredImage(file: File, max = IMAGE_SIZE): Promise<Blob> {
  const bitmap = await createImageBitmap(file)

  try {
    const size = fitWithin(bitmap.width, bitmap.height, max)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height

    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('画像を変換できませんでした（canvas を初期化できません）')
    }

    context.drawImage(bitmap, 0, 0, size.width, size.height)

    return await canvasToBlob(canvas)
  } finally {
    bitmap.close()
  }
}

/**
 * canvas を Blob にする。webp に対応しない環境では png へ落とす。
 *
 * `toBlob` は対応しない形式を渡されると既定の png を返す実装が多いが、
 * 仕様上は `null` もありうるため、返らなかった場合は例外にする。
 */
function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob !== null) {
          resolve(blob)
          return
        }
        canvas.toBlob(
          (fallback) =>
            fallback === null ? reject(new Error('画像を変換できませんでした')) : resolve(fallback),
          'image/png',
        )
      },
      'image/webp',
      0.85,
    )
  })
}

/** Blob を data URL にする（書き出し用）。 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('画像を読み込めませんでした'))
    reader.readAsDataURL(blob)
  })
}

/** data URL を Blob に戻す（読み込み用）。 */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl)
  return await response.blob()
}
