import { describe, expect, it } from 'vitest'

import {
  createAppReducer,
  createInitialAppState,
  minimumBet,
  needsTopUp,
  type AppAction,
  type AppState,
} from '../../src/ui/appReducer'
import { DEFAULT_RULES } from '../../src/config/rules'
import { IllegalActionError } from '../../src/engine/errors'
import type { OutcomeSummary } from '../../src/ui/transport/transport'
import { testRules } from '../helpers/game'

const rules = DEFAULT_RULES
// 既定は local モード（Pages・prefs + computePayout）。server モードは末尾の describe で別途検証する。
const reducer = createAppReducer(rules, 'local')

function initial(overrides: Partial<AppState> = {}): AppState {
  return { ...createInitialAppState({ wallet: 10_000, seed: 13 }), ...overrides }
}

/**
 * FINISH アクションの組み立て。local モードでは server 用フィールド（`serverOutcome`/`serverWallet`）は
 * 使われないので、既定値（null / 0）を入れる。
 */
function finish(
  ranking: readonly number[],
  scores: readonly number[],
  humanSeat: number,
): AppAction {
  return { type: 'FINISH', ranking, scores, humanSeat, serverOutcome: null, serverWallet: 0 }
}

/** 1位で終わる順位表（人間は席0）。 */
const WON: readonly number[] = [0, 1, 2, 3]
/** 4位で終わる順位表。 */
const LOST: readonly number[] = [1, 2, 3, 0]

describe('画面遷移', () => {
  it('タイトルから始まる', () => {
    expect(initial().screen).toBe('title')
  })

  it('遊ぶで BET 画面へ進む', () => {
    expect(reducer(initial(), { type: 'GO_BET' }).screen).toBe('bet')
  })

  it('BET を出すと対局画面へ進む', () => {
    const next = reducer(initial({ screen: 'bet' }), { type: 'PLACE_BET', amount: 1000 })

    expect(next.screen).toBe('table')
    expect(next.bet).toBe(1000)
  })

  it('精算すると結果画面へ進む', () => {
    const playing = reducer(initial({ screen: 'bet' }), { type: 'PLACE_BET', amount: 1000 })
    const next = reducer(playing, finish(WON, [1200, 900, 900, 1000], 0))

    expect(next.screen).toBe('result')
    expect(next.outcome).not.toBeNull()
  })

  it('タイトルへ戻ると進行中の BET と結果が消える', () => {
    const playing = reducer(initial({ screen: 'bet' }), { type: 'PLACE_BET', amount: 1000 })
    const next = reducer(playing, { type: 'GO_TITLE' })

    expect(next.screen).toBe('title')
    expect(next.bet).toBeNull()
    expect(next.outcome).toBeNull()
  })

  it('未知のアクションは黙って無視されず例外になる', () => {
    const unknown = { type: 'TELEPORT' } as unknown as AppAction

    expect(() => reducer(initial(), unknown)).toThrow(/未知の画面アクション/)
  })
})

describe('BET の引き落とし', () => {
  /**
   * 精算時にまとめて差額を足す方式だと、対局を中断してタブを閉じるだけで
   * 負けを帳消しにできてしまう。BET はその場で引く。
   */
  it('BET を出した時点で所持コインが減る', () => {
    const next = reducer(initial({ wallet: 10_000 }), { type: 'PLACE_BET', amount: 2000 })

    expect(next.wallet).toBe(8_000)
  })

  it('所持コインが足りなければ受け付けない', () => {
    const state = initial({ wallet: 900, screen: 'bet' })
    const next = reducer(state, { type: 'PLACE_BET', amount: 1000 })

    expect(next).toBe(state)
    expect(next.screen).toBe('bet')
  })

  it('ちょうど足りるときは受け付ける', () => {
    const next = reducer(initial({ wallet: 1_000 }), { type: 'PLACE_BET', amount: 1000 })

    expect(next.screen).toBe('table')
    expect(next.wallet).toBe(0)
  })

  /** 画面のボタンを無効化するだけの防御にしない。 */
  it('選択肢にない BET 額は受け付けない', () => {
    const state = initial({ wallet: 10_000 })

    expect(reducer(state, { type: 'PLACE_BET', amount: 1500 })).toBe(state)
    expect(reducer(state, { type: 'PLACE_BET', amount: 0 })).toBe(state)
    expect(reducer(state, { type: 'PLACE_BET', amount: -1000 })).toBe(state)
  })
})

