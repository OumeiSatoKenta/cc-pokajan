# ポカジャン Step 8: 演出の作り込みと残り枚数の確認 — 計画書

## Context

Step 7（7-1〜7-5）が完了し、盤面は麻雀の卓になった。和了は確認ボタンで止まり、
カットイン・得点の増減・順位の移動まで出る。

そのうえでプレイテストから2つの要望が出た。**4b / 6b と同じ形**、つまり
自動テストが全部通っている状態でしか見つからない種類の指摘である。

| # | 課題 | 現状 |
| --- | ---- | ---- |
| 1 | 和了演出が一度に全部出る | 誰が和了したか・何点動いたか・順位がどうなったかが同時に出て、視線が定まらない |
| 2 | 確認ボタンを毎回押す | 連続宣言は最大8回（`maxChainDeclare`）。最悪8回押すことになる |
| 3 | 大物手が普通の和了と同じ見え方 | 同色役（540〜1800点）も3カード（120点）も演出が同じ |
| 4 | 残り枚数が読めない | 同じ絵札が何枚生きているかを手札と河から目で数えるしかない |

3 は「和了が見える」ようになったからこそ出てきた不満で、
4 は**待ちが「あと1枚」でもその1枚が既に全部見えていれば無駄**という、
ポカジャンでは山札がプールの一部でしかない仕様に直結する判断材料である。

### 確認済みの決定

| 項目 | 決定 |
| ---- | ---- |
| 高得点の基準 | **`candidate.sameColor`**（同色役かどうか）。恣意的な点数の閾値を持たない |
| 演出の長さ | カットイン **1.2秒** → 点数獲得結果 **2.5秒** → 自動で閉じる（計3.7秒） |
| 途中の飛ばし方 | **クリックで1段進む**（カットイン→結果→閉じる）。Escape で即閉じ |
| 残り枚数の出し方 | **手札ホバーのツールチップ** + **待ち一覧パネル**（テンパイ時のみ） |

> **高得点の基準に点数の閾値を使わない理由**: 閾値を置くと「480点は大物手か」を
> ルール値が変わるたびに決め直すことになる。同色役はルールの構造そのものなので、
> `scores` の数値を変えても意味が変わらない。
> 帰結として **5人組（480点）は通常演出**、**3カード同色（840点）は大物手**になる。

---

## 設計

### 1. 和了演出を2段にする（Step 8-1）

```
[0.0s] カットイン      アバターがフェードイン + 席名
                       同色役なら大物手バージョン（金の縁・拡大・役名を大きく）
[1.2s] 点数獲得結果    役の絵札・役名・ボーナス数・獲得点・順位の移動
[3.7s] 自動で閉じる    対局再開
```

**段は必ず時間で進む。** `useReducedMotion` はアニメーションを消すが、
**時間は消さない**。「動きを減らす」設定であって「読む時間を減らす」設定ではないため。
順位表の中身は `WinRanking` が既に減らす設定を吸収している（7-5）。

**クリックは1段だけ進める。** 1回で全部消す実装にしない。他家の和了は
こちらが打とうとした瞬間に割り込むので、**押しかけていたクリックで演出が丸ごと消える**。

**焦点は奪わない。** `role="status"` / `aria-live="polite"` にする。
自動で閉じるものを `aria-modal` のダイアログにすると、読み上げが終わる前に消える。
Escape はいつでも閉じられるようにして、キーボードからの脱出路を残す。

#### 段の状態機械を置く場所

`WinOverlay` に置く。**`useGameLoop` には置かない。**

7-4 で「停止フラグを持つ効果が3つある」構造を作っており、ここに4つ目を足すと
止め忘れの面が1つ増える。段の進行は演出の内部事情であり、対局ループは
「`pendingWins` が空でない間は止まる」ことだけを知っていればよい。

#### `WinOverlay` の `key`

**その和了を一意に決める値**（`playerId` + 構成カードの uid）を渡す。
連続和了で2件目が来たとき、鍵が同じだと**段が進んだ状態のまま2件目が表示される**
（カットインを飛ばして結果だけが一瞬出る）。構成カードは一度消費されたら
二度と場に戻らないので、uid 列は和了の識別子として使える。

#### 役の絵札

`win.candidate.cards` をそのまま `CardView size="small"` で並べる。

**`MemberTile` ではなく `CardView` を使う。** 色が見えることに意味があるため
（同色役かどうかが絵で分かる）。`.card--small` は BONUS の帯を隠す
（`src/App.css`）ので、ボーナス枚数は `candidate.bonusCount` から
役名の隣にテキストで出す。

