import { describe, expect, it } from 'vitest'

import { createLoopReducer, winKey, type LoopState } from '../../src/ui/hooks/loopReducer'
import { yakuContextOf } from '../../src/engine/gameSelectors'
import { findYaku } from '../../src/engine/yaku'
import { DEFAULT_RULES } from '../../src/config/rules'
import { createCardSource, gameState, testRules } from '../helpers/game'
import type { GameState, YakuCandidate } from '../../src/engine/types'

/**
 * 和了の確認ゲート（Step 7-4）の検証。
 *
 * **止まることそのものより、「止まっている間に何も進まない」ことが本体。**
 * 効果（`useEffect`）の停止は E2E でしか踏めないが、状態の側で受理されないことは
 * ここで固定できる。画面の無効化だけに頼らないという方針の担保でもある。
 */

const HUMAN = 0
const RULES = testRules({ handSize: 3 })

function wrap(game: GameState, overrides: Partial<LoopState> = {}): LoopState {
  return {
    game,
    pending: [],
    gameOverReason: null,
    ranking: null,
    timeLimitMs: RULES.turnTimer.initialMs,
    drawnUid: null,
    pendingWins: [],
    ...overrides,
  }
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

describe('和了で確認待ちになる', () => {
  const reducer = createLoopReducer(RULES, HUMAN)

  it('DECLARE で pendingWins が1件積まれる', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)

    const next = reducer(wrap(state), {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate },
    })

    expect(next.pendingWins).toHaveLength(1)
    expect(next.pendingWins[0].playerId).toBe(0)
    expect(next.pendingWins[0].winKind).toBe('tsumo')
    expect(next.pendingWins[0].candidate.kind).toBe('triple')
  })

  /** 和了でないアクションで止まると、対局が一歩も進まなくなる。 */
  it('和了でないアクションでは積まれない', () => {
    const next = reducer(wrap(tsumoReady()), {
      type: 'ENGINE',
      action: { type: 'SKIP_DECLARE' },
    })

    expect(next.pendingWins).toEqual([])
  })

  /**
   * **7-5 の得点移動が使うデータ。**
   *
   * `reduce` 後の `game.players[].score` から逆算しないのが要点で、
   * 1回の `reduce` で複数の和了が起きたときに全部が同じ最終点数になってしまう。
   */
  it('適用前後の点数を持つ', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)
    const before = state.players.map((player) => player.score)

    const next = reducer(wrap(state), {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate },
    })
    const win = next.pendingWins[0]

    expect(win.scoresBefore).toEqual(before)
    // 適用後は実際のエンジンの点数と一致する
    expect(win.scoresAfter).toEqual(next.game.players.map((player) => player.score))
    expect(win.scoresAfter[0]).toBeGreaterThan(win.scoresBefore[0])
  })

  /**
   * ツモは他3人が等分で支払う。**演出に出す増減は前後の差分から作る**ので、
   * 支払った側が減り、合計が動かないことを差分の側で確かめる。
   */
  it('増減が支払いの形と一致する（ツモは他3人が減る）', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)

    const next = reducer(wrap(state), {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate },
    })
    const win = next.pendingWins[0]
    const deltas = win.scoresAfter.map((score, id) => score - (win.scoresBefore[id] ?? 0))

    expect(deltas[0]).toBeGreaterThan(0)
    expect(deltas.slice(1).every((delta) => delta < 0)).toBe(true)

    // 点数保存則。演出の数字を足しても場の総和は動かない。
    expect(deltas.reduce((sum, delta) => sum + delta, 0)).toBe(0)
  })
})

