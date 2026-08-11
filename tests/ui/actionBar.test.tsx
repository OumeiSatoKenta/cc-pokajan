import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ActionBar } from '../../src/ui/components/ActionBar'
import type { SelectionPreviewProps } from '../../src/ui/components/SelectionPreview'
import { hand } from '../helpers/cards'
import type { ObservablePhase, YakuCandidate } from '../../src/engine/types'

/**
 * 操作ボタンの**配線**を固定する（Step 10-2 / Step 2 / Step 3 で改訂）。
 *
 * ツモ・ロン候補はどちらも**おまかせプレフィル**（金 `button--primary`・押すと選択欄へ入れる。即確定しない）。
 * 実際の確定は `SelectionPreview`（緑ツモ `declare-confirm` / 赤ロン `claim-confirm`）が担うため、
 * ActionBar 側は確定ボタンを直接出さない。見送る=ゴースト。onClick の中身（プレフィル）は
 * 静的マークアップでは検証できないため E2E で担保し、ここでは class・testid・ラベルの配線のみ検査する。
 */

function candidate(score: number): YakuCandidate {
  return { kind: 'triple', sameColor: false, cards: hand('a1:pink a2:blue'), bonusCount: 0, score }
}

function render(
  phase: ObservablePhase,
  options: {
    declarable?: readonly YakuCandidate[]
    claimable?: readonly YakuCandidate[]
    selection?: SelectionPreviewProps | null
    isPaused?: boolean
  } = {},
): string {
  return renderToStaticMarkup(
    <ActionBar
      phase={phase}
      declarable={options.declarable ?? []}
      claimable={options.claimable ?? []}
      timerKind={null}
      timeLimitMs={0}
      timerKey={null}
      selection={options.selection ?? null}
      onPrefill={() => undefined}
      onPass={() => undefined}
      isPaused={options.isPaused ?? false}
    />,
  )
}

describe('ActionBar — 操作ボタンの配線', () => {
  it('ツモ候補は「おまかせ」プレフィル（金 button--primary）で出す', () => {
    const html = render('selfDeclare', { declarable: [candidate(120)] })

    expect(html).toContain('data-testid="declare-button"')
    // おまかせ＝金の主ボタン。緑の確定（button--tsumo）はここには出さない。
    expect(html).toContain('button--primary')
    expect(html).not.toContain('button--tsumo')
    // ラベルは「おまかせ」＋役名＋点数。
    expect(html).toContain('おまかせ 3カード 120点')
  })

  it('ロン候補も「おまかせ」プレフィル（金 button--primary）で出す（赤の即時ではない）', () => {
    const html = render('claimWindow', { claimable: [candidate(390)] })

    expect(html).toContain('data-testid="claim-button"')
    // ツモと対称に金のプレフィル。赤の確定（button--ron）はここには出さない（SelectionPreview が担う）。
    expect(html).toContain('button--primary')
    expect(html).not.toContain('button--ron')
    expect(html).toContain('おまかせ 3カード 390点')
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

  it('selection(kind=tsumo) を渡すと操作バー内にライブプレビュー＋緑ツモ確定を出す', () => {
    const html = render('selfDeclare', {
      declarable: [candidate(120)],
      selection: {
        composed: candidate(120),
        selectionCount: 3,
        onConfirm: () => undefined,
        kind: 'tsumo',
      },
    })

    // プレビューと確定は `.actions` の中（横向きの高さ保護に相乗りする）。
    expect(html).toContain('data-testid="selection-preview"')
    expect(html).toContain('data-testid="declare-confirm"')
    // おまかせ（金）と確定（緑）が併存する。
    expect(html).toContain('data-testid="declare-button"')
    expect(html).toContain('button--tsumo')
  })

  it('selection(kind=ron) を渡すと操作バー内に赤ロン確定（claim-confirm）を出す', () => {
    const html = render('claimWindow', {
      claimable: [candidate(390)],
      selection: {
        composed: candidate(390),
        selectionCount: 2,
        onConfirm: () => undefined,
        kind: 'ron',
      },
    })

    expect(html).toContain('data-testid="selection-preview"')
    // ロン確定は赤（button--ron）の claim-confirm。おまかせ（金）と併存する。
    expect(html).toContain('data-testid="claim-confirm"')
    expect(html).toContain('button--ron')
    expect(html).toContain('data-testid="claim-button"')
  })

  it('selection が null なら確定は出さない（おまかせと見送りだけ）', () => {
    const html = render('selfDeclare', { declarable: [candidate(120)], selection: null })

    expect(html).not.toContain('data-testid="selection-preview"')
    expect(html).not.toContain('data-testid="declare-confirm"')
    expect(html).not.toContain('data-testid="claim-confirm"')
  })

  it('和了演出中（isPaused）は役があってもボタンを一切出さない（7-4 の両層停止）', () => {
    // 連続宣言で game.state が次の selfDeclare に進んでいても、演出中はボタンを出さない。
    // これを出すと `.overlay` が奪えないキーボード経路で見送り・おまかせが押せてしまう。
    const html = render('selfDeclare', { declarable: [candidate(120)], isPaused: true })

    expect(html).toContain('data-testid="action-bar"')
    expect(html).not.toContain('data-testid="declare-button"')
    expect(html).not.toContain('data-testid="pass-button"')
  })

  it('claimWindow でも演出中（isPaused）はロン候補ボタンを出さない', () => {
    const html = render('claimWindow', { claimable: [candidate(390)], isPaused: true })

    expect(html).not.toContain('data-testid="claim-button"')
    expect(html).not.toContain('data-testid="pass-button"')
  })
})
