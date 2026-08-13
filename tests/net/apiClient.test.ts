import { afterEach, describe, expect, it, vi } from 'vitest'

import { authorizedFetch } from '../../src/net/apiClient'

/**
 * 認証付き fetch 土台のヘッダ生成を、aws-amplify も実ネットワークも介さずに固定する
 * （getIdToken / baseUrl を注入）。idToken を Bearer に載せるのはここだけ。
 */
describe('authorizedFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const stubFetch = () => {
    const fetchMock = vi.fn(
      async (_input: string, _init?: RequestInit) => new Response('{}', { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it('idToken があれば Bearer で付与し base+path を叩く', async () => {
    const fetchMock = stubFetch()
    await authorizedFetch(
      '/games',
      { method: 'POST' },
      { getIdToken: async () => 'TOKEN123', baseUrl: 'https://api.test' },
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0]
    expect(call[0]).toBe('https://api.test/games')
    expect(new Headers(call[1]?.headers).get('Authorization')).toBe('Bearer TOKEN123')
    expect(call[1]?.method).toBe('POST')
  })

  it('token が null なら Authorization を付けない', async () => {
    const fetchMock = stubFetch()
    await authorizedFetch(
      '/games',
      {},
      { getIdToken: async () => null, baseUrl: 'https://api.test' },
    )
    const call = fetchMock.mock.calls[0]
    expect(new Headers(call[1]?.headers).get('Authorization')).toBeNull()
  })

  it('baseUrl が null（Pages 版・未配線）なら誤用として例外', async () => {
    await expect(
      authorizedFetch('/games', {}, { getIdToken: async () => 'X', baseUrl: null }),
    ).rejects.toThrow(/apiBaseUrl/)
  })
})
