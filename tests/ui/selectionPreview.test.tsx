import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { SelectionPreview } from '../../src/ui/components/SelectionPreview'
import { hand } from '../helpers/cards'
import type { YakuCandidate } from '../../src/engine/types'

/**
 * ライブプレビューの配線を固定する（Step 2 / Step 3 で `kind` を追加）。
 *
 * `renderToStaticMarkup` は `useEffect` を実行しないため初期描画のみを見る。
 * 検証したいのは「役があれば役名＋点数を出し確定を活性化する」「無効なら案内＋不活性」
 * という**出力と活性条件**、および**確定ボタンをツモ／ロンで出し分ける**（`kind`）ことなので、
 * それで足りる（見た目・クリック・詳細度勝敗は E2E の領分）。
 */

function candidate(overrides: Partial<YakuCandidate> = {}): YakuCandidate {
  return {
    kind: 'triple',
    sameColor: false,
    cards: hand('a1:pink a1:blue a1:orange'),
    bonusCount: 0,
    score: 120,
    ...overrides,
  }
}

describe('SelectionPreview', () => {
  it('有効な役なら役名＋点数を出し、確定（ツモ）を活性化する', () => {
    const html = renderToStaticMarkup(
      <SelectionPreview
        composed={candidate()}
        selectionCount={3}
        onConfirm={() => undefined}
        kind="tsumo"
      />,
    )

    expect(html).toContain('3カード 120点')
    expect(html).toContain('data-valid="true"')
    // 確定は緑（button--tsumo）で、活性（disabled が付かない）。
    expect(html).toContain('data-testid="declare-confirm"')
    expect(html).toContain('button--tsumo')
    expect(html).not.toContain('disabled')
  })

  it('同色役なら（同色）バッジを出す', () => {
    const html = renderToStaticMarkup(
      <SelectionPreview
        composed={candidate({ sameColor: true, score: 840 })}
        selectionCount={3}
        onConfirm={() => undefined}
        kind="tsumo"
      />,
    )

    expect(html).toContain('3カード（同色） 840点')
  })

  it('選んだが役にならないときは案内を出し、確定を不活性にする', () => {
    const html = renderToStaticMarkup(
      <SelectionPreview
        composed={null}
        selectionCount={2}
        onConfirm={() => undefined}
        kind="tsumo"
      />,
    )

    expect(html).toContain('この組み合わせでは役になりません')
    expect(html).toContain('data-valid="false"')
    // 確定ボタンは描くが押せない（活性条件を反転すると落ちる）。
    expect(html).toContain('data-testid="declare-confirm"')
    expect(html).toContain('disabled')
  })

  it('未選択のときは選び方の案内を出し、確定を不活性にする', () => {
    const html = renderToStaticMarkup(
      <SelectionPreview
        composed={null}
        selectionCount={0}
        onConfirm={() => undefined}
        kind="tsumo"
      />,
    )

    expect(html).toContain('手札をタップして役を作る')
    expect(html).toContain('disabled')
  })

  it('kind="ron" では確定を赤（button--ron）の「ロン」（claim-confirm）で出す', () => {
    const html = renderToStaticMarkup(
      <SelectionPreview
        composed={candidate({ score: 390 })}
        selectionCount={2}
        onConfirm={() => undefined}
        kind="ron"
      />,
    )

    // プレビュー本文はツモと共通（役名＋点数）。差分は確定ボタンの3属性だけ。
    expect(html).toContain('3カード 390点')
    expect(html).toContain('data-testid="claim-confirm"')
    expect(html).toContain('button--ron')
    expect(html).toContain('>ロン<')
    // ツモ側の testid・色・ラベルは出さない（種別が固定化されていない＝出し分けが効いている）。
    expect(html).not.toContain('data-testid="declare-confirm"')
    expect(html).not.toContain('button--tsumo')
    expect(html).not.toContain('ツモ')
    expect(html).not.toContain('disabled')
  })

  it('kind="ron" でも無効なら確定（ロン）を不活性にする', () => {
    const html = renderToStaticMarkup(
      <SelectionPreview
        composed={null}
        selectionCount={1}
        onConfirm={() => undefined}
        kind="ron"
      />,
    )

    expect(html).toContain('この組み合わせでは役になりません')
    expect(html).toContain('data-testid="claim-confirm"')
    expect(html).toContain('disabled')
  })
})
