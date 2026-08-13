/**
 * 対局の状態遷移を「どこで行うか」の差し替え点（transport seam）。
 *
 * Step 6 で、UI（`useGameLoop`）は生の `GameState` を持たず、注入された `GameTransport` に1手ずつ委ねて
 * `GameSnapshot`（`PlayerView` + 差分 events + version + wallet + outcome）を受け取り描画する。
 * - `localTransport`: ブラウザ内エンジン（Pages/オフライン・今日の挙動）。
 * - `remoteTransport`: サーバー権威（AWS。`POST/GET` で DynamoDB の真実を進める）。
 *
 * **配置は `src/net/` ではなく `src/ui/transport/`。** `.oxlintrc.json` の `src/net/**` は engine/ui からの import を
 * 禁止するが、transport は engine（型・ロジック）に依存する。`src/ui/**` に import 制限は無いのでここへ置く。
 * `remoteTransport` は `src/net/apiClient` を使う（依存の向き ui→net を保つ）。
 *
 * `GameSnapshot`/`OutcomeSummary`/`ClientAction` は Step 5 backend（`backend/src/dto.ts`）と**同形**で、同じ JSON を消費する。
 *
 * ⚠️ **これらトップレベル3型は backend と手書きで二重定義している**（ネストする `PlayerView`/`GameEvent`/`YakuCandidate`/
 * `PayoutBreakdown` は `@engine/*` で実体共有だが、外側の形は共有していない）。**片方のフィールドを変えたらもう片方も
 * 必ず直すこと**（`backend/src/dto.ts` の対の型）。コンパイルでは検知できない＝「たまたま揃っている」に正しさを預けている。
 */

import type { PayoutBreakdown } from '../../engine/payout'
import type { PlayerView } from '../../engine/playerView'
import type { Action, GameEvent, PlayerId, YakuCandidate } from '../../engine/types'

/** 終局時の精算内訳（backend の `OutcomeSummary` と同形）。server モードの精算はこれをそのまま使う。 */
export interface OutcomeSummary {
  readonly payout: PayoutBreakdown
  readonly ranking: readonly PlayerId[]
  readonly scores: readonly number[]
}

/**
 * 1手適用ごとにクライアントへ返す snapshot（backend の `GameSnapshot` と同形）。
 * `events` は **redact 済み**で、その apply の差分（人間手＋CPU手の連結）。`view` に他家手札・山札の中身・seed は無い。
 */
export interface GameSnapshot {
  readonly id: string
  readonly version: number
  readonly view: PlayerView
  readonly events: readonly GameEvent[]
  /** server 権威の財布。local ではダミー（`walletSource==='local'` で未使用）。 */
  readonly wallet: number
  readonly outcome: OutcomeSummary | null
}

/**
 * 次に自動で進める CPU の1手（local のみ）。`key` は決定の同一性を表し、`useGameLoop` の auto タイマーの
 * 依存に使う（`autoActionKey` 相当。`GameState` を依存に載せてタイマーが張り直される事故を防ぐ）。
 */
export interface AutoStep {
  readonly action: Action
  readonly delayMs: number
  readonly key: string
}

/**
 * `apply` の結果。`accepted` は「この手が受理され状態が進んだか」。
 * 時間切れの持ち時間減算は**受理時のみ**行う（押下と時間切れの競合で、間に合った操作から持ち時間を奪わないため）。
 * local は `IllegalActionError` を見送りとして `accepted:false`、remote は 409（競合）を `accepted:false` で返す。
 */
export interface ApplyResult {
  readonly snapshot: GameSnapshot
  readonly accepted: boolean
}

/**
 * 対局の状態遷移を担う差し替え可能な境界。
 *
 * `apply` が受け取るのは **engine の `Action`**（`ClientAction` ではない）。理由は、claim の時間切れが
 * `TICK`（受付を閉じる内部アクション）を送る必要があり、`TICK` は `ClientAction` に含まれないため。
 * `ClientAction` への変換（`TICK→PASS`・`playerId` 除去・`DRAW` の除外）は remoteTransport の内部に閉じる。
 */
export interface GameTransport {
  /**
   * 直近の snapshot を同期で返す（useReducer の初期 seed 用）。**local は常に非 null**（factory で createGame 済み）、
   * **remote は create() 前は null**（サーバー往復が要るため）。local はこれで初回レンダーから view を持ち loading 無し。
   */
  current(): GameSnapshot | null
  /** 新規対局を作り、最初の snapshot を返す。remote は POST /games、local は現在の（進めていない）snapshot。 */
  create(): Promise<GameSnapshot>
  /** engine `Action` を1手適用する。人間操作・時間切れ・（local の）CPU 手すべてこの1経路。 */
  apply(action: Action, expectedVersion: number): Promise<ApplyResult>
  /** 現在の snapshot を取り直す（remote の再同期・初回同期用）。 */
  get(): Promise<GameSnapshot>
  /** local: 次に自動で進める CPU 手＋演出遅延＋同一性キー。remote: 常に null（サーバーが解決済み）。 */
  nextAuto(): AutoStep | null
}

/**
 * サーバーへ送るときだけ使う DTO（backend の `ClientAction` と同形・5種）。`playerId` を持たない
 * （サーバーが humanSeat を強制）。remoteTransport が engine `Action` からこれへ変換する。
 */
export type ClientAction =
  | { readonly type: 'DISCARD'; readonly uid: number }
  | { readonly type: 'DECLARE'; readonly candidate: YakuCandidate }
  | { readonly type: 'SKIP_DECLARE' }
  | { readonly type: 'CLAIM'; readonly candidate: YakuCandidate }
  | { readonly type: 'PASS' }