describe('精算の反映', () => {
  function play(walletStart: number, bet: number): AppState {
    return reducer(initial({ wallet: walletStart }), { type: 'PLACE_BET', amount: bet })
  }

  it('1位なら所持コインが増える', () => {
    const next = reducer(play(10_000, 1000), finish(WON, [1200, 900, 900, 1000], 0))

    // 10000 − 1000（BET）+ 3000（1200 × 1 × 2.5）
    expect(next.wallet).toBe(12_000)
    expect(next.outcome?.payout.net).toBe(2_000)
  })

  it('4位で低い点数なら所持コインが減る', () => {
    const next = reducer(play(10_000, 1000), finish(LOST, [400, 1500, 1100, 1000], 0))

    // 10000 − 1000 + 400
    expect(next.wallet).toBe(9_400)
    expect(next.outcome?.payout.net).toBe(-600)
  })

  it('BET 2000 は増減が倍になる', () => {
    const small = reducer(play(10_000, 1000), finish(WON, [1200, 0, 0, 0], 0))
    const large = reducer(play(10_000, 2000), finish(WON, [1200, 0, 0, 0], 0))

    expect(large.outcome?.payout.net).toBe((small.outcome?.payout.net ?? 0) * 2)
  })

  it('人間の席が0番以外でもその席の点数と順位で精算する', () => {
    const next = reducer(play(10_000, 1000), finish([2, 0, 1, 3], [900, 800, 1300, 1000], 2))

    expect(next.outcome?.payout.rank).toBe(1)
    expect(next.outcome?.payout.finalScore).toBe(1300)
  })

  it('精算の前後で所持コインの記録が残る', () => {
    const next = reducer(play(10_000, 1000), finish(WON, [1200, 0, 0, 0], 0))

    expect(next.outcome?.walletBefore).toBe(9_000)
    expect(next.outcome?.walletAfter).toBe(12_000)
  })

  /** BET を経由しない対局は存在しないはずだが、状態としても弾いておく。 */
  it('BET していない状態では精算しない', () => {
    const state = initial({ screen: 'table', bet: null })
    const next = reducer(state, finish(WON, [1200, 0, 0, 0], 0))

    expect(next).toBe(state)
  })

  it('対局画面にいないときは精算しない', () => {
    const state = initial({ screen: 'title', bet: 1000 })
    const next = reducer(state, finish(WON, [1200, 0, 0, 0], 0))

    expect(next).toBe(state)
  })

  it('順位表に人間がいなければ黙って0位扱いにせず例外', () => {
    expect(() => reducer(play(10_000, 1000), finish([1, 2, 3], [1200, 0, 0, 0], 0))).toThrow(
      IllegalActionError,
    )
  })
})

describe('シードの採番', () => {
  /**
   * `GO_BET` で増やすと、タイトルから初回に入るだけで URL 指定のシードがずれる。
   * `PLACE_BET` で増やすと、実際に遊ぶ対局のシードが指定値とずれる。
   */
  it('BET 画面へ進んでもシードは変わらない', () => {
    expect(reducer(initial({ seed: 13 }), { type: 'GO_BET' }).seed).toBe(13)
  })

  it('BET を出してもシードは変わらない（その対局が指定のシードで打たれる）', () => {
    expect(reducer(initial({ seed: 13 }), { type: 'PLACE_BET', amount: 1000 }).seed).toBe(13)
  })

  it('精算のときだけシードが1つ進む', () => {
    const playing = reducer(initial({ seed: 13 }), { type: 'PLACE_BET', amount: 1000 })
    const settled = reducer(playing, finish(WON, [1200, 0, 0, 0], 0))

    expect(settled.seed).toBe(14)
  })

  it('タイトルへ戻ってもシードは戻らない', () => {
    const playing = reducer(initial({ seed: 13 }), { type: 'PLACE_BET', amount: 1000 })
    const settled = reducer(playing, finish(WON, [1200, 0, 0, 0], 0))

    expect(reducer(settled, { type: 'GO_TITLE' }).seed).toBe(14)
  })
})

