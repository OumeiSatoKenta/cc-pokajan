import { describe, expect, it } from 'vitest'

import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { DEFAULT_RULES } from '../../src/config/rules'
import { createGame } from '../../src/engine/game'
import { redactEvents, toPlayerView } from '../../src/engine/playerView'
import type { GameEvent, YakuCandidate } from '../../src/engine/types'
import { createCardSource, gameState } from '../helpers/game'

/**
 * PlayerView の redaction を機械的に固定する。
 *
 * この Step の存在意義は「他家の手札・山札の中身・seed を絶対に含めない」こと。構造（hand フィールドを
 * 持たない）と leak オラクル（カード uid が JSON に出ない）の両面で検査し、わざと漏らすと落ちるようにする。
 */

/** カード1枚は `{"uid":N,"memberId":..,"color":..}` に直列化される。uid の後は必ずカンマなので前方一致の誤検出を避ける。 */
const uidLeaked = (json: string, uid: number): boolean => json.includes(`"uid":${uid},`)

describe('toPlayerView — 構造的 redaction', () => {
  const state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 7, { humanSeats: [0] })

  it('自分の手札だけを hand に持ち、他家は handCount のみ（hand フィールドを持たない）', () => {
    const view = toPlayerView(state, 0)

    expect(view.hand).toBe(state.players[0].hand)
    for (const summary of view.players) {
      expect('hand' in summary).toBe(false)
      expect(summary.handCount).toBe(state.players[summary.id].hand.length)
    }
  })

  it('山札は枚数のみ・seed / rngState / wall は含めない', () => {
    const view = toPlayerView(state, 0)

    expect(view.wallCount).toBe(state.wall.length)
    expect('wall' in view).toBe(false)
    expect('seed' in view).toBe(false)
    expect('rngState' in view).toBe(false)
  })

  it('範囲外の席は 0 埋めせず RangeError にする', () => {
    expect(() => toPlayerView(state, state.players.length)).toThrow(RangeError)
    expect(() => toPlayerView(state, -1)).toThrow(RangeError)
    expect(() => toPlayerView(state, 1.5)).toThrow(RangeError)
  })

  /**
   * seat は Step 5 でネットワーク境界（JSON デシリアライズ後の未検証値）から来る。JS 配列は
   * '__proto__' / 'length' のようなプロトタイプ由来キーや文字列添字で undefined を返さないため、
   * 暗黙の `players[seat] === undefined` 判定ではガードを素通りしてしまう。明示検証で弾くことを固定する。
   */
  it('プロトタイプ由来キー・文字列添字も RangeError にする（暗黙 undefined 判定の穴を塞ぐ）', () => {
    for (const bad of ['__proto__', 'length', 'constructor', '0']) {
      expect(() => toPlayerView(state, bad as unknown as number)).toThrow(RangeError)
    }
  })
})

