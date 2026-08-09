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
}

function describe(candidate: YakuCandidate): string {
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
  if (input.phase === 'selfDeclare' && input.declarable.length > 0) {
    return [
      ...[...input.declarable].sort(byValue).map((candidate): ActionBarItem => ({
        kind: 'declare',
        label: describe(candidate),
        candidate,
      })),
      { kind: 'pass', label: '見送る' },
    ]
  }

  if (input.phase === 'claimWindow' && input.claimable.length > 0) {
    return [
      ...[...input.claimable].sort(byValue).map((candidate): ActionBarItem => ({
        kind: 'claim',
        label: describe(candidate),
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
