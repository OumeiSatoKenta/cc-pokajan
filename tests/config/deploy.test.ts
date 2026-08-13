import { describe, expect, it } from 'vitest'

import { deriveDeployConfig } from '../../src/config/deploy'

/**
 * デプロイ設定導出の回帰テスト。
 *
 * deployConfig 定数は import.meta.env を読むため環境依存だが、導出ロジックは純関数
 * deriveDeployConfig に閉じている。ここで「aws だけが認証/サーバー権威/サーバー財布を有効化し、
 * それ以外は既定安全側（github-pages・ローカル完結）に握り潰す」ことと、apiBaseUrl の防御分岐
 * （aws かつ未指定/空文字→null / Pages では強制 null）を機械的に固定する。
 */
describe('deriveDeployConfig（デプロイ設定の導出）', () => {
  it('既定（undefined）は github-pages・ローカル完結・無認証', () => {
    expect(deriveDeployConfig(undefined, undefined)).toEqual({
      target: 'github-pages',
      isAuthEnabled: false,
      transport: 'local',
      walletSource: 'local',
      apiBaseUrl: null,
    })
  })

  it('aws はサーバー権威・認証有効・サーバー財布', () => {
    expect(deriveDeployConfig('aws', 'https://api.example.com')).toEqual({
      target: 'aws',
      isAuthEnabled: true,
      transport: 'remote',
      walletSource: 'server',
      apiBaseUrl: 'https://api.example.com',
    })
  })

  it('未知の target は github-pages に握り潰す（既定安全側）', () => {
    expect(deriveDeployConfig('staging', undefined).target).toBe('github-pages')
    expect(deriveDeployConfig('', undefined).target).toBe('github-pages')
    expect(deriveDeployConfig('AWS', undefined).target).toBe('github-pages') // 大文字は別物
  })

  it('aws かつ apiBaseUrl 未指定は null', () => {
    expect(deriveDeployConfig('aws', undefined).apiBaseUrl).toBeNull()
  })

  it('aws かつ apiBaseUrl が空文字も null（未設定扱い・誤配線防止）', () => {
    expect(deriveDeployConfig('aws', '').apiBaseUrl).toBeNull()
  })

  it('github-pages では apiBaseUrl を渡しても強制 null（誤配線の防止）', () => {
    expect(deriveDeployConfig('github-pages', 'https://api.example.com').apiBaseUrl).toBeNull()
  })
})
