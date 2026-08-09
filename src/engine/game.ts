/**
 * 対局の状態機械。
 *
 * **タイマーを持たない純粋リデューサ**として実装する。時間の経過は UI 層が `TICK` で供給し、
 * エンジンは `Date` も `Math.random()` も参照しない。これにより対局の全経過が
 * 「初期シード + アクション列」だけで完全に再現できる。
 *
 * `rules` は `GameState` に埋め込まず引数で受け取る（Step 1 からの持ち越し課題の決着）。
 * 既存のエンジン関数がすべて `rules` を引数で受け取る形と一貫させ、
 * `GameState` を純粋な状態スナップショットのまま保つため。
 */

import { resolveClaimWinner, verifyCandidate } from './claims'
import { setupGame } from './deck'
import { IllegalActionError } from './errors'
import {
  claimDecisionOf,
  fromDraft,
  requireDiscarder,
  requirePhase,
  requirePlayer,
  takeFromWall,
  toDraft,
  type Draft,
} from './gameDraft'
import { yakuContextOf } from './gameSelectors'
import { createRng } from './rng'
import { advanceTurn, exitChain, finishGame } from './turnFlow'
import { applyDeclare, applyWin } from './win'
import { findYaku } from './yaku'
import type { Action, GameEvent, GameState, Player, PlayerId, Roster, RulesConfig } from './types'

export { IllegalActionError } from './errors'
export { resolveClaimWinner, type ClaimWinner } from './claims'
export { computeRanking, expectedHandSize, yakuContextOf } from './gameSelectors'
export {
  colorCountsOf,
  countUnseen,
  toVisibleCards,
  unseenOf,
  type ColorCount,
  type UnseenCounts,
  type VisibleCards,
} from './unseen'

export interface ReduceResult {
  readonly state: GameState
  readonly events: readonly GameEvent[]
}

export interface CreateGameOptions {
  /** 人間が操作する席。既定は 0 番のみ。全員 CPU にするなら空配列を渡す。 */
  readonly humanSeats?: readonly PlayerId[]
}

// --- 初期化 -------------------------------------------------------------------

/** ロスターとシードから配牌済みの初期状態を作る。同一シードなら完全に同じ状態になる。 */
export function createGame(
  roster: Roster,
  rules: RulesConfig,
  seed: number,
  options: CreateGameOptions = {},
): GameState {
  const humanSeats = new Set(options.humanSeats ?? [0])
  const rng = createRng(seed)
  const setup = setupGame(roster, rules, rng)

  const players: Player[] = setup.hands.map((hand, id) => ({
    id,
    isCpu: !humanSeats.has(id),
    hand,
    score: rules.startingScore,
    discards: [],
    declared: [],
  }))

  return {
    phase: 'draw',
    turn: 0,
    declarer: 0,
    players,
    wall: setup.wall,
    activeGroups: setup.activeGroups,
    activeMembers: setup.activeMembers,
    bonusMemberIds: setup.bonusMemberIds,
    lastDiscard: null,
    lastDiscardBy: null,
    claims: {},
    claimTimerMs: 0,
    chainCount: 0,
    seed,
    rngState: rng.state(),
  }
}

// --- 進行 ---------------------------------------------------------------------

function applyDraw(draft: Draft, events: GameEvent[]): void {
  requirePhase(draft, 'draw', 'DRAW')

  if (draft.wall.length === 0) {
    finishGame(draft, events, 'wallEmpty')
    return
  }

  const [card] = takeFromWall(draft, 1)
  const player = draft.players[draft.turn]
  player.hand = [...player.hand, card]

  draft.declarer = draft.turn
  draft.chainCount = 0
  draft.phase = 'selfDeclare'

  events.push({ type: 'CardDrawn', playerId: draft.turn, card })
}

function applyDiscard(draft: Draft, events: GameEvent[], uid: number, rules: RulesConfig): void {
  requirePhase(draft, 'discard', 'DISCARD')

  const player = draft.players[draft.turn]
  const index = player.hand.findIndex((card) => card.uid === uid)

  if (index < 0) {
    throw new IllegalActionError(`プレイヤー${draft.turn}の手札に uid ${uid} のカードがありません`)
  }

  const card = player.hand[index]
  player.hand = player.hand.filter((_, position) => position !== index)
  player.discards = [...player.discards, card]

  draft.lastDiscard = card
  draft.lastDiscardBy = draft.turn
  // 受付の上限。UI 層は自分の持ち時間で先に切り上げることがあるが、その場合も
  // 「窓を閉じる」意図で上限値の TICK を送ってくるため、ここは常に上限で初期化してよい。
  draft.claimTimerMs = rules.turnTimer.initialMs
  draft.phase = 'claimWindow'

  // 手番以外の全員を「未決定」として明示的に並べる。誰の意思表示を待っているかが
  // キーの有無ではなく値で分かるようにするため。
  draft.claims = {}
  for (const other of draft.players) {
    if (other.id !== draft.turn) {
      draft.claims[other.id] = null
    }
  }

  events.push({ type: 'Discarded', playerId: draft.turn, card })

  // プレイヤーが1人しかいない設定でも進行が止まらないようにする（待つ相手が誰もいない）。
  closeClaimWindowIfSettled(draft, events, rules)
}

// --- 割り込み -----------------------------------------------------------------

/**
 * 割り込みの意思表示を受け付けられる状態かを検査する。
 *
 * 役の再計算より先に呼ぶこと。順序を逆にすると、手番プレイヤーが誤って `CLAIM` を
 * 送ったときに「役が成立しません」という的外れなエラーになってしまう。
 */