5枚 × `.card--small`（2.4rem）＋ 隙間で約 13.6rem。`.overlay__panel` は
`min(24rem, 100%)` なので 375px でも収まる。

#### 名前を実態に合わせる

`CONFIRM_WIN` → **`DISMISS_WIN`**、`confirmWin` → `dismissWin` に改名する。
確認していないものを confirm と呼び続けると、次に読む人が
「何を確認しているのか」を探すことになる。判別共用体なので `tsc` が全呼び出しを指す。

### 2. 残り枚数の確認（Step 8-2）

#### 何を数えるのか

見えている枚数 = **自分の手札 + 全員の河 + 全員の成立済みの役（`declared`）**。

- **成立済みの役を数え落とさない。** 消費されたカードが「まだ引ける」ことになる
- ロンで取られた捨て札は河から取り除かれて `declared` へ移る（`win.ts` の
  `consumeAndRefill`）ので、河と成立済みの役を両方数えても二重にならない
- `lastDiscard` は捨てた本人の `discards` にも入っているため、別に数えない

残枚数 = `rules.copiesPerMemberColor` − 見えている枚数。

**これは上限であって確定値ではない。** `buildDeck` はプール（117〜144枚）から
`deckSize`（100枚）しか抜かないため、残枚数の中には
**そもそも山札に入らなかったカード**が混ざる。内訳は次のとおり。

```
残枚数 = 山札に残っている枚数 + 他家の手札にある枚数 + 山札に入らなかった枚数
```

画面のラベルもそのように書く（「残り」とだけ書いて確定値に見せない）。

#### エンジン側（`src/engine/unseen.ts` 新規）

```ts
/** 見えているカードの出どころ。公開情報だけで構成する。 */
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

export function toVisibleCards(state: GameState, playerId: PlayerId): VisibleCards
export function countUnseen(
  visible: VisibleCards,
  memberIds: readonly MemberId[],
  rules: RulesConfig,
): UnseenCounts
export function unseenOf(counts: UnseenCounts, memberId: MemberId, color: ColorId): number
```

- **`countUnseen` は `GameState` を受け取らない。** `ai.ts` の `AiView` と同じ形にする。
  `GameState` を渡す設計だと他家の手札に到達でき、**カンニングが型で防げなくなる**。
  状態に触るのは `toVisibleCards` の1箇所だけ
- **`AiView` に `declaredByPlayer` を足して流用しない。** AI が読まないフィールドを
  増やすことになり、7-5 で `payments` を外したときと同じ負債になる
- キーの作り方は `yaku.ts` の `countBy` と同じ `${memberId}:${color}` の慣習に合わせる

#### UI 側

**手札ホバーのツールチップ**（`CardCounts.tsx`）

```
        ミナ ／ 桃1 青2 橙3
   ┌────┬────┬────┬────┬────┐
   │    │ ミナ│    │    │    │  ← ホバー
   └────┴────┴────┴────┴────┘
```

- **`.hand` を基準に絶対配置する。** カード単位に置くと、端の札で画面外へ出る
  （375px では左端の札の中央から左へ 1.5rem ほどはみ出す）
- **ホバーの受け口は `<li>` に置く。** `CardView` は捨てられないとき `disabled` の
  `<button>` になり、**無効化されたボタンにはマウスイベントが来ない**。
  カードに付けると「自分の捨てる番のときしか調べられない」ことになる
- 焦点でも出す（`onFocus` / `onBlur`）。ただし `disabled` のボタンは焦点も取れないため、
  キーボードから調べられるのは自分の手番のときだけ。触れる端末でも同様に出ない。
  **この2つの経路は待ち一覧が受け持つ**

**待ち一覧パネル**（`WaitPanel.tsx`）

```
┌─ 待ち ────────────────────────┐
│ ミナ（青）  残2  3カード同色 840 │
│ ミナ（桃）  残0  3カード      120 │ ← 淡く落とす
│ リオ（橙）  残3  4人組       300 │
└──────────────────────────────┘
```

- `loop.waits`（`computeWaits`）が既にあるので、**待ちの算出は二重実装しない**
- `waits.length > 0` のときだけ描画する（＝上がれそうなときだけ出る）
- 点数降順で上位6件 + 「他N件」。理論上の上限は
  `groupsPerGame × maxGroupSize × colors.length` = 60 件で、画面を埋め尽くしうる
- **残0 の行を淡く落とすのが本機能の中心的な価値。** 役はできるが、その札はもう場に無い

---

## 段階分割

