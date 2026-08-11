import { describe, expect, it } from 'vitest'
import {
  IllegalActionError,
  createGame,
  expectedHandSize,
  reduce,
  resolveClaimWinner,
  yakuContextOf,
} from '../../src/engine/game'
import { findYaku } from '../../src/engine/yaku'
import { DEFAULT_RULES } from '../../src/config/rules'
import { DEFAULT_ROSTER } from '../../src/config/defaultRoster'
import { TEST_GROUPS } from '../helpers/cards'
import { allCardUids, createCardSource, gameState, testRules, totalScore } from '../helpers/game'
import type { Action, Card, GameEvent, GameState, YakuCandidate } from '../../src/engine/types'

/** 手札から唯一成立している役を取り出す。テストの意図を短く書くための補助。 */
function onlyYaku(state: GameState, playerId: number): YakuCandidate {
  const candidates = findYaku(state.players[playerId].hand, yakuContextOf(state, DEFAULT_RULES))
  expect(candidates).toHaveLength(1)
  return candidates[0]
}

function eventTypes(events: readonly GameEvent[]): string[] {
  return events.map((event) => event.type)
}

describe('createGame', () => {
  it('配牌済みの初期状態を返す', () => {
    const state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 7)

    expect(state.phase).toBe('draw')
    expect(state.turn).toBe(0)
    expect(state.declarer).toBe(0)
    expect(state.players).toHaveLength(DEFAULT_RULES.playerCount)

    for (const player of state.players) {
      expect(player.hand).toHaveLength(DEFAULT_RULES.handSize)
      expect(player.score).toBe(DEFAULT_RULES.startingScore)
      expect(player.discards).toEqual([])
      expect(player.declared).toEqual([])
    }

    const dealt = DEFAULT_RULES.playerCount * DEFAULT_RULES.handSize
    expect(state.wall).toHaveLength(DEFAULT_RULES.deckSize - dealt)
  })

  it('同一シードなら完全に同じ状態になる', () => {
    const a = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 42)
    const b = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 42)

    expect(a).toEqual(b)
  })

  it('シードが違えば異なる配牌になる', () => {
    const a = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 1)
    const b = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 2)

    expect(a.players[0].hand).not.toEqual(b.players[0].hand)
  })

  it('既定では0番だけが人間で、humanSeats を空にすると全員 CPU になる', () => {
    const withHuman = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 1)
    expect(withHuman.players.map((player) => player.isCpu)).toEqual([false, true, true, true])

    const allCpu = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 1, { humanSeats: [] })
    expect(allCpu.players.every((player) => player.isCpu)).toBe(true)
  })
})

describe('フェーズ遷移の基本経路', () => {
  it('draw → selfDeclare → discard → claimWindow → 次の手番へ一巡する', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'draw',
      turn: 0,
      hands: [make('b1:pink b2:blue'), make('b3:pink b4:blue'), make('c1:pink'), make('c2:pink')],
      wall: make('b1:orange z9:pink'),
    })
    const rules = testRules({ handSize: 2 })

    const drawn = reduce(state, { type: 'DRAW' }, rules)
    expect(drawn.state.phase).toBe('selfDeclare')
    expect(drawn.state.players[0].hand).toHaveLength(3)
    expect(drawn.state.wall).toHaveLength(1)
    expect(eventTypes(drawn.events)).toEqual(['CardDrawn'])

    const skipped = reduce(drawn.state, { type: 'SKIP_DECLARE' }, rules)
    expect(skipped.state.phase).toBe('discard')

    const uid = skipped.state.players[0].hand[0].uid
    const discarded = reduce(skipped.state, { type: 'DISCARD', uid }, rules)
    expect(discarded.state.phase).toBe('claimWindow')
    expect(discarded.state.players[0].discards).toHaveLength(1)
    expect(discarded.state.lastDiscardBy).toBe(0)
    expect(discarded.state.claimTimerMs).toBe(rules.turnTimer.initialMs)
    // 手番以外の3人が「未決定」として明示的に並ぶ
    expect(discarded.state.claims).toEqual({ 1: null, 2: null, 3: null })

    let current = discarded.state
    for (const playerId of [1, 2, 3]) {
      current = reduce(current, { type: 'PASS', playerId }, rules).state
    }

    expect(current.phase).toBe('draw')
    expect(current.turn).toBe(1)
    expect(current.declarer).toBe(1)
    expect(current.lastDiscard).toBeNull()
  })

  it('手番は反時計回り（ID 昇順）に一周する', () => {
    const rules = testRules({ handSize: 1 })
    const make = createCardSource()
    let state = gameState({
      phase: 'discard',
      turn: 3,
      hands: [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')],
    })

    state = reduce(state, { type: 'DISCARD', uid: state.players[3].hand[0].uid }, rules).state
    for (const playerId of [0, 1, 2]) {
      state = reduce(state, { type: 'PASS', playerId }, rules).state
    }

    expect(state.turn).toBe(0)
  })

  it('山札が空のまま DRAW すると山切れで終局する', () => {
    const make = createCardSource()
    const state = gameState({ phase: 'draw', hands: [make('b1:pink'), [], [], []], wall: [] })

    const result = reduce(state, { type: 'DRAW' }, DEFAULT_RULES)

    expect(result.state.phase).toBe('gameOver')
    expect(result.events).toContainEqual({
      type: 'GameOver',
      ranking: [0, 1, 2, 3],
      reason: 'wallEmpty',
    })
  })

  it('gameOver に到達した後はどのアクションでも状態が変わらない', () => {
    const make = createCardSource()
    const over = gameState({ phase: 'gameOver', hands: [make('b1:pink'), [], [], []] })

    const actions: Action[] = [
      { type: 'DRAW' },
      { type: 'SKIP_DECLARE' },
      { type: 'DISCARD', uid: 0 },
      { type: 'PASS', playerId: 1 },
      { type: 'TICK', deltaMs: 1000 },
    ]

    for (const action of actions) {
      const result = reduce(over, action, DEFAULT_RULES)
      expect(result.state).toBe(over)
      expect(result.events).toEqual([])
    }
  })
})

