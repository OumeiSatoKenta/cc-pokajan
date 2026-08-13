import { describe, expect, it } from 'vitest'

import { createTransportFor } from '../../src/ui/transport/createTransport'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'

/**
 * transport の選択（local/remote）を純関数として固定する。以前は `TableScreen` の useMemo にインライン
 * だったため remote 分岐がどのテストからも評価されなかった（レビュー指摘）。ここで両分岐を機械的に固定する。
 */

const OPTIONS = {
  roster: DEFAULT_ROSTER,
  rules: DEFAULT_RULES,
  seed: 1,
  bet: 1000,
  humanSeat: 0,
}

describe('createTransportFor', () => {
  it('transport=local はブラウザ内エンジン（current が非 null・nextAuto が非 null）', () => {
    const transport = createTransportFor({ transport: 'local' }, OPTIONS)

    // local は factory で createGame 済み＝current() が同期で view を返し、開始時は DRAW を自動で進める。
    expect(transport.current()).not.toBeNull()
    expect(transport.nextAuto()).not.toBeNull()
  })

  it('transport=remote はサーバー権威（current が null・nextAuto が null）', () => {
    const transport = createTransportFor({ transport: 'remote' }, OPTIONS)

    // remote は create() までサーバー往復が要る＝current() は null、CPU 進行はサーバーなので nextAuto も null。
    expect(transport.current()).toBeNull()
    expect(transport.nextAuto()).toBeNull()
  })
})