describe('演出を閉じるまで進まない', () => {
  const reducer = createLoopReducer(RULES, HUMAN)

  /** 演出待ちの状態を作る。 */
  function paused(): LoopState {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)
    const next = reducer(wrap(state), {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate },
    })

    expect(next.pendingWins).toHaveLength(1)
    return next
  }

  /**
   * **効果を止めるだけでは足りない。**
   * オーバーレイの外側・キーボード操作・E2E からの直接クリックは残るため、
   * 状態の側でも受け付けない（`PLACE_BET` と同じ方針）。
   */
  it('停止中は ENGINE が受理されない', () => {
    const state = paused()
    const next = reducer(state, { type: 'ENGINE', action: { type: 'SKIP_DECLARE' } })

    expect(next).toBe(state)
    expect(next.game.phase).toBe(state.game.phase)
  })

  /**
   * **止め忘れると演出を読んでいる間にツモ切りされる。**
   * しかも持ち時間まで削られるため、次の手番が短くなる。
   */
  it('停止中は TIMEOUT で持ち時間が減らない', () => {
    const state = paused()
    const next = reducer(state, { type: 'TIMEOUT', action: { type: 'SKIP_DECLARE' } })

    expect(next).toBe(state)
    expect(next.timeLimitMs).toBe(state.timeLimitMs)
  })

  it('DISMISS_WIN で解除され、再び進められる', () => {
    const state = paused()
    const dismissed = reducer(state, { type: 'DISMISS_WIN', key: winKey(state.pendingWins[0]) })

    expect(dismissed.pendingWins).toEqual([])

    const advanced = reducer(dismissed, { type: 'ENGINE', action: { type: 'SKIP_DECLARE' } })
    expect(advanced.game.phase).not.toBe(dismissed.game.phase)
  })

  /**
   * **鍵が合わなければ何も落とさない。**
   *
   * 閉じる操作は自動クローズ・オーバーレイのクリック・パネル内のボタン・Escape の
   * 4経路から来る。ボタンの click はオーバーレイまで泡立つため、素直に書くと
   * 1回の操作で2回走る。鍵なしで「先頭を落とす」実装だと**2件消え**、
   * 連続和了の2件目が黙って飛ぶ（プレイヤーには点数バグに見える）。
   *
   * `stopPropagation` で塞ぐ手もあるが、それは「今の DOM 構造ではたまたま漏れない」
   * 形の正しさになる。ここで固定するのは構造に依存しない側の保証。
   */
  it('鍵が合わない DISMISS_WIN は何も落とさない', () => {
    const state = paused()
    const next = reducer(state, { type: 'DISMISS_WIN', key: 'まったく別の鍵' })

    expect(next).toBe(state)
    expect(next.pendingWins).toHaveLength(1)
  })

  /** 同じ鍵で2回送っても1件しか落ちない（泡立ちと二重クリックの再現）。 */
  it('同じ鍵を2回送っても落ちるのは1件だけ', () => {
    const state = paused()
    const key = winKey(state.pendingWins[0])

    const once = reducer(state, { type: 'DISMISS_WIN', key })
    const twice = reducer(once, { type: 'DISMISS_WIN', key })

    expect(once.pendingWins).toEqual([])
    expect(twice.pendingWins).toEqual([])
  })

  it('空の状態で DISMISS_WIN を送っても落ちない', () => {
    const state = wrap(tsumoReady())

    expect(() => reducer(state, { type: 'DISMISS_WIN', key: 'なんでもよい' })).not.toThrow()
    expect(reducer(state, { type: 'DISMISS_WIN', key: 'なんでもよい' }).pendingWins).toEqual([])
  })

  /** 表示済みイベントの掃除は進行ではないので、止めない。 */
  it('停止中でも EVENTS_CONSUMED は通る', () => {
    const state = paused()
    const next = reducer(state, { type: 'EVENTS_CONSUMED', count: state.pending.length })

    expect(next.pending).toEqual([])
    expect(next.pendingWins).toHaveLength(1)
  })
})

describe('連続宣言', () => {
  const reducer = createLoopReducer(RULES, HUMAN)

  /**
   * ポカジャンは和了しても局が終わらない。**1回の和了につき1回止まる**ことで、
   * 連続宣言でも取りこぼさずに見せられる。
   */
  it('1回の和了につき1件ずつ積まれ、1件ずつ解除される', () => {
    const make = createCardSource()
    // `a1` の3カードと `b1` の3カードを同時に持ち、2回続けて宣言できる手札
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
    let current = reducer(wrap(state), {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate: candidates[0] },
    })
    expect(current.pendingWins).toHaveLength(1)
    expect(current.game.phase).toBe('selfDeclare')

    // 閉じるまで2回目は宣言できない
    const blocked = reducer(current, {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate: candidates[1] },
    })
    expect(blocked).toBe(current)

    current = reducer(current, { type: 'DISMISS_WIN', key: winKey(current.pendingWins[0]) })
    expect(current.pendingWins).toEqual([])

    // 2回目
    const second = findYaku(current.game.players[0].hand, yakuContextOf(current.game, RULES))
    expect(second.length).toBeGreaterThan(0)

    current = reducer(current, {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate: second[0] },
    })
    expect(current.pendingWins).toHaveLength(1)

    // 2回目の始点は1回目の終点（点数が飛ばない）
    expect(current.pendingWins[0].scoresBefore[0]).toBeGreaterThan(RULES.startingScore)
  })
})

describe('winKey', () => {
  const reducer = createLoopReducer(RULES, HUMAN)

  /**
   * 鍵は「誰が・どのカードで」和了したかで決まる。構成カードは成立した時点で
   * 場から取り除かれ二度と戻らないため、1局のうちに重複しない。
   */
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

    let current = reducer(wrap(state), {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate: candidates[0] },
    })
    const firstKey = winKey(current.pendingWins[0])

    current = reducer(current, { type: 'DISMISS_WIN', key: firstKey })
    const second = findYaku(current.game.players[0].hand, yakuContextOf(current.game, RULES))
    current = reducer(current, {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate: second[0] },
    })

    expect(winKey(current.pendingWins[0])).not.toBe(firstKey)
  })

  /** 同じ和了からは何度呼んでも同じ鍵。React の `key` として使うために必要。 */
  it('同じ和了からは同じ鍵になる', () => {
    const state = tsumoReady()
    const candidate = onlyYaku(state, 0)
    const next = createLoopReducer(RULES, HUMAN)(wrap(state), {
      type: 'ENGINE',
      action: { type: 'DECLARE', playerId: 0, candidate },
    })

    expect(winKey(next.pendingWins[0])).toBe(winKey(next.pendingWins[0]))
    expect(winKey(next.pendingWins[0])).toContain('0:')
  })
})

describe('初期状態', () => {
  it('対局開始時は演出待ちが無い', () => {
    const reducer = createLoopReducer(DEFAULT_RULES, HUMAN)
    const state = wrap(tsumoReady())

    expect(state.pendingWins).toEqual([])
    expect(reducer(state, { type: 'EVENTS_CONSUMED', count: 0 }).pendingWins).toEqual([])
  })
})