describe('不正なアクション', () => {
  const make = createCardSource()
  const base = gameState({
    phase: 'selfDeclare',
    turn: 0,
    hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
    wall: make('c1:pink c2:pink c3:pink'),
  })

  it('フェーズが受け付けないアクションは例外になる', () => {
    expect(() => reduce(base, { type: 'DRAW' }, DEFAULT_RULES)).toThrow(IllegalActionError)
    expect(() => reduce(base, { type: 'DISCARD', uid: 0 }, DEFAULT_RULES)).toThrow(
      IllegalActionError,
    )
    expect(() => reduce(base, { type: 'TICK', deltaMs: 1 }, DEFAULT_RULES)).toThrow(
      IllegalActionError,
    )
  })

  it('宣言権のないプレイヤーの DECLARE は例外になる', () => {
    const candidate = onlyYaku(base, 0)

    expect(() => reduce(base, { type: 'DECLARE', playerId: 1, candidate }, DEFAULT_RULES)).toThrow(
      /宣言権を持つのはプレイヤー0/,
    )
  })

  it('手札にないカードの DISCARD は例外になる', () => {
    const discardPhase = { ...base, phase: 'discard' as const }

    expect(() => reduce(discardPhase, { type: 'DISCARD', uid: 999 }, DEFAULT_RULES)).toThrow(
      /uid 999 のカードがありません/,
    )
  })

  it('手番プレイヤー自身は割り込めない', () => {
    const make2 = createCardSource()
    const window = gameState({
      phase: 'claimWindow',
      turn: 0,
      hands: [make2('b1:pink'), make2('b2:pink'), make2('b3:pink'), make2('b4:pink')],
      lastDiscard: make2('c1:pink')[0],
      lastDiscardBy: 0,
      claims: { 1: null, 2: null, 3: null },
    })

    expect(() => reduce(window, { type: 'PASS', playerId: 0 }, DEFAULT_RULES)).toThrow(
      /自分の捨て札に対して/,
    )
  })

  it('二重の意思表示は例外になる', () => {
    const make2 = createCardSource()
    const window = gameState({
      phase: 'claimWindow',
      turn: 0,
      hands: [make2('b1:pink'), make2('b2:pink'), make2('b3:pink'), make2('b4:pink')],
      lastDiscard: make2('c1:pink')[0],
      lastDiscardBy: 0,
      claims: { 1: 'pass', 2: null, 3: null },
    })

    expect(() => reduce(window, { type: 'PASS', playerId: 1 }, DEFAULT_RULES)).toThrow(
      /既に意思表示を終えています/,
    )
  })

  it('TICK の deltaMs が負なら例外になる', () => {
    const make2 = createCardSource()
    const window = gameState({
      phase: 'claimWindow',
      turn: 0,
      hands: [make2('b1:pink'), make2('b2:pink'), make2('b3:pink'), make2('b4:pink')],
      lastDiscard: make2('c1:pink')[0],
      lastDiscardBy: 0,
      claims: { 1: null, 2: null, 3: null },
      claimTimerMs: 4000,
    })

    expect(() => reduce(window, { type: 'TICK', deltaMs: -1 }, DEFAULT_RULES)).toThrow(
      IllegalActionError,
    )
  })
})

