/**
 * 実 DynamoDB を叩かないインメモリ偽 doc クライアント。repo が実際に使う**特定の式だけ**を評価する
 * （汎用パーサではない）。repo が式を変えたら「未知の式（fake を更新して）」で落ちる＝テストが repo に追従する。
 *
 * 対応: GetCommand / PutCommand / UpdateCommand / TransactWriteCommand と、
 * 条件式（attribute_not_exists(pk) / version=:expected / version=:expected AND #s=:active / coins>=:bet）、
 * 更新式（SET coins = if_not_exists(coins,:initial) / coins - :bet / coins + :gross）。
 */
import {
  ConditionalCheckFailedException,
  TransactionCanceledException,
} from '@aws-sdk/client-dynamodb'
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

type Item = Record<string, any>
type Values = Record<string, any> | undefined
type Names = Record<string, string> | undefined

function evalCondition(
  expr: string | undefined,
  existing: Item | undefined,
  values: Values,
  names: Names,
): boolean {
  if (expr === undefined) {
    return true
  }
  switch (expr) {
    case 'attribute_not_exists(pk)':
      return existing === undefined
    case 'version = :expected':
      return existing?.version === values?.[':expected']
    case 'version = :expected AND #s = :active':
      return (
        existing?.version === values?.[':expected'] &&
        existing?.[names?.['#s'] ?? 'status'] === values?.[':active']
      )
    case 'coins >= :bet':
      return (existing?.coins ?? Number.NEGATIVE_INFINITY) >= values?.[':bet']
    default:
      throw new Error(`fakeDoc: 未知の ConditionExpression（fake を更新して）: ${expr}`)
  }
}

function applyUpdate(expr: string, pk: string, existing: Item | undefined, values: Values): Item {
  switch (expr) {
    case 'SET coins = if_not_exists(coins, :initial)':
      return { ...existing, pk, coins: existing?.coins ?? values?.[':initial'] }
    case 'SET coins = coins - :bet':
      return { ...existing, pk, coins: existing?.coins - values?.[':bet'] }
    case 'SET coins = coins + :gross':
      return { ...existing, pk, coins: existing?.coins + values?.[':gross'] }
    default:
      throw new Error(`fakeDoc: 未知の UpdateExpression（fake を更新して）: ${expr}`)
  }
}

export interface FakeDoc {
  readonly client: DynamoDBDocumentClient
  readonly store: Map<string, Item>
  readonly calls: string[]
}

export function createFakeDoc(seed?: Record<string, Item>): FakeDoc {
  const store = new Map<string, Item>(Object.entries(seed ?? {}))
  const calls: string[] = []

  const send = async (command: any): Promise<any> => {
    const name: string = command.constructor.name
    const input = command.input
    calls.push(name)

    switch (name) {
      case 'GetCommand':
        return { Item: store.get(input.Key.pk) }

      case 'PutCommand': {
        const item: Item = input.Item
        if (
          !evalCondition(
            input.ConditionExpression,
            store.get(item.pk),
            input.ExpressionAttributeValues,
            input.ExpressionAttributeNames,
          )
        ) {
          throw new ConditionalCheckFailedException({
            $metadata: {},
            message: 'conditional check failed',
          })
        }
        store.set(item.pk, item)
        return {}
      }

      case 'UpdateCommand': {
        const pk: string = input.Key.pk
        const existing = store.get(pk)
        if (
          !evalCondition(
            input.ConditionExpression,
            existing,
            input.ExpressionAttributeValues,
            input.ExpressionAttributeNames,
          )
        ) {
          throw new ConditionalCheckFailedException({
            $metadata: {},
            message: 'conditional check failed',
          })
        }
        store.set(
          pk,
          applyUpdate(input.UpdateExpression, pk, existing, input.ExpressionAttributeValues),
        )
        return {}
      }

      case 'TransactWriteCommand': {
        const items: any[] = input.TransactItems
        // 全条件を先に評価する（all-or-nothing）。1つでも外れれば適用せず取消例外を投げる。
        const oks = items.map((ti) => {
          if (ti.Put) {
            return evalCondition(
              ti.Put.ConditionExpression,
              store.get(ti.Put.Item.pk),
              ti.Put.ExpressionAttributeValues,
              ti.Put.ExpressionAttributeNames,
            )
          }
          if (ti.Update) {
            return evalCondition(
              ti.Update.ConditionExpression,
              store.get(ti.Update.Key.pk),
              ti.Update.ExpressionAttributeValues,
              ti.Update.ExpressionAttributeNames,
            )
          }
          return true
        })
        if (oks.some((ok) => !ok)) {
          throw new TransactionCanceledException({
            $metadata: {},
            message: 'transaction cancelled',
            CancellationReasons: oks.map((ok) => ({
              Code: ok ? 'None' : 'ConditionalCheckFailed',
            })),
          })
        }
        for (const ti of items) {
          if (ti.Put) {
            store.set(ti.Put.Item.pk, ti.Put.Item)
          }
          if (ti.Update) {
            const pk: string = ti.Update.Key.pk
            store.set(
              pk,
              applyUpdate(
                ti.Update.UpdateExpression,
                pk,
                store.get(pk),
                ti.Update.ExpressionAttributeValues,
              ),
            )
          }
        }
        return {}
      }

      default:
        throw new Error(`fakeDoc: 未対応のコマンドです: ${name}`)
    }
  }

  return { client: { send } as unknown as DynamoDBDocumentClient, store, calls }
}
