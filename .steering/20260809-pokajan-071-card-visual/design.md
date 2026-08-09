# Step 7-1: カードの表現 — 設計

## 決定1: 伏せ札は `Card` を受け取らない別コンポーネントにする

**本ステップで最も重要な設計判断。**

計画では `CardView` に `faceDown?: boolean` を足す案だったが、これを採らない。

`CardView` に `faceDown` を足すと、**伏せ札を描くために他家の `Card` を渡すことになる**。
他家の手札は `GameState.players[].hand` として UI から参照できるので、
「渡すが描かない」という約束だけで情報を守ることになり、
実装ミス1つ・条件分岐の取り違え1つで名前や画像が漏れる。

代わりに**枚数だけを受け取る** `CardBack` を作る。

```ts
// src/ui/components/CardBack.tsx
export interface CardBackProps {
  readonly count: number
  readonly orientation?: 'horizontal' | 'vertical'
}
```

`Card` を引数に取らないので、**漏らそうとしても漏らせない**。
CPU に `AiView` しか渡さないのと同じ考え方で、
「正しく実装したから漏れない」ではなく「到達経路が型として存在しない」状態にする。

> `orientation` は Step 7-2 で左右の席を縦積みにするために先に用意しておく。
> 本ステップでは `horizontal` のみ使う。

## 決定2: `.card--small` はサイズ修飾子として `CardView` に足す

```ts
readonly size?: 'normal' | 'small'
```

河のカードは手札より小さくする。`.card` の寸法（4.25rem × 6rem）を
`.card--small`（2.4rem × 3.4rem）で上書きする。

**別コンポーネントに分けない。** 河のカードと手札のカードは
「同じものが違う大きさで出ている」ことに意味がある（手札と河の対応を目で取れる）。
分けると、片方だけに変更が入ったときに見え方がずれる。

## 決定3: `MemberTile` は合成 `Card` を作らない

ボーナスは**メンバー単位**の情報で、色を持たない。
`Card` は `color` を必須で持つため、ボーナス表示のために合成 `Card` を作ると
「実在しないカード」がドメイン型として生まれ、
`uid` の衝突やカード保存則の検査に紛れ込む余地ができる。

`MemberTile` は `Member` の表示に必要な最小限だけを受け取る。

```ts
// src/ui/components/MemberTile.tsx
export interface MemberTileProps {
  readonly name: string
  readonly imageUrl?: string
  readonly label?: string // 「ボーナス」など
}
```

スタイルは `.card` を再利用し、色の代わりに `.card--tile`（中立色）を当てる。

## 決定4: 河のカードも画像とグループ記号を出す

手札と同じ見え方にそろえる。`TableScreen` が既に持っている
`imageUrlById` / `groupSymbolById` を `DiscardPile` へ渡す。

河のカードは**押せない**（`onClick` を渡さない）。
`CardView` は `onClick` が無ければ `<div>` で描くので、
捨てる操作と取り違える余地がない。

## 決定5: `.chip` は残す

`.chip` は `DiscardPile` と `PlayerSeat`（直近の捨て札）の両方で使われている。
本ステップで `DiscardPile` はカード化するが、`PlayerSeat` は Step 7-2 で
作り替えるまで `.chip` を使い続ける。**今消すと 7-2 までの間だけ壊れる。**

## 決定6: 河の折り返しは行数で頭打ちにしない

河は最大で `deckSize`(100) 枚まで増えうる。`flex-wrap` で折り返すが、
**高さの上限は設けない**（Step 7-2 で卓レイアウトに入れるときに領域が決まるため、
ここで暫定の上限を入れると 7-2 で二度手間になる）。

---

## 変更するファイル

| ファイル | 区分 | 内容 |
| -------- | ---- | ---- |
| `src/ui/components/CardBack.tsx` | 新規 | 枚数だけを受け取る伏せ札 |
| `src/ui/components/MemberTile.tsx` | 新規 | ボーナス表示（カード型・色なし） |
| `src/ui/components/CardView.tsx` | 修正 | `size` prop と `.card--small` |
| `src/ui/components/DiscardPile.tsx` | 修正 | チップ → `CardView`（小） |
| `src/ui/components/BoardInfo.tsx` | 修正 | ボーナスのテキスト → `MemberTile` |
| `src/ui/components/PlayerSeat.tsx` | 修正 | 伏せ札を `CardBack` で描く |
| `src/ui/screens/TableScreen.tsx` | 修正 | `DiscardPile` / `BoardInfo` へ画像と記号を渡す |
| `src/App.css` | 修正 | `.card--small` / `.card--back` / `.card--tile` |
| `src/ui/table.css` | 修正 | 河のレイアウト |
| `tests/ui/cardVisual.test.tsx` | 新規 | 伏せ札の情報漏れ検査ほか |

## リスク

| リスク | 対策 |
| ------ | ---- |
| **伏せ札から他家の手札が漏れる** | 決定1。`Card` を受け取らない形にする。テストで出力にメンバー名が含まれないことを固定 |
| 河が縦に伸びて盤面を圧迫する | 決定6。折り返しはするが上限は 7-2 で決める |
| 画像付きの河でレンダリングが重くなる | 実機のスクリーンショットで確認する |
| `.chip` を消して `PlayerSeat` が壊れる | 決定5。7-2 まで残す |
| 河のカードを押せてしまう | 決定4。`onClick` を渡さない（`<div>` になる） |
