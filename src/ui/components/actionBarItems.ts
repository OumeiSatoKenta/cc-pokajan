/**
 * 操作バーに出すボタンの決定。
 *
 * 「今どのボタンを出すか」を純粋関数として切り出すことで、
 * jsdom を導入せずに配線を検証できるようにする。
 * `renderToStaticMarkup` は `useEffect` を実行しないため、
 * この判断をコンポーネントの中に埋めるとテストできる手段が E2E しかなくなる。
 */

import type { ObservablePhase, YakuCandidate } from '../../engine/types'
import { YAKU_LABELS } from '../labels'

export interface ActionBarItem {
  readonly kind: 'declare' | 'claim' | 'pass'
  readonly label: string
  /** `pass` のときだけ未定義。 */
  readonly candidate?: YakuCandidate
}

export interface ActionBarInput {
  readonly phase: ObservablePhase
  readonly declarable: readonly YakuCandidate[]
  readonly claimable: readonly YakuCandidate[]
  /**
   * 和了演出中か（`pendingWin !== null`）。真なら**ボタンを一切出さない**。
   * 演出中も `game.state` は連続宣言で次の `selfDeclare` へ進みうるため、`phase`/`declarable` だけで
   * ボタンを出すと `.overlay` が奪えないキーボード経路で見送り・おまかせが押せてしまう。手札側
   * （`interactionGate` の `isPaused`）と同じ判定で、7-4 の「両層で止める」をボタンにも効かせる。
   */
  readonly isPaused?: boolean
}

/** 役を「役名（同色）N点」の1行に整える。操作バーとライブプレビューで文言を揃えるため共有する。 */
export function describeYaku(candidate: YakuCandidate): string {
  const name = YAKU_LABELS[candidate.kind]
  const color = candidate.sameColor ? '（同色）' : ''
  return `${name}${color} ${candidate.score}点`
}

/** 点数の高い順。同点なら消費枚数の少ない順（手札を温存できる方を先に見せる）。 */
function byValue(a: YakuCandidate, b: YakuCandidate): number {
  return b.score - a.score || a.cards.length - b.cards.length
}

/**
 * 出すべきボタンを決める。
 *
 * 宣言できる役がないときは**何も出さない**。押せないボタンを見せても
 * 判断の材料にならず、「押せるはずなのに押せない」という誤解を生む。
 * 役がない場合は `decideAutoAction` が自動で通過させるため、
 * そもそもこの状態が画面に留まることはない。
 */
export function actionBarItems(input: ActionBarInput): ActionBarItem[] {
  // 和了演出中は盤面を凍結する。ボタンを出すと演出の裏でキーボードから押せてしまう（7-4）。
  if (input.isPaused === true) {
    return []
  }

  if (input.phase === 'selfDeclare' && input.declarable.length > 0) {
    return [
      ...[...input.declarable].sort(byValue).map((candidate): ActionBarItem => ({
        kind: 'declare',
        label: describeYaku(candidate),
        candidate,
      })),
      { kind: 'pass', label: '見送る' },
    ]
  }

  if (input.phase === 'claimWindow' && input.claimable.length > 0) {
    return [
      ...[...input.claimable].sort(byValue).map((candidate): ActionBarItem => ({
        kind: 'claim',
        label: describeYaku(candidate),
        candidate,
      })),
      { kind: 'pass', label: '見送る' },
    ]
  }

  return []
}

/**
 * 手札の上に出す案内文。
 *
 * 捨てられるかどうかだけで決めると、宣言や割り込みを求められている場面でも
 * 「相手の手番です」と出てしまう（ボタンが出ているのに待てと言う矛盾になる）。
 * 判断を純粋関数にしておき、各状況を直接テストできるようにする。
 */
export function hintFor(input: ActionBarInput & { readonly canDiscard: boolean }): string {
  // 和了演出中は局面が連続宣言で先に進んでいても操作は凍結されている（手札・ボタンとも）。
  // ここで「捨ててください」「割り込めます」を出すと**押せると言うのに押せない**矛盾になるため、
  // 中立の文言に倒す（`interactionGate`/`actionBarItems` の `isPaused` 停止と揃える）。
  if (input.isPaused === true) {
    return '和了を確認しています'
  }
  if (input.canDiscard) {
    return '捨てるカードを選んでください'
  }
  if (input.phase === 'claimWindow' && input.claimable.length > 0) {
    return '割り込めます'
  }
  if (input.phase === 'selfDeclare' && input.declarable.length > 0) {
    return '役が成立しています'
  }
  if (input.phase === 'gameOver') {
    return '対局終了'
  }
  return '相手の手番です'
}
