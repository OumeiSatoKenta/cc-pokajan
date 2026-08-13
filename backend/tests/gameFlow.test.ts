import { describe, expect, it } from 'vitest'

import { createGame } from '@engine/game'
import { nextCpuAction } from '@engine/autoAction'
import { computePayout } from '@engine/payout'
import type { GameState, YakuCandidate } from '@engine/types'

import { AI, HUMAN_SEAT, HUMAN_SEATS, MAX_ADVANCE_STEPS, ROSTER, RULES } from '../src/gameConfig'
import { advanceToHuman, buildOutcome, buildSnapshot, normalizeHumanAction } from '../src/gameFlow'

const uidLeaked = (json: string, uid: number): boolean => json.includes(`"uid":${uid},`)

describe('advanceToHuman', () => {
  it('人間の判断点（nextCpuAction が null）か gameOver で止まる', () => {
    for (const seed of [0, 7, 42, 99]) {
      const state = createGame(ROSTER, RULES, seed, { humanSeats: HUMAN_SEATS })
      const advanced = advanceToHuman(state, RULES, AI, HUMAN_SEATS, MAX_ADVANCE_STEPS)
      const stoppedCorrectly =
        advanced.state.phase === 'gameOver' ||
        nextCpuAction(advanced.state, RULES, AI, HUMAN_SEATS) === null
      expect(stoppedCorrectly).toBe(true)
    }
  })

  it('maxSteps を超えたら黙って途中状態を返さず例外にする', () => {
    const state = createGame(ROSTER, RULES, 7, { humanSeats: HUMAN_SEATS })
    // 人間が絶対に判断を求められない全員 CPU（humanSeats=[]）にすると必ず自動で進むため、
    // 極端に小さい maxSteps では収束せず例外になる（暴走検知の砦）。
    expect(() => advanceToHuman(state, RULES, AI, [], 1)).toThrow()
  })
})

describe('normalizeHumanAction — playerId を humanSeat に強制', () => {
  const candidate: YakuCandidate = {
    kind: 'triple',
    sameColor: false,
    cards: [],
    bonusCount: 0,
    score: 120,
  }

  it('DECLARE / CLAIM / PASS は playerId=humanSeat になる', () => {
    expect(normalizeHumanAction({ type: 'DECLARE', candidate }, 0)).toEqual({
      type: 'DECLARE',
      playerId: 0,
      candidate,
    })
    expect(normalizeHumanAction({ type: 'CLAIM', candidate }, 0)).toEqual({
      type: 'CLAIM',
      playerId: 0,
      candidate,
    })
    expect(normalizeHumanAction({ type: 'PASS' }, 0)).toEqual({ type: 'PASS', playerId: 0 })
  })

  it('DISCARD / SKIP_DECLARE はそのまま', () => {
    expect(normalizeHumanAction({ type: 'DISCARD', uid: 5 }, 0)).toEqual({
      type: 'DISCARD',
      uid: 5,
    })
    expect(normalizeHumanAction({ type: 'SKIP_DECLARE' }, 0)).toEqual({ type: 'SKIP_DECLARE' })
  })
})

describe('buildOutcome — computePayout を共有', () => {
  it('順位・精算が engine の computePayout と一致する', () => {
    const state = {
      players: [
        { id: 0, score: 1100 },
        { id: 1, score: 900 },
        { id: 2, score: 800 },
        { id: 3, score: 1000 },
      ],
    } as unknown as GameState

    const outcome = buildOutcome(state, 0, 2000, RULES)

    expect(outcome.ranking).toEqual([0, 3, 1, 2]) // score 降順・同点 id 昇順
    expect(outcome.payout.rank).toBe(1)
    expect(outcome.payout.gross).toBe(computePayout(1100, 2000, 1, RULES).gross) // floor(1100*2*2.5)=5500
    expect(outcome.scores).toEqual([1100, 900, 800, 1000])
  })
})

describe('buildSnapshot — view / events の redaction', () => {
  it('view に seed/wall を含めず、他家の手札 uid が snapshot 全体に現れない', () => {
    const state = createGame(ROSTER, RULES, 7, { humanSeats: HUMAN_SEATS })
    const advanced = advanceToHuman(state, RULES, AI, HUMAN_SEATS, MAX_ADVANCE_STEPS)

    const snapshot = buildSnapshot({
      id: 'game-1',
      version: 1,
      state: advanced.state,
      events: advanced.events,
      seat: HUMAN_SEAT,
      wallet: 9000,
      bet: 1000,
      rules: RULES,
    })

    expect('seed' in snapshot.view).toBe(false)
    expect('wall' in snapshot.view).toBe(false)
    expect(snapshot.outcome).toBeNull() // 未終局

    const json = JSON.stringify(snapshot)
    const secretUids = [
      ...advanced.state.wall.map((card) => card.uid),
      ...advanced.state.players
        .filter((player) => player.id !== HUMAN_SEAT)
        .flatMap((player) => player.hand.map((card) => card.uid)),
    ]
    for (const uid of secretUids) {
      expect(uidLeaked(json, uid)).toBe(false)
    }
  })
})
