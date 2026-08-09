import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CardBack } from '../../src/ui/components/CardBack'
import { CardView } from '../../src/ui/components/CardView'
import { DiscardPile } from '../../src/ui/components/DiscardPile'
import { MemberTile } from '../../src/ui/components/MemberTile'
import { hand } from '../helpers/cards'
import type { MemberId } from '../../src/engine/types'

/**
 * カードの描き方の検証。
 *
 * `renderToStaticMarkup` は `useEffect` を実行しないため初期描画のみを見る。
 * ここで確かめたいのは**出力に何が含まれるか / 含まれないか**なので、それで足りる。
 */

const NAMES: ReadonlyMap<MemberId, string> = new Map([
  ['a1', 'アオイ'],
  ['a2', 'ヒナタ'],
])

const IMAGES: ReadonlyMap<MemberId, string> = new Map([['a1', 'blob:image-a1']])
const SYMBOLS: ReadonlyMap<MemberId, string> = new Map([
  ['a1', 'ス'],
  ['a2', 'ス'],
])

describe('CardBack — 情報漏れ', () => {
  /**
   * **本ステップで最も重要な検査。**
   *
   * 他家の手札は `GameState.players[].hand` として UI から参照できる。
   * 伏せ札が `Card` を受け取らない設計なら、そもそも中身を渡せないので漏れない。
   * この検査は「その設計が保たれていること」を出力から確かめる。
   */
  it('伏せ札の出力にカードの情報が一切含まれない', () => {
    const html = renderToStaticMarkup(<CardBack count={7} />)

    expect(html).not.toContain('アオイ')
    expect(html).not.toContain('ヒナタ')
    expect(html).not.toContain('blob:')
    // 色のクラスも出さない（色から絞り込めてしまう）
    expect(html).not.toContain('card--pink')
    expect(html).not.toContain('card--blue')
    expect(html).not.toContain('card--orange')
    // グループ記号も出さない
    expect(html).not.toContain('card-symbol')
  })

  it('指定した枚数だけ描かれる', () => {
    for (const count of [0, 1, 7, 13]) {
      const html = renderToStaticMarkup(<CardBack count={count} />)
      const backs = html.match(/data-testid="card-back"/g)?.length ?? 0

      expect(backs, `count=${count}`).toBe(count)
    }
  })

  it('枚数を属性としても出す', () => {
    expect(renderToStaticMarkup(<CardBack count={5} />)).toContain('data-count="5"')
  })

  /** 上流で保証されるはずだが、ここでも潰しておく（描画を壊さない）。 */
  it('負値・小数・非数でも落ちない', () => {
    expect(renderToStaticMarkup(<CardBack count={-3} />)).toContain('data-count="0"')
    expect(renderToStaticMarkup(<CardBack count={2.7} />)).toContain('data-count="2"')
    expect(renderToStaticMarkup(<CardBack count={Number.NaN} />)).toContain('data-count="0"')
  })

  it('向きをクラスに反映する', () => {
    expect(renderToStaticMarkup(<CardBack count={1} />)).toContain('card-backs--horizontal')
    expect(renderToStaticMarkup(<CardBack count={1} orientation="vertical" />)).toContain(
      'card-backs--vertical',
    )
  })
})

describe('CardView — サイズと識別子', () => {
  const card = hand('a1:pink')[0]

  it('既定は通常サイズで、小サイズの修飾子が付かない', () => {
    const html = renderToStaticMarkup(<CardView card={card} memberName="アオイ" />)

    expect(html).not.toContain('card--small')
    expect(html).toContain('data-testid="card"')
  })

  it('small を指定すると修飾子が付く', () => {
    const html = renderToStaticMarkup(<CardView card={card} memberName="アオイ" size="small" />)

    expect(html).toContain('card--small')
  })

  /**
   * 河のカードと手札のカードが同じ識別子だと、「手札の1枚を捨てる」E2E が
   * 河のカードを拾い、静かに別の場所を検査することになる。
   */
  it('識別子を差し替えられる', () => {
    const html = renderToStaticMarkup(
      <CardView card={card} memberName="アオイ" testId="river-card" />,
    )

    expect(html).toContain('data-testid="river-card"')
    expect(html).not.toContain('data-testid="card"')
  })

  it('onClick が無ければボタンにならない', () => {
    const html = renderToStaticMarkup(<CardView card={card} memberName="アオイ" />)

    expect(html).not.toContain('<button')
  })

  it('onClick があればボタンになる', () => {
    const html = renderToStaticMarkup(
      <CardView card={card} memberName="アオイ" onClick={() => undefined} />,
    )

    expect(html).toContain('<button')
  })
})

