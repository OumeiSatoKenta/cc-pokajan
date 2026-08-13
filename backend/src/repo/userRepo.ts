/** wallet（USER#sub item）のサーバー権威な読み書き。 */
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

import { userPk } from '../keys'

/** 初回だけ初期コインを付与する冪等な upsert（既存なら変えない）。 */
export async function ensureWallet(
  doc: DynamoDBDocumentClient,
  table: string,
  sub: string,
  initial: number,
): Promise<void> {
  await doc.send(
    new UpdateCommand({
      TableName: table,
      Key: { pk: userPk(sub) },
      UpdateExpression: 'SET coins = if_not_exists(coins, :initial)',
      ExpressionAttributeValues: { ':initial': initial },
    }),
  )
}

/** 現在のコイン残高。item が無い場合は 0（`ensureWallet` 前提だが防御的に）。 */
export async function getWallet(
  doc: DynamoDBDocumentClient,
  table: string,
  sub: string,
): Promise<number> {
  // ConsistentRead: BET 差引/精算の直後に正しい残高を返すため強整合にする（金額表示のラグを避ける）。
  const res = await doc.send(
    new GetCommand({ TableName: table, Key: { pk: userPk(sub) }, ConsistentRead: true }),
  )
  const coins = res.Item?.coins
  return typeof coins === 'number' ? coins : 0
}
