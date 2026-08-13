import { describe, expect, it } from 'vitest'

import {
  createInitialLoopState,
  createLoopReducer,
  type LoopAction,
  type LoopState,
} from '../../src/ui/hooks/loopReducer'
import { reduce } from '../../src/engine/game'
import { redactEvents, toPlayerView } from '../../src/engine/playerView'
import { DEFAULT_RULES } from '../../src/config/rules'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { createCardSource, gameState, testRules } from '../helpers/game'
import { createGame } from '../../src/engine/game'
import type { GameSnapshot } from '../../src/ui/transport/transport'
import type { Action, GameEvent, GameState, RulesConfig } from '../../src/engine/types'

/**
 * Step 6 で `loopReducer` は「transport が出した `GameSnapshot`（`PlayerView` + 差分 events）を UI 状態へ
 * 折り込む」役割に純化した。状態を進める `reduce` は `localTransport` へ移ったので、ここでは
 * **localTransport が出すのと同じ形の snapshot を組んで INGEST に流し、折り込みの正しさ**を検査する
 * （`snapshotOf` は localTransport の snapshot 生成と同じく `toPlayerView` + `redactEvents` を通す）。
 */

const HUMAN = 0
let versionCounter = 1

/** localTransport が出すのと同じ snapshot（events は redact 済み）を組む。 */
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

/** engine action を1手適用し、localTransport が返すのと同じ snapshot を作る。 */
function apply(game: GameState, action: Action, rules: RulesConfig = DEFAULT_RULES): GameSnapshot {
  const result = reduce(game, action, rules)
  return snapshotOf(result.state, result.events)
}

/** view を持った LoopState を作る（INGEST_CREATE 済み相当）。 */
function seed(
  game: GameState,
  rules: RulesConfig = DEFAULT_RULES,
  overrides: Partial<LoopState> = {},
): LoopState {
  return {
    ...createInitialLoopState(rules),
    view: toPlayerView(game, HUMAN),
    version: 1,
    ...overrides,
  }
}

function ingest(
  state: LoopState,
  snapshot: GameSnapshot,
  reducer = createLoopReducer(DEFAULT_RULES),
  extra: { isTimeout?: boolean; accepted?: boolean } = {},
): LoopState {
  return reducer(state, {
    type: 'INGEST',
    snapshot,
    isTimeout: extra.isTimeout ?? false,
    accepted: extra.accepted ?? true,
  })
}

describe('createLoopReducer — INGEST の折り込み', () => {
  const reducer = createLoopReducer(DEFAULT_RULES)

  it('INGEST で view を差し替え、発生したイベントをキューに積む', () => {
    const game = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 5, { humanSeats: [HUMAN] })
    const next = ingest(seed(game), apply(game, { type: 'DRAW' }), reducer)

    expect(next.view?.phase).toBe('selfDeclare')
    expect(next.pending.map((event) => event.type)).toEqual(['CardDrawn'])
  })

  it('イベントは消費されるまで（置き換えでなく）積み上がる', () => {
    const make = createCardSource()
    const game = gameState({ hands: [make('b1:pink'), [], [], []] })

    // 連続する2つの INGEST の events が置き換わらず連結されることを確かめる。
    let current = ingest(
      seed(game),
      snapshotOf(game, [{ type: 'TurnChanged', playerId: 1 }]),
      reducer,
    )
    current = ingest(current, snapshotOf(game, [{ type: 'TurnChanged', playerId: 2 }]), reducer)

    expect(current.pending).toHaveLength(2)
    expect(
      current.pending.map((event) => (event.type === 'TurnChanged' ? event.playerId : -1)),
    ).toEqual([1, 2])
  })

  it('EVENTS_CONSUMED で先頭から指定件数だけ捨てる（view は変えない）', () => {
    const make = createCardSource()
    const state = seed(gameState({ hands: [make('b1:pink'), [], [], []] }), DEFAULT_RULES, {
      pending: [
        { type: 'TurnChanged', playerId: 1 },
        { type: 'TurnChanged', playerId: 2 },
        { type: 'TurnChanged', playerId: 3 },
      ],
    })

    const next = reducer(state, { type: 'EVENTS_CONSUMED', count: 2 })

    expect(next.pending).toHaveLength(1)
    expect(next.pending[0]).toMatchObject({ playerId: 3 })
    expect(next.view).toBe(state.view)
  })

  it('入力の state を破壊しない', () => {
    const game = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 3, { humanSeats: [HUMAN] })
    const state = seed(game)
    const snapshot = structuredClone(state)

    ingest(state, apply(game, { type: 'DRAW' }), reducer)

    expect(state).toEqual(snapshot)
  })

  it('未知のループアクションは黙って無視されず例外になる', () => {
    const game = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 1, { humanSeats: [HUMAN] })
    const unknown = { type: 'EXPLODE' } as unknown as LoopAction

    expect(() => reducer(seed(game), unknown)).toThrow(/未知のループアクション/)
  })

  it('create 前は view が null（loading）', () => {
    expect(createInitialLoopState(DEFAULT_RULES).view).toBeNull()
  })
})

