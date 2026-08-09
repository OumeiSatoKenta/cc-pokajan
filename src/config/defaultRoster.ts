import type { Roster } from '../engine/types'

/**
 * 同梱のデフォルトロスター。
 *
 * 著作権上の方針として、実在のキャラクター名・公式素材は一切含めない。
 * 天体・海・森・大地・風をモチーフにした創作名のみで構成している。
 * ユーザーは Step 6 のロスターエディタから自由に差し替えられる。
 *
 * 構成: 6グループ / 22メンバー（サイズ 3, 3, 3, 4, 4, 5）。
 *
 * グループ数を `groupsPerGame`(4) より多く用意することで、局ごとに登場グループが変わる。
 * サイズ配分は「4グループ選出時の合計人数が13〜16人」に収まるよう決めており、
 * 原作の実測レンジ（12〜16種）とほぼ一致する。3人組・4人組・5人組の全役が
 * 出現しうるよう、3つのサイズをすべて含めている。
 *
 * 最悪ケース（人数の少ない4グループ = 13人 = 117枚）でも `deckSize`(100) を満たす。
 * 画像未設定でも遊べるよう、全メンバーに `accent`（カード地の差し色）を持たせている。
 */
export const DEFAULT_ROSTER: Roster = {
  version: 1,
  members: [
    // ステラ組
    { id: 'nova', name: 'ノヴァ', accent: '#f2789b' },
    { id: 'lux', name: 'ルクス', accent: '#7fb2f0' },
    { id: 'vega', name: 'ヴェガ', accent: '#f5b971' },

    // ソレイユ組
    { id: 'sol', name: 'ソル', accent: '#f4a259' },
    { id: 'aurora', name: 'アウロラ', accent: '#b98cf0' },
    { id: 'helio', name: 'ヘリオ', accent: '#f0d264' },

    // ゼファー組
    { id: 'zeph', name: 'ゼフィル', accent: '#a8d8e8' },
    { id: 'notos', name: 'ノトス', accent: '#e8b8a8' },
    { id: 'boreas', name: 'ボレアス', accent: '#a8b8e8' },

    // マリン組
    { id: 'nereis', name: 'ネレイス', accent: '#5fc9d6' },
    { id: 'coral', name: 'コーラル', accent: '#f38b8b' },
    { id: 'tide', name: 'ティード', accent: '#6aa9e9' },
    { id: 'abyss', name: 'アビス', accent: '#4a5a8a' },

    // シルヴァ組
    { id: 'flora', name: 'フローラ', accent: '#f28fb2' },
    { id: 'blanc', name: 'ブラン', accent: '#d8d8e0' },
    { id: 'verde', name: 'ヴェルデ', accent: '#7bc47f' },
    { id: 'moss', name: 'モス', accent: '#5c8a5c' },

    // テラ組
    { id: 'gaia', name: 'ガイア', accent: '#a3785a' },
    { id: 'petra', name: 'ペトラ', accent: '#9a9a9a' },
    { id: 'rune', name: 'ルーン', accent: '#8f7fd6' },
    { id: 'onyx', name: 'オニキス', accent: '#4a4a52' },
    { id: 'agate', name: 'アガット', accent: '#d69f9f' },
  ],
  groups: [
    { id: 'stella', name: 'ステラ組', memberIds: ['nova', 'lux', 'vega'] },
    { id: 'soleil', name: 'ソレイユ組', memberIds: ['sol', 'aurora', 'helio'] },
    { id: 'zephyr', name: 'ゼファー組', memberIds: ['zeph', 'notos', 'boreas'] },
    { id: 'marine', name: 'マリン組', memberIds: ['nereis', 'coral', 'tide', 'abyss'] },
    { id: 'silva', name: 'シルヴァ組', memberIds: ['flora', 'blanc', 'verde', 'moss'] },
    { id: 'terra', name: 'テラ組', memberIds: ['gaia', 'petra', 'rune', 'onyx', 'agate'] },
  ],
}