describe('候補の再計算による検証', () => {
  const make = createCardSource()
  const state = gameState({
    phase: 'selfDeclare',
    turn: 0,
    hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
    wall: make('c1:pink c2:pink c3:pink'),
  })

  it('成立していない役の宣言は例外になる', () => {
    const fake: YakuCandidate = {
      kind: 'triple',
      sameColor: false,
      cards: [{ uid: 900, memberId: 'a2', color: 'pink' }],
      bonusCount: 0,
      score: 9999,
    }

    expect(() =>
      reduce(state, { type: 'DECLARE', playerId: 0, candidate: fake }, DEFAULT_RULES),
    ).toThrow(/現在の手札では成立しません/)
  })

  it('点数を偽装した候補を渡しても、精算にはエンジンが再計算した点数が使われる', () => {
    const real = onlyYaku(state, 0)
    const forged: YakuCandidate = { ...real, score: 999_999 }

    const result = reduce(state, { type: 'DECLARE', playerId: 0, candidate: forged }, DEFAULT_RULES)

    // 3カード（通常）= 120点。他3人が 40 点ずつ支払う。
    expect(real.score).toBe(120)
    expect(result.state.players[0].score).toBe(DEFAULT_RULES.startingScore + 120)
    for (const playerId of [1, 2, 3]) {
      expect(result.state.players[playerId].score).toBe(DEFAULT_RULES.startingScore - 40)
    }
    expect(totalScore(result.state)).toBe(DEFAULT_RULES.startingScore * 4)

    const declared = result.events.find((event) => event.type === 'Declared')
    expect(declared).toMatchObject({ winKind: 'tsumo' })
    expect(result.state.players[0].declared[0].score).toBe(120)
  })

  it('役の形をしていない候補は専用の例外になる（素の TypeError にしない）', () => {
    const malformed = { kind: 'triple' } as unknown as YakuCandidate

    expect(() =>
      reduce(state, { type: 'DECLARE', playerId: 0, candidate: malformed }, DEFAULT_RULES),
    ).toThrow(IllegalActionError)
  })

  it('役種を偽装しても、選んだカードから再計算した役種・点数が採用される', () => {
    // 検証で使われるのは cards の uid だけ。kind/sameColor/score は無視して再計算される。
    // a1 の3カード(triple, 120点)を group5(高得点役)に偽装しても triple として確定する。
    const real = onlyYaku(state, 0)
    const forged: YakuCandidate = { ...real, kind: 'group5', sameColor: true, score: 999_999 }

    const result = reduce(state, { type: 'DECLARE', playerId: 0, candidate: forged }, DEFAULT_RULES)

    const declared = result.state.players[0].declared[0]
    expect(declared.kind).toBe('triple')
    expect(declared.sameColor).toBe(false)
    expect(declared.score).toBe(120)
    expect(totalScore(result.state)).toBe(DEFAULT_RULES.startingScore * 4)
  })

  /**
   * CLAIM 側の再計算は DECLARE とは別の呼び出し（`required` 付きの findYaku）を通るため、
   * DECLARE のテストだけでは検証されない。
   */
  describe('CLAIM 側', () => {
    function claimWindowState() {
      const make = createCardSource()
      const discarded = make('a1:pink')[0]

      return gameState({
        phase: 'claimWindow',
        turn: 0,
        hands: [
          make('z1:pink'),
          make('a1:blue a1:orange z2:pink'),
          make('z3:pink'),
          make('z4:pink'),
        ],
        wall: make('z5:pink z6:pink z7:pink'),
        discards: [[discarded], [], [], []],
        lastDiscard: discarded,
        lastDiscardBy: 0,
        claims: { 1: null, 2: null, 3: null },
      })
    }

    it('成立していない役の CLAIM は例外になる', () => {
      const window = claimWindowState()
      const fake: YakuCandidate = {
        kind: 'triple',
        sameColor: false,
        cards: [{ uid: 900, memberId: 'a2', color: 'pink' }],
        bonusCount: 0,
        score: 9999,
      }

      expect(() =>
        reduce(window, { type: 'CLAIM', playerId: 1, candidate: fake }, DEFAULT_RULES),
      ).toThrow(/現在の手札では成立しません/)
    })

    it('CLAIM の点数を偽装しても、精算にはエンジンが再計算した点数が使われる', () => {
      const window = claimWindowState()
      const discard = window.lastDiscard as Card
      const real = findYaku(
        [...window.players[1].hand, discard],
        yakuContextOf(window, DEFAULT_RULES),
        discard,
      )[0]
      const forged: YakuCandidate = { ...real, score: 999_999 }

      let current = reduce(
        window,
        { type: 'CLAIM', playerId: 1, candidate: forged },
        DEFAULT_RULES,
      ).state
      current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
      current = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES).state

      expect(real.score).toBe(120)
      expect(current.players[1].score).toBe(DEFAULT_RULES.startingScore + 120)
      expect(current.players[0].score).toBe(DEFAULT_RULES.startingScore - 120)
      expect(current.players[1].declared[0].score).toBe(120)
    })
  })
})

