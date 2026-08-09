import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WaitPanel } from '../../src/ui/components/WaitPanel'
import { countUnseen, type UnseenCounts } from '../../src/engine/unseen'
import { testRules } from '../helpers/game'
import { hand } from '../helpers/cards'
import type { ColorId, MemberId, YakuKind } from '../../src/engine/types'
import type { WaitEntry } from '../../src/engine/yaku'

const RULES = testRules()
const MEMBER_IDS: readonly MemberId[] = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3', 'b4']

const NAMES: ReadonlyMap<MemberId, string> = new Map([
  ['a1', 'ミナ'],
  ['a2', 'リオ'],
  ['a3', 'ソラ'],
  ['b1', 'ハル'],
])

function waitEntry(
  memberId: MemberId,
  color: ColorId,
  options: { kind?: YakuKind; score?: number; sameColor?: boolean } = {},
): WaitEntry {
  return {
    memberId,
    color,
    best: {
      kind: options.kind ?? 'triple',
      sameColor: options.sameColor ?? false,
      cards: [],
      bonusCount: 0,
      score: options.score ?? 120,
    },
  }
}

/**
 * 見えている枚数から残枚数を作る。
 *
 * **`countUnseen` を通す。** ここで `UnseenCounts` を手で組み立てると、
 * 実際の並びやキーの作り方から離れたテスト用の形を検査してしまう。
 */
function unseenWith(visibleSpec: string): UnseenCounts {
  return countUnseen(
    { hand: hand(visibleSpec), discardsByPlayer: [], declaredByPlayer: [] },
    MEMBER_IDS,
    RULES,
  )
}

const EMPTY = unseenWith('')

function render(
  waits: readonly WaitEntry[],
  options: { unseen?: UnseenCounts; maxRows?: number } = {},
): string {
  return renderToStaticMarkup(
    <WaitPanel
      waits={waits}
      unseen={options.unseen ?? EMPTY}
      memberNameById={NAMES}
      maxRows={options.maxRows}
    />,
  )
}

describe('WaitPanel — 出す条件', () => {
  /** テンパイしていないときに枠だけ出ると、卓の高さが常に取られる。 */
  it('待ちが無ければ何も描かない', () => {
    expect(render([])).toBe('')
  })

  it('待ちがあれば一覧を出す', () => {
    const html = render([waitEntry('a1', 'blue')])

    expect(html).toContain('data-testid="wait-panel"')
    expect(html).toContain('ミナ')
    expect(html).toContain('青')
    expect(html).toContain('3カード')
  })
})

describe('WaitPanel — トリガとフロー外オーバーレイ（10-1）', () => {
  /**
   * 手札の位置を動かさないため、常時は「待ち N件」トリガだけを出し、
   * 一覧はフロー外オーバーレイに入れる。件数はソート後の総数と一致する。
   */
  it('「待ち N件」トリガと、オーバーレイを出す', () => {
    const html = render([waitEntry('a1', 'blue'), waitEntry('a2', 'pink')])

    expect(html).toContain('data-testid="wait-trigger"')
    expect(html).toContain('待ち2件')
    expect(html).toContain('data-testid="wait-overlay"')
  })

  /** 初期はピン留めされていない（明示操作の状態を `aria-expanded` が反映する）。 */
  it('初期状態は aria-expanded=false', () => {
    expect(render([waitEntry('a1', 'blue')])).toContain('aria-expanded="false"')
  })

  /** トリガとオーバーレイが aria-controls / id で結ばれている（開示ウィジェット）。 */
  it('トリガの aria-controls がオーバーレイの id を指す', () => {
    const html = render([waitEntry('a1', 'blue')])
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1]

    expect(controls).toBeTruthy()
    expect(html).toContain(`id="${controls}"`)
  })

  /** 一覧の行はオーバーレイの内側にある（フローには出さない）。 */
  it('待ちの行はオーバーレイの内側に入る', () => {
    const html = render([waitEntry('a1', 'blue')])
    const overlayPos = html.indexOf('data-testid="wait-overlay"')
    const rowPos = html.indexOf('data-testid="wait-row"')

    expect(overlayPos).toBeGreaterThanOrEqual(0)
    expect(rowPos).toBeGreaterThan(overlayPos)
  })
})

