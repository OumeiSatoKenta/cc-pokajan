/**
 * DynamoDB のドキュメントクライアント（marshalling 済みの素の JS オブジェクトで読み書きできる）。
 *
 * repo 層はこの `DynamoDBDocumentClient` 型を引数で受け取る（依存性注入）。テストは同じ形の偽クライアント
 * （`{ send: vi.fn() }` を cast）を渡して実 AWS を叩かずに 409/version+1 を検査する。
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'

export function createDocClient(): DynamoDBDocumentClient {
  const base = new DynamoDBClient({})
  return DynamoDBDocumentClient.from(base, {
    // undefined 値は書き込まない（省略可能フィールドを null で埋めない）。
    marshallOptions: { removeUndefinedValues: true },
  })
}
