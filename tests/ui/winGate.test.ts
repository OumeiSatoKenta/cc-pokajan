import { describe, expect, it } from 'vitest'

import {
  createInitialLoopState,
  createLoopReducer,
  winKey,
  type LoopState,
} from '../../src/ui/hooks/loopReducer'
import { reduce } from '../../src/engine/game'
import { redactEvents, toPlayerView } from '../../src/engine/playerView'
import { yakuContextOf } from '../../src/engine/gameSelectors'
import { findYaku } from '../../src/engine/yaku'
import { createCardSource, gameState, testRules } from '../helpers/game'
import type { GameSnapshot } from '../../src/ui/transport/transport'
import type { Action, GameEvent, GameState, YakuCandidate } from '../../src/engine/types'

/**
 * 和了の確認ゲート（Step 7-4）の検証。
 *
 * Step 6 で「状態を進める」のは `localTransport`（engine `reduce`）に移り、`loopReducer` は snapshot の
 * events から **和了演出（`pendingWins`）を折り込む**役割になった。ここではその折り込み（`collectWins` 由来の
 * `scoresBefore`/`scoresAfter`・`winKind`・連続和了の1件ずつ）と `DISMISS_WIN` の鍵照合を固定する。
 *
 * **「停止中は進めない」進行停止そのものは `useGameLoop`（apply を呼ぶ前の `isPaused` ゲート）＋ E2E
 * `winGate.spec.ts` が担う**（リデューサは transport が独立に進めた snapshot を折り込むだけなので、
 * リデューサ内で INGEST を握り潰すと view が transport とずれる。ゲートは apply 側に置く）。
 */

const HUMAN = 0
const RULES = testRules({ handSize: 3 })
let versionCounter = 1

function snapshotOf(game: GameState, events: readonly GameEvent[] = []): GameSnapshot {
  return {
    id: 'local',
    version: ++versionCounter,
    view: toPlayerView(game, HUMAN),
    events: redactEvents(events, HUMAN),
    wallet: 0,
    outcome: null,
  }
}

/** engine action を1手適用し、snapshot と次の game を返す（localTransport と同じ生成）。 */
function apply(game: GameState, action: Action): { snapshot: GameSnapshot; next: GameState } {
  const result = reduce(game, action, RULES)
  return { snapshot: snapshotOf(result.state, result.events), next: result.state }
}

function seed(game: GameState, overrides: Partial<LoopState> = {}): LoopState {
  return {
    ...createInitialLoopState(RULES),
    view: toPlayerView(game, HUMAN),
    version: 1,
    ...overrides,
  }
}

const reducer = createLoopReducer(RULES)

function ingest(
  state: LoopState,
  snapshot: GameSnapshot,
  extra: { isTimeout?: boolean; accepted?: boolean } = {},
): LoopState {
  return reducer(state, {
    type: 'INGEST',
    snapshot,
    isTimeout: extra.isTimeout ?? false,
    accepted: extra.accepted ?? true,
  })
}

/** ツモ宣言できる局面。プレイヤー0 が `a1` の3カードを持っている。 */
function tsumoReady(): GameState {
  const make = createCardSource()
  return gameState({
    phase: 'selfDeclare',
    turn: 0,
    declarer: 0,
    hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
    wall: make('c1:pink c2:pink c3:pink c4:pink'),
  })
}

function onlyYaku(state: GameState, playerId: number): YakuCandidate {
  const candidates = findYaku(state.players[playerId].hand, yakuContextOf(state, RULES))
  expect(candidates).toHaveLength(1)
  return candidates[0]
}

/** 演出待ち（pendingWins に1件）の LoopState を作る。 */
function paused(): LoopState {
  const state = tsumoReady()
  const candidate = onlyYaku(state, 0)
  const next = ingest(
    seed(state),
    apply(state, { type: 'DECLARE', playerId: 0, candidate }).snapshot,
  )
  expect(next.pendingWins).toHaveLength(1)
  return next
}

