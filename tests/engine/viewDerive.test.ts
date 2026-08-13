import { describe, expect, it } from 'vitest'

import { DEFAULT_AI_CONFIG } from '../../src/engine/ai'
import {
  claimableFor,
  declarableFor,
  nextCpuAction,
  pendingCpuClaimIds,
} from '../../src/engine/autoAction'
import { createGame, reduce } from '../../src/engine/game'
import { yakuContextOf } from '../../src/engine/gameSelectors'
import { toPlayerView } from '../../src/engine/playerView'
import { countUnseen, toVisibleCards } from '../../src/engine/unseen'
import {
  canDiscardFromView,
  claimableFromView,
  declarableFromView,
  isClaimWindowOpenFromView,
  pendingCpuClaimsFromView,
  unseenFromView,
  waitsFromView,
} from '../../src/engine/viewDerive'
import { computeWaits } from '../../src/engine/yaku'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'

/**
 * `viewDerive`（`PlayerView` 版）が `GameState` 版と**同じ値**を返すことを、autoplay の全ステップで突き合わせる
 * 差分オラクル。これが成り立つ限り、UI が `PlayerView` から導出しても local の挙動は不変
 * （かつ redaction 済みの view だけで自席の判断が完結する＝他家手札に触れない）。
 */

const SEAT = 0
const RULES = DEFAULT_RULES

describe('viewDerive は GameState 版と一致する（差分オラクル・seed 0..24）', () => {
  it('declarable / claimable / waits / unseen / canDiscard / isClaimWindowOpen / pendingCpuClaims', () => {
    for (let seed = 0; seed < 25; seed++) {
      // humanSeats=[] で全席 CPU の autoplay を回し、各局面で SEAT の視点を突き合わせる。
      let state = createGame(DEFAULT_ROSTER, RULES, seed, { humanSeats: [] })

      for (let step = 0; step < 5000; step++) {
        if (state.phase === 'gameOver') {
          break
        }

        const view = toPlayerView(state, SEAT)

        expect(declarableFromView(view, RULES)).toEqual(declarableFor(state, RULES, SEAT))
        expect(claimableFromView(view, RULES)).toEqual(claimableFor(state, RULES, SEAT))
        expect(waitsFromView(view, RULES)).toEqual(
          computeWaits(state.players[SEAT].hand, yakuContextOf(state, RULES)),
        )
        expect(unseenFromView(view, RULES)).toEqual(
          countUnseen(
            toVisibleCards(state, SEAT),
            state.activeMembers.map((member) => member.id),
            RULES,
          ),
        )
        expect(canDiscardFromView(view)).toBe(state.phase === 'discard' && state.turn === SEAT)
        expect(isClaimWindowOpenFromView(view)).toBe(
          state.phase === 'claimWindow' && state.claims[SEAT] === null,
        )
        expect(pendingCpuClaimsFromView(view)).toBe(pendingCpuClaimIds(state, [SEAT]).length)

        const action = nextCpuAction(state, RULES, DEFAULT_AI_CONFIG, [])
        if (action === null) {
          break
        }
        state = reduce(state, action, RULES).state
      }
    }
  })

  it('claimWindow・selfDeclare の局面に実際に到達している（オラクルが空回りしていない）', () => {
    // 上のループが「常に空の派生値」だけを比べていないことを、到達フェーズの集合で担保する。
    const phases = new Set<string>()
    for (let seed = 0; seed < 25; seed++) {
      let state = createGame(DEFAULT_ROSTER, RULES, seed, { humanSeats: [] })
      for (let step = 0; step < 5000 && state.phase !== 'gameOver'; step++) {
        phases.add(state.phase)
        const action = nextCpuAction(state, RULES, DEFAULT_AI_CONFIG, [])
        if (action === null) break
        state = reduce(state, action, RULES).state
      }
    }
    expect(phases.has('selfDeclare')).toBe(true)
    expect(phases.has('claimWindow')).toBe(true)
    expect(phases.has('discard')).toBe(true)
  })
})
