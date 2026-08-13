import { afterEach, describe, expect, it, vi } from 'vitest'

// aws-amplify は重く実ネットワークを持つため、Amplify.configure だけをモックする。
const { configureMock } = vi.hoisted(() => ({ configureMock: vi.fn() }))
vi.mock('aws-amplify', () => ({ Amplify: { configure: configureMock } }))

/**
 * amplifyConfig の fail-closed を固定する。
 * VITE_COGNITO_* 欠落を握り潰すと「ログイン画面のはずが素通し」になり、この機能が防ぎたい事故を自ら生む。
 * モジュールスコープの configured フラグを test 間でリセットするため、各 test で resetModules + 動的 import する。
 */
describe('configureAmplify', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
    configureMock.mockClear()
  })

  it('VITE_COGNITO_* 欠落なら throw（fail-closed・configure しない）', async () => {
    // env は未設定のまま。
    const { configureAmplify } = await import('../../src/ui/auth/amplifyConfig')
    expect(() => configureAmplify()).toThrow(/VITE_COGNITO/)
    expect(configureMock).not.toHaveBeenCalled()
  })

  it('env 充足なら正しい shape で Amplify.configure を1回だけ呼ぶ（冪等）', async () => {
    vi.stubEnv('VITE_COGNITO_USER_POOL_ID', 'pool-x')
    vi.stubEnv('VITE_COGNITO_APP_CLIENT_ID', 'client-y')
    const { configureAmplify } = await import('../../src/ui/auth/amplifyConfig')
    configureAmplify()
    configureAmplify() // 2回目は冪等で再 configure しない。
    expect(configureMock).toHaveBeenCalledTimes(1)
    expect(configureMock).toHaveBeenCalledWith({
      Auth: { Cognito: { userPoolId: 'pool-x', userPoolClientId: 'client-y' } },
    })
  })
})
