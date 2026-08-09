/**
 * ポカジャンのドメイン型定義。
 *
 * このモジュールは型と定数のみを持ち、ロジックを一切含まない。
 * エンジン層（`src/engine/`）は `src/config/` を import しない。
 * 具体的なルール値は `RulesConfig` として呼び出し側から注入される。
 */

/** カードの色。役の構成カードが全て同色だと大幅に加点される。 */
export const COLOR_IDS = ['pink', 'blue', 'orange'] as const

export type ColorId = (typeof COLOR_IDS)[number]

export type MemberId = string
export type GroupId = string
export type PlayerId = number

/** 山札・手札・河を構成する1枚。`uid` は1局を通じて一意。 */
export interface Card {
  readonly uid: number
  readonly memberId: MemberId
  readonly color: ColorId
}

/** カードに描かれるキャラクター。`imageId` は IndexedDB 上の画像キー（Step 6）。 */
export interface Member {
  readonly id: MemberId
  readonly name: string
  readonly imageId?: string
  readonly accent?: string
}

/** キャラクターのまとまり（原作の「期生」に相当）。3〜5人で構成される。 */
export interface Group {
  readonly id: GroupId
  readonly name: string
  /**
   * カードの角に出す記号。トランプのスートに相当する。
   *
   * 未設定なら名前の1文字目を使う。**上書きとして持つ**ことで、
   * 名前が似ているグループ（「ステラ組」「ソレイユ組」）を1文字で区別できる。
   */
  readonly symbol?: string
  readonly memberIds: readonly MemberId[]
}

/** 1ゲームで使うキャラクター定義の全体。Step 6 でユーザーが編集できる。 */
export interface Roster {
  readonly version: number
  readonly members: readonly Member[]
  readonly groups: readonly Group[]
}

/**
 * 役の種類。
 * - `triple`: 同一メンバー3枚
 * - `group3` / `group4` / `group5`: 該当サイズのグループ全員を1枚ずつ
 */
export type YakuKind = 'triple' | 'group3' | 'group4' | 'group5'

/**
 * 役として扱えるグループ人数の範囲。`YakuKind` の `group3` / `group4` / `group5` に対応する。
 *
 * `RulesConfig.minGroupSize` / `maxGroupSize` がこの範囲を外れると、ロスター検証は通るのに
 * 役判定が対応する `YakuKind` を決められず対局中に落ちる。両者の単一の真実として
 * ここに置き、`yaku.ts`（役種の決定）と `deck.ts`（ルール検証）の双方から参照する。
 */
export const MIN_YAKU_GROUP_SIZE = 3
export const MAX_YAKU_GROUP_SIZE = 5

/** 成立している役1つ分。`cards` は消費されるカード。 */
export interface YakuCandidate {
  readonly kind: YakuKind
  readonly sameColor: boolean
  readonly cards: readonly Card[]
  readonly bonusCount: number
  readonly score: number
}

/** 和了の種別。ツモは他3人から1/3ずつ、ロンは放銃者が全額支払う。 */
export type WinKind = 'tsumo' | 'ron'

/**
 * 役判定に必要な局の文脈（Step 2 の `findYaku` / `computeWaits` が受け取る）。
 *
 * 手札だけでは「どのグループが今局に登場しているか」「どのメンバーがボーナスか」が
 * 分からないため、判定関数はこれを引数で受け取る。
 */
export interface YakuContext {
  readonly activeGroups: readonly Group[]
  readonly bonusMemberIds: readonly MemberId[]
  readonly rules: RulesConfig
}

/** 対局の進行フェーズ。 */
export type Phase = 'draw' | 'selfDeclare' | 'discard' | 'claimWindow' | 'resolveClaim' | 'gameOver'