describe('CardView — 待ち札の強調（面の色を殺さない）', () => {
  const card = hand('a1:pink')[0]

  /**
   * 待ち札は枠・グロー・持ち上げ（App.css の .card--waiting）で強調するが、
   * **面の色は塗り替えない**。面の色は同色役の判定情報で、消すと狙える色が読めなくなる。
   *
   * ここで固定するのは DOM 不変条件——強調クラスと面の色クラスが**同時に**付くこと。
   * 将来 CardView が面の色クラスを強調クラスで置き換えたら落ちる。
   * （`renderToStaticMarkup` は CSS を適用しないため、色や translateY の**見た目**は
   * ここでは検証していない。それは実装の目視・E2E の領分。）
   */
  it('isWaiting でも面の色クラス（card--pink）が残る', () => {
    const html = renderToStaticMarkup(<CardView card={card} memberName="アオイ" isWaiting />)

    expect(html).toContain('card--waiting')
    expect(html).toContain('card--pink')
  })

  it('isWaiting でなければ強調クラスは付かない', () => {
    const html = renderToStaticMarkup(<CardView card={card} memberName="アオイ" />)

    expect(html).not.toContain('card--waiting')
  })
})

describe('DiscardPile', () => {
  const cards = hand('a1:pink a2:blue')

  it('河のカードは手札と別の識別子で描かれる', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={cards} memberNameById={NAMES} label="あなたの河" />,
    )

    expect(html.match(/data-testid="river-card"/g)).toHaveLength(2)
    expect(html).not.toContain('data-testid="card"')
  })

  /** 押せてしまうと「捨てる」操作と取り違える。 */
  it('河のカードは押せない', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={cards} memberNameById={NAMES} label="あなたの河" />,
    )

    expect(html).not.toContain('<button')
  })

  it('小サイズで描かれる', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={cards} memberNameById={NAMES} label="あなたの河" />,
    )

    expect(html.match(/card--small/g)).toHaveLength(2)
  })

  /** 手札と同じ見え方にそろえる（画像とグループ記号を出す）。 */
  it('画像とグループ記号を出す', () => {
    const html = renderToStaticMarkup(
      <DiscardPile
        cards={cards}
        memberNameById={NAMES}
        imageUrlById={IMAGES}
        groupSymbolById={SYMBOLS}
        label="あなたの河"
      />,
    )

    expect(html).toContain('blob:image-a1')
    expect(html).toContain('card-symbol')
  })

  /**
   * 卓には河が4つ並ぶ。見出しを出すと文字が卓を埋めるため、
   * 誰の河かは位置が示し、読み上げ向けには `aria-label` を残す。
   */
  it('見出しを持たず読み上げ用の名前だけを持つ', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={cards} memberNameById={NAMES} label="上家の河" />,
    )

    expect(html).toContain('aria-label="上家の河"')
    expect(html).not.toContain('<h2')
  })

  /**
   * 空でも `<ul>` ごと消さない。消すと1枚目が出た瞬間に河の高さが
   * 0 から立ち上がり、卓全体がガタつく（高さは CSS の `min-height` で確保する）。
   */
  it('空でも枠は残り、カードは0枚になる', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={[]} memberNameById={NAMES} label="あなたの河" />,
    )

    expect(html).toContain('data-testid="river-list"')
    expect(html).toContain('data-count="0"')
    expect(html).not.toContain('river-card')
  })

  /** 4人分の河を席ごとに数えられないと、E2E が総数しか見られなくなる。 */
  it('識別子を差し替えられる', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={cards} memberNameById={NAMES} label="あなたの河" testId="my-river" />,
    )

    expect(html).toContain('data-testid="my-river"')
  })

  it('画像と記号を渡さなくても描ける', () => {
    expect(() =>
      renderToStaticMarkup(<DiscardPile cards={cards} memberNameById={NAMES} label="あなたの河" />),
    ).not.toThrow()
  })

  /**
   * 河は直近5枚だけを固定長で見せる（卓の高さを一定に保つ）。
   * **表示の制限であり、残枚数計算（unseen.ts）は全枚を数える別経路**。
   * わざと `slice(-5)` を外すと6枚描かれてこのテストが落ちる。
   */
  it('6枚以上でも表示は直近5枚に留まり、件数ラベルで超過を示す', () => {
    const six = hand('a1:pink a2:blue a1:pink a2:blue a1:pink a2:blue')
    const html = renderToStaticMarkup(
      <DiscardPile cards={six} memberNameById={NAMES} label="あなたの河" />,
    )

    expect(html.match(/data-testid="river-card"/g)).toHaveLength(5)
    expect(html).toContain('直近5枚 / 計6')
    // データ上の総数は保つ（残枚数計算やE2Eが総数を参照できる）。
    expect(html).toContain('data-count="6"')
  })

  it('5枚以下は「N枚」ラベルを出す', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={cards} memberNameById={NAMES} label="あなたの河" />,
    )

    expect(html).toContain('>2枚<')
  })

  /**
   * 直前の1枚（ロン対象）だけを強調する。**表示中の最後の札**（slice 後の末尾）にだけ付き、
   * 他には付かないこと・面の色クラスが残ることを**位置で**固定する。
   * 回数だけ見ると実装を `i === 0` に書き換えても通ってしまうため、どのカードかを検証する。
   */
  it('highlightLast は表示中の最後の1枚だけを card--last にする', () => {
    // 6枚投入。表示は直近5枚で、末尾は a2:blue。古い a1:pink 側には付かない。
    const six = hand('a1:pink a1:pink a1:pink a1:pink a1:pink a2:blue')
    const html = renderToStaticMarkup(
      <DiscardPile cards={six} memberNameById={NAMES} label="あなたの河" highlightLast />,
    )

    // カード容器の class 属性を1枚ずつ取り出す（card__name 等は "card " で始まらず拾わない）。
    const cardClasses = html.match(/class="card [^"]*"/g) ?? []
    expect(cardClasses).toHaveLength(5)

    const last = cardClasses.at(-1) ?? ''
    expect(last).toContain('card--last')
    expect(last).toContain('card--blue') // 面の色は残す
    for (const cls of cardClasses.slice(0, -1)) {
      expect(cls).not.toContain('card--last')
    }
  })

  it('highlightLast を渡さなければ強調しない', () => {
    const html = renderToStaticMarkup(
      <DiscardPile cards={cards} memberNameById={NAMES} label="あなたの河" />,
    )

    expect(html).not.toContain('card--last')
  })
})

