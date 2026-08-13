import { describe, expect, it } from 'vitest'

import { authGateMode } from '../../src/ui/auth/authGateMode'

/**
 * ゲート判断の純関数。両分岐を直接固定する。
 * 「条件そのものが消えて常に素通しする」欠陥（＝ AWS 版が実質無認証になる最悪の回帰）を捕まえる砦。
 */
describe('authGateMode', () => {
  it('認証無効（Pages 版）は passthrough（素通し）', () => {
    expect(authGateMode(false)).toBe('passthrough')
  })

  it('認証有効（AWS 版）は gate（ログイン要求）', () => {
    expect(authGateMode(true)).toBe('gate')
  })
})