describe('非正準の合法選択が宣言経路を通る', () => {
  it('DECLARE: findYaku の正準とは別の3枚を選んでもツモが成立し、選んだ札が消費される', () => {
    // a1 を4枚持つ。findYaku の正準は先頭3枚(uid 0,1,2)だが、末尾3枚(uid 1,2,3)を
    // 選んで宣言しても受理され、残すのは uid 0 になる。
    // 「正準のみ受理（列挙との uid 一致）」に戻すと verifyCandidate が弾いてこのテストが落ちる。
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      hands: [
        make('a1:pink a1:blue a1:orange a1:pink'),
        make('b1:pink'),
        make('b2:pink'),
        make('b3:pink'),
      ],
      wall: make('c1:pink c2:pink c3:pink'),
    })
    const hand0 = state.players[0].hand
    const nonCanonical: YakuCandidate = {
      kind: 'triple',
      sameColor: false,
      cards: [hand0[1], hand0[2], hand0[3]],
      bonusCount: 0,
      score: 120,
    }

    const result = reduce(
      state,
      { type: 'DECLARE', playerId: 0, candidate: nonCanonical },
      DEFAULT_RULES,
    )

    const declared = result.state.players[0].declared[0]
    expect(declared.kind).toBe('triple')
    expect(declared.score).toBe(120)
    expect(declared.cards.map((c) => c.uid).sort((a, b) => a - b)).toEqual([1, 2, 3])
    // 選ばなかった uid 0 が手札に残っている（正準なら uid 0 が消費され uid 3 が残るはず）。
    expect(result.state.players[0].hand.some((c) => c.uid === 0)).toBe(true)
    expect(result.state.players[0].hand.some((c) => c.uid === 1)).toBe(false)
    expect(totalScore(result.state)).toBe(DEFAULT_RULES.startingScore * 4)
  })

  it('CLAIM: 捨て札と組む色を選べる（混色を選んで同色札を手に残す）', () => {
    // 3人組 trio(a1,a2,a3)。手札 a1:pink / a2:pink / a2:blue に a3:pink をロン。
    // findYaku の正準は「全員ピンク(540点)」だが、a2:blue を使う混色(180点)を選ぶと
    // a2:pink を手札に残せる。列挙は混色版を出さないため、旧検証ではこの選択は弾かれる。
    const make = createCardSource()
    const discard = make('a3:pink')[0]
    const window = gameState({
      phase: 'claimWindow',
      turn: 0,
      hands: [make('z1:pink'), make('a1:pink a2:pink a2:blue'), make('z2:pink'), make('z3:pink')],
      wall: make('z4:pink z5:pink z6:pink'),
      discards: [[discard], [], [], []],
      lastDiscard: discard,
      lastDiscardBy: 0,
      claims: { 1: null, 2: null, 3: null },
    })
    // uid は make の呼び出し順に連番: discard=0 / z1=1 / a1:pink=2 a2:pink=3 a2:blue=4。
    const hand1 = window.players[1].hand
    const nonCanonical: YakuCandidate = {
      kind: 'group3',
      sameColor: false,
      cards: [hand1[0], hand1[2], discard], // a1:pink(2), a2:blue(4), a3:pink(0)（混色）
      bonusCount: 0,
      score: 180,
    }

    let current = reduce(
      window,
      { type: 'CLAIM', playerId: 1, candidate: nonCanonical },
      DEFAULT_RULES,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES).state

    const declared = current.players[1].declared[0]
    expect(declared.kind).toBe('group3')
    expect(declared.sameColor).toBe(false)
    expect(declared.score).toBe(180)
    expect(declared.cards.map((c) => c.uid).sort((a, b) => a - b)).toEqual([0, 2, 4])
    // a2:pink(uid 3) を手札に残せている（正準の全ピンクなら消費されていたはず）。
    expect(current.players[1].hand.some((c) => c.uid === 3)).toBe(true)
    expect(current.lastDiscard).toBeNull()
    expect(totalScore(current)).toBe(DEFAULT_RULES.startingScore * 4)
  })
})

