/** Lambda 環境変数の読み取り。欠落は即エラー（fail-closed）にして設定漏れを起動時に検知する。 */

export interface Env {
  readonly tableName: string
}

export function loadEnv(): Env {
  const tableName = process.env.TABLE_NAME
  if (tableName === undefined || tableName === '') {
    throw new Error('環境変数 TABLE_NAME が未設定です')
  }
  return { tableName }
}
