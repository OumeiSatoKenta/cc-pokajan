/**
 * 認証ゲート。`isAuthEnabled` が偽（Pages 版）なら children を素通し、真（AWS 版）ならログインを要求する。
 *
 * **aws-amplify を静的 import しない**。真の分岐でのみ `lazy(() => import('./AuthProvider'))` を評価するため、
 * Pages ビルドでは AuthProvider の chunk（aws-amplify を含む）が実行時に fetch されない。
 * 分岐判断は純関数 `authGateMode`（両分岐を単体テスト済み）。`isAuthEnabled` は既定で `deployConfig.isAuthEnabled` だが、
 * テストが両分岐の描画を固定できるよう prop で上書き可能にする。
 */
import { lazy, Suspense, type ReactNode } from 'react'

import { deployConfig } from '../../config/deploy'
import { authGateMode } from './authGateMode'

const AuthProvider = lazy(() => import('./AuthProvider'))

const loading = (
  <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>読み込み中…</div>
)

export interface AuthGateProps {
  readonly children: ReactNode
  /** 既定は deployConfig.isAuthEnabled。テストが両分岐の描画を固定できるよう上書き可能にする。 */
  readonly isAuthEnabled?: boolean
}

export function AuthGate({ children, isAuthEnabled = deployConfig.isAuthEnabled }: AuthGateProps) {
  if (authGateMode(isAuthEnabled) === 'passthrough') {
    return <>{children}</>
  }
  return (
    <Suspense fallback={loading}>
      <AuthProvider>{children}</AuthProvider>
    </Suspense>
  )
}