describe('ツモ和了と連続宣言', () => {
  function chainState() {
    const make = createCardSource()
    return gameState({
      phase: 'selfDeclare',
      turn: 0,
      declarer: 0,
      // a1 の3カードが成立済み。補充で a2 が3枚入って連続宣言できる並びにしてある。
      hands: [
        make('a1:pink a1:blue a1:orange b1:pink'),
        make('b2:pink'),
        make('b3:pink'),
        make('b4:pink'),
      ],
      wall: make('a2:pink a2:blue a2:orange z1:pink z2:pink z3:pink'),
    })
  }

  it('ツモで他3人から等分を徴収し、消費した枚数だけ補充する', () => {
    const state = chainState()
    const candidate = onlyYaku(state, 0)

    const result = reduce(state, { type: 'DECLARE', playerId: 0, candidate }, DEFAULT_RULES)

    expect(eventTypes(result.events)).toEqual(['Declared', 'Paid', 'Paid', 'Paid', 'Refilled'])
    // 手札から3枚消費し、3枚補充されるので枚数は変わらない
    expect(result.state.players[0].hand).toHaveLength(4)
    expect(result.state.wall).toHaveLength(3)
    expect(result.state.chainCount).toBe(1)
    expect(result.state.phase).toBe('selfDeclare')
    expect(totalScore(result.state)).toBe(DEFAULT_RULES.startingScore * 4)
  })

  it('補充で新たに成立した役を続けて宣言できる', () => {
    const state = chainState()
    const first = reduce(
      state,
      { type: 'DECLARE', playerId: 0, candidate: onlyYaku(state, 0) },
      DEFAULT_RULES,
    )

    const second = reduce(
      first.state,
      { type: 'DECLARE', playerId: 0, candidate: onlyYaku(first.state, 0) },
      DEFAULT_RULES,
    )

    expect(second.state.chainCount).toBe(2)
    expect(second.state.players[0].declared).toHaveLength(2)
    expect(second.state.players[0].score).toBe(DEFAULT_RULES.startingScore + 240)
    expect(totalScore(second.state)).toBe(DEFAULT_RULES.startingScore * 4)
  })

  it('maxChainDeclare に達したら例外ではなくフェーズ遷移でチェーンを抜ける', () => {
    const rules = testRules({ maxChainDeclare: 1 })
    const state = chainState()

    const result = reduce(
      state,
      { type: 'DECLARE', playerId: 0, candidate: onlyYaku(state, 0) },
      rules,
    )

    // 役はまだ成立しているが、上限に達したので捨てるフェーズへ進む
    expect(result.state.phase).toBe('discard')
    expect(findYaku(result.state.players[0].hand, yakuContextOf(result.state, rules))).not.toEqual(
      [],
    )
  })

  it('チェーン中は reduce が resolveClaim のまま返らない', () => {
    const state = chainState()
    const result = reduce(
      state,
      { type: 'DECLARE', playerId: 0, candidate: onlyYaku(state, 0) },
      DEFAULT_RULES,
    )

    expect(result.state.phase).not.toBe('resolveClaim')
  })
})

describe('割り込み宣言の優先度', () => {
  it('点数が高い役を宣言したプレイヤーが優先される', () => {
    const winner = resolveClaimWinner(
      {
        1: { kind: 'triple', sameColor: false, cards: [], bonusCount: 0, score: 120 },
        2: { kind: 'group4', sameColor: false, cards: [], bonusCount: 0, score: 300 },
        3: 'pass',
      },
      0,
      4,
    )

    expect(winner?.playerId).toBe(2)
  })

  it('同点なら捨てたプレイヤーから近い順に優先される', () => {
    const same = { kind: 'triple', sameColor: false, cards: [], bonusCount: 0, score: 120 } as const

    expect(resolveClaimWinner({ 2: same, 3: same }, 1, 4)?.playerId).toBe(2)
    // 捨てたのが2番なら、3 → 0 → 1 の順に近い
    expect(resolveClaimWinner({ 0: same, 3: same }, 2, 4)?.playerId).toBe(3)
    expect(resolveClaimWinner({ 0: same, 1: same }, 2, 4)?.playerId).toBe(0)
  })

  it('誰も割り込まなければ null を返す', () => {
    expect(resolveClaimWinner({ 1: 'pass', 2: 'pass', 3: 'pass' }, 0, 4)).toBeNull()
    expect(resolveClaimWinner({}, 0, 4)).toBeNull()
  })

  it('優先されなかったプレイヤーには支払いも収入も発生しない（頭ハネ）', () => {
    const make = createCardSource()
    const discarded = make('b4:pink')[0]
    const state = gameState({
      phase: 'claimWindow',
      turn: 0,
      hands: [
        make('z1:pink'),
        // プレイヤー1: b4 の3カード（混色 120点）
        make('b4:blue b4:orange'),
        // プレイヤー2: 4人組（混色 300点）
        make('b1:pink b2:blue b3:orange'),
        make('z2:pink'),
      ],
      wall: make('z3:pink z4:pink z5:pink z6:pink'),
      discards: [[discarded], [], [], []],
      lastDiscard: discarded,
      lastDiscardBy: 0,
      claims: { 1: null, 2: null, 3: null },
    })

    const ctx = yakuContextOf(state, DEFAULT_RULES)
    const claim1 = findYaku([...state.players[1].hand, discarded], ctx, discarded)
    const claim2 = findYaku([...state.players[2].hand, discarded], ctx, discarded)
    expect(claim1[0].score).toBe(120)
    expect(claim2[0].score).toBe(300)

    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claim1[0] },
      DEFAULT_RULES,
    ).state
    current = reduce(
      current,
      { type: 'CLAIM', playerId: 2, candidate: claim2[0] },
      DEFAULT_RULES,
    ).state
    const final = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES)

    expect(final.state.players[2].score).toBe(DEFAULT_RULES.startingScore + 300)
    expect(final.state.players[0].score).toBe(DEFAULT_RULES.startingScore - 300)
    // 割り込んだが負けたプレイヤー1と、割り込まなかったプレイヤー3は無傷
    expect(final.state.players[1].score).toBe(DEFAULT_RULES.startingScore)
    expect(final.state.players[3].score).toBe(DEFAULT_RULES.startingScore)
    expect(final.state.players[1].declared).toEqual([])
  })
})

