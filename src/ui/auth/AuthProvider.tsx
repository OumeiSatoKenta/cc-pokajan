/**
 * 認証ゲートの本体。**lazy chunk の入口**（`AuthGate` からのみ `lazy(() => import('./AuthProvider'))` で読まれる）。
 * ここと配下（AuthForm / useAuthForm / amplifyConfig）だけが aws-amplify を静的 import する
 * ＝ Pages バンドルの実行時に読まれない。
 *
 * 4状態 checking / signedIn / signedOut / configError を持つ。**checking の間は children(<App/>) を描画しない**（fail-closed）。
 * 楽観的に signedIn 初期化するとリロード直後に一瞬 App が見えるゲート漏れになる（CLAUDE.md 7-4「両層で止める」と同型）。
 * VITE_COGNITO_* 欠落（configureAmplify の throw）は configError にして中立画面を出す（白画面・無限スピナーを避ける）。
 */
import { useEffect, useState, type ReactNode } from 'react'
import { getCurrentUser, signOut } from 'aws-amplify/auth'

import { configureAmplify } from './amplifyConfig'
import { AuthForm } from './AuthForm'
import './auth.css'

type Status = 'checking' | 'signedIn' | 'signedOut' | 'configError'

export interface AuthProviderProps {
  readonly children: ReactNode
}

export default function AuthProvider({ children }: AuthProviderProps) {
  // 初期値は必ず未認証側（checking）。getCurrentUser 解決までは App を出さない。
  const [status, setStatus] = useState<Status>('checking')

  useEffect(() => {
    let alive = true
    try {
      // configure は mount 時に一度だけ（冪等）。env 欠落はここで throw → configError（fail-closed）。
      configureAmplify()
    } catch (err) {
      // ユーザー向けは中立画面（configError）だが、原因（欠落した env 名等）は開発者向けに残す。
      console.error('[auth] configureAmplify に失敗しました:', err)
      if (alive) setStatus('configError')
      return () => {
        alive = false
      }
    }
    getCurrentUser()
      .then(() => {
        if (alive) setStatus('signedIn')
      })
      .catch(() => {
        if (alive) setStatus('signedOut')
      })
    return () => {
      alive = false
    }
  }, [])

  switch (status) {
    case 'checking':
      return (
        <div className="auth">
          <p>読み込み中…</p>
        </div>
      )
    case 'configError':
      return (
        <div className="auth">
          <p className="auth__error" role="alert">
            認証の設定に問題があります。時間をおいて再度お試しください。
          </p>
        </div>
      )
    case 'signedOut':
      return <AuthForm onSignedIn={() => setStatus('signedIn')} />
    case 'signedIn':
      return (
        <>
          <div className="auth__bar">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => void signOut().finally(() => setStatus('signedOut'))}
            >
              ログアウト
            </button>
          </div>
          {children}
        </>
      )
    default: {
      const exhaustive: never = status
      throw new Error(`未知の認証状態です: ${String(exhaustive)}`)
    }
  }
}
