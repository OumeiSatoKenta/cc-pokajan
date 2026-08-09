/**
 * キャラクター画像の保存（IndexedDB）。
 *
 * localStorage を使わないのは約5MB制限に収まらないため。
 * `imageId → Blob` の単純な KV として使い、ライブラリは追加しない。
 *
 * **すべての関数は失敗しても例外を投げない。** プライベートモードや容量超過で
 * IndexedDB が使えない環境はあるが、**画像が出ないことはゲームが遊べない理由にならない**。
 * 読み出せなければ画像なしで、書き込めなければ保存されなかったものとして続行する。
 */

const DB_NAME = 'cc-pokajan'
const STORE_NAME = 'assets'
const DB_VERSION = 1

/** 画像1件分。`id` はメンバー ID とは独立に採番する。 */
export interface StoredImage {
  readonly id: string
  readonly blob: Blob
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      // indexedDB そのものが存在しない・アクセスが禁止されている環境。
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}

/**
 * トランザクションを1つ実行する。失敗は `null` として扱う。
 *
 * 例外・エラーイベント・中断のすべてを同じ経路に集約し、
 * 呼び出し側に「失敗の種類」を意識させない（どれも「画像が無い」に帰着するため）。
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDb()
  if (db === null) {
    return null
  }

  return new Promise((resolve) => {
    let request: IDBRequest<T>
    try {
      request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME))
    } catch {
      db.close()
      resolve(null)
      return
    }

    request.onsuccess = () => {
      resolve(request.result)
      db.close()
    }
    request.onerror = () => {
      resolve(null)
      db.close()
    }
  })
}

/**
 * 画像を保存する。**成否を返す**（例外は投げない）。
 *
 * 保存できなかったことは利用者に伝える必要があるため、ここだけ結果を返す。
 * 他の関数は「無い」で十分に表現できる。
 */
export async function putImage(id: string, blob: Blob): Promise<boolean> {
  const result = await withStore('readwrite', (store) => store.put(blob, id))
  return result !== null
}

export async function getImage(id: string): Promise<Blob | null> {
  const value = await withStore<unknown>('readonly', (store) => store.get(id))
  return value instanceof Blob ? value : null
}

export async function deleteImage(id: string): Promise<void> {
  await withStore('readwrite', (store) => store.delete(id))
}

export async function listImageIds(): Promise<string[]> {
  const keys = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
  return (keys ?? []).filter((key): key is string => typeof key === 'string')
}

/**
 * 保存されている画像をすべて読む。書き出しと、対局開始時の一括読み込みに使う。
 *
 * 1件ずつ `getImage` を呼ぶとトランザクションが人数分開く。
 * 20人程度でも無駄が大きいので、まとめて読む経路を用意する。
 */
export async function getAllImages(): Promise<Map<string, Blob>> {
  const ids = await listImageIds()
  const values = await withStore<unknown[]>('readonly', (store) => store.getAll())
  const map = new Map<string, Blob>()

  if (values === null) {
    return map
  }

  ids.forEach((id, index) => {
    const value = values[index]
    if (value instanceof Blob) {
      map.set(id, value)
    }
  })

  return map
}

/** 使われなくなった画像を消す。ロスター保存時の後始末に使う。 */
export async function pruneImages(keepIds: readonly string[]): Promise<void> {
  const keep = new Set(keepIds)
  const stored = await listImageIds()

  for (const id of stored) {
    if (!keep.has(id)) {
      await deleteImage(id)
    }
  }
}