describe('MemberTile', () => {
  it('名前とラベルを出す', () => {
    const html = renderToStaticMarkup(<MemberTile name="アオイ" label="ボーナス" />)

    expect(html).toContain('アオイ')
    expect(html).toContain('ボーナス')
  })

  it('画像があれば出す', () => {
    const html = renderToStaticMarkup(<MemberTile name="アオイ" imageUrl="blob:x" />)

    expect(html).toContain('blob:x')
  })

  /** 画像が無くても遊べるという要件は変わらない。 */
  it('画像が無ければ名前だけで描ける', () => {
    const html = renderToStaticMarkup(<MemberTile name="アオイ" />)

    expect(html).toContain('アオイ')
    expect(html).not.toContain('<img')
  })

  /** 色を持たないので、カードの色クラスは付かない。 */
  it('色のクラスを持たず中立色のタイルになる', () => {
    const html = renderToStaticMarkup(<MemberTile name="アオイ" />)

    expect(html).toContain('card--tile')
    expect(html).not.toContain('card--pink')
    expect(html).not.toContain('card--blue')
    expect(html).not.toContain('card--orange')
  })

  it('識別子を差し替えられる', () => {
    const html = renderToStaticMarkup(<MemberTile name="アオイ" testId="bonus-tile" />)

    expect(html).toContain('data-testid="bonus-tile"')
  })
})
