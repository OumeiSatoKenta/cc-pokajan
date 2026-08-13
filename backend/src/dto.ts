/**
 * HTTP 境界の型（リクエスト/レスポンス）と DynamoDB item、およびボディの型ガード。
 *
 * クライアントが送ってよい Action は `ClientAction`（5種）だけ。`DRAW`/`TICK` はサーバー内部専用なので
 * 型に存在させない。`DECLARE`/`CLAIM`/`PASS` は `playerId` を持たない（サーバーが humanSeat を強制する）。
 * candidate の中身の妥当性は engine（`reduce`→`verifyCandidate`）が再導出して検証するため、ここでは形だけ見る。
 *
 * ⚠️ `ClientAction`/`GameSnapshot`/`OutcomeSummary` は**フロント（`src/ui/transport/transport.ts`）と同形の手書き複製**。
 * どちらかのフィールドを変えたら対の型も必ず直すこと（型共有していないのでコンパイルでは検知できない）。
 */
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'

import type { PayoutBreakdown } from '@engine/payout'
import type { PlayerView } from '@engine/playerView'
import type { GameEvent, GameState, PlayerId, RulesConfig, YakuCandidate } from '@engine/types'

// --- リクエスト ---------------------------------------------------------------

export interface CreateGameRequest {
  readonly bet: number
}

export type ClientAction =
  | { readonly type: 'DISCARD'; readonly uid: number }
  | { readonly type: 'DECLARE'; readonly candidate: YakuCandidate }
  | { readonly type: 'SKIP_DECLARE' }
  | { readonly type: 'CLAIM'; readonly candidate: YakuCandidate }
  | { readonly type: 'PASS' }

export interface ApplyActionRequest {
  readonly action: ClientAction
  readonly expectedVersion: number
}

// --- レスポンス ---------------------------------------------------------------

export interface OutcomeSummary {
  readonly payout: PayoutBreakdown
  readonly ranking: readonly PlayerId[]
  readonly scores: readonly number[]
}

export interface GameSnapshot {
  readonly id: string
  readonly version: number
  readonly view: PlayerView
  readonly events: readonly GameEvent[]
  readonly wallet: number
  readonly outcome: OutcomeSummary | null
}

// --- 永続化 item --------------------------------------------------------------

export interface GameItem {
  readonly pk: string
  readonly ownerSub: string
  readonly version: number
  readonly status: 'active' | 'settled'
  readonly state: GameState
  readonly rules: RulesConfig
  readonly seed: number
  readonly bet: number
  readonly humanSeats: readonly PlayerId[]
  readonly createdAt: string
  readonly updatedAt: string
  readonly ttl: number
}

// --- ルートの実行コンテキスト --------------------------------------------------

export interface RouteContext {
  readonly event: APIGatewayProxyEventV2WithJWTAuthorizer
  readonly doc: DynamoDBDocumentClient
  readonly table: string
}

// --- 型ガード -----------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isCreateGameRequest(value: unknown): value is CreateGameRequest {
  return isRecord(value) && typeof value.bet === 'number'
}

function isClientAction(value: unknown): value is ClientAction {
  if (!isRecord(value)) {
    return false
  }
  switch (value.type) {
    case 'DISCARD':
      return typeof value.uid === 'number'
    case 'DECLARE':
    case 'CLAIM':
      // candidate の詳細は engine が再導出・検証するので、ここでは存在（オブジェクト）だけ確かめる。
      return isRecord(value.candidate)
    case 'SKIP_DECLARE':
    case 'PASS':
      return true
    default:
      return false
  }
}

export function isApplyActionRequest(value: unknown): value is ApplyActionRequest {
  // expectedVersion は非負整数のみ（NaN/負/小数は 400 にする。`typeof number` だけだと NaN 等を通してしまう）。
  return (
    isRecord(value) &&
    typeof value.expectedVersion === 'number' &&
    Number.isInteger(value.expectedVersion) &&
    value.expectedVersion >= 0 &&
    isClientAction(value.action)
  )
}