describe('和了で演出待ちが積まれる', () => {
  it('DECLARE の snapshot で pendingWins が1件積まれる', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)
    const { snapshot } = apply(state, { type: 'DECLARE', playerId: 0, candidate })

    const next = ingest(seed(state), snapshot)

    expect(next.pendingWins).toHaveLength(1)
    expect(next.pendingWins[0].playerId).toBe(0)
    expect(next.pendingWins[0].winKind).toBe('tsumo')
    expect(next.pendingWins[0].candidate.kind).toBe('triple')
  })

  it('和了でないアクション（SKIP_DECLARE）では積まれない', () => {
    const state = tsumoReady()
    const next = ingest(seed(state), apply(state, { type: 'SKIP_DECLARE' }).snapshot)

    expect(next.pendingWins).toEqual([])
  })

  /**
   * **7-5 の得点移動が使うデータ。** `scoresBefore` は INGEST 前の view の点数（Paid で前進）。1回の
   * reduce で複数和了が起きても、走査で点数を持ち回るのでそれぞれの始点が正しく入る。
   */
  it('適用前後の点数を持つ', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)
    const before = state.players.map((player) => player.score)

    const next = ingest(
      seed(state),
      apply(state, { type: 'DECLARE', playerId: 0, candidate }).snapshot,
    )
    const win = next.pendingWins[0]

    expect(win.scoresBefore).toEqual(before)
    // 適用後は snapshot の view の点数（＝エンジンの点数）と一致する。
    expect(win.scoresAfter).toEqual(next.view?.players.map((player) => player.score))
    expect(win.scoresAfter[0]).toBeGreaterThan(win.scoresBefore[0])
  })

  /** ツモは他3人が等分で支払う。増減は前後の差分から作るので、支払った側が減り総和が動かない。 */
  it('増減が支払いの形と一致する（ツモは他3人が減る）', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)

    const next = ingest(
      seed(state),
      apply(state, { type: 'DECLARE', playerId: 0, candidate }).snapshot,
    )
    const win = next.pendingWins[0]
    const deltas = win.scoresAfter.map((score, id) => score - (win.scoresBefore[id] ?? 0))

    expect(deltas[0]).toBeGreaterThan(0)
    expect(deltas.slice(1).every((delta) => delta < 0)).toBe(true)
    expect(deltas.reduce((sum, delta) => sum + delta, 0)).toBe(0)
  })
})

describe('DISMISS_WIN の鍵照合', () => {
  it('DISMISS_WIN で解除される', () => {
    const state = paused()
    const dismissed = reducer(state, { type: 'DISMISS_WIN', key: winKey(state.pendingWins[0]) })

    expect(dismissed.pendingWins).toEqual([])
  })

  /**
   * **鍵が合わなければ何も落とさない。** 閉じる操作は自動クローズ・オーバーレイのクリック・パネル内の
   * ボタン・Escape の4経路から来る。鍵なしで「先頭を落とす」と二重に走って2件消え、連続和了の2件目が飛ぶ。
   */
  it('鍵が合わない DISMISS_WIN は何も落とさない', () => {
    const state = paused()
    const next = reducer(state, { type: 'DISMISS_WIN', key: 'まったく別の鍵' })

    expect(next).toBe(state)
    expect(next.pendingWins).toHaveLength(1)
  })

  it('同じ鍵を2回送っても落ちるのは1件だけ', () => {
    const state = paused()
    const key = winKey(state.pendingWins[0])

    const once = reducer(state, { type: 'DISMISS_WIN', key })
    const twice = reducer(once, { type: 'DISMISS_WIN', key })

    expect(once.pendingWins).toEqual([])
    expect(twice.pendingWins).toEqual([])
  })

  it('空の状態で DISMISS_WIN を送っても落ちない', () => {
    const state = seed(tsumoReady())

    expect(() => reducer(state, { type: 'DISMISS_WIN', key: 'なんでもよい' })).not.toThrow()
    expect(reducer(state, { type: 'DISMISS_WIN', key: 'なんでもよい' }).pendingWins).toEqual([])
  })

  /** 表示済みイベントの掃除は進行ではないので、演出待ちでも通す。 */
  it('演出待ちでも EVENTS_CONSUMED は通る', () => {
    const state = paused()
    const next = reducer(state, { type: 'EVENTS_CONSUMED', count: state.pending.length })

    expect(next.pending).toEqual([])
    expect(next.pendingWins).toHaveLength(1)
  })
})

