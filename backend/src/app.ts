/**
 * ルーティング + エラー→HTTP 変換を、依存（doc クライアント・テーブル名）を注入して組み立てる。
 *
 * `index.ts` は実クライアントを注入するだけ。テストは偽 doc を注入して全ルート＋エラー対応表を
 * 実 AWS 無しで検査できる（`createDocClient`/`loadEnv` を経由しない）。
 */
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer,
  APIGatewayProxyStructuredResultV2,
} from 'aws-lambda'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

import { IllegalActionError } from '@engine/game'

import { HttpError } from './errors'
import { json } from './http'
import { route } from './router'

export interface HandlerDeps {
  readonly doc: DynamoDBDocumentClient
  readonly table: string
}

export function createHandler(
  deps: HandlerDeps,
): (event: APIGatewayProxyEventV2WithJWTAuthorizer) => Promise<APIGatewayProxyStructuredResultV2> {
  return async (event) => {
    try {
      return await route({ event, doc: deps.doc, table: deps.table })
    } catch (err) {
      return toErrorResponse(err)
    }
  }
}

export function toErrorResponse(err: unknown): APIGatewayProxyStructuredResultV2 {
  if (err instanceof HttpError) {
    return json(err.statusCode, { message: err.message })
  }
  // engine の不正入力（不正 Action・不正 seat・精算入力の異常）は 400。
  if (err instanceof IllegalActionError) {
    return json(400, { message: err.message })
  }
  // 想定外は詳細をログにだけ残し、本文は中立文言（内部情報を漏らさない）。
  console.error('[game-api] 未処理エラー:', err)
  return json(500, { message: '内部エラーが発生しました' })
}
