/**
 * Lambda ハンドラのエントリ。実クライアント・テーブル名を注入して `createHandler` を組み立てるだけ。
 *
 * env / doc はモジュールスコープで1度だけ生成する（コンテナ再利用で使い回す）。
 * TABLE_NAME 欠落はここで throw され Lambda 初期化が失敗する（fail-closed）。
 */
import type { APIGatewayProxyHandlerV2WithJWTAuthorizer } from 'aws-lambda'

import { createHandler } from './app'
import { createDocClient } from './ddb'
import { loadEnv } from './env'

const env = loadEnv()
const doc = createDocClient()

export const handler: APIGatewayProxyHandlerV2WithJWTAuthorizer = createHandler({
  doc,
  table: env.tableName,
})