describe('連続宣言', () => {
  /**
   * ポカジャンは和了しても局が終わらない。**1回の和了につき1件ずつ積まれ、1件ずつ解除される。**
   * 2回目の始点は1回目の終点（点数が飛ばない）。
   */
  it('1件ずつ積まれ、2回目の始点が1回目の終点になる', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      declarer: 0,
      hands: [
        make('a1:pink a1:blue a1:orange b1:pink b1:blue b1:orange'),
        make('c1:pink'),
        make('c2:pink'),
        make('c3:pink'),
      ],
      wall: make('c4:pink c5:pink a2:pink a3:pink b2:pink b3:pink'),
    })

    const candidates = findYaku(state.players[0].hand, yakuContextOf(state, RULES))
    expect(candidates.length).toBeGreaterThanOrEqual(2)

    // 1回目
    const first = apply(state, { type: 'DECLARE', playerId: 0, candidate: candidates[0] })
    let current = ingest(seed(state), first.snapshot)
    expect(current.pendingWins).toHaveLength(1)
    expect(current.view?.phase).toBe('selfDeclare')

    // 閉じる
    current = reducer(current, { type: 'DISMISS_WIN', key: winKey(current.pendingWins[0]) })
    expect(current.pendingWins).toEqual([])

    // 2回目（1回目適用後の game・手札から）
    const second = findYaku(first.next.players[0].hand, yakuContextOf(first.next, RULES))
    expect(second.length).toBeGreaterThan(0)
    current = ingest(
      current,
      apply(first.next, { type: 'DECLARE', playerId: 0, candidate: second[0] }).snapshot,
    )

    expect(current.pendingWins).toHaveLength(1)
    // 2回目の始点は1回目の終点（＝ INGEST 前の view の点数）。開始点より高い。
    expect(current.pendingWins[0].scoresBefore[0]).toBeGreaterThan(RULES.startingScore)
  })
})

describe('winKey', () => {
  it('和了ごとに異なる鍵になる', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      declarer: 0,
      hands: [
        make('a1:pink a1:blue a1:orange b1:pink b1:blue b1:orange'),
        make('c1:pink'),
        make('c2:pink'),
        make('c3:pink'),
      ],
      wall: make('c4:pink c5:pink a2:pink a3:pink b2:pink b3:pink'),
    })

    const candidates = findYaku(state.players[0].hand, yakuContextOf(state, RULES))
    const first = apply(state, { type: 'DECLARE', playerId: 0, candidate: candidates[0] })
    let current = ingest(seed(state), first.snapshot)
    const firstKey = winKey(current.pendingWins[0])

    current = reducer(current, { type: 'DISMISS_WIN', key: firstKey })
    const second = findYaku(first.next.players[0].hand, yakuContextOf(first.next, RULES))
    current = ingest(
      current,
      apply(first.next, { type: 'DECLARE', playerId: 0, candidate: second[0] }).snapshot,
    )

    expect(winKey(current.pendingWins[0])).not.toBe(firstKey)
  })

  it('同じ和了からは同じ鍵になる', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)
    const next = ingest(
      seed(state),
      apply(state, { type: 'DECLARE', playerId: 0, candidate }).snapshot,
    )

    expect(winKey(next.pendingWins[0])).toBe(winKey(next.pendingWins[0]))
    expect(winKey(next.pendingWins[0])).toContain('0:')
  })
})

describe('初期状態', () => {
  it('対局開始時は演出待ちが無い', () => {
    const state = seed(tsumoReady())

    expect(state.pendingWins).toEqual([])
    expect(reducer(state, { type: 'EVENTS_CONSUMED', count: 0 }).pendingWins).toEqual([])
  })
})