describe('toPlayerView — leak オラクル', () => {
  it('初期局面: 他家の手札 uid・山札 uid が JSON に一切現れない', () => {
    const state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 7, { humanSeats: [0] })
    const view = toPlayerView(state, 0)
    const json = JSON.stringify(view)

    const secretUids = [
      ...state.wall.map((card) => card.uid),
      ...state.players
        .filter((player) => player.id !== 0)
        .flatMap((player) => player.hand.map((card) => card.uid)),
    ]

    for (const uid of secretUids) {
      expect(uidLeaked(json, uid)).toBe(false)
    }
  })

  /**
   * [必須] claimWindow は全員表明まで閉じないため、「CPU が先に CLAIM・人間が未表明」の局面が
   * 単一人間プレイでも生じる。そのとき state.claims[cpu] に CPU の実カード（YakuCandidate）が入るため、
   * claims を素通しすると他家の手札が漏れる。ClaimStatus への redact を検査する。
   */
  it('claimWindow: CLAIM 済み CPU の実カードが漏れず、claims は状態のみになる', () => {
    const make = createCardSource()
    const claimCards = make('a1:pink a1:blue a1:orange') // CPU1 の手札＝CLAIM 構成カード
    const discarded = make('a2:pink')[0]
    const claim: YakuCandidate = {
      kind: 'triple',
      sameColor: false,
      cards: claimCards,
      bonusCount: 0,
      score: 120,
    }

    const state = gameState({
      phase: 'claimWindow',
      turn: 3,
      hands: [make('z1:pink z2:pink'), claimCards, make('z3:pink'), make('z4:pink')],
      wall: make('z5:pink z6:pink z7:pink'),
      discards: [[], [], [], [discarded]],
      lastDiscard: discarded,
      lastDiscardBy: 3,
      claims: { 0: null, 1: claim, 2: null },
    })

    const view = toPlayerView(state, 0)

    expect(view.claims[1]).toBe('claimed')
    expect(view.claims[0]).toBe('pending')
    expect(view.claims[2]).toBe('pending')
    expect(3 in view.claims).toBe(false) // 捨て札の本人は割り込み対象外（キーを持たない）

    const json = JSON.stringify(view)
    for (const card of claimCards) {
      expect(uidLeaked(json, card.uid)).toBe(false)
    }
  })
})

/**
 * [必須] events の redaction。`GameSnapshot.events` に生の GameEvent を載せると、CPU の引き札（CardDrawn）・
 * 補充札（Refilled）で他家の実カードが漏れる（view だけ redact しても無意味）。他家分の当該2種を除外し、
 * 公開イベントは維持することを、差分オラクル（生では漏れる／redact 後は漏れない）で機械的に固定する。
 */
describe('redactEvents — イベントの redaction', () => {
  const make = createCardSource()
  const selfDraw = make('a1:pink')[0]
  const cpuDraw = make('a2:pink')[0]
  const cpuRefill = make('a3:pink a3:blue')
  const discard = make('a4:pink')[0]

  it('他家の CardDrawn / Refilled は除外し、自席のもの・公開イベントは残す', () => {
    const events: GameEvent[] = [
      { type: 'CardDrawn', playerId: 0, card: selfDraw },
      { type: 'CardDrawn', playerId: 2, card: cpuDraw },
      { type: 'Refilled', playerId: 1, cards: cpuRefill },
      { type: 'Discarded', playerId: 2, card: discard },
      { type: 'TurnChanged', playerId: 3 },
    ]

    const redacted = redactEvents(events, 0)

    expect(redacted).toContainEqual({ type: 'CardDrawn', playerId: 0, card: selfDraw })
    expect(redacted.some((e) => e.type === 'CardDrawn' && e.playerId === 2)).toBe(false)
    expect(redacted.some((e) => e.type === 'Refilled')).toBe(false)
    // 河・手番は公開情報なので維持する。
    expect(redacted.some((e) => e.type === 'Discarded')).toBe(true)
    expect(redacted.some((e) => e.type === 'TurnChanged')).toBe(true)
  })

  it('leak オラクル: 他家の引き札・補充札 uid が生 events には現れ、redact 後には現れない', () => {
    const events: GameEvent[] = [
      { type: 'CardDrawn', playerId: 2, card: cpuDraw },
      { type: 'Refilled', playerId: 1, cards: cpuRefill },
    ]

    const rawJson = JSON.stringify(events)
    const redactedJson = JSON.stringify(redactEvents(events, 0))

    for (const card of [cpuDraw, ...cpuRefill]) {
      expect(uidLeaked(rawJson, card.uid)).toBe(true) // 生では漏れる＝検査が無意味でない証明
      expect(uidLeaked(redactedJson, card.uid)).toBe(false) // redact 後は漏れない
    }
  })

  it('自席の引き札は保持する（自分の CardDrawn は見せてよい）', () => {
    const events: GameEvent[] = [{ type: 'CardDrawn', playerId: 0, card: selfDraw }]
    const json = JSON.stringify(redactEvents(events, 0))
    expect(uidLeaked(json, selfDraw.uid)).toBe(true)
  })
})
