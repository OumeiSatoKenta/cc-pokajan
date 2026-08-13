/**
 * AWS 版のログイン/サインアップ/検証フォーム（描画のみ）。lazy chunk 側。
 * 状態と送信ロジックは `useAuthForm` フックに集約し、ここは描画に専念する
 * （`@aws-amplify/ui-react` は使わず承認済み依存 aws-amplify だけで組む）。
 */
import { useAuthForm, type AuthFormMode } from './useAuthForm'

export interface AuthFormProps {
  readonly onSignedIn: () => void
}

const TITLES: Record<AuthFormMode, string> = {
  signIn: 'ログイン',
  signUp: 'アカウント作成',
  confirm: 'メール検証',
}

export function AuthForm({ onSignedIn }: AuthFormProps) {
  const {
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
  } = useAuthForm(onSignedIn)

  return (
    <div className="auth">
      <form className="auth__card" onSubmit={submit}>
        <h1 className="auth__title">ポカジャン！ — {TITLES[mode]}</h1>

        {mode !== 'confirm' && (
          <>
            <label className="auth__field">
              メールアドレス
              <input
                className="auth__input"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="auth__field">
              パスワード
              <input
                className="auth__input"
                type="password"
                autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
          </>
        )}

        {mode === 'confirm' && (
          <label className="auth__field">
            {email} 宛の検証コード
            <input
              className="auth__input"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
        )}

        <p className="auth__error" role="alert">
          {error}
        </p>

        <button className="button button--primary" type="submit" disabled={busy}>
          {busy ? '処理中…' : TITLES[mode]}
        </button>

        {mode === 'signIn' && (
          <button className="auth__switch" type="button" onClick={() => setMode('signUp')}>
            アカウントを作成する
          </button>
        )}
        {mode === 'signUp' && (
          <button className="auth__switch" type="button" onClick={() => setMode('signIn')}>
            ログインに戻る
          </button>
        )}
        {mode === 'confirm' && (
          <button className="auth__switch" type="button" disabled={busy} onClick={resend}>
            検証コードを再送する
          </button>
        )}
      </form>
    </div>
  )
}