describe('WaitPanel — 残枚数', () => {
  it('残枚数を数と属性の両方で出す', () => {
    // ピンクの a1 が1枚見えている → 残りは copiesPerMemberColor - 1
    const html = render([waitEntry('a1', 'pink')], { unseen: unseenWith('a1:pink') })
    const remaining = RULES.copiesPerMemberColor - 1

    expect(html).toContain(`data-unseen="${remaining}"`)
    expect(html).toContain(`残${remaining}`)
  })

  /**
   * **この印がこの部品の中心。** 役はできるが、その札はもう場に無い。
   * 淡さ（CSS）だけでなく `data-unseen` にも出すので、色を見なくても分かる。
   */
  it('残0 の行に印を付ける', () => {
    const allGone = 'a1:pink a1:pink a1:pink'
    const html = render([waitEntry('a1', 'pink')], { unseen: unseenWith(allGone) })

    expect(html).toContain('data-unseen="0"')
    expect(html).toContain('wait__row--dead')
  })

  it('残っている行には印を付けない', () => {
    expect(render([waitEntry('a1', 'pink')])).not.toContain('wait__row--dead')
  })
})

describe('WaitPanel — 並び順', () => {
  /**
   * **生きている待ちを先に出す。**
   *
   * 点数だけで並べると、高い役の待ちが全部死んでいる局面で
   * 生きている待ちが打ち切りの下に隠れる。「上がれそうか」を確かめる、という
   * この機能の目的がそこで失われる。
   */
  it('残っている待ちを、点数が低くても死んだ待ちより先に出す', () => {
    const deadHighScore = waitEntry('a1', 'pink', { score: 1800, kind: 'group5' })
    const aliveLowScore = waitEntry('a2', 'blue', { score: 120 })

    const html = render([deadHighScore, aliveLowScore], {
      unseen: unseenWith('a1:pink a1:pink a1:pink'),
    })

    expect(html.indexOf('リオ')).toBeLessThan(html.indexOf('ミナ'))
  })

  it('生死が同じなら点数の高い順に並べる', () => {
    const html = render([
      waitEntry('a1', 'pink', { score: 120 }),
      waitEntry('a2', 'blue', { score: 480, kind: 'group5' }),
    ])

    expect(html.indexOf('リオ')).toBeLessThan(html.indexOf('ミナ'))
  })
})

describe('WaitPanel — 打ち切り', () => {
  const many = [
    waitEntry('a1', 'pink'),
    waitEntry('a2', 'pink'),
    waitEntry('a3', 'pink'),
    waitEntry('b1', 'pink'),
    waitEntry('a1', 'blue'),
    waitEntry('a2', 'blue'),
    waitEntry('a3', 'blue'),
  ]

  it('上限までしか並べず、残りは件数で示す', () => {
    const html = render(many, { maxRows: 6 })
    const rows = html.match(/data-testid="wait-row"/g) ?? []

    expect(rows).toHaveLength(6)
    expect(html).toContain('他1件')
  })

  it('上限に収まっていれば件数は出さない', () => {
    const html = render(many.slice(0, 3), { maxRows: 6 })

    expect(html).not.toContain('data-testid="wait-more"')
  })

  /** ちょうど上限のときに「他0件」が出ないこと（`hidden > 0` の境界）。 */
  it('ちょうど上限のときは件数を出さない', () => {
    const html = render(many.slice(0, 6), { maxRows: 6 })
    const rows = html.match(/data-testid="wait-row"/g) ?? []

    expect(rows).toHaveLength(6)
    expect(html).not.toContain('data-testid="wait-more"')
    expect(html).not.toContain('他0件')
  })
})

describe('WaitPanel — 待ちが全滅している局面', () => {
  /**
   * 全部の待ちが残0。**淡くはなるが、消えはしない。**
   * 消してしまうと「テンパイしているのに何も出ない」ことになり、
   * 「待ちが無い」のか「全部死んでいる」のかを区別できなくなる。
   */
  it('全部が残0でも一覧は出て、全行に印が付く', () => {
    const allGone = unseenWith('a1:pink a1:pink a1:pink a2:blue a2:blue a2:blue')
    const html = render([waitEntry('a1', 'pink'), waitEntry('a2', 'blue', { score: 480 })], {
      unseen: allGone,
    })

    const rows = html.match(/data-testid="wait-row"/g) ?? []
    const dead = html.match(/wait__row--dead/g) ?? []

    expect(rows).toHaveLength(2)
    expect(dead).toHaveLength(2)
    // 生死が同じなら点数の高い順のまま
    expect(html.indexOf('リオ')).toBeLessThan(html.indexOf('ミナ'))
  })
})