**2ステップに分割する。** 依存は 8-1 → 8-2 の一方向。

| Step | 内容 | 完了時に何が変わるか |
| ---- | ---- | -------------------- |
| 8-1 | **和了演出の作り込み** — 2段構成・大物手バージョン・役の絵札・自動クローズ | 和了が読めるようになり、確認ボタンが要らなくなる |
| 8-2 | **残り枚数の確認** — `unseen.ts` + 手札ホバー + 待ち一覧 | 待ちが生きているかが分かる |

**8-1 を先に置く理由は CSS の分割。** `table.css` は現在 381 行で、
8-1 が `.win*` を `win.css` へ出して約270行に戻る。順序を逆にすると
8-2 で待ち一覧を足した時点で 400 行を超え、8-1 で二度目の分割をすることになる。

コマンド文字列は
[pokajan-presentation-and-counts-add-feature-commands.md](pokajan-presentation-and-counts-add-feature-commands.md)
にある。

作業記録は各ステップごとに `.steering/[日付]-pokajan-08N-[名前]/` を作って進める
（他ステップと同じ形式）。

---

## Critical Files

### Step 8-1

**新規**

| ファイル | 役割 |
| ---- | ---- |
| `src/ui/components/WinCutIn.tsx` | アバターのフェードカットイン。`variant: 'normal' \| 'big'` |
| `src/ui/components/WinResult.tsx` | 役の絵札・獲得点・`WinRanking`・閉じるボタン |
| `src/ui/win.css` | `.win__*` / `.win-rank__*` を `table.css` から移し、段の演出を足す |
| `src/config/presentation.ts` | `WIN_PRESENTATION`（1200 / 2500）と `FAST_WIN_PRESENTATION`（0 / 0） |

**修正**

- `src/ui/components/WinOverlay.tsx` — 段の状態機械・タイマー・クリック・Escape に絞る
- `src/ui/hooks/loopReducer.ts` — `CONFIRM_WIN` → `DISMISS_WIN`
- `src/ui/hooks/useGameLoop.ts` — `confirmWin` → `dismissWin`
- `src/ui/screens/TableScreen.tsx` — `memberNameById` / `imageUrlById` / `groupSymbolById` /
  `bonusMemberIds` / `timing` / `key` を `WinOverlay` へ渡す
- `src/ui/table.css` — `.win*` を `win.css` へ移す
- `src/App.tsx` / `src/appOptions.ts` — `fast` から演出の長さを選ぶ

### Step 8-2

**新規**

| ファイル | 役割 |
| ---- | ---- |
| `src/engine/unseen.ts` | `VisibleCards` / `countUnseen` / `unseenOf` / `toVisibleCards` |
| `src/ui/components/CardCounts.tsx` | 手札ホバーのツールチップ（`.hand` 基準の絶対配置） |
| `src/ui/components/WaitPanel.tsx` | 待ち一覧。テンパイ時のみ描画 |
| `src/ui/hints.css` | 待ち一覧とツールチップ |

**修正**

- `src/engine/game.ts` — 再エクスポートに追加
- `src/ui/hooks/useGameLoop.ts` — `unseen` を公開（`waits` と同じ形の `useMemo`）
- `src/ui/components/Hand.tsx` — `<li>` にホバー・焦点の受け口
- `src/ui/screens/TableScreen.tsx` — `WaitPanel` を `.table__mine` の見出し直下に置く

---

## 既存への影響（見落としやすい点）

| 影響 | 対応 |
| ---- | ---- |
| **`tests/ui/winOverlay.test.tsx` の大半が落ちる** | `renderToStaticMarkup` は `useEffect` を実行しないため、`WinOverlay` からは**カットイン段しか見えない**。役名・獲得点・順位表の検査は `WinResult` を直接描画する形へ移す |
| **`tests/e2e/winGate.spec.ts` の「5秒待って overlay が見えたまま」** | 3.7秒で自動的に閉じるため必ず落ちる。**オーバーレイが見えている間だけ**山札の残りを繰り返し観測する形に書き換える |
| `tests/e2e/helpers/table.ts` の `confirmWinIfAny` | `dismissWinIfAny` へ。ボタンの無い段でも閉じられるよう Escape を送る。**進行ヘルパは1本しかない**ので直す場所も1つ（7-4 の教訓） |
| `tests/ui/winGate.test.ts` の `CONFIRM_WIN` | 改名に追随 |
| `.overlay*` は `ResultOverlay` と `ErrorBoundary` も使う | `.win*` だけを `win.css` へ移し、`.overlay*` は `table.css` に残す |
| ホバーの受け口を `CardView` に付けると自分の手番でしか効かない | `<li>` に付ける（`disabled` の `<button>` にはマウスイベントが来ない） |