/**
 * `reduce` が外部に返しうるフェーズ。
 *
 * `resolveClaim` は割り込みを解決する間だけリデューサ内部を通過する過渡フェーズであり、
 * `reduce` の戻り値がこの状態になることはない。型から除いておくことで、UI 層が `phase` で
 * 網羅的に分岐したときに到達しないケースを書かされずに済む。
 * 「過渡フェーズのまま返らない」という保証をテストだけでなく型でも表現している。
 */
export type ObservablePhase = Exclude<Phase, 'resolveClaim'>

export interface Player {
  readonly id: PlayerId
  readonly isCpu: boolean
  readonly hand: readonly Card[]
  readonly score: number
  readonly discards: readonly Card[]
  /**
   * これまでに宣言して成立させた役。構成カードは場から取り除かれ、二度と使われない。
   *
   * UI の得点表示に使うほか、「山札 + 手札 + 河 + 成立済みの役」の合計が対局を通じて
   * 一定であること（カード保存則）を検査するための消費済みカードの置き場でもある。
   */
  readonly declared: readonly YakuCandidate[]
}

/** 割り込み宣言の意思表示。`null` は未決定（まだ待っている）。 */
export type ClaimDecision = YakuCandidate | 'pass' | null

/**
 * 1回分の点数移動。`settle.ts` の精算結果と `GameEvent` の `Paid` が同じ形を共有する。
 *
 * 両者を別々に定義すると、片方だけフィールドを足したときに drift するため1箇所にまとめている。
 */
export interface Payment {
  readonly from: PlayerId
  readonly to: PlayerId
  readonly amount: number
}

/** 対局終了の理由。 */
export type GameOverReason = 'wallEmpty' | 'bankrupt'

export interface GameState {
  readonly phase: ObservablePhase
  readonly turn: PlayerId
  /**
   * `selfDeclare` フェーズで宣言権を持つプレイヤー。`turn` とは別物である点に注意。
   *
   * ツモの連続宣言では `declarer === turn` だが、ロンの連続宣言では
   * `declarer` がロンしたプレイヤー、`turn` が捨て札を出したプレイヤーになり両者が食い違う。
   * この区別がないと「ロンした人が補充後に続けて宣言する」状況を表現できない。
   *
   * 「引いたカードをまだ持っているのは誰か」の判定にも使う（`declarer === turn` のときだけ
   * 手番プレイヤーが1枚多く持つ）。
   */
  readonly declarer: PlayerId
  readonly players: readonly Player[]
  readonly wall: readonly Card[]
  readonly activeGroups: readonly Group[]
  readonly activeMembers: readonly Member[]
  readonly bonusMemberIds: readonly MemberId[]
  /**
   * 直前の捨て札と、それを出したプレイヤー。
   *
   * この2つは対で読むこと。ロンが成立すると捨て札は役として消費されて `lastDiscard` は
   * `null` になるが、`lastDiscardBy` は「誰の手番だったか」を保持したまま次の手番へ進む。
   */
  readonly lastDiscard: Card | null
  readonly lastDiscardBy: PlayerId | null
  /**
   * 割り込みの意思表示。値が `null` なら「まだ待っている」。
   *
   * キーが存在するのは捨てたプレイヤー以外だけなので、全プレイヤー分が埋まる `Record` ではなく
   * 部分マップとして表す。存在しないキーを引いたときに型が `undefined` を含むため、
   * 「そもそも割り込みの対象外」と「まだ未表明」を取り違えずに済む。
   */
  readonly claims: Readonly<Partial<Record<PlayerId, ClaimDecision>>>
  readonly claimTimerMs: number
  /** 連続宣言の回数。`maxChainDeclare` を超えたら強制的に次フェーズへ進む。 */
  readonly chainCount: number
  readonly seed: number
  /** 乱数の現在状態。シードと合わせて局を完全に再現できる。 */
  readonly rngState: number
}

