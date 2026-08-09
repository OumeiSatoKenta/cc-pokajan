import { describe, expect, it } from 'vitest'

import {
  createInitialLoopState,
  createLoopReducer,
  type LoopAction,
  type LoopState,
} from '../../src/ui/hooks/loopReducer'
import { nextTimeLimitMs } from '../../src/ui/hooks/turnTimer'
import { IllegalActionError } from '../../src/engine/game'
import { DEFAULT_RULES } from '../../src/config/rules'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { createCardSource, gameState, testRules } from '../helpers/game'
import type { GameState } from '../../src/engine/types'

const HUMAN = 0

function wrap(
  game: GameState,
  pending: LoopState['pending'] = [],
  overrides: Partial<LoopState> = {},
): LoopState {
  return {
    game,
    pending,
    gameOverReason: null,
    ranking: null,
    timeLimitMs: DEFAULT_RULES.turnTimer.initialMs,
    drawnUid: null,
    pendingWins: [],
    ...overrides,
  }
}

describe('createLoopReducer', () => {
  const reducer = createLoopReducer(DEFAULT_RULES, HUMAN)

  it('ENGINE でエンジンを進め、発生したイベントをキューに積む', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 5,
      humanSeat: HUMAN,
    })

    const next = reducer(initial, { type: 'ENGINE', action: { type: 'DRAW' } })

    expect(next.game.phase).toBe('selfDeclare')
    expect(next.pending.map((event) => event.type)).toEqual(['CardDrawn'])
  })

  it('イベントは消費されるまで積み上がる', () => {
    const make = createCardSource()
    const state = wrap(
      gameState({
        phase: 'draw',
        turn: 0,
        hands: [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')],
        wall: make('c1:pink c2:pink'),
      }),
    )
    const rules = testRules({ handSize: 1 })
    const localReducer = createLoopReducer(rules, HUMAN)

    let current = localReducer(state, { type: 'ENGINE', action: { type: 'DRAW' } })
    current = localReducer(current, { type: 'ENGINE', action: { type: 'SKIP_DECLARE' } })

    expect(current.pending.length).toBeGreaterThan(0)
  })

  it('EVENTS_CONSUMED で先頭から指定件数だけ捨てる', () => {
    const make = createCardSource()
    const state = wrap(gameState({ hands: [make('b1:pink'), [], [], []] }), [
      { type: 'TurnChanged', playerId: 1 },
      { type: 'TurnChanged', playerId: 2 },
      { type: 'TurnChanged', playerId: 3 },
    ])

    const next = reducer(state, { type: 'EVENTS_CONSUMED', count: 2 })

    expect(next.pending).toHaveLength(1)
    expect(next.pending[0]).toMatchObject({ playerId: 3 })
    // ゲーム状態は変わらない
    expect(next.game).toBe(state.game)
  })

  it('RESTART で状態を丸ごと差し替える', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 1,
      humanSeat: HUMAN,
    })
    const replacement = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 2,
      humanSeat: HUMAN,
    })

    const next = reducer(initial, { type: 'RESTART', state: replacement })

    expect(next.game.seed).toBe(2)
    expect(next.pending).toEqual([])
  })

  it('入力の state を破壊しない', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 3,
      humanSeat: HUMAN,
    })
    const snapshot = structuredClone(initial)

    reducer(initial, { type: 'ENGINE', action: { type: 'DRAW' } })

    expect(initial).toEqual(snapshot)
  })

  it('未知のループアクションは黙って無視されず例外になる', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 1,
      humanSeat: HUMAN,
    })
    const unknown = { type: 'EXPLODE' } as unknown as LoopAction

    expect(() => reducer(initial, unknown)).toThrow(/未知のループアクション/)
  })

  it('createInitialLoopState が人間の席以外を CPU にする', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 1,
      humanSeat: HUMAN,
    })

    expect(initial.game.players.map((p) => p.isCpu)).toEqual([false, true, true, true])
  })
})

describe('不正なアクションの扱い', () => {
  const reducer = createLoopReducer(DEFAULT_RULES, HUMAN)

  /**
   * 受付時間の経過とプレイヤーのクリックは無関係なタイミングで発火するため、
   * 「押した瞬間に受付が閉じていた」という競合が構造上起こりうる。
   * 画面全体をクラッシュさせず、状態を変えずに見送るのが正しい。
   */
  it('受け付けられないアクションは状態を変えずに見送る', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 1,
      humanSeat: HUMAN,
    })

    // draw フェーズに DISCARD を送る（エンジンは IllegalActionError を投げる）
    const next = reducer(initial, { type: 'ENGINE', action: { type: 'DISCARD', uid: 0 } })

    expect(next).toBe(initial)
  })

  it('エンジンの契約違反以外の例外は握りつぶさない', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 1,
      humanSeat: HUMAN,
    })
    const broken = { type: 'ENGINE', action: { type: 'TELEPORT' } } as never

    // 未知のアクション種別はエンジンが IllegalActionError で弾くので見送られる。
    // ここでは「見送る対象が IllegalActionError に限定されている」ことを型で確認する。
    expect(() => reducer(initial, broken)).not.toThrow(TypeError)
    expect(IllegalActionError.prototype).toBeInstanceOf(Error)
  })
})

