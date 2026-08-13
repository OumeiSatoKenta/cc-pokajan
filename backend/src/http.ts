/** HTTP 応答とリクエストボディのヘルパー。 */
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda'

import { BadRequestError } from './errors'

export function json(statusCode: number, body: unknown): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }
}

/**
 * リクエストボディを JSON として読む。**構文（valid JSON か）だけ**を見る。
 * 形状の検証（bet が数値か等）は `dto.ts` の型ガードが行う。空ボディは空オブジェクト扱い。
 */
export function readJsonBody(event: {
  readonly body?: string
  readonly isBase64Encoded?: boolean
}): unknown {
  if (event.body === undefined || event.body === '') {
    return {}
  }
  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body
  try {
    return JSON.parse(raw)
  } catch {
    throw new BadRequestError('リクエストボディが不正な JSON です')
  }
}

/** パスの `{id}` を取り出す。無ければ 400。 */
export function requireGameId(event: {
  readonly pathParameters?: Record<string, string | undefined> | null
}): string {
  const id = event.pathParameters?.id
  if (id === undefined || id === '') {
    throw new BadRequestError('対局IDがありません')
  }
  return id
}