describe('ロン和了', () => {
  /**
   * プレイヤー0が a1:pink を捨て、プレイヤー1が3カードでロンする局面。
   * プレイヤー1は補充で a2 が3枚揃い、連続宣言できる。
   */
  function ronState() {
    const make = createCardSource()
    const discarded = make('a1:pink')[0]

    return gameState({
      phase: 'claimWindow',
      turn: 0,
      declarer: 0,
      hands: [
        make('c1:pink c2:pink'),
        make('a1:blue a1:orange a2:pink'),
        make('c3:pink'),
        make('c4:pink'),
      ],
      wall: make('a2:blue a2:orange c5:pink c6:pink'),
      discards: [[discarded], [], [], []],
      lastDiscard: discarded,
      lastDiscardBy: 0,
      claims: { 1: null, 2: null, 3: null },
    })
  }

  function claimFor(state: GameState, playerId: number): YakuCandidate {
    const discard = state.lastDiscard as Card
    const candidates = findYaku(
      [...state.players[playerId].hand, discard],
      yakuContextOf(state, DEFAULT_RULES),
      discard,
    )
    expect(candidates).toHaveLength(1)
    return candidates[0]
  }

  it('捨てたプレイヤーが全額を支払う', () => {
    const state = ronState()
    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claimFor(state, 1) },
      DEFAULT_RULES,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
    const final = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES)

    expect(final.state.players[1].score).toBe(DEFAULT_RULES.startingScore + 120)
    expect(final.state.players[0].score).toBe(DEFAULT_RULES.startingScore - 120)
    expect(final.state.players[2].score).toBe(DEFAULT_RULES.startingScore)
    expect(totalScore(final.state)).toBe(DEFAULT_RULES.startingScore * 4)

    const declared = final.events.find((event) => event.type === 'Declared')
    expect(declared).toMatchObject({ winKind: 'ron', playerId: 1 })
  })

  it('ロンに使われた捨て札は河から取り除かれる（カードの二重計上を防ぐ）', () => {
    const state = ronState()
    const discardUid = (state.lastDiscard as Card).uid

    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claimFor(state, 1) },
      DEFAULT_RULES,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES).state

    expect(current.players[0].discards.map((card) => card.uid)).not.toContain(discardUid)
    expect(current.players[1].declared[0].cards.map((card) => card.uid)).toContain(discardUid)
    // 場全体で uid が重複していない
    const uids = allCardUids(current)
    expect(new Set(uids).size).toBe(uids.length)
  })

  it('ロン後は宣言権がロンしたプレイヤーへ移り、手番は動かない', () => {
    const state = ronState()
    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claimFor(state, 1) },
      DEFAULT_RULES,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES).state

    expect(current.phase).toBe('selfDeclare')
    expect(current.declarer).toBe(1)
    expect(current.turn).toBe(0)
    expect(current.chainCount).toBe(1)
  })

  it('ロンチェーン中、捨て終わった手番プレイヤーの手札は規定枚数のままである', () => {
    const rules = testRules({ handSize: 2 })
    const state = ronState()
    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claimFor(state, 1) },
      rules,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, rules).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, rules).state

    // ロンチェーン中は誰も「引いたカード」を持っていないので全員が規定枚数
    expect(expectedHandSize(current, 0, rules)).toBe(2)
    expect(current.players[0].hand).toHaveLength(2)
    expect(expectedHandSize(current, 1, rules)).toBe(2)
  })

  it('ロン後の連続宣言はツモとして精算される', () => {
    const state = ronState()
    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claimFor(state, 1) },
      DEFAULT_RULES,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES).state

    // 補充で a2 が3枚揃っている
    const chained = reduce(
      current,
      { type: 'DECLARE', playerId: 1, candidate: onlyYaku(current, 1) },
      DEFAULT_RULES,
    )

    const declared = chained.events.find((event) => event.type === 'Declared')
    expect(declared).toMatchObject({ winKind: 'tsumo', playerId: 1 })

    // ロンの 120 を払った0を含め、他3人が 40 点ずつ支払う
    expect(chained.state.players[1].score).toBe(DEFAULT_RULES.startingScore + 120 + 120)
    expect(chained.state.players[0].score).toBe(DEFAULT_RULES.startingScore - 120 - 40)
    expect(chained.state.players[2].score).toBe(DEFAULT_RULES.startingScore - 40)
    expect(totalScore(chained.state)).toBe(DEFAULT_RULES.startingScore * 4)
  })

  it('ロンチェーンを抜けると、捨てたプレイヤーの次の手番へ進む', () => {
    const state = ronState()
    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claimFor(state, 1) },
      DEFAULT_RULES,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES).state

    const exited = reduce(current, { type: 'SKIP_DECLARE' }, DEFAULT_RULES)

    // 捨てたのは0番。ロンしたのは1番だが、手番は0の次＝1番へ進む（1番の手番になる）
    expect(exited.state.phase).toBe('draw')
    expect(exited.state.turn).toBe(1)
    expect(exited.state.declarer).toBe(1)
    expect(eventTypes(exited.events)).toContain('TurnChanged')
  })

  /**
   * `exitChain` にはツモチェーン（`discard` へ）とロンチェーン（次の手番へ）の2経路があり、
   * 上限到達によってロンチェーン側へ自動的に入るケースはこのテストだけが押さえている。
   */
  it('ロン成立と同時に maxChainDeclare へ達したら、そのまま次の手番へ進む', () => {
    const rules = testRules({ maxChainDeclare: 1 })
    const state = ronState()

    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: claimFor(state, 1) },
      rules,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, rules).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, rules).state

    // 補充で新たな役が成立しているが、上限に達したので宣言せずにチェーンを抜ける
    expect(current.phase).toBe('draw')
    expect(current.turn).toBe(1)
    expect(current.declarer).toBe(1)
  })
})

