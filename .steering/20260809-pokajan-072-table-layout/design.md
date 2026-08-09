# Step 7-2: 4方向レイアウト — 設計

## 1. 席の向きは「相対位置」から導く

`seatName`（`src/ui/labels.ts:39`）は既に `humanSeat` からの相対オフセットで
呼び名を決めている。**向きも同じオフセットから導く**。

| オフセット | 呼び名 | 向き | グリッド領域 |
| ---------- | ------ | ---- | ------------ |
| 0 | あなた | —（`table__mine`） | `bottom` |
| 1 | 下家 | `right` | `right` |
| 2 | 対面 | `top` | `top` |
| 3 | 上家 | `left` | `left` |

`labels.ts` に `seatOrientation(playerId, humanSeat, playerCount)` を追加する。

```ts
export type SeatOrientation = 'self' | 'right' | 'top' | 'left'
const SEAT_ORIENTATIONS = ['self', 'right', 'top', 'left'] as const
```

**`playerId` で直接引かない理由**は `seatName` と同じ。`createGame` は任意の席を
人間にできるため、`playerId === 1` を「下家」と決め打つと `humanSeat !== 0` の対局で
卓が回転する。「今はたまたま 0 番だから正しい」に依存させない。

`playerCount` が 4 以外のときは `SEAT_ORIENTATIONS[offset]` が `undefined` になる。
**そのときは `'top'` に落とす**（上段に横並びで積まれる＝Step 7-1 以前と同じ見え方）。
`playerCount` は `RulesConfig` にあるが UI からは編集できないため実際には 4 固定だが、
落とし先を決めておかないと「4人でしか動かない」暗黙の前提が生まれる。

## 2. `BoardInfo` → `BoardCenter` に改名する

計画（`docs/ideas/pokajan-mahjong-board-plan.md`）は
「中央の盤面（山札・ボーナス・グループ）を `BoardCenter.tsx` へ切り出す」としているが、
**その中身はすでに `BoardInfo.tsx`（114行）として独立している**。
新たに `BoardCenter` を作ると `BoardInfo` を包むだけの層になる。

そこで**切り出しではなく改名**する。責務は変わらないが、
「場の情報パネル」から「卓の中央」へと**置かれる場所が役割の名前になった**ため、
名前を合わせておくほうが後から読んだときに配置と対応が取れる。

`BoardInfo` の import 元は `TableScreen` だけ（`grep` で確認済み）なので影響は閉じる。

> 計画が想定していた「`TableScreen` が 400 行を超える」問題は、
> 分離済みだったぶん**すでに解決している**。実測で確認しながら進める。

## 3. `PlayerSeat` に向きと河を持たせる

```ts
export interface PlayerSeatProps {
  readonly player: Player
  readonly memberNameById: ReadonlyMap<MemberId, string>
  readonly imageUrlById?: ReadonlyMap<MemberId, string>
  readonly groupSymbolById?: ReadonlyMap<MemberId, string>
  readonly seatLabel: string
  readonly orientation: 'top' | 'left' | 'right'
  readonly isTurn: boolean
  readonly isDeclarer: boolean
}
```

- 伏せ札の向き: `orientation === 'top' ? 'horizontal' : 'vertical'`
- **直近の捨て札チップを廃止**し、`DiscardPile` による河に置き換える。
  チップは「河が無かったころの代用品」なので、河が入った時点で二重表示になる。
  `.chip` の CSS も同時に消す（**使われない CSS を残すと、次に触る人が現役だと誤解する**。
  Step 6b で `.card__image` が丸ごと欠けていたのと逆向きの事故）
- 手札の中身を渡さない性質は変えない。`CardBack` は枚数しか受け取らない

## 4. 縦積みは「回転」ではなく「寸法の入れ替え」

左右の席の伏せ札は縦に積む。`transform: rotate(90deg)` は**レイアウトボックスを変えない**ため、
1.5rem 幅のまま 2.2rem がはみ出し、余白を手で足して辻褄を合わせることになる。

伏せ札は**中身を一切描かない**（`CardBack` は `Card` を受け取らない）ので、
回転せず**幅と高さを入れ替えるだけ**で同じ絵になる。

```css
.card-backs--vertical .card--back {
  width: 2.2rem;
  height: 1.5rem;
}
```

## 5. 河は見出しを持たない

4人分の河が並ぶと `<h2>河</h2>` が4つ出て卓が文字で埋まる。
**位置で誰の河かが分かるのが卓レイアウトの目的**なので、見出しは表示しない。

