# Step 8-2: 残り枚数の確認 — 設計

## 1. エンジン層（`src/engine/unseen.ts` 新規）

### 型

```ts
/** 見えているカードの出どころ。**公開情報だけ**で構成する。 */
export interface VisibleCards {
  readonly hand: readonly Card[]                                   // 自分の手札
  readonly discardsByPlayer: readonly (readonly Card[])[]          // 全員の河
  readonly declaredByPlayer: readonly (readonly YakuCandidate[])[] // 全員の成立済み役
}

export interface ColorCount {
  readonly color: ColorId
  readonly unseen: number
}

export type UnseenCounts = ReadonlyMap<MemberId, readonly ColorCount[]>
```

### 関数

| 関数 | 役割 |
| ---- | ---- |
| `toVisibleCards(state, playerId)` | **状態に触る唯一の場所。** 手札は指定プレイヤーのものだけを取る |
| `countUnseen(visible, memberIds, rules)` | `GameState` を受け取らない。公開情報だけから数える |
| `colorCountsOf(counts, memberId)` | メンバーの全色分を取り出す（ツールチップ用） |
| `unseenOf(counts, memberId, color)` | 1つの (メンバー, 色) を取り出す（待ち一覧用） |

**`countUnseen` に `GameState` を渡さない理由。** 渡す設計だと他家の手札に到達でき、
`ai.ts` の `AiView` で型として塞いだはずのカンニングが、こちら側から復活する。
状態を1関数に閉じ込めておけば、「見えるものだけを見ている」ことが
**関数の引数の型を読むだけで確かめられる**。

**`AiView` に `declaredByPlayer` を足して流用しない。** AI が読まないフィールドを
増やすことになり、7-5 で `payments` を外したときと同じ負債になる。

### 引き当てが失敗したら例外にする（重要な判断）

`colorCountsOf` / `unseenOf` は、そのメンバー（色）が `counts` に無ければ **`RangeError` を投げる**。
0 を返すフォールバックは置かない。

理由は**フォールバックの値が最悪の嘘になる**こと。この画面で「残0」は
「その札はもう場に無いので、その待ちは捨てろ」という意味を持つ。
数え落としを 0 として黙って表示すると、**本機能が解こうとしている誤りを本機能が生む**。

`groupYakuKind` が範囲外のグループ人数で `RangeError` を投げるのと同じ扱いで、
到達したら内部不変条件の違反である（`countUnseen` に渡す `memberIds` は
`state.activeMembers` の全員で、手札も待ちも必ずその部分集合になる）。

### 数え方

```
残枚数(m,c) = rules.copiesPerMemberColor − 見えている枚数(m,c)
見えている枚数 = 自分の手札 + 全員の河 + 全員の成立済みの役
```

- **成立済みの役を数え落とさない**（R4）
- ロンで取られた捨て札は河から取り除かれて `declared` へ移る（`win.ts` の
  `consumeAndRefill`）ため、河と成立済みの役を両方数えても**二重にならない**
- `lastDiscard` は捨てた本人の `discards` にも入っているため、別に数えない
  （`game.ts` の `applyDiscard` は `discards` に積んでから `lastDiscard` に同じ参照を置く）
- キーの作り方は `yaku.ts` の `countBy` と同じ `${memberId}:${color}` の慣習に合わせる

`Math.max(0, ...)` でクランプ**しない**。負になったらそれは数え方の欠陥であり、
隠すと自動対局の突き合わせが通ってしまう。テストで下限を検査する。

### `memberIds` に無いカードが混ざっていたら例外にする

`countUnseen` は集計中に `memberIds` へ含まれないメンバーのカードを見つけたら
`RangeError` を投げる。今の `deck.ts` の構造では起こらない（`buildCardPool` は
`collectMembers` が解決した登場メンバーからしかカードを作らない）が、
黙って捨てると**そのメンバーの分だけ見えている枚数が過小になり、残枚数が過大になる**。
`yaku.ts` の `pickGroupCards` が同じ理由で防御的に書いてあるのに倣う。

## 2. UI 層

### `useGameLoop` が `unseen` を公開する

`GameLoop` インターフェースに `readonly unseen: UnseenCounts` を足し、
末尾の `return { ... }` にも足す（`waits` と同じ扱い）。

```ts
const unseen = useMemo(
  () =>
    countUnseen(
      toVisibleCards(game, humanSeat),
      game.activeMembers.map((member) => member.id),
      rules,
    ),
  [game, rules, humanSeat],
)
```

`memberIds` は `state.activeMembers`。**山札のプールを作ったのがこの集合**
（`deck.ts` の `collectMembers` → `buildCardPool`）なので、`copiesPerMemberColor` が
上限として意味を持つ範囲と完全に一致する。`activeGroups` から導き直すと、
同じ集合を2通りの方法で作ることになる。

