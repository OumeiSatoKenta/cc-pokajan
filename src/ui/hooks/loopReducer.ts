/**
 * 対局ループの UI 状態とリデューサ。
 *
 * Step 6 で「状態の権威ある前進」は `GameTransport`（local=engine `reduce` / remote=HTTP）が持つようになった。
 * このリデューサは **transport が出した `GameSnapshot`（`PlayerView` + 差分 events）を UI 状態へ折り込む**だけに
 * 純化する（`reduce`/`createGame` は import しない）。演出用のイベントキュー・和了演出・ツモ切り対象・持ち時間は
 * このラッパーが持つ。React に触れない部分を純粋関数に保ち、jsdom なしで単体テストできるようにする。
 *
 * 和了で対局を止める「二層停止」（7-4）のうち、**進行を止めるのは `useGameLoop` 側**（`isPaused` の間 transport を
 * 呼ばない）。transport が独立に state を進める以上、リデューサ側で INGEST を握り潰すと view が transport と
 * ずれるため、ゲートは apply を呼ぶ前（フック）に置く。ここは折り込みに徹する。
 */

import type { PlayerView } from '../../engine/playerView'
import type {
  GameEvent,
  GameOverReason,
  Payment,
  PlayerId,
  RulesConfig,
  WinKind,
  YakuCandidate,
} from '../../engine/types'
import type { GameSnapshot, OutcomeSummary } from '../transport/transport'
import { nextTimeLimitMs } from './turnTimer'

/**
 * 和了1回分の演出データ。
 *
 * **適用前後の点数を両方持つ**のが要点。得点移動は「いくらからいくらへ」を描くため、片方だけでは足りない。
 * 支払い明細は持たず、画面に出す増減は `scoresAfter - scoresBefore` から作る（表示している点数そのものなので、
 * 集計の書き方でずれる余地がない）。
 */
export interface WinPresentation {
  readonly playerId: PlayerId
  readonly candidate: YakuCandidate
  readonly winKind: WinKind
  readonly scoresBefore: readonly number[]
  readonly scoresAfter: readonly number[]
}

/**
 * 和了1回分を一意に決める鍵。構成カードは成立時に場から取り除かれ二度と戻らないため、
 * 「誰が・どのカードで」の組は1局のうちに重複しない。
 *
 * 用途は2つ。1) `DISMISS_WIN` の照合（オーバーレイ全体クリックの泡立ち・二重クローズ・自動クローズの競合を
 * すべて同じ規則で無効化する）。2) `WinOverlay` の React `key`（同じ鍵だと段が進んだ状態のまま2件目が出る）。
 */
export function winKey(win: WinPresentation): string {
  const uids = win.candidate.cards.map((card) => card.uid).sort((a, b) => a - b)
  return `${win.playerId}:${uids.join('-')}`
}

/**
 * UI 層だけが持つ状態。
 *
 * `view` は transport が返した `PlayerView`（`null` は create 未完＝loading）。`version` は次の apply へ渡す
 * `expectedVersion`。ドメインの真実は transport 側にあり、ここは描画と演出のための派生状態を持つ。
 */
export interface LoopState {
  readonly view: PlayerView | null
  /** 次の apply に渡す楽観ロックのバージョン。 */
  readonly version: number
  /** 演出待ちのイベント。UI が再生し終えたら `EVENTS_CONSUMED` で削る。 */
  readonly pending: readonly GameEvent[]
  /** 終局理由。**`GameOver` イベントが確定させた値をそのまま保持する**（点数から UI で導出し直さない）。 */
  readonly gameOverReason: GameOverReason | null
  /** 終局時の順位。同じく `GameOver` の値。順位倍率＝精算額になるため食い違いは金額の誤りになる。 */
  readonly ranking: readonly PlayerId[] | null
  /** 人間の残り持ち時間。**ここが時間の権威**（CPU は即決するのでスカラーで足りる）。 */
  readonly timeLimitMs: number
  /** 人間が今引いているカードの uid。時間切れのツモ切りで捨てる対象（末尾に依存しない）。 */
  readonly drawnUid: number | null
  /** 演出待ちの和了。**空でない間、対局は進めない**（進行停止は `useGameLoop` が担う）。先頭が今見せている和了。 */
  readonly pendingWins: readonly WinPresentation[]
  /** サーバー権威の財布（server モードで App へ同期）。local はダミー（`walletSource==='local'` で未使用）。 */
  readonly wallet: number
  /** サーバー精算（server モードの settle 用）。local は常に null。 */
  readonly outcome: OutcomeSummary | null
}

/** transport の snapshot を折り込むアクションと、UI 専用のアクション。 */
export type LoopAction =
  /**
   * transport が返した snapshot を UI 状態へ折り込む。`isTimeout`＝時間切れ由来か、`accepted`＝受理されたか。
   * **受理された時間切れのときだけ**持ち時間を減らす（間に合った操作から持ち時間を奪わないため）。
   * create の初回 snapshot もこれで折り込む（`isTimeout:false`・`accepted:true`）。
   */
  | {
      readonly type: 'INGEST'
      readonly snapshot: GameSnapshot
      readonly isTimeout: boolean
      readonly accepted: boolean
    }
  | { readonly type: 'EVENTS_CONSUMED'; readonly count: number }
  /** 和了演出を閉じて進行を再開させる。**鍵を必ず添える**（二重クローズで2件落ちるのを防ぐ）。 */
  | { readonly type: 'DISMISS_WIN'; readonly key: string }

/**
 * `rules` を束縛したリデューサを作る（時間切れの持ち時間減算に `rules` が要る）。
 *
 * **純粋関数のまま保つこと。** イベントの消費（アニメーション再生）はリデューサ内ではなく `pending` を見る
 * `useEffect` 側で行う（StrictMode の二重実行で演出が2回走るのを避ける）。
 */
