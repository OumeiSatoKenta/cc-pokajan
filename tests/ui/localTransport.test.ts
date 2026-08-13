import { describe, expect, it } from 'vitest'

import { DEFAULT_AI_CONFIG } from '../../src/engine/ai'
import { nextCpuAction } from '../../src/engine/autoAction'
import { createGame, reduce } from '../../src/engine/game'
import { redactEvents, toPlayerView } from '../../src/engine/playerView'
import { createLocalTransport } from '../../src/ui/transport/localTransport'
import { DELAYS, NO_DELAYS } from '../../src/ui/hooks/autoAction'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'

/**
 * localTransport は「今日の挙動」（engine `reduce` + redaction）を transport の形に包んだもの。
 * ここでは **engine 直叩きと完全一致**することを差分オラクルで固定する（local 完全不変の transport 層の担保）。
 */

const SEAT = 0
const RULES = DEFAULT_RULES

function makeTransport(seed: number, fast = false) {
  return createLocalTransport({ roster: DEFAULT_ROSTER, rules: RULES, seed, humanSeat: SEAT, fast })
}

describe('createLocalTransport', () => {
  it('current()/create() は初期 view を同期で返す（version 1・events なし・進めない）', async () => {
    const transport = makeTransport(5)
    const initialGame = createGame(DEFAULT_ROSTER, RULES, 5, { humanSeats: [SEAT] })

    const current = transport.current()
    expect(current).not.toBeNull()
    expect(current?.version).toBe(1)
    expect(current?.view).toEqual(toPlayerView(initialGame, SEAT))
    expect(current?.events).toEqual([])
    expect(current?.outcome).toBeNull()

    const created = await transport.create()
    expect(created.view).toEqual(toPlayerView(initialGame, SEAT))
  })

  it('apply は engine reduce と完全一致する（view・events・version／差分オラクル seed 0..4）', async () => {
    for (let seed = 0; seed < 5; seed++) {
      const transport = makeTransport(seed)
      let engineState = createGame(DEFAULT_ROSTER, RULES, seed, { humanSeats: [SEAT] })
      let version = transport.current()?.version ?? 0

      for (let step = 0; step < 5000; step++) {
        if (engineState.phase === 'gameOver') break
        // humanSeats=[] の autoplay 手を localTransport に流し、engine 直叩きと突き合わせる。
        const action = nextCpuAction(engineState, RULES, DEFAULT_AI_CONFIG, [])
        if (action === null) break

        const result = reduce(engineState, action, RULES)
        const { snapshot, accepted } = await transport.apply(action, version)
        engineState = result.state
        version = snapshot.version

        expect(accepted).toBe(true)
        expect(snapshot.version).toBe(step + 2) // 初期 1 → 1手ごとに +1
        expect(snapshot.view).toEqual(toPlayerView(engineState, SEAT))
        expect(snapshot.events).toEqual(redactEvents(result.events, SEAT))
        // redaction: 他家の実カード（CardDrawn/Refilled）は snapshot に出ない。
        for (const event of snapshot.events) {
          if (event.type === 'CardDrawn' || event.type === 'Refilled') {
            expect(event.playerId).toBe(SEAT)
          }
        }
      }
    }
  })

  it('受け付けられないアクションは accepted:false・version 据え置きで見送る', async () => {
    const transport = makeTransport(1)
    // 初期は draw フェーズ。DISCARD は engine が IllegalActionError で弾く。
    const { snapshot, accepted } = await transport.apply({ type: 'DISCARD', uid: 0 }, 1)

    expect(accepted).toBe(false)
    expect(snapshot.version).toBe(1)
    expect(snapshot.view).toEqual(transport.current()?.view)
  })

  it('nextAuto は開始時に DRAW を返し、演出遅延を付ける（fast で 0）', () => {
    const normal = makeTransport(3)
    const auto = normal.nextAuto()
    expect(auto?.action).toEqual({ type: 'DRAW' })
    expect(auto?.delayMs).toBe(DELAYS.draw)
    expect(typeof auto?.key).toBe('string')

    const fast = makeTransport(3, true)
    expect(fast.nextAuto()?.delayMs).toBe(NO_DELAYS.draw)
  })
})
