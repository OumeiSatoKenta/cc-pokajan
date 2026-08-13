/**
 * ログインフォームの状態＋送信ロジック（signIn/signUp/confirmSignUp/resendSignUpCode）。
 * `useSelection` と同型に、複雑な state はフックへ抽出し `AuthForm` は描画に専念させる。
 * aws-amplify/auth を静的 import するため lazy chunk 側（AuthProvider 経由でのみ読まれる）に置く。
 */
import { useState, type FormEvent } from 'react'
import { confirmSignUp, resendSignUpCode, signIn, signUp } from 'aws-amplify/auth'

export type AuthFormMode = 'signIn' | 'signUp' | 'confirm'

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export interface UseAuthForm {
  readonly mode: AuthFormMode
  readonly email: string
  readonly password: string
  readonly code: string
  readonly error: string
  readonly busy: boolean
  readonly setEmail: (value: string) => void
  readonly setPassword: (value: string) => void
  readonly setCode: (value: string) => void
  readonly setMode: (mode: AuthFormMode) => void
  readonly submit: (event: FormEvent) => void
  readonly resend: () => void
}

export function useAuthForm(onSignedIn: () => void): UseAuthForm {
  const [mode, setMode] = useState<AuthFormMode>('signIn')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (task: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await task()
    } catch (err) {
      setError(toMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (busy) return // フォーム onSubmit はボタンの disabled を経由しないため、二重送信をここでも弾く。
    const username = email.trim() // 前後空白は「ユーザーが見つかりません」を招くのでトリムする。
    switch (mode) {
      case 'signIn':
        void run(async () => {
          const { isSignedIn, nextStep } = await signIn({ username, password })
          if (isSignedIn) onSignedIn()
          else if (nextStep.signInStep === 'CONFIRM_SIGN_UP') setMode('confirm')
          // MVP: MFA(OFF)・セルフサインアップのみ想定。RESET_PASSWORD 等の他ステップ用 UI は未実装なので、
          // 行き止まりにせず何が起きたかを明示する（黙って無視しない）。
          else setError(`未対応のサインインステップです: ${nextStep.signInStep}`)
        })
        break
      case 'signUp':
        void run(async () => {
          const { isSignUpComplete, nextStep } = await signUp({
            username,
            password,
            options: { userAttributes: { email: username } },
          })
          if (!isSignUpComplete && nextStep.signUpStep === 'CONFIRM_SIGN_UP') setMode('confirm')
          else setMode('signIn')
        })
        break
      case 'confirm':
        void run(async () => {
          await confirmSignUp({ username, confirmationCode: code })
          setCode('')
          setMode('signIn')
        })
        break
      default: {
        const exhaustive: never = mode
        throw new Error(`未知のフォームモードです: ${String(exhaustive)}`)
      }
    }
  }

  const resend = () => {
    if (busy) return
    void run(async () => {
      await resendSignUpCode({ username: email.trim() })
    })
  }

  return {
    mode,
    email,
    password,
    code,
    error,
    busy,
    setEmail,
    setPassword,
    setCode,
    setMode,
    submit,
    resend,
  }
}
