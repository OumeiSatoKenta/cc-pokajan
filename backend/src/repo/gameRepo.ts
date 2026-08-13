/**
 * GAME item の読み書きと**楽観ロック**。1ゲーム=1item なので更新は「item 全体を Put ＋ 条件式」で行う
 * （部分 Update の属性取りこぼしを避ける）。読んだ item の全フィールドをメモリに保持してから書くので落とさない。
 *
 * - `updateGameVersioned`: 通常更新。`version = :expected` 条件で書き、失敗は 409。
 * - `createGameWithDebit`: 新規作成 + BET 差引を `TransactWriteItems` で原子的に。残高不足は 402。
 * - `settleGame`: gameOver 遷移の精算。`version=:expected AND status=active` 条件 + コイン加算を原子的に・一度だけ。
 */
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb'
import { GetCommand, PutCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

import type { GameItem } from '../dto'
import { NotFoundError, PaymentRequiredError, VersionConflictError } from '../errors'
import { gamePk, userPk } from '../keys'

/** id で GAME item を取得する。不存在・非所有者はどちらも 404（存在を漏らさない）。 */
export async function getGame(
  doc: DynamoDBDocumentClient,
  table: string,
  id: string,
  sub: string,
): Promise<GameItem> {
  // ConsistentRead: 楽観ロックの version を正しく読むため強整合にする（結果整合だと直後の連続 POST で
  // 一瞬古い version を読み無用な 409 を招く）。
  const res = await doc.send(
    new GetCommand({ TableName: table, Key: { pk: gamePk(id) }, ConsistentRead: true }),
  )
  const item = res.Item as GameItem | undefined
  if (item === undefined || item.ownerSub !== sub) {
    throw new NotFoundError('対局が見つかりません')
  }
  return item
}

/** 新規 GAME item を作成し、同一トランザクションで USER のコインから BET を引く。 */
export async function createGameWithDebit(
  doc: DynamoDBDocumentClient,
  table: string,
  item: GameItem,
  sub: string,
  bet: number,
): Promise<void> {
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: item,
              ConditionExpression: 'attribute_not_exists(pk)',
            },
          },
          {
            Update: {
              TableName: table,
              Key: { pk: userPk(sub) },
              UpdateExpression: 'SET coins = coins - :bet',
              ConditionExpression: 'coins >= :bet',
              ExpressionAttributeValues: { ':bet': bet },
            },
          },
        ],
      }),
    )
  } catch (err) {
    // 取消理由の並びは TransactItems と一致: [0]=GAME Put(pk 重複)、[1]=USER Update(残高不足)。
    if (err instanceof TransactionCanceledException) {
      const reasons = err.CancellationReasons ?? []
      if (reasons[1]?.Code === 'ConditionalCheckFailed') {
        throw new PaymentRequiredError('コインが不足しています')
      }
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        throw new VersionConflictError('対局IDが重複しました。再試行してください')
      }
    }
    throw err
  }
}

/** 通常更新。`item.version` は呼び出し側で expectedVersion+1 に設定済みで渡す。競合は 409。 */
export async function updateGameVersioned(
  doc: DynamoDBDocumentClient,
  table: string,
  item: GameItem,
  expectedVersion: number,
): Promise<void> {
  try {
    await doc.send(
      new PutCommand({
        TableName: table,
        Item: item,
        ConditionExpression: 'version = :expected',
        ExpressionAttributeValues: { ':expected': expectedVersion },
      }),
    )
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      throw new VersionConflictError('対局が他の更新と競合しました。最新状態を取得してください')
    }
    throw err
  }
}

/**
 * 精算（gameOver 遷移）。GAME を `version=:expected AND status=active` 条件で settled に更新し、
 * 同一トランザクションで USER にコイン（gross）を加算する。条件が外れれば**二重精算は成立しない**（409）。
 * `item` は version=expectedVersion+1・status='settled' に設定済みで渡す。
 */
export async function settleGame(
  doc: DynamoDBDocumentClient,
  table: string,
  item: GameItem,
  expectedVersion: number,
  sub: string,
  gross: number,
): Promise<void> {
  try {
    await doc.send(
      new TransactWriteCommand({
        TransactItems: [
          {
            Put: {
              TableName: table,
              Item: item,
              ConditionExpression: 'version = :expected AND #s = :active',
              ExpressionAttributeNames: { '#s': 'status' },
              ExpressionAttributeValues: { ':expected': expectedVersion, ':active': 'active' },
            },
          },
          {
            Update: {
              TableName: table,
              Key: { pk: userPk(sub) },
              UpdateExpression: 'SET coins = coins + :gross',
              ExpressionAttributeValues: { ':gross': gross },
            },
          },
        ],
      }),
    )
  } catch (err) {
    if (err instanceof TransactionCanceledException) {
      const reasons = err.CancellationReasons ?? []
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        // version 競合、または既に settled（＝二重精算の試行）。どちらもコインは動かさない。
        throw new VersionConflictError(
          '対局が既に更新/精算されています。最新状態を取得してください',
        )
      }
    }
    throw err
  }
}