describe('コインの補充', () => {
  /**
   * BET のガードだけだと、所持コインが尽きた時点でどのボタンも押せなくなる。
   * localStorage に残るのでリロードしても回復しない。
   */
  it('最低 BET を下回ると補充できる', () => {
    const next = reducer(initial({ wallet: 500 }), { type: 'TOP_UP' })

    expect(next.wallet).toBe(rules.bet.initialWallet)
  })

  it('所持コイン0からでも復帰できる', () => {
    expect(reducer(initial({ wallet: 0 }), { type: 'TOP_UP' }).wallet).toBe(rules.bet.initialWallet)
  })

  /** 足りているうちに補充できると、無制限にコインを増やせる。 */
  it('最低 BET を出せるうちは補充できない', () => {
    const state = initial({ wallet: 1_000 })

    expect(reducer(state, { type: 'TOP_UP' })).toBe(state)
  })

  it('所持コインが初期値より多くても補充で減らない（条件を満たさないため何もしない）', () => {
    const state = initial({ wallet: 999_999 })

    expect(reducer(state, { type: 'TOP_UP' })).toBe(state)
  })

  it('補充後は通常どおり BET を出せる', () => {
    const topped = reducer(initial({ wallet: 0, screen: 'bet' }), { type: 'TOP_UP' })
    const next = reducer(topped, { type: 'PLACE_BET', amount: 1000 })

    expect(next.screen).toBe('table')
  })
})

describe('server モードの財布（walletSource=server）', () => {
  const serverReducer = createAppReducer(rules, 'server')

  const SERVER_OUTCOME: OutcomeSummary = {
    payout: {
      finalScore: 1200,
      bet: 1000,
      betMultiplier: 1,
      rank: 1,
      rankMultiplier: 2.5,
      gross: 3000,
      net: 2000,
    },
    ranking: WON,
    scores: [1200, 900, 900, 1000],
  }

  /**
   * server モードは BET を**ローカルで控除しない**（サーバーが createGame で debit し、その後の snapshot の
   * wallet を SYNC_WALLET で反映する）。→ create 失敗時も残高固着が起きない。
   */
  it('PLACE_BET でローカル残高を控除しない', () => {
    const next = serverReducer(initial({ wallet: 10_000, screen: 'bet' }), {
      type: 'PLACE_BET',
      amount: 2000,
    })

    expect(next.screen).toBe('table')
    expect(next.bet).toBe(2000)
    expect(next.wallet).toBe(10_000) // 控除しない（local は 8_000 になる）
  })

  it('SYNC_WALLET でサーバー権威の財布を反映する', () => {
    const next = serverReducer(initial({ wallet: 10_000 }), { type: 'SYNC_WALLET', wallet: 7_777 })

    expect(next.wallet).toBe(7_777)
  })

  /**
   * **値が同じなら同一参照を返す**（onWalletSync の無限ループ対策の第2層）。App.tsx の安定コールバックが
   * 主対策だが、他の呼び出し元が非メモ化コールバックを渡しても、ここで無駄な再レンダーの芽を摘む。
   */
  it('SYNC_WALLET は値が同じなら同一参照を返す', () => {
    const state = initial({ wallet: 5_000 })

    expect(serverReducer(state, { type: 'SYNC_WALLET', wallet: 5_000 })).toBe(state)
    expect(serverReducer(state, { type: 'SYNC_WALLET', wallet: 6_000 }).wallet).toBe(6_000)
  })

  /**
   * server モードの精算は**サーバー値をそのまま使う**（`computePayout` を再計算しない＝localStorage 改竄が
   * 精算に効かない）。財布・順位・内訳はすべて `serverOutcome`/`serverWallet` 由来。
   */
  it('FINISH はサーバー精算とサーバー財布を採用する（computePayout を呼ばない）', () => {
    const playing = serverReducer(initial({ wallet: 9_000, screen: 'bet' }), {
      type: 'PLACE_BET',
      amount: 1000,
    })
    const next = serverReducer(playing, {
      type: 'FINISH',
      ranking: WON,
      scores: [1200, 900, 900, 1000],
      humanSeat: 0,
      serverOutcome: SERVER_OUTCOME,
      serverWallet: 12_345,
    })

    expect(next.screen).toBe('result')
    expect(next.wallet).toBe(12_345) // サーバー値をそのまま
    expect(next.outcome?.payout).toBe(SERVER_OUTCOME.payout) // 内訳もサーバー由来（同一参照）
    expect(next.outcome?.walletAfter).toBe(12_345)
  })

  /** server モードなのに outcome が無いのは異常。黙って local 計算に落とさず、精算を進めない。 */
  it('server モードで serverOutcome が null なら精算しない', () => {
    const playing = serverReducer(initial({ wallet: 9_000, screen: 'bet' }), {
      type: 'PLACE_BET',
      amount: 1000,
    })
    const next = serverReducer(playing, {
      type: 'FINISH',
      ranking: WON,
      scores: [1200, 900, 900, 1000],
      humanSeat: 0,
      serverOutcome: null,
      serverWallet: 12_345,
    })

    expect(next).toBe(playing)
  })
})