export function createLoopReducer(
  rules: RulesConfig,
): (state: LoopState, action: LoopAction) => LoopState {
  return (state, action) => {
    switch (action.type) {
      case 'INGEST':
        return ingest(state, action.snapshot, action.isTimeout, action.accepted, rules)

      case 'EVENTS_CONSUMED':
        return { ...state, pending: state.pending.slice(action.count) }

      case 'DISMISS_WIN': {
        const head = state.pendingWins[0]
        // **鍵が合わなければ何もしない。** 今見せている和了以外は絶対に落とさない。
        // これで二重クリック・イベントの泡立ち・自動クローズとクリックの競合がすべて無効になる。
        if (head === undefined || winKey(head) !== action.key) {
          return state
        }
        return { ...state, pendingWins: state.pendingWins.slice(1) }
      }

      default: {
        const exhaustive: never = action
        throw new Error(`未知のループアクションです: ${JSON.stringify(exhaustive)}`)
      }
    }
  }
}

/**
 * snapshot（`PlayerView` + 差分 events）を UI 状態へ折り込む。
 *
 * `scoresBefore` は **INGEST 前の view の点数**を使う（`collectWins` が Paid で前進させる）。初回（create・
 * `state.view === null`）は snapshot 自身の点数を基準にするが、create は人間の最初の判断より前で終わるため
 * `Declared`/`Paid` を含まない＝`collectWins` は必ず空になり、基準のずれは結果に出ない。
 */
function ingest(
  state: LoopState,
  snapshot: GameSnapshot,
  isTimeout: boolean,
  accepted: boolean,
  rules: RulesConfig,
): LoopState {
  const humanSeat = snapshot.view.selfId
  const scoresBefore = (state.view ?? snapshot.view).players.map((player) => player.score)
  const gameOver = snapshot.events.find((event) => event.type === 'GameOver')

  return {
    view: snapshot.view,
    version: snapshot.version,
    pending: [...state.pending, ...snapshot.events],
    gameOverReason: gameOver?.reason ?? state.gameOverReason,
    ranking: gameOver?.ranking ?? state.ranking,
    // **受理された時間切れのときだけ**減らす（弾かれたのは先に操作が通っていた＝時間内に打てたということ）。
    timeLimitMs:
      isTimeout && accepted ? nextTimeLimitMs(state.timeLimitMs, rules) : state.timeLimitMs,
    drawnUid: trackDrawnUid(state.drawnUid, snapshot.events, humanSeat),
    pendingWins: [...state.pendingWins, ...collectWins(snapshot.events, scoresBefore)],
    wallet: snapshot.wallet,
    outcome: snapshot.outcome,
  }
}

/**
 * イベント列を畳んで和了の演出データを組み立てる。
 *
 * `Paid` は `settleWin` からしか出ないため、**直前の `Declared` に属すると確定できる**。順に走査して、
 * `Declared` で新しい演出を開始し、`Paid` で点数を進める。`scoresBefore` に「その和了の直前の点数」を入れるには
 * この走査で点数を持ち回るしかない（種別ごとにまとめて拾うと、複数和了でどの支払いがどの和了か分からなくなる）。
 */
function collectWins(
  events: readonly GameEvent[],
  scoresBeforeAll: readonly number[],
): WinPresentation[] {
  const wins: WinPresentation[] = []
  let scores = [...scoresBeforeAll]

  for (const event of events) {
    if (event.type === 'Declared') {
      wins.push({
        playerId: event.playerId,
        candidate: event.candidate,
        winKind: event.winKind,
        scoresBefore: [...scores],
        scoresAfter: [...scores],
      })
      continue
    }

    if (event.type !== 'Paid') {
      continue
    }

    const current = wins[wins.length - 1]
    if (current === undefined) {
      // `Paid` が `Declared` より先に来ることは今の実装では起こらない。黙って捨てず点数だけ進めておく。
      scores = applyPayment(scores, event)
      continue
    }

    scores = applyPayment(scores, event)
    wins[wins.length - 1] = { ...current, scoresAfter: [...scores] }
  }

  return wins
}

function applyPayment(scores: readonly number[], payment: Payment): number[] {
  const next = [...scores]
  next[payment.from] = (next[payment.from] ?? 0) - payment.amount
  next[payment.to] = (next[payment.to] ?? 0) + payment.amount
  return next
}

/**
 * 人間が引いているカードを追跡する。引いたら覚え、捨てたら忘れる。
 *
 * **`playerId` で人間の席に限定するのが要点。** redact 済み events では他家の `CardDrawn` は落ちており、残るのは
 * 自席の `CardDrawn` だけ＝この関数が欲しい humanSeat の分そのもの。それでも席で明示的に絞るのは、進行順序という
 * 別の性質にツモ切りの正しさを預けないため（連続宣言・ロン割り込みで順序が変わっても壊れない）。
 */
function trackDrawnUid(
  current: number | null,
  events: readonly GameEvent[],
  humanSeat: PlayerId,
): number | null {
  let drawn = current

  for (const event of events) {
    if (event.type === 'CardDrawn' && event.playerId === humanSeat) {
      drawn = event.card.uid
    } else if (event.type === 'Discarded' && event.playerId === humanSeat) {
      drawn = null
    }
  }

  return drawn
}

/** create 前の初期状態（view 未取得）。持ち時間だけ対局ごとにリセットする。 */
export function createInitialLoopState(rules: RulesConfig): LoopState {
  return {
    view: null,
    version: 0,
    pending: [],
    gameOverReason: null,
    ranking: null,
    timeLimitMs: rules.turnTimer.initialMs,
    drawnUid: null,
    pendingWins: [],
    wallet: 0,
    outcome: null,
  }
}