### `Hand.tsx` — ホバーの受け口は `<li>` に置く

**`CardView` には付けない。** 捨てられないとき `CardView` は `disabled` の `<button>` になり、
**無効化されたボタンにはマウスイベントが来ない**。カード側に付けると
「自分の捨てる番のときしか調べられない」機能になる（R1 に反する）。

```tsx
<div className="hand-area">
  {hoveredCounts !== null && <CardCounts ... />}
  <ul className="hand" data-testid="hand"> ... </ul>
</div>
```

- ホバー中のメンバーは `Hand` が `useState` で持つ。親に上げると
  `TableScreen` が1手ごとに再描画される経路にホバーが乗る
- `onMouseEnter` / `onMouseLeave` / `onFocus` / `onBlur` の4つを `<li>` に付ける
- **`.hand-area` を基準に絶対配置する。** カード単位に置くと、375px では
  端の札の中央から左へ 1.5rem ほどはみ出す

### `CardCounts.tsx`（新規）

```
ミナ ／ ピンク1 青2 オレンジ3
```

- 色名は `COLOR_LABELS`（`labels.ts`）を使う。短縮名を新しく作らない
- 色は文字だけでなく背景色でも出す（カードの色と対応が取れる）
- `data-testid="card-counts"`、各色は `data-testid="card-count"` +
  `data-color` / `data-unseen`。**数字を属性で出す**ので E2E が文字列の整形に依存しない

### `WaitPanel.tsx`（新規）

```
┌─ 待ち ──────────────────────────┐
│ ミナ（青）  残2  3カード同色 840 │
│ リオ（橙）  残3  4人組       300 │
│ ミナ（桃）  残0  3カード     120 │ ← 淡く落とす
└────────────────────────────────┘
```

- `loop.waits`（既存の `computeWaits`）を使う。**待ちの算出は二重実装しない**
- `waits.length === 0` なら `null` を返す（＝上がれそうなときだけ出る）
- 上位6件 + 「他N件」。理論上の上限は
  `groupsPerGame × maxGroupSize × colors.length` = 60 件で、画面を埋め尽くしうる

**並び順は「残枚数が1枚以上あるものを先に、その中で点数降順」。**
計画書の下書きは点数降順だけだったが、それだと
**高い役の待ちが全部死んでいるとき、生きている待ちが「他N件」の下に隠れる**。
残0 を淡く落とすことが本機能の中心なのに、そもそも表示されないのでは意味がない。
同点は `computeWaits` の順（メンバー順 × 色順）のまま（`sort` は安定なので決定的）。

- `data-testid="wait-panel"` / 行は `wait-row` + `data-unseen` / 打ち切りは `wait-more`
- 残0 の行に `wait__row--dead` を付ける。**淡くするのは CSS、印は属性**。
  色だけで伝えない（`data-unseen="0"` が機械にも読める）

### `TableScreen.tsx`

`WaitPanel` を `.table__mine` の見出し直下（河より上）に置く。
`unseen` を `Hand` へ渡す。

### `src/ui/hints.css`（新規）

`.hand-area` / `.card-counts*` / `.wait*`。`table.css`（267行）をこれ以上太らせない。

## 3. テスト

### `tests/engine/unseen.test.ts`

**自動対局との突き合わせが本命。** 構造だけのテストでは「河を1人分数え落とした」
種類の欠陥を取りこぼす（Step 2 の欠陥3件はいずれも186件のテストを通過していた）。

`autoplay` の `onStep` で毎ステップ、**製品コードが決して見ない情報**から
独立に導いた値と一致することを見る。

**まず用語を閉じた形で定める。「場」という語は使わない**（麻雀の語感では
山札を含むとも含まないとも読めてしまい、含まない読み方で実装すると
右辺が常に `wall(m,c)` の分だけずれる。しかも山札が枯れる終局間際にだけ
一致に近づくため、**落ちたり通ったりするテスト**という最も追いにくい形で出る）。

```
inDeck(m,c)    := wall(m,c)
                + Σ_{全員} hand(m,c)
                + Σ_{全員} discards(m,c)
                + Σ_{全員} declared(m,c)      ← 山札に実際に入った枚数
notInDeck(m,c) := copiesPerMemberColor − inDeck(m,c)   ← そもそも入らなかった枚数
```

検査する等式:

```
unseen(m,c) === wall(m,c) + Σ_{他家} hand(m,c) + notInDeck(m,c)
```

右辺は「山にある」「他家が持っている」「そもそも山札に入らなかった」の3つの内訳で、
左辺の「見えていない」を**引き算ではなく足し算で**組み直したもの。
`countUnseen` が同じ引き算をもう一度やる形になっていないので、
数え落としがあれば必ず食い違う。