export type Action =
  | { readonly type: 'DRAW' }
  | { readonly type: 'DECLARE'; readonly playerId: PlayerId; readonly candidate: YakuCandidate }
  | { readonly type: 'SKIP_DECLARE' }
  | { readonly type: 'DISCARD'; readonly uid: number }
  | { readonly type: 'CLAIM'; readonly playerId: PlayerId; readonly candidate: YakuCandidate }
  | { readonly type: 'PASS'; readonly playerId: PlayerId }
  | { readonly type: 'TICK'; readonly deltaMs: number }

/**
 * リデューサが状態と一緒に返す演出用イベント。
 * UI 層はこれを見てアニメーションを再生し、ロジックと演出を疎結合に保つ。
 */
export type GameEvent =
  | { readonly type: 'CardDrawn'; readonly playerId: PlayerId; readonly card: Card }
  | { readonly type: 'Discarded'; readonly playerId: PlayerId; readonly card: Card }
  | {
      readonly type: 'Declared'
      readonly playerId: PlayerId
      readonly candidate: YakuCandidate
      readonly winKind: WinKind
    }
  | ({ readonly type: 'Paid' } & Payment)
  | { readonly type: 'Refilled'; readonly playerId: PlayerId; readonly cards: readonly Card[] }
  | { readonly type: 'TurnChanged'; readonly playerId: PlayerId }
  | {
      readonly type: 'GameOver'
      readonly ranking: readonly PlayerId[]
      readonly reason: GameOverReason
    }

/** 役1種あたりの点数。同色成立時は `sameColor` を使う。 */
export interface YakuScore {
  readonly base: number
  readonly sameColor: number
}

/**
 * 人間の持ち時間。**エンジンはこの値を計測しない**（時計を持たないため）。
 * 実際のカウントダウンは UI 層が行い、エンジンへは時間切れの瞬間だけ通知が来る。
 *
 * 「使い切ったときだけ減る」という非対称な仕様のため、初期値と減少幅と下限の3つが要る。
 * 単純に毎回減らすと、素早く打っているプレイヤーまで持ち時間を失う。
 */
export interface TurnTimerConfig {
  /** 対局開始時の持ち時間。割り込みの受付が開いている長さでもある。 */
  readonly initialMs: number
  /** 使い切ったときに減らす幅。 */
  readonly decrementMs: number
  /** これ以上は減らない下限。 */
  readonly minMs: number
}

/** BET 額の選択肢と、順位ごとの精算倍率。 */
export interface BetConfig {
  readonly options: readonly number[]
  /**
   * index 0 が1位。`playerCount` と同じ長さを持つ。
   *
   * **0.5 の倍数であること。** 精算では `整数の点数 × この倍率` を切り捨てるが、
   * 0.5 の倍数であれば二進浮動小数で厳密に表現でき、丸めに誤差が入らない。
   * `tests/config/rules.test.ts` で不変条件として検査している。
   */
  readonly rankMultiplier: readonly number[]
  /** 初回起動時に付与する所持コイン。 */
  readonly initialWallet: number
}

/**
 * 対局ルールの可変値すべて。
 * エンジンの関数は必ずこれを引数で受け取り、グローバル定数を直接参照しない。
 * これにより Step 6 のルール設定画面から任意の値を注入できる。
 */
export interface RulesConfig {
  readonly playerCount: number
  readonly handSize: number
  /** プールからこの枚数だけを抜き出して山札にする。残りは局中に登場しない。 */
  readonly deckSize: number
  readonly groupsPerGame: number
  readonly colors: readonly ColorId[]
  /** 1メンバー1色あたりのカード枚数。3色 × 3枚 = 1メンバー9枚。 */
  readonly copiesPerMemberColor: number
  readonly minGroupSize: number
  readonly maxGroupSize: number
  readonly startingScore: number
  readonly bonusMemberCount: number
  readonly bonusPerCard: number
  readonly turnTimer: TurnTimerConfig
  readonly maxChainDeclare: number
  readonly scores: Readonly<Record<YakuKind, YakuScore>>
  readonly bet: BetConfig
}