describe('割り込み受付の時間切れ', () => {
  function windowState() {
    const make = createCardSource()
    const discarded = make('a1:pink')[0]
    return gameState({
      phase: 'claimWindow',
      turn: 0,
      hands: [make('c1:pink'), make('c2:pink'), make('c3:pink'), make('c4:pink')],
      wall: make('c5:pink'),
      discards: [[discarded], [], [], []],
      lastDiscard: discarded,
      lastDiscardBy: 0,
      claims: { 1: null, 2: null, 3: null },
      claimTimerMs: 4000,
    })
  }

  it('時間が残っていれば受付は閉じない', () => {
    const result = reduce(windowState(), { type: 'TICK', deltaMs: 1000 }, DEFAULT_RULES)

    expect(result.state.phase).toBe('claimWindow')
    expect(result.state.claimTimerMs).toBe(3000)
    expect(result.state.claims).toEqual({ 1: null, 2: null, 3: null })
  })

  it('時間切れで未表明のプレイヤーはパス扱いになり、次の手番へ進む', () => {
    const state = reduce(windowState(), { type: 'PASS', playerId: 1 }, DEFAULT_RULES).state
    const result = reduce(state, { type: 'TICK', deltaMs: 9999 }, DEFAULT_RULES)

    expect(result.state.phase).toBe('draw')
    expect(result.state.turn).toBe(1)
  })

  it('全員が意思表示済みなら TICK を待たずに解決する', () => {
    let state = windowState()
    for (const playerId of [1, 2, 3]) {
      state = reduce(state, { type: 'PASS', playerId }, DEFAULT_RULES).state
    }

    expect(state.phase).toBe('draw')
  })
})

describe('終了条件', () => {
  it('点数が0になったら破産で終局する', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
      wall: make('c1:pink c2:pink c3:pink'),
      scores: [1000, 30, 1000, 1000],
    })

    const result = reduce(
      state,
      { type: 'DECLARE', playerId: 0, candidate: onlyYaku(state, 0) },
      DEFAULT_RULES,
    )

    expect(result.state.phase).toBe('gameOver')
    // 残高不足のプレイヤーからは残高分だけを徴収する
    expect(result.state.players[1].score).toBe(0)
    expect(result.state.players[0].score).toBe(1000 + 40 + 30 + 40)
    expect(totalScore(result.state)).toBe(1000 + 30 + 1000 + 1000)

    const gameOver = result.events.find((event) => event.type === 'GameOver')
    expect(gameOver).toMatchObject({ reason: 'bankrupt' })
  })

  it('補充中に山札が尽きても精算は取り消されず、山切れで終局する', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
      // 3枚消費するが山札は1枚しかない
      wall: make('c1:pink'),
    })

    const result = reduce(
      state,
      { type: 'DECLARE', playerId: 0, candidate: onlyYaku(state, 0) },
      DEFAULT_RULES,
    )

    expect(result.state.phase).toBe('gameOver')
    expect(result.state.players[0].score).toBe(DEFAULT_RULES.startingScore + 120)
    expect(result.state.wall).toHaveLength(0)
    expect(result.state.players[0].hand).toHaveLength(1)
    expect(result.events.find((event) => event.type === 'GameOver')).toMatchObject({
      reason: 'wallEmpty',
    })
  })

  it('順位は点数降順、同点はプレイヤー ID 昇順で決まる', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'draw',
      hands: [make('b1:pink'), [], [], []],
      wall: [],
      scores: [500, 1500, 1500, 500],
    })

    const result = reduce(state, { type: 'DRAW' }, DEFAULT_RULES)
    const gameOver = result.events.find((event) => event.type === 'GameOver')

    expect(gameOver).toMatchObject({ ranking: [1, 2, 0, 3] })
  })
})

