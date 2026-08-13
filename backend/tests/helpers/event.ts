/** テスト用の API Gateway HTTP API(v2, JWT authorizer) イベント生成。必要なフィールドだけ埋める。 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'

export function makeEvent(opts: {
  routeKey: string
  sub?: string
  id?: string
  body?: unknown
}): APIGatewayProxyEventV2WithJWTAuthorizer {
  return {
    version: '2.0',
    routeKey: opts.routeKey,
    rawPath: '/',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      authorizer: { jwt: { claims: { sub: opts.sub ?? 'user-1' }, scopes: [] } },
    },
    pathParameters: opts.id === undefined ? undefined : { id: opts.id },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer
}