**`inDeck(m,c)` は対局を通じて変わらない**（カード保存則をメンバー×色ごとに述べたもの）。
テストは**最初のステップで測って固定し、以降そのまま使い回したうえで、
毎ステップ変わっていないことも検査する**。こうすると

- 「そもそも入らなかった枚数」が対局中の状態から毎回導き直される形にならない
- 既存の uid 総数の検査より細かい粒度でカード保存則を見ることになる

の2つが同時に得られる。

**試行数と視点を決め打ちにする。**

- シードは既存の不変条件テストと同じ **100局**（`tests/engine/autoplay.test.ts` の `SEEDS`）
- `onStep` の中で**全プレイヤー分ループする**。`toVisibleCards` は `playerId` で
  隠す手札が変わるため、1人だけで見ると添字の取り違えが player 0 でだけ
  たまたま表に出ない形で通り抜ける

そのほか:

- 手札・河・成立済みの役をそれぞれ数え、3つが重ならないこと
- 残枚数が `0 〜 copiesPerMemberColor` に必ず収まること（全ステップ・全員分）
- `colorCountsOf` / `unseenOf` が未知のメンバー・色で `RangeError` を投げること
- `countUnseen` が `memberIds` に無いメンバーのカードで `RangeError` を投げること

### `tests/ui/waitPanel.test.tsx`

待ちが無ければ描画しない / 残0 の行に印が付く / 上限を超えたら「他N件」/
**生きている待ちが死んだ待ちより先に出る**。

### `tests/ui/cardCounts.test.tsx`

色ごとの数が属性に出る / 名前が出る。

### `tests/e2e/counts.spec.ts`

- 固定シードで手札にホバーすると数字が出る
- **捨てられない状態（自分の手番でないとき）でも出る**
- テンパイしたら待ち一覧が出る（出るまで進める）

**「ある条件まで進める」手順は `tests/e2e/helpers/table.ts` に足す。**
既存の `playToEnd` は終局まで進める一方通行で、途中で止められない。
`counts.spec.ts` の中に進行ループをその場で書くと、7-4 で
「`playToEnd` が2ファイルに写しになっていて同じ修正を2回書いた」のと
同じことが始まる。進行の手順は**この1本だけ**に置く。

**`Hand` のホバーは単体テストで踏めない。** テスト環境は `node` で、
DOM は `renderToStaticMarkup` の文字列しか無く、`useState` も `useEffect` も動かない。
ホバーの受け口が `<li>` にあることを確かめられるのは E2E だけ。

### わざと壊して落ちることを確かめる対象

| 壊し方 | 落ちるべきテスト |
| ---- | ---- |
| 河を数えない（`discardsByPlayer` を空にする） | `unseen` の自動対局突き合わせ |
| 成立済みの役を数えない | 同上 |
| **ホバーの受け口を `<li>` から `CardView` へ移す** | E2E「手番でなくても出る」 |
| `waits.length > 0` のガードを外す | `waitPanel` 単体 |
| 残0 の印（`data-unseen` / dead クラス）を外す | `waitPanel` 単体 |
| 並び替えを「点数降順だけ」に戻す | `waitPanel` 単体（生きている待ちが先） |

`unseenOf` の例外は**壊し方が「0 を返す」**になるため、
突き合わせテストではなく専用の単体テストで見る。

## 4. ファイルサイズの見込み

| ファイル | 現在 | 見込み |
| ---- | ---- | ---- |
| `src/engine/unseen.ts` | — | 約120 |
| `src/ui/components/CardCounts.tsx` | — | 約60 |
| `src/ui/components/WaitPanel.tsx` | — | 約120 |
| `src/ui/hints.css` | — | 約120 |
| `src/ui/components/Hand.tsx` | 67 | 約115 |
| `src/ui/hooks/useGameLoop.ts` | 308 | 約325 |
| `src/ui/screens/TableScreen.tsx` | 276 | 約295 |

`board.css` 406 / `yaku.ts` 410 / `deck.ts` 406 は 7-5 以前からの積み残しで今回の範囲外
（触らないファイルを基準のためだけに動かさない）。

## 5. 触らないもの

- `src/engine/ai.ts` と `AiView`（CPU に残枚数を渡さない）
- `src/engine/game.ts` の状態遷移（`unseen` は読み取り専用の導出）
- 和了演出一式（8-1 の成果物）
- `src/App.tsx` / `src/appOptions.ts`
- **終局後の `Hand` / `WaitPanel`。** `gameOver` でも DOM には残るが、
  `ResultOverlay` が全画面を覆うため見えない。ここに「終局なら消す」条件を足すと、
  8-1 で数を絞ったばかりの**停止フラグを持つ場所**がまた1つ増える。
  残枚数は読み取り専用の導出なので、裏で残っていても進行に影響しない