describe('純粋性', () => {
  it('reduce は入力の state を破壊しない', () => {
    const make = createCardSource()
    const state = gameState({
      phase: 'selfDeclare',
      turn: 0,
      hands: [make('a1:pink a1:blue a1:orange'), make('b1:pink'), make('b2:pink'), make('b3:pink')],
      wall: make('c1:pink c2:pink c3:pink'),
    })
    const snapshot = structuredClone(state)

    reduce(state, { type: 'DECLARE', playerId: 0, candidate: onlyYaku(state, 0) }, DEFAULT_RULES)

    expect(state).toEqual(snapshot)
  })

  it('対局の人数と食い違う rules を渡すと例外になる', () => {
    const state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 5)

    expect(() => reduce(state, { type: 'DRAW' }, testRules({ playerCount: 3 }))).toThrow(
      /対局の人数\(4\)と一致しません/,
    )
  })

  it('未知のアクション種別は黙って無視されず例外になる', () => {
    const state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 5)
    const unknown = { type: 'TELEPORT' } as unknown as Action

    expect(() => reduce(state, unknown, DEFAULT_RULES)).toThrow(/未知のアクション/)
  })

  it('rngState は対局中に変化しない（進行に乱数を使っていない）', () => {
    let state = createGame(DEFAULT_ROSTER, DEFAULT_RULES, 3, { humanSeats: [] })
    const initial = state.rngState

    state = reduce(state, { type: 'DRAW' }, DEFAULT_RULES).state
    state = reduce(state, { type: 'SKIP_DECLARE' }, DEFAULT_RULES).state
    state = reduce(
      state,
      { type: 'DISCARD', uid: state.players[0].hand[0].uid },
      DEFAULT_RULES,
    ).state

    expect(state.rngState).toBe(initial)
  })
})

describe('expectedHandSize', () => {
  const make = createCardSource()
  const rules = testRules({ handSize: 7 })
  const hands = [make('b1:pink'), make('b2:pink'), make('b3:pink'), make('b4:pink')]

  it('引いてから捨てるまでの手番プレイヤーだけが1枚多い', () => {
    const drawing = gameState({ phase: 'selfDeclare', turn: 1, declarer: 1, hands })

    expect(expectedHandSize(drawing, 1, rules)).toBe(8)
    expect(expectedHandSize(drawing, 0, rules)).toBe(7)
  })

  it('ロンチェーン中（declarer !== turn）は手番プレイヤーも規定枚数である', () => {
    const ronChain = gameState({ phase: 'selfDeclare', turn: 1, declarer: 2, hands })

    expect(expectedHandSize(ronChain, 1, rules)).toBe(7)
    expect(expectedHandSize(ronChain, 2, rules)).toBe(7)
  })

  it('draw / claimWindow では全員が規定枚数である', () => {
    for (const phase of ['draw', 'claimWindow'] as const) {
      const state = gameState({ phase, turn: 1, declarer: 1, hands })
      expect(expectedHandSize(state, 1, rules)).toBe(7)
    }
  })
})

describe('グループ役でのロン', () => {
  it('4人組の最後の1枚をロンできる', () => {
    const make = createCardSource()
    const discarded = make('b4:pink')[0]
    const state = gameState({
      phase: 'claimWindow',
      turn: 0,
      hands: [make('c1:pink'), make('b1:pink b2:blue b3:orange'), make('c2:pink'), make('c3:pink')],
      wall: make('c4:pink c5:pink c6:pink'),
      discards: [[discarded], [], [], []],
      lastDiscard: discarded,
      lastDiscardBy: 0,
      claims: { 1: null, 2: null, 3: null },
      groups: [TEST_GROUPS.trio, TEST_GROUPS.quartet],
    })

    const candidates = findYaku(
      [...state.players[1].hand, discarded],
      yakuContextOf(state, DEFAULT_RULES),
      discarded,
    )
    expect(candidates[0].kind).toBe('group4')

    let current = reduce(
      state,
      { type: 'CLAIM', playerId: 1, candidate: candidates[0] },
      DEFAULT_RULES,
    ).state
    current = reduce(current, { type: 'PASS', playerId: 2 }, DEFAULT_RULES).state
    current = reduce(current, { type: 'PASS', playerId: 3 }, DEFAULT_RULES).state

    expect(current.players[1].score).toBe(DEFAULT_RULES.startingScore + 300)
    expect(current.players[0].score).toBe(DEFAULT_RULES.startingScore - 300)
    // 手札から3枚消費 → 3枚補充
    expect(current.players[1].hand).toHaveLength(3)
    expect(current.wall).toHaveLength(0)
  })
})