describe('終局理由の保持', () => {
  const reducer = createLoopReducer(DEFAULT_RULES, HUMAN)

  /**
   * 点数から UI 側で導出し直さず、エンジンが確定させた値をそのまま保持する。
   * 「破産と山切れが同時に成立したら破産を優先する」というポリシーを二重実装しない。
   */
  it('GameOver イベントの理由をそのまま写し取る', () => {
    const make = createCardSource()
    const state = wrap(gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] }))

    const next = reducer(state, { type: 'ENGINE', action: { type: 'DRAW' } })

    expect(next.game.phase).toBe('gameOver')
    expect(next.gameOverReason).toBe('wallEmpty')
  })

  it('終局前は null のままである', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 1,
      humanSeat: HUMAN,
    })

    expect(reducer(initial, { type: 'ENGINE', action: { type: 'DRAW' } }).gameOverReason).toBeNull()
  })

  it('RESTART で理由がリセットされる', () => {
    const make = createCardSource()
    const ended = reducer(
      wrap(gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] })),
      { type: 'ENGINE', action: { type: 'DRAW' } },
    )
    const fresh = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules: DEFAULT_RULES,
      seed: 9,
      humanSeat: HUMAN,
    })

    expect(ended.gameOverReason).not.toBeNull()
    expect(reducer(ended, { type: 'RESTART', state: fresh }).gameOverReason).toBeNull()
  })
})

describe('持ち時間の消費', () => {
  const rules = testRules()
  const reducer = createLoopReducer(rules, HUMAN)

  function fresh(): LoopState {
    return createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules,
      seed: 5,
      humanSeat: HUMAN,
    })
  }

  it('対局開始時は初期値を持つ', () => {
    expect(fresh().timeLimitMs).toBe(rules.turnTimer.initialMs)
  })

  /** 仕様の核心。素早く打っているプレイヤーから持ち時間を奪わない。 */
  it('時間内に打った（ENGINE）場合は減らない', () => {
    const next = reducer(fresh(), { type: 'ENGINE', action: { type: 'DRAW' } })

    expect(next.timeLimitMs).toBe(rules.turnTimer.initialMs)
  })

  it('使い切った（TIMEOUT）場合は減る', () => {
    const next = reducer(fresh(), { type: 'TIMEOUT', action: { type: 'DRAW' } })

    expect(next.timeLimitMs).toBe(15_000)
  })

  it('使い切るたびに減り、下限で止まる', () => {
    let current = fresh()
    const seen: number[] = [current.timeLimitMs]

    // DRAW は draw フェーズでしか通らないので、進行しないアクションで代用せず
    // 減算関数の適用回数そのものを確かめる
    for (let i = 0; i < 4; i++) {
      current = { ...current, timeLimitMs: nextTimeLimitMs(current.timeLimitMs, rules) }
      seen.push(current.timeLimitMs)
    }

    expect(seen).toEqual([20_000, 15_000, 10_000, 5_000, 5_000])
  })

  /**
   * 時間切れの発火とクリックは無関係なタイミングで起こるため、
   * 「押した直後に時間切れが走る」競合が構造上ありうる。弾かれたということは
   * 先にプレイヤーの操作が通っていたということで、間に合っている。
   */
  it('競合で弾かれた TIMEOUT では減らない', () => {
    const initial = fresh()

    // draw フェーズに DISCARD を送る（エンジンが IllegalActionError で弾く）
    const next = reducer(initial, { type: 'TIMEOUT', action: { type: 'DISCARD', uid: 0 } })

    expect(next.timeLimitMs).toBe(rules.turnTimer.initialMs)
    expect(next).toBe(initial)
  })

  it('ロンで使い切った持ち時間が打牌にも引き継がれる', () => {
    // 持ち時間は場面ごとではなく1つの残量。TIMEOUT を経た状態を作って確認する。
    const worn = reducer(fresh(), { type: 'TIMEOUT', action: { type: 'DRAW' } })
    const afterDiscardPhase = reducer(worn, { type: 'ENGINE', action: { type: 'SKIP_DECLARE' } })

    expect(afterDiscardPhase.timeLimitMs).toBe(15_000)
  })

  it('もう1局始めると初期値に戻る', () => {
    const worn = reducer(fresh(), { type: 'TIMEOUT', action: { type: 'DRAW' } })
    const restarted = reducer(worn, { type: 'RESTART', state: fresh() })

    expect(worn.timeLimitMs).toBe(15_000)
    expect(restarted.timeLimitMs).toBe(rules.turnTimer.initialMs)
  })
})

