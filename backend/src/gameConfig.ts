/**
 * サーバー権威の既定設定。**クライアント指定の rules/roster は受け付けない**（anti-cheat）。
 *
 * import 元が非対称な点に注意: `RULES`/`ROSTER` は `@config/*`、**`AI` だけ `@engine/ai`**（`DEFAULT_AI_CONFIG` は
 * engine 側にある）。`INITIAL_WALLET` は `RULES.bet.initialWallet` を単一の真実として導出する（env で二重管理しない）。
 */
import { DEFAULT_ROSTER } from '@config/defaultRoster'
import { DEFAULT_RULES } from '@config/rules'
import { DEFAULT_AI_CONFIG } from '@engine/ai'
import type { PlayerId } from '@engine/types'

export const RULES = DEFAULT_RULES
export const ROSTER = DEFAULT_ROSTER
export const AI = DEFAULT_AI_CONFIG

/** 人間が操作する席。単プレイは席0のみ（残り3席は CPU）。 */
export const HUMAN_SEAT: PlayerId = 0
export const HUMAN_SEATS: readonly PlayerId[] = [HUMAN_SEAT]

/** 新規ユーザーの初期コイン。RulesConfig を単一の真実にする（env で渡さない）。 */
export const INITIAL_WALLET = RULES.bet.initialWallet

/** GAME item の TTL。対局が収まる十分長い値（精算前失効を起こさない）。 */
export const TTL_DAYS = 30

/**
 * `advanceToHuman` の暴走検知。1リクエストで解決しうる手数の理論上限（`maxChainDeclare` × 人数 × 補充）を
 * 大きく超える値。正常時は絶対に到達せず、到達したら engine のバグとして例外（→500）にする。
 */
export const MAX_ADVANCE_STEPS = 10_000
