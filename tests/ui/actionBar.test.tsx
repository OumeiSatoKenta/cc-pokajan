import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActionBar } from '../../src/ui/components/ActionBar'
import { hand } from '../helpers/cards'
import type { ObservablePhase, YakuCandidate } from '../../src/engine/types'

/**
 * 操作ボタンの**色分けの配線**を固定する（Step 10-2）。
 *
 * ツモ（自摸宣言）=緑 / ロン（割り込み）=赤 / 見送る=ゴースト。
 * class を `button--primary` に戻すと落ちるようにして、色分けの回帰を捕まえる。
 * 見た目（グラデ・影・コントラスト）は CSS 側の設計で担保し、ここでは配線のみ検査する。
 */

function candidate(score: number): YakuCandidate {
  return { kind: 'triple', sameColor: false, cards: hand('a1:pink a2:blue'), bonusCount: 0, score }
}

function render(
  phase: ObservablePhase,
  options: { declarable?: readonly YakuCandidate[]; claimable?: readonly YakuCandidate[] } = {},
): string {
  return renderToStaticMarkup(
    <ActionBar
      phase={phase}
      declarable={options.declarable ?? []}
      claimable={options.claimable ?? []}
      timerKind={null}
      timeLimitMs={0}
      timerKey={null}
      onDeclare={() => undefined}
      onClaim={() => undefined}
      onPass={() => undefined}
    />,
  )
}

describe('ActionBar — 操作ボタンの色分け', () => {
  it('ツモ（自摸宣言）は緑（button--tsumo）で出す', () => {
    const html = render('selfDeclare', { declarable: [candidate(120)] })

    expect(html).toContain('data-testid="declare-button"')
    expect(html).toContain('button--tsumo')
    // ラベルは役名＋点数を保つ。
    expect(html).toContain('3カード 120点')
    // 金の主ボタンには戻さない（色分けの回帰）。
    expect(html).not.toContain('button--primary')
  })

  it('ロン（割り込み）は赤（button--ron）で出す', () => {
    const html = render('claimWindow', { claimable: [candidate(390)] })

    expect(html).toContain('data-testid="claim-button"')
    expect(html).toContain('button--ron')
    expect(html).not.toContain('button--primary')
  })

  it('見送るはゴースト（button--ghost）で出す', () => {
    const html = render('selfDeclare', { declarable: [candidate(120)] })

    expect(html).toContain('data-testid="pass-button"')
    expect(html).toContain('button--ghost')
    expect(html).toContain('見送る')
  })

  it('押せる役が無ければボタンを出さない（操作エリアは残る）', () => {
    const html = render('discard')

    expect(html).toContain('data-testid="action-bar"')
    expect(html).not.toContain('data-testid="declare-button"')
    expect(html).not.toContain('data-testid="claim-button"')
  })
})
