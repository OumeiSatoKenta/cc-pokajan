/**
 * HTTP ステータスに対応する例外。`index.ts` の単一 catch が `statusCode` を見て応答に変換する。
 *
 * engine の `IllegalActionError`（不正 Action・不正 seat・精算入力）は 400 として別に扱う（`index.ts`）。
 * ここに無い未知の例外は 500（詳細はログのみ・本文は中立文言）にして内部情報を漏らさない。
 */

export abstract class HttpError extends Error {
  abstract readonly statusCode: number
}

export class BadRequestError extends HttpError {
  readonly statusCode = 400
}

export class UnauthorizedError extends HttpError {
  readonly statusCode = 401
}

export class PaymentRequiredError extends HttpError {
  readonly statusCode = 402
}

export class NotFoundError extends HttpError {
  readonly statusCode = 404
}

/** 楽観ロックの競合（`ConditionalCheckFailed`）。クライアントは GET で再同期する。 */
export class VersionConflictError extends HttpError {
  readonly statusCode = 409
}
