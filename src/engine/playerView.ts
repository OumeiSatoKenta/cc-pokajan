/**
 * プレイヤー1人に見せてよい情報だけを集めた PlayerView。
 *
 * `ai.ts` の AiView・`unseen.ts` の VisibleCards と同じく「状態に触れるのは toPlayerView 1関数だけ、
 * 以降は公開情報で完結」。他家の手札・山札の中身・seed（山札の決定的再現に使える）は型・構造の両面で含めない。
 * Step 5（サーバー権威）はこの view をクライアントへ返し、Step 6（フロント transport seam）は
 * local/remote の双方でこの view を描画に使う。
 */

import type {
  Card,
  ClaimDecision,
  GameEvent,
  GameState,
  Group,
  Member,
  MemberId,
  ObservablePhase,
  PlayerId,
  YakuCandidate,
} from './types'

/**
 * 割り込みの状態のみ。`ClaimDecision`（`YakuCandidate` を含む）を外へ出さないための redact 型。
 *
 * `GameState.claims[id]` は CLAIM 時に実カードを含む `YakuCandidate` を保持し、claimWindow は全員表明まで
 * 閉じない。「CPU が先に CLAIM・人間が未表明」の局面（単一人間プレイでも到達）で生カードを素通しすると
 * 他家の手札が漏れるため、状態だけに落とす。
 */
export type ClaimStatus = 'pending' | 'passed' | 'claimed'

/**
 * 他家も含む各プレイヤーの公開情報。**`hand` フィールドを持たない**（他家の手札を表現する経路が型に存在しない）。
 * 手札は枚数 `handCount` のみ。
 */
export interface PlayerSummary {
  readonly id: PlayerId
  readonly isCpu: boolean
  readonly score: number
  readonly handCount: number
  readonly discards: readonly Card[]
  readonly declared: readonly YakuCandidate[]
}

/**
 * `selfId` の席から見た1局の公開ビュー。自分の手札だけ `hand` に入り、山札は `wallCount` のみ。
 * `wall`（中身）・`seed`・`rngState` は含めない（seed から山札を再現できるため）。`version` も含めない
 * （`GameState` に無く、Step 5 の DynamoDB 層が付ける）。
 */
export interface PlayerView {
  readonly selfId: PlayerId
  readonly hand: readonly Card[]
  readonly phase: ObservablePhase
  readonly turn: PlayerId
  readonly declarer: PlayerId
  readonly players: readonly PlayerSummary[]
  readonly wallCount: number
  readonly activeGroups: readonly Group[]
  readonly activeMembers: readonly Member[]
  readonly bonusMemberIds: readonly MemberId[]
  readonly lastDiscard: Card | null
  readonly lastDiscardBy: PlayerId | null
  readonly claims: Readonly<Partial<Record<PlayerId, ClaimStatus>>>
  readonly claimTimerMs: number
  readonly chainCount: number
}

/**
 * `ClaimDecision`（`null | 'pass' | YakuCandidate`）をカードを含まない `ClaimStatus` に落とす。
 * CLAIM 済みの他家の実カードを外へ出さない唯一の変換点。
 */
function toClaimStatus(decision: ClaimDecision): ClaimStatus {
  if (decision === null) {
    return 'pending'
  }
  if (decision === 'pass') {
    return 'passed'
  }
  // 残るのは YakuCandidate のみ。ClaimDecision に第4の変種が増えたらここで型エラーになり、
  // redaction 境界（実カードを外へ出さない唯一の変換点）を黙って 'claimed' に丸めるのを防ぐ。
  decision satisfies YakuCandidate
  return 'claimed'
}

/**
 * **状態に触れる唯一の場所。** ここで手札を1人分に絞り、山札を枚数に、claims を状態に redact することで、
 * 返り値は他家の手札・山札の中身・seed への到達経路を持たない。
 */
export function toPlayerView(state: GameState, seat: PlayerId): PlayerView {
  // seat は Step 5 でネットワーク境界（JSON デシリアライズ後の未検証値）から来る。型は実行時に消えるため、
  // toAiView と同じ明示検証で範囲外・非整数・プロトタイプ由来キー（'__proto__' / 'length' 等）を弾く
  // （`state.players[seat] === undefined` の暗黙判定はそれらを素通しし、hand:undefined の壊れた view を返す）。
  if (!Number.isInteger(seat) || seat < 0 || seat >= state.players.length) {
    throw new RangeError(
      `seat は 0〜${state.players.length - 1} の整数である必要がありますが ${String(seat)} でした`,
    )
  }
  const me = state.players[seat]

  const claims: Partial<Record<PlayerId, ClaimStatus>> = {}
  for (const key of Object.keys(state.claims)) {
    const id = Number(key)
    const decision = state.claims[id]
    if (decision === undefined) {
      continue
    }
    claims[id] = toClaimStatus(decision)
  }

  return {
    selfId: seat,
    hand: me.hand,
    phase: state.phase,
    turn: state.turn,
    declarer: state.declarer,
    players: state.players.map((player) => ({
      id: player.id,
      isCpu: player.isCpu,
      score: player.score,
      handCount: player.hand.length,
      discards: player.discards,
      declared: player.declared,
    })),
    wallCount: state.wall.length,
    activeGroups: state.activeGroups,
    activeMembers: state.activeMembers,
    bonusMemberIds: state.bonusMemberIds,
    lastDiscard: state.lastDiscard,
    lastDiscardBy: state.lastDiscardBy,
    claims,
    claimTimerMs: state.claimTimerMs,
    chainCount: state.chainCount,
  }
}

/**
 * イベント列を `selfSeat` に見せてよいものだけに絞る。**`toPlayerView` と対になる redaction の第2の境界。**
 *
 * `reduce` の演出用 `GameEvent` のうち、他家の**実カード**を含むのは2種類:
 * - `CardDrawn`（`game.ts`）: 手番が CPU でも「引いた実カード」を持つ。
 * - `Refilled`（`win.ts`）: 勝者が CPU でも「補充した実カード」を持つ（手の内に入り公開されない）。
 *
 * これらは `playerId !== selfSeat` なら**イベントごと除外**する（枚数は `PlayerView.players[].handCount` で公開済み）。
 * 他のイベントは公開情報なので通す:
 * - `Discarded`（河に出る）/ `Declared`（成立役は勝利時に公開＝`PlayerSummary.declared` と一致）/
 *   `Paid`（点数移動）/ `TurnChanged` / `GameOver`。
 *
 * サーバー権威（Step 5）は `GameSnapshot.events` に**必ずこれを通した結果だけ**を載せる。`view` を redact しても
 * 生の `events` を返せば他家手札が漏れる（`view` だけ守っても意味が無い）。Step 6 のローカル transport も同関数を通す。
 */
export function redactEvents(
  events: readonly GameEvent[],
  selfSeat: PlayerId,
): readonly GameEvent[] {
  return events.filter((event) => {
    switch (event.type) {
      // 他家の実カードを含む2種。自席のものだけ残す。
      case 'CardDrawn':
      case 'Refilled':
        return event.playerId === selfSeat
      // 以下はすべて公開情報。新しい変種が増えたら default の never で気付く。
      case 'Discarded':
      case 'Declared':
      case 'Paid':
      case 'TurnChanged':
      case 'GameOver':
        return true
      default: {
        // `GameEvent` に変種が増えて case を書き忘れたらコンパイルエラーにする（漏洩の初期値を安全側に倒す）。
        const exhaustive: never = event
        void exhaustive
        return false
      }
    }
  })
}
