/**
 * JWT authorizer が検証済みのクレームから `sub`（Cognito ユーザー識別子）を取り出す。
 * API Gateway の JWT authorizer を通っている前提だが、`sub` の不在は防御的に 401 にする。
 */
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'

import { UnauthorizedError } from './errors'

export function requireSub(event: APIGatewayProxyEventV2WithJWTAuthorizer): string {
  const sub = event.requestContext.authorizer.jwt.claims.sub
  if (typeof sub !== 'string' || sub === '') {
    throw new UnauthorizedError('認証情報(sub)がありません')
  }
  return sub
}
