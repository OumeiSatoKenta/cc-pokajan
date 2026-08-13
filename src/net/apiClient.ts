/**
 * サーバー権威 API 用の認証付き fetch 土台（本格利用は Step 6 の remote transport）。
 *
 * idToken を `Authorization: Bearer` に載せる唯一の場所。トークンがネットワークに触れるのはここだけ。
 * aws-amplify は **動的 import** し、この module の静的グラフに載せない
 * （Pages バンドル・テストに aws-amplify を引き込まない。呼ばれたときだけ解決）。
 * base URL とトークン取得は注入可能にして、aws-amplify も実ネットワークも介さずヘッダ生成を単体テストできる。
 */
import { deployConfig } from '../config/deploy'

export type IdTokenProvider = () => Promise<string | null>

export interface AuthorizedFetchOptions {
  /** テスト・特殊経路用のトークン取得差し替え。既定は Amplify の現在セッション。 */
  readonly getIdToken?: IdTokenProvider
  /** 既定は deployConfig.apiBaseUrl。テストで明示指定する。 */
  readonly baseUrl?: string | null
}

/**
 * 既定のトークン取得。呼ばれたときだけ aws-amplify を動的 import し、現在セッションの idToken を返す。
 * 未ログイン等でトークンが無ければ null（＝ Authorization ヘッダを付けない）。
 */
export const amplifyIdToken: IdTokenProvider = async () => {
  const { fetchAuthSession } = await import('aws-amplify/auth')
  const session = await fetchAuthSession()
  return session.tokens?.idToken?.toString() ?? null
}

/**
 * `deployConfig.apiBaseUrl` 起点で API を叩き、idToken があれば Bearer で付与する。
 * apiBaseUrl 未設定（Pages 版・未配線）で呼ばれたら誤用なので例外にする（黙って相対 URL に飛ばさない）。
 */
export async function authorizedFetch(
  path: string,
  init: RequestInit = {},
  opts: AuthorizedFetchOptions = {},
): Promise<Response> {
  const base = opts.baseUrl ?? deployConfig.apiBaseUrl
  if (base === null) {
    throw new Error(
      'authorizedFetch: apiBaseUrl が未設定です。AWS 版（VITE_API_BASE_URL 設定時）でのみ使用してください。',
    )
  }

  const getIdToken = opts.getIdToken ?? amplifyIdToken
  const token = await getIdToken()

  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  return fetch(`${base}${path}`, { ...init, headers })
}