describe('minimumBet / needsTopUp', () => {
  it('最小の BET 額を返す（並び順に依存しない）', () => {
    expect(minimumBet(rules)).toBe(1000)
    expect(minimumBet(testRules({ bet: { ...rules.bet, options: [2000, 1000] } }))).toBe(1000)
  })

  it('最低 BET を下回るときだけ補充が要る', () => {
    expect(needsTopUp(999, rules)).toBe(true)
    expect(needsTopUp(1000, rules)).toBe(false)
    expect(needsTopUp(0, rules)).toBe(true)
  })
})

describe('設定画面への遷移', () => {
  it('タイトルからロスター設定へ進める', () => {
    const next = reducer(initial(), { type: 'GO_SETTINGS', screen: 'roster' })

    expect(next.screen).toBe('roster')
  })

  it('タイトルからルール設定へ進める', () => {
    expect(reducer(initial(), { type: 'GO_SETTINGS', screen: 'rules' }).screen).toBe('rules')
  })

  it('タイトルからプレイヤー設定へ進める', () => {
    expect(reducer(initial(), { type: 'GO_SETTINGS', screen: 'players' }).screen).toBe('players')
  })

  /**
   * プレイヤー設定も「タイトルからしか開けない」に含める。
   * 画面を足すたびに判定を書き足す形にすると、いつか書き忘れる。
   */
  it('対局中はプレイヤー設定も開けない', () => {
    const playing = reducer(reducer(initial(), { type: 'GO_BET' }), {
      type: 'PLACE_BET',
      amount: 1_000,
    })

    expect(reducer(playing, { type: 'GO_SETTINGS', screen: 'players' })).toBe(playing)
  })

  it('設定からタイトルへ戻れる', () => {
    const opened = reducer(initial(), { type: 'GO_SETTINGS', screen: 'roster' })

    expect(reducer(opened, { type: 'GO_TITLE' }).screen).toBe('title')
  })

  /**
   * 対局中に設定を開けると、進行中の対局と保存されたルールが食い違ったまま
   * 精算まで進んでしまう（点数表を変えた後の精算がどちらの値か決まらない）。
   */
  it('対局中は設定を開けない', () => {
    const playing = reducer(initial({ screen: 'bet' }), { type: 'PLACE_BET', amount: 1000 })
    const next = reducer(playing, { type: 'GO_SETTINGS', screen: 'rules' })

    expect(next).toBe(playing)
    expect(next.screen).toBe('table')
  })

  it('BET 画面からも設定を開けない', () => {
    const bet = initial({ screen: 'bet' })

    expect(reducer(bet, { type: 'GO_SETTINGS', screen: 'rules' })).toBe(bet)
  })

  it('設定へ進んでも所持コインとシードは変わらない', () => {
    const next = reducer(initial({ wallet: 5_000, seed: 42 }), {
      type: 'GO_SETTINGS',
      screen: 'roster',
    })

    expect(next.wallet).toBe(5_000)
    expect(next.seed).toBe(42)
  })
})