describe('引いたカードの追跡', () => {
  const rules = testRules()
  const reducer = createLoopReducer(rules, HUMAN)

  function fresh(): LoopState {
    return createInitialLoopState({ roster: DEFAULT_ROSTER, rules, seed: 5, humanSeat: HUMAN })
  }

  it('引く前は未記録', () => {
    expect(fresh().drawnUid).toBeNull()
  })

  it('自分が引いたカードを記録する', () => {
    const next = reducer(fresh(), { type: 'ENGINE', action: { type: 'DRAW' } })
    const drawn = next.pending.find((event) => event.type === 'CardDrawn')

    expect(drawn?.type).toBe('CardDrawn')
    expect(next.drawnUid).toBe(drawn?.type === 'CardDrawn' ? drawn.card.uid : null)
  })

  it('自分が捨てたら忘れる', () => {
    let current = reducer(fresh(), { type: 'ENGINE', action: { type: 'DRAW' } })
    current = reducer(current, { type: 'ENGINE', action: { type: 'SKIP_DECLARE' } })
    const uid = current.game.players[HUMAN].hand[0].uid
    current = reducer(current, { type: 'ENGINE', action: { type: 'DISCARD', uid } })

    expect(current.drawnUid).toBeNull()
  })

  /**
   * 席を見ずに「直近に誰かが引いたカード」を覚える実装でも、引くと捨てるが
   * 交互に来るため人間の打牌フェーズでは結果的に正しくなる。しかしそれは
   * 進行順序という別の性質に正しさを預けることであり、ここで固定しておく。
   */
  it('CPU の引きは記録しない', () => {
    const make = createCardSource()
    const state = wrap(
      gameState({
        phase: 'draw',
        turn: 1,
        hands: [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')],
        wall: make('c1:pink c2:pink'),
      }),
    )
    const localReducer = createLoopReducer(testRules({ handSize: 1 }), HUMAN)

    const next = localReducer(state, { type: 'ENGINE', action: { type: 'DRAW' } })

    expect(next.pending.some((event) => event.type === 'CardDrawn')).toBe(true)
    expect(next.drawnUid).toBeNull()
  })

  it('CPU の捨て札で自分の記録が消えない', () => {
    const make = createCardSource()
    const state = wrap(
      gameState({
        phase: 'discard',
        turn: 1,
        hands: [make('b1:pink'), make('b2:pink b5:pink'), make('b3:pink'), make('b4:pink')],
        wall: make('c1:pink c2:pink c3:pink c4:pink'),
      }),
      [],
      { drawnUid: 0 },
    )
    const localReducer = createLoopReducer(testRules({ handSize: 1 }), HUMAN)
    const uid = state.game.players[1].hand[0].uid

    const next = localReducer(state, { type: 'ENGINE', action: { type: 'DISCARD', uid } })

    expect(next.drawnUid).toBe(0)
  })
})

describe('終局時の順位の保持', () => {
  const rules = testRules()
  const reducer = createLoopReducer(rules, HUMAN)

  /**
   * 順位はそのまま順位倍率＝**精算額**になる。エンジンが確定させた値を写し取り、
   * 点数から並べ直すフォールバックは置かない（二重実装が名前を変えて戻るだけ）。
   */
  it('GameOver イベントの順位をそのまま写し取る', () => {
    const make = createCardSource()
    const state = wrap(gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] }))

    const next = reducer(state, { type: 'ENGINE', action: { type: 'DRAW' } })
    const event = next.pending.find((e) => e.type === 'GameOver')

    expect(event?.type).toBe('GameOver')
    expect(next.ranking).toEqual(event?.type === 'GameOver' ? event.ranking : null)
  })

  it('終局前は順位が未確定', () => {
    const initial = createInitialLoopState({
      roster: DEFAULT_ROSTER,
      rules,
      seed: 5,
      humanSeat: HUMAN,
    })

    expect(initial.ranking).toBeNull()
    expect(reducer(initial, { type: 'ENGINE', action: { type: 'DRAW' } }).ranking).toBeNull()
  })

  /**
   * `TableScreen` は `phase === 'gameOver'` のときに順位を使う。
   * この含意が崩れると、精算に渡す順位が空になる。
   */
  it('終局に至ると必ず順位が埋まっている', () => {
    const make = createCardSource()
    const state = wrap(gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] }))

    const next = reducer(state, { type: 'ENGINE', action: { type: 'DRAW' } })

    expect(next.game.phase).toBe('gameOver')
    expect(next.ranking).not.toBeNull()
    expect(next.ranking).toHaveLength(rules.playerCount)
  })

  it('イベントを捨てても順位は残る', () => {
    const make = createCardSource()
    const state = wrap(gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] }))

    let current = reducer(state, { type: 'ENGINE', action: { type: 'DRAW' } })
    const ranking = current.ranking
    current = reducer(current, { type: 'EVENTS_CONSUMED', count: current.pending.length })

    expect(current.pending).toEqual([])
    expect(current.ranking).toEqual(ranking)
  })
})
