/**
 * Amplify(Cognito) の設定。**この module は lazy chunk 側にのみ存在する**
 * （AuthProvider からのみ import され、Pages 版の実行時には読み込まれない）。
 *
 * VITE_COGNITO_* が欠落していたら**明示エラー**にする（黙って無認証にしない・fail-closed）。
 * env 未設定を握り潰すと「ログイン画面のはずが素通し」になり、この機能が防ぎたい事故を自ら生む。
 */
import { Amplify } from 'aws-amplify'

const requireEnv = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(
      `${name} が未設定です。AWS 版のビルド（VITE_DEPLOY_TARGET=aws）では VITE_COGNITO_* が必須です。`,
    )
  }
  return value
}

let configured = false

/** Amplify を一度だけ設定する（StrictMode の二重実行に備えて冪等）。 */
export const configureAmplify = (): void => {
  if (configured) return
  const userPoolId = requireEnv(
    'VITE_COGNITO_USER_POOL_ID',
    import.meta.env.VITE_COGNITO_USER_POOL_ID,
  )
  const userPoolClientId = requireEnv(
    'VITE_COGNITO_APP_CLIENT_ID',
    import.meta.env.VITE_COGNITO_APP_CLIENT_ID,
  )
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
      },
    },
  })
  configured = true
}