- `<section class="river" aria-label="上家の河">` の `aria-label` は残す（読み上げは維持）
- 空のときの案内文も出さない。空の河は麻雀では普通の状態で、
  「まだ捨て札はありません」は情報を増やさない。代わりに `min-height` で場所だけ確保し、
  1枚目が出たときに卓がガタつかないようにする
- `DiscardPile` に `testId?: string`（既定 `'river'`）を足す

### `testId` が必要な理由（E2E の回帰）

`tests/e2e/table.spec.ts` の「河が捨てた絵札で並ぶ」は
`getByTestId('river-card')` の**総数**を 0 → 1 で見ている。
4人分の河になると、自分の番が来るまでに CPU が捨てた札が入るので**必ず落ちる**。

自分の河に `data-testid="my-river"` を付け、
`page.locator('[data-testid="my-river"] [data-testid="river-card"]')` で数えるようにする。
**「自分の河が1枚増えたこと」を見るという元の意図をそのまま保てる。**

## 6. グリッド

```css
.table__board {
  display: grid;
  grid-template-areas:
    'top    top    top'
    'left   center right'
    'bottom bottom bottom';
  grid-template-columns: minmax(6rem, 1fr) minmax(0, 2.4fr) minmax(6rem, 1fr);
  gap: 0.5rem;
}
```

- 対面と自分は横幅いっぱいを使う（伏せ札7枚と手札7枚が横に並ぶため）
- 左右は `minmax(6rem, 1fr)`。縦積みの伏せ札（2.2rem）と小カードの河が入る幅
- 中央は `minmax(0, 2.4fr)`。**`minmax(0, …)` にしないと**、中の
  グループ一覧が最小コンテンツ幅を押し上げて左右の列を潰す

30rem 以下では 1 列に積む。

```css
grid-template-areas: 'top' 'left' 'right' 'center' 'bottom';
```

**縦積みの伏せ札も横並びに戻す。** 1 列になった時点で左右の区別は位置ではなく
ラベルが担うため、縦のままだと席が縦に伸びるだけで得がない。
向きは props で決まるが、ここは CSS 側で上書きする（レイアウトの都合なので CSS の責務）。

## 7. CSS の分割

`src/ui/table.css` は 579 行あり、卓レイアウトを足すと基準（400行）を大きく超える。
**卓（盤面）と操作（手札・操作バー・演出）**で分ける。

| ファイル | 含めるもの |
| -------- | ---------- |
| `src/ui/board.css`（新規） | `.table` / `.table__board` / `.seat*` / `.board*` / `.river*` |
| `src/ui/table.css` | `.table__mine*` / `.hand*` / `.actions*` / `.timer*` / `.toast*` / `.overlay*` |

メディアクエリは**それぞれのファイルに置く**（分割の境界をまたいで1箇所に集めると、
片方を消したときにもう片方の指定が孤児になる）。`TableScreen` が両方を import する。

## 8. 変更するファイル

**新規**
- `src/ui/board.css`
- `src/ui/components/BoardCenter.tsx`（`BoardInfo.tsx` からの改名）

**修正**
- `src/ui/labels.ts` — `seatOrientation` / `SeatOrientation`
- `src/ui/components/PlayerSeat.tsx` — 向き・河・チップ廃止
- `src/ui/components/DiscardPile.tsx` — 見出しと空文言の廃止・`testId`
- `src/ui/screens/TableScreen.tsx` — 3×3 グリッド
- `src/ui/table.css` — 盤面の記述を `board.css` へ移す・`.chip` 削除
- `src/App.css` — `.card-backs--vertical` の寸法入れ替え

**削除**
- `src/ui/components/BoardInfo.tsx`

**テスト**
- `tests/ui/cardVisual.test.tsx` — 見出し・空文言の廃止に追随
- `tests/ui/labels.test.ts` — `seatOrientation`
- `tests/ui/tableLayout.test.tsx`（新規） — 席の向き・河の分離・伏せ札の非漏洩
- `tests/e2e/table.spec.ts` — 自分の河に限定・4方向の配置

## 9. 検証

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

目視（Playwright のスクリーンショット）:
1. 900px — 対面が上・上家が左・下家が右・自分が下
2. 900px — 4人分の河にカードが並ぶ
3. 375px — 1列に積まれ横スクロールが出ない
4. 画像付きロスターで河が崩れない