describe('終局理由・順位の保持', () => {
  const reducer = createLoopReducer(DEFAULT_RULES)

  /**
   * 点数から UI 側で導出し直さず、エンジンが `GameOver` で確定させた値をそのまま保持する。
   * 「破産と山切れが同時に成立したら破産を優先する」ポリシーを二重実装しない。
   */
  it('GameOver イベントの理由と順位をそのまま写し取る', () => {
    const make = createCardSource()
    const game = gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] })
    const snapshot = apply(game, { type: 'DRAW' })
    const gameOver = snapshot.events.find((e) => e.type === 'GameOver')

    const next = ingest(seed(game), snapshot, reducer)

    expect(next.view?.phase).toBe('gameOver')
    expect(next.gameOverReason).toBe('wallEmpty')
    expect(next.ranking).toEqual(gameOver?.type === 'GameOver' ? gameOver.ranking : null)
    expect(next.ranking).toHaveLength(DEFAULT_RULES.playerCount)
  })

  it('終局前は理由も順位も null', () => {
    const game = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 1, { humanSeats: [HUMAN] })
    const next = ingest(seed(game), apply(game, { type: 'DRAW' }), reducer)

    expect(next.gameOverReason).toBeNull()
    expect(next.ranking).toBeNull()
  })

  it('イベントを捨てても理由・順位は残る', () => {
    const make = createCardSource()
    const game = gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] })

    let current = ingest(seed(game), apply(game, { type: 'DRAW' }), reducer)
    const ranking = current.ranking
    current = reducer(current, { type: 'EVENTS_CONSUMED', count: current.pending.length })

    expect(current.pending).toEqual([])
    expect(current.ranking).toEqual(ranking)
  })
})

describe('持ち時間の消費', () => {
  const rules = testRules()
  const reducer = createLoopReducer(rules)
  const game = createGame(DEFAULT_ROSTER, rules, 5, { humanSeats: [HUMAN] })

  it('対局開始時は初期値を持つ', () => {
    expect(seed(game, rules).timeLimitMs).toBe(rules.turnTimer.initialMs)
  })

  /** 仕様の核心。素早く打っている（time-out でない）INGEST では持ち時間を減らさない。 */
  it('時間内に打った（isTimeout:false）場合は減らない', () => {
    const next = ingest(seed(game, rules), apply(game, { type: 'DRAW' }, rules), reducer)

    expect(next.timeLimitMs).toBe(rules.turnTimer.initialMs)
  })

  it('使い切った（isTimeout:true・accepted）場合は減る', () => {
    const next = ingest(seed(game, rules), apply(game, { type: 'DRAW' }, rules), reducer, {
      isTimeout: true,
      accepted: true,
    })

    expect(next.timeLimitMs).toBe(15_000)
  })

  /**
   * 時間切れの発火とクリックは無関係なタイミングで起こるため、「押した直後に時間切れが走る」競合が構造上
   * ありうる。弾かれた（accepted:false）ということは先に操作が通っていた＝間に合っている。減らさない。
   */
  it('競合で弾かれた（isTimeout:true・accepted:false）では減らない', () => {
    const start = seed(game, rules)
    // 競合時、localTransport は「進んでいない現在の snapshot」を accepted:false で返す。
    const next = ingest(start, snapshotOf(game), reducer, { isTimeout: true, accepted: false })

    expect(next.timeLimitMs).toBe(rules.turnTimer.initialMs)
  })
})

describe('引いたカードの追跡（drawnUid）', () => {
  const rules = testRules({ handSize: 1 })
  const reducer = createLoopReducer(rules)

  it('自分が引いたカードを記録する', () => {
    const make = createCardSource()
    const game = gameState({
      phase: 'draw',
      turn: HUMAN,
      hands: [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')],
      wall: make('c1:pink c2:pink'),
    })
    const snapshot = apply(game, { type: 'DRAW' }, rules)
    const drawn = snapshot.events.find((e) => e.type === 'CardDrawn')

    const next = ingest(seed(game, rules), snapshot, reducer)

    expect(drawn?.type).toBe('CardDrawn')
    expect(next.drawnUid).toBe(drawn?.type === 'CardDrawn' ? drawn.card.uid : null)
  })

  /**
   * **redaction と drawnUid の両方を1つで固定する。** CPU の引きは redactEvents で snapshot から消えるので、
   * トラッキングが CPU の CardDrawn に反応する経路がそもそも無い（他家手札の uid が UI に出ない）。
   */
  it('CPU の引きは snapshot に現れず、記録もしない', () => {
    const make = createCardSource()
    const game = gameState({
      phase: 'draw',
      turn: 1,
      hands: [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')],
      wall: make('c1:pink c2:pink'),
    })
    const snapshot = apply(game, { type: 'DRAW' }, rules)

    const next = ingest(seed(game, rules), snapshot, reducer)

    expect(snapshot.events.some((e) => e.type === 'CardDrawn')).toBe(false)
    expect(next.drawnUid).toBeNull()
  })

  it('CPU の捨て札で自分の記録が消えない', () => {
    const make = createCardSource()
    const game = gameState({
      phase: 'discard',
      turn: 1,
      hands: [make('b1:pink'), make('b2:pink b5:pink'), make('b3:pink'), make('b4:pink')],
      wall: make('c1:pink c2:pink c3:pink c4:pink'),
    })
    const uid = game.players[1].hand[0].uid
    const snapshot = apply(game, { type: 'DISCARD', uid }, rules)

    const next = ingest(seed(game, rules, { drawnUid: 0 }), snapshot, reducer)

    expect(next.drawnUid).toBe(0)
  })
})
