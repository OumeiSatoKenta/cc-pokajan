# Step 6b: カードの見た目 — 設計

> **後追いで作成した記録。** 実装済みのコードに基づく。

## R1: 画像を切り取らない

### 決定1: 切り出しではなく「収める」計算に置き換える

`centerSquareCrop(width, height) → { sx, sy, size }` を廃止し、
`fitWithin(width, height, max) → { width, height }` に置き換えた。

```ts
export function fitWithin(width: number, height: number, max = IMAGE_SIZE): FitSize {
  if (width <= 0 || height <= 0) return { width: 1, height: 1 }
  const scale = Math.min(1, max / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
```

- **拡大しない**（`Math.min(1, …)`）。粗くなるだけで情報は増えない
- **1px 未満に潰さない**（`Math.max(1, …)`）。0px の canvas は作れない
- 保存される画像は正方形ではなくなるため、`fileToSquareImage` を
  `fileToStoredImage` に改名した

### 決定2: 保存と表示の**両方**を `contain` に揃える

これが本ステップで最も間違えやすい点。

保存時に切らなくても、表示側が `object-fit: cover` のままだと
**切り取る場所が保存時から表示時に移るだけ**で、利用者から見た結果は変わらない。

- `.card__image` → `object-fit: contain`
- `.roster__thumb-image` → `cover` から `contain` へ変更

カードの縦横比（4.25 : 6）と画像の縦横比は一般に異なるので余白ができるが、
**それが「切り取らない」ということ**であり意図どおり。

### 決定3: `.card__image` の CSS を新設する（既存の欠落）

Step 6 で `<img className="card__image">` を書いたにもかかわらず、
対応する CSS が存在しなかった。画像は原寸で描画され、カードから溢れていたはず。

**Step 6 の検証では発見できなかった。** ロスター設定のサムネイルは確認したが、
**画像を入れた状態で対局画面を開いていなかった**。E2E も同様で、
`.roster__thumb-image` の表示しか見ていない。

```css
.card__image {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 0.4rem;
  background: rgb(255 255 255 / 0.35);
}
```

名前が画像に埋もれないよう `.card__name` に半透明の下地を敷いた。

---

## R2: グループの記号

### 決定4: `Group.symbol` は**上書き**として持つ

```ts
export interface Group {
  readonly id: GroupId
  readonly name: string
  readonly symbol?: string
  readonly memberIds: readonly MemberId[]
}
```

必須にせず省略可能にしたのは、既存のロスター（同梱・保存済み・書き出し済み）を
そのまま読めるようにするため。未設定なら名前の1文字目を使う。

上書きできるようにした理由は、**1文字目が似ているグループを区別するため**。
同梱ロスターの「ステラ組」「ソレイユ組」は「ス」「ソ」で紛らわしい。

### 決定5: 1文字目の取り出しは配列展開で行う

```ts
return [...group.name.trim()][0] ?? '?'
```

`slice(0, 1)` は**サロゲートペアの片側だけ**を切り出すため、
絵文字をグループ名の先頭に置くと文字化けした記号になる。
チーム名に絵文字を使うことは十分にありうる。

### 決定6: 空文字は保存せず、未設定に戻す

入力欄を空にしたときに `symbol: ''` を保存すると、
**名前を変えても角の表示が空白のまま追随しなくなる**。
リデューサ側でキーごと落とし、導出に任せる。

画面では導出値を `placeholder` に出し、「何も入れなければこうなる」を見せる。

### 決定7: 左上と右下に置き、右下は 180 度回す

トランプの慣習に合わせた。手札を扇状に重ねても
**どちらかの角が必ず見える**ため、重ねたままグループを数えられる。

右下は `aria-hidden` にしている（同じ情報を読み上げさせない）。

### 決定8: 記号の対応表は画面レベルで1つ作る

```ts
export function groupSymbolsByMember(groups: readonly Group[]): ReadonlyMap<MemberId, string>
```

`CardView` はグループを知らない（`Card` が持つのは `memberId` だけ）。
カードごとにグループを検索すると手札8枚 × レンダーのたびに線形探索が走るため、
`TableScreen` で `useMemo` して配る。`imageUrlById` と同じ形にそろえた。

### 決定9: 名前と記号を重ねない

初回の実装では右下の記号がメンバー名に重なった（スクリーンショットで発見）。
カードの下パディングを厚くして、名前が記号の領域に来ないようにした。

```css
.card { padding: 0.4rem 0.35rem 0.95rem; }
```

375px ではカード自体が小さい（高さ 4.4rem）ため、
記号のフォントサイズと位置も併せて詰めている。

---

## ファイル別の変更一覧

| ファイル                            | 区分 | 内容                                       |
| ----------------------------------- | ---- | ------------------------------------------ |
| `src/engine/types.ts`               | 修正 | `Group.symbol` を追加                      |
| `src/ui/imageResize.ts`             | 修正 | `centerSquareCrop` → `fitWithin`、改名     |
| `src/ui/labels.ts`                  | 修正 | `groupSymbolOf` / `groupSymbolsByMember`   |
| `src/ui/rosterEditor.ts`            | 修正 | `SET_GROUP_SYMBOL`（空文字は未設定に戻す） |
| `src/ui/rosterBundle.ts`            | 修正 | `symbol` の読み書き                        |
| `src/ui/components/CardView.tsx`    | 修正 | 角の記号を描画                             |
| `src/ui/components/Hand.tsx`        | 修正 | `groupSymbolById` を渡す                   |
| `src/ui/screens/TableScreen.tsx`    | 修正 | 記号の対応表を作る                         |
| `src/ui/screens/RosterEditor.tsx`   | 修正 | 記号の入力欄                               |
| `src/App.css` / `table.css` / `settings.css` | 修正 | 画像と記号のスタイル             |
| `tests/ui/imageResize.test.ts`      | 修正 | `fitWithin` の検証に差し替え               |
| `tests/ui/labels.test.ts`           | 新規 | 記号の導出                                 |
| `tests/ui/rosterEditor.test.ts`     | 修正 | `SET_GROUP_SYMBOL`                         |
| `tests/ui/rosterBundle.test.ts`     | 修正 | 記号の往復と旧形式互換                     |
| `tests/e2e/roster.spec.ts`          | 修正 | 記号の設定・保存・カードへの表示           |

## リスク

| リスク                                           | 対策                                                  |
| ------------------------------------------------ | ----------------------------------------------------- |
| 保存で切らずに表示で切ってしまう                 | 決定2。両方を `contain` に揃える                      |
| 絵文字のグループ名で記号が文字化けする           | 決定5。配列展開 + 単体テスト                          |
| 記号が名前と重なって読めない                     | 決定9。スクリーンショットで確認                       |
| 既存の書き出しファイルが読めなくなる             | 決定4。`symbol` は省略可能。旧形式の互換をテストで固定 |
| 極端な縦横比の画像で canvas が 0px になる        | 決定1。`Math.max(1, …)`                               |
