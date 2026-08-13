/**
 * サーバー権威 transport（AWS）。`src/net/apiClient` の `authorizedFetch` で HTTP を叩き、DynamoDB の真実を進める。
 *
 * - `create`: `POST /games`（BET を差引き、CPU を人間の番まで解決した初期 snapshot）。
 * - `apply`: `POST /games/{id}/actions`。**409（version 競合）はレスポンス本体に現在 snapshot が載る**ので、
 *   それを再同期として使う（追加の GET はしない・backend `applyAction.ts` の設計）。
 * - `nextAuto`: 常に null。CPU 進行はサーバーが解決済みで、クライアントは CPU タイマーを持たない。
 *
 * engine `Action` → `ClientAction` の変換（`toClientAction`）を内部に閉じる。`playerId` は落とし（サーバーが
 * humanSeat を強制）、claim 時間切れの `TICK` は `PASS` に落とす。
 */

import { authorizedFetch } from '../../net/apiClient'
import type { Action } from '../../engine/types'
import type { ApplyResult, ClientAction, GameSnapshot, GameTransport } from './transport'

/** HTTP エラーを status 付きで表面化する（UI は ErrorBoundary で受ける）。 */
export class RemoteTransportError extends Error {
  // パラメータプロパティ（constructor 引数の readonly）は erasableSyntaxOnly で不可なので、明示的にフィールド宣言する。
  readonly statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.name = 'RemoteTransportError'
    this.statusCode = statusCode
  }
}

/** テスト・特殊経路用に差し替え可能な fetch。既定は `authorizedFetch`（Bearer idToken 付与）。 */
export type FetchImpl = (path: string, init?: RequestInit) => Promise<Response>

export interface RemoteTransportOptions {
  readonly bet: number
  readonly fetchImpl?: FetchImpl
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const

/**
 * engine `Action` を、サーバーへ送れる `ClientAction`（5種・`playerId` なし）へ落とす。
 *
 * `TICK`（claim の時間切れ）は `PASS` にする。**`HUMAN_SEATS=[0]`（単一人間席）前提**での等価:
 * 人間が claimWindow の時計に乗る時点で CPU は全員表明済み（`nextCpuAction` が先に解決）＝残る pending は人間だけ。
 * `TICK` は「未表明の全員を pass にして受付を閉じる」ので、その全員＝人間1人なら `PASS` と結果が一致する。
 * 将来 human を複数席へ拡張するときは本前提の再検証が要る（backend `normalizeHumanAction` と同水準の注記）。
 *
 * `DRAW` は remote では `nextAuto` が null（CPU 進行はサーバー）＝この経路に到達しないので、来たら不正として弾く。
 */
export function toClientAction(action: Action): ClientAction {
  switch (action.type) {
    case 'DISCARD':
      return { type: 'DISCARD', uid: action.uid }
    case 'DECLARE':
      return { type: 'DECLARE', candidate: action.candidate }
    case 'SKIP_DECLARE':
      return { type: 'SKIP_DECLARE' }
    case 'CLAIM':
      return { type: 'CLAIM', candidate: action.candidate }
    case 'PASS':
      return { type: 'PASS' }
    case 'TICK':
      return { type: 'PASS' }
    case 'DRAW':
      throw new Error('DRAW はサーバー権威モードでクライアントから送れません（CPU 進行はサーバー）')
    default: {
      const exhaustive: never = action
      throw new Error(`未知のアクションです: ${JSON.stringify(exhaustive)}`)
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * レスポンス JSON を `GameSnapshot` として最小検査する。candidate の詳細・redaction はサーバー責務なので、
 * ここでは「形が snapshot か」だけを確かめて型を確定する（壊れた JSON を黙って通さない）。
 */
export function parseSnapshot(json: unknown): GameSnapshot {
  if (!isRecord(json)) {
    throw new Error('snapshot が object ではありません')
  }
  const { id, version, view, events, wallet, outcome } = json
  if (
    typeof id !== 'string' ||
    typeof version !== 'number' ||
    !isRecord(view) ||
    !Array.isArray(events) ||
    typeof wallet !== 'number' ||
    !(outcome === null || isRecord(outcome))
  ) {
    throw new Error('snapshot の必須フィールド（id/version/view/events/wallet/outcome）が不正です')
  }
  return json as unknown as GameSnapshot
}

async function readError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as unknown
    if (isRecord(body) && typeof body.message === 'string') {
      return body.message
    }
  } catch {
    // JSON でなければ本文は諦める（status は呼び出し側が持つ）。
  }
  return `HTTP ${response.status}`
}

export function createRemoteTransport(options: RemoteTransportOptions): GameTransport {
  const fetchImpl: FetchImpl = options.fetchImpl ?? ((path, init) => authorizedFetch(path, init))
  let gameId: string | null = null
  let last: GameSnapshot | null = null

  const requireId = (): string => {
    if (gameId === null) {
      throw new Error('remoteTransport: create() より前に apply/get は呼べません')
    }
    return gameId
  }

  const remember = (snapshot: GameSnapshot): GameSnapshot => {
    gameId = snapshot.id
    last = snapshot
    return snapshot
  }

  return {
    current(): GameSnapshot | null {
      // remote は create() までサーバー往復が要る＝初回 seed は null（useGameLoop の create 効果が埋める）。
      return last
    },

    async create(): Promise<GameSnapshot> {
      const response = await fetchImpl('/games', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ bet: options.bet }),
      })
      if (!response.ok) {
        throw new RemoteTransportError(response.status, await readError(response))
      }
      return remember(parseSnapshot(await response.json()))
    },

    async apply(action, expectedVersion): Promise<ApplyResult> {
      const response = await fetchImpl(`/games/${requireId()}/actions`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ action: toClientAction(action), expectedVersion }),
      })
      if (response.status === 409) {
        // 競合。backend は 409 の本体に現在 snapshot を載せるので、それを再同期として使う（追加 GET なし）。
        return { snapshot: remember(parseSnapshot(await response.json())), accepted: false }
      }
      if (!response.ok) {
        throw new RemoteTransportError(response.status, await readError(response))
      }
      return { snapshot: remember(parseSnapshot(await response.json())), accepted: true }
    },

    async get(): Promise<GameSnapshot> {
      const response = await fetchImpl(`/games/${requireId()}`, { method: 'GET' })
      if (!response.ok) {
        throw new RemoteTransportError(response.status, await readError(response))
      }
      return remember(parseSnapshot(await response.json()))
    },

    nextAuto() {
      return null
    },
  }
}