---

## ファイルサイズ（400行の基準）

フェーズの区切りごとに `wc -l` で測る。**基準は文書に書くだけでは機能しない**（Step 3 の教訓）。

| ファイル | 現在 | 見込み |
| ---- | ---- | ---- |
| `src/ui/table.css` | 381 | 約270（`.win*` を `win.css` へ） |
| `src/ui/win.css` | — | 約210 |
| `src/ui/hints.css` | — | 約90 |
| `src/ui/components/WinOverlay.tsx` | 105 | 約110（段の機械だけに絞る） |
| `src/ui/hooks/useGameLoop.ts` | 303 | 約320 |
| `tests/ui/winOverlay.test.tsx` | 194 | 分割して各150前後 |

`board.css` 406 / `yaku.ts` 410 / `deck.ts` 406 は 7-5 以前からの積み残しで、
今回の範囲外（触らないファイルを基準のためだけに動かさない）。

---

## 検証

### 自動

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

**Step 8-1 の新規テスト**

- `WinCutIn`: 同色役で `data-variant="big"`、そうでなければ `"normal"`。
  アバター未設定でも席名の頭文字で成立する（7-3 から通している要件）
- `WinResult`: 役の絵札が `candidate.cards` と同じ枚数・同じ uid で出る。
  ボーナス枚数が出る。獲得点は前後の差分（既存の検査を移設）
- `WinOverlay`: 初期描画はカットイン段（`data-stage="cutin"`）
- E2E: **確認を押さずに自動で閉じる**こと、閉じるまで山札が動かないこと、
  クリック1回では閉じずに結果段へ進むこと

**Step 8-2 の新規テスト**

- `tests/engine/unseen.test.ts`
  - 手札・河・成立済みの役をそれぞれ数え、3つが重ならないこと
  - **自動対局との突き合わせ**（本機能でいちばん重要な検査）。
    `autoplay` の `onStep` で毎ステップ、**製品コードが決して見ない情報**から
    独立に導いた値と一致することを見る:

    ```
    unseen(m,c) === wall(m,c)
                  + Σ_{他家} hand(m,c)
                  + (copiesPerMemberColor − 場の全カード(m,c))
    ```

    構造だけのテストでは「河を1人分数え落とした」種類の欠陥を取りこぼす
    （Step 2 の欠陥3件はいずれも186件のテストを通過していた）
  - 残枚数が `0 〜 copiesPerMemberColor` に必ず収まること
- `tests/ui/waitPanel.test.tsx` — 待ちが無ければ描画しない / 残0 の行に印が付く /
  上限を超えたら「他N件」が出る
- `tests/e2e/counts.spec.ts` — 固定シードで手札にホバーして数字が出ること。
  **捨てられない状態（自分の手番でないとき）でも出ること**

**新しく書いた回帰テストは、わざと実装を壊して「落ちること」を確かめる。**
7-5 ではこの手順が偽陽性を1件捕まえている。特に「自動で閉じる」の検査は、
閉じない実装でも `toBeHidden` の待ちがタイムアウトするだけで通る書き方があるため注意する。

### 目視

1. 通常役 / 同色役の演出の違い
2. アバター未設定でも演出が成立すること
3. 375px で演出と待ち一覧が画面からはみ出さないこと
4. 視覚効果を減らす設定で動きが消え、**時間は消えない**こと
5. 連続和了（2件以上）でカットインが2回とも頭から出ること
6. 手札ホバーで残枚数が出ること、自分の手番でなくても出ること
7. 画像付きロスターで待ち一覧とツールチップが崩れないこと

---

## 関連ドキュメント

- [pokajan-presentation-and-counts-add-feature-commands.md](pokajan-presentation-and-counts-add-feature-commands.md) — 本計画の実行コマンド
- [pokajan-plan.md](pokajan-plan.md) — 全体の実装計画（Step 1〜6）
- [pokajan-mahjong-board-plan.md](pokajan-mahjong-board-plan.md) — Step 7 の計画書
- [pokajan-mahjong-board-add-feature-commands.md](pokajan-mahjong-board-add-feature-commands.md) — Step 7 の実行コマンド
- `.steering/20260809-pokajan-074-win-gate/` — 和了で進行を止める仕組み（3つの効果）
- `.steering/20260809-pokajan-075-win-presentation/` — 演出の中身と `computeRanking` の共有