function requireClaimable(draft: Draft, playerId: PlayerId, actionType: string): void {
  requirePhase(draft, 'claimWindow', actionType)
  requirePlayer(draft, playerId, `${actionType} の playerId`)

  if (playerId === draft.turn) {
    throw new IllegalActionError(
      `プレイヤー${playerId}は自分の捨て札に対して ${actionType} を送れません`,
    )
  }
  if (claimDecisionOf(draft, playerId) !== null) {
    throw new IllegalActionError(`プレイヤー${playerId}は既に意思表示を終えています`)
  }
}

/**
 * 割り込みを解決する。
 *
 * `resolveClaim` は外部からアクションを受け付けない過渡フェーズであり、
 * この関数を抜けるときには必ず別のフェーズへ移っている。
 */
function resolveClaims(draft: Draft, events: GameEvent[], rules: RulesConfig): void {
  draft.phase = 'resolveClaim'

  const winner = resolveClaimWinner(draft.claims, requireDiscarder(draft), rules.playerCount)

  if (winner === null) {
    advanceTurn(draft, events, rules)
    return
  }

  // ロンした人が補充後に続けて宣言できる。手番（捨てた人）はチェーンを抜けるまで動かさない。
  draft.declarer = winner.playerId
  draft.chainCount = 0
  draft.claims = {}

  applyWin(draft, events, winner.playerId, winner.candidate, 'ron', rules)
}

/** 全員の意思表示が揃っていれば、解決まで一気に進める。 */
function closeClaimWindowIfSettled(draft: Draft, events: GameEvent[], rules: RulesConfig): void {
  const hasPendingClaims = Object.values(draft.claims).some((decision) => decision === null)

  if (!hasPendingClaims) {
    resolveClaims(draft, events, rules)
  }
}

function applyTick(draft: Draft, events: GameEvent[], deltaMs: number, rules: RulesConfig): void {
  requirePhase(draft, 'claimWindow', 'TICK')

  if (!Number.isFinite(deltaMs) || deltaMs < 0) {
    throw new IllegalActionError(`TICK の deltaMs は0以上の有限値である必要があります: ${deltaMs}`)
  }

  draft.claimTimerMs = Math.max(0, draft.claimTimerMs - deltaMs)

  if (draft.claimTimerMs === 0) {
    for (const [key, decision] of Object.entries(draft.claims)) {
      if (decision === null) {
        draft.claims[Number(key)] = 'pass'
      }
    }
  }

  closeClaimWindowIfSettled(draft, events, rules)
}

// --- リデューサ ---------------------------------------------------------------

/**
 * アクションを適用し、次の状態と演出用イベントを返す。
 *
 * 入力の `state` は破壊しない。`gameOver` に到達した後はどのアクションも状態を変えない。
 * `rules` は対局を通じて同じものを渡すこと（入口で人数の整合だけ検査する）。
 */
export function reduce(state: GameState, action: Action, rules: RulesConfig): ReduceResult {
  if (state.phase === 'gameOver') {
    return { state, events: [] }
  }

  if (rules.playerCount !== state.players.length) {
    throw new IllegalActionError(
      `rules.playerCount(${rules.playerCount}) が対局の人数(${state.players.length})と一致しません。対局の途中で rules を差し替えていないか確認してください`,
    )
  }

  const draft = toDraft(state)
  const events: GameEvent[] = []
  const ctx = yakuContextOf(state, rules)

  switch (action.type) {
    case 'DRAW':
      applyDraw(draft, events)
      break

    case 'DECLARE':
      requirePhase(draft, 'selfDeclare', 'DECLARE')
      requirePlayer(draft, action.playerId, 'DECLARE の playerId')
      applyDeclare(draft, events, action.playerId, action.candidate, ctx, rules)
      break

    case 'SKIP_DECLARE':
      requirePhase(draft, 'selfDeclare', 'SKIP_DECLARE')
      exitChain(draft, events, rules)
      break

    case 'DISCARD':
      applyDiscard(draft, events, action.uid, rules)
      break

    case 'CLAIM': {
      requireClaimable(draft, action.playerId, 'CLAIM')

      const discard = draft.lastDiscard
      if (discard === null) {
        throw new IllegalActionError('割り込みの対象となる捨て札がありません')
      }

      // ロンの再計算は「受理の瞬間」に行う。優先度解決は手札を持たない純関数なので、
      // その時点では再計算できない。`claims` に入るのは常に再計算済みの候補になる。
      const probed = [...draft.players[action.playerId].hand, discard]
      const candidate = verifyCandidate(findYaku(probed, ctx, discard), action.candidate, 'CLAIM')

      draft.claims[action.playerId] = candidate
      closeClaimWindowIfSettled(draft, events, rules)
      break
    }

    case 'PASS':
      requireClaimable(draft, action.playerId, 'PASS')
      draft.claims[action.playerId] = 'pass'
      closeClaimWindowIfSettled(draft, events, rules)
      break

    case 'TICK':
      applyTick(draft, events, action.deltaMs, rules)
      break

    default: {
      // `Action` に種別を足して case を書き忘れたらここでコンパイルエラーになる。
      // switch の後に return があるため、default がないと未知の種別が黙って素通りしてしまう。
      const exhaustive: never = action
      throw new IllegalActionError(`未知のアクションです: ${JSON.stringify(exhaustive)}`)
    }
  }

  return { state: fromDraft(state, draft), events }
}
