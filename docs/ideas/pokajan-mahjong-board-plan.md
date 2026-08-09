# ポカジャン Step 7: 盤面を麻雀ゲームに近づける — 計画書

## Context

全6ステップ（+ 4b / 6b）が完了し、BET → 対局 → 精算のループとロスター編集が動いている。
一方で**盤面は情報の一覧に近く、卓を囲んでいる感じがない**。

プレイテストで挙がった課題は次の4点。

| # | 課題 | 現状 |
| --- | ---- | ---- |
| 1 | 他家の手札が見えない | 上部に横並びのテキストカード。手札は「7枚」という数字だけ |
| 2 | 河が絵になっていない | 自分の河だけ、しかも小さなチップ表示 |
| 3 | ボーナスが目立たない | 名前のテキストのみ |
| 4 | 和了の実感がない | 画面上部に小さなトーストが出るだけ。点数が動いた感じがない |

本ステップで**麻雀ゲームの卓に寄せる**。

### 確認済みの決定

| 項目 | 決定 |
| ---- | ---- |
| レイアウト | **4方向の卓レイアウト**（上家=左 / 対面=上 / 下家=右 / 自分=下）。375px では縦積み |
| アバター | **プレイヤー画像を新設**（ロスターとは別に4人分をアップロード） |
| 確認ボタン | **すべての和了で止める**（CPU 同士の和了でも確認を押すまで進まない） |

> **確認済みの帰結**: 連続宣言は最大8回（`maxChainDeclare`）まで起こりうるため、
> 最悪ケースでは確認を8回押すことになる。これを承知のうえでの選択。

### ビジュアルデザインの扱い

本ステップは**構造**（配置・情報・動き）までを対象とし、
配色やカードの質感といった見た目の作り込みは対象外とする。

レイアウトが変わる前にデザインを起こしても当てる先が動くため、
**フェーズ1〜2 を終えて実物のスクリーンショットが撮れる状態にしてから**、
見た目を詰めるか外部に出すかを判断する。

外部に出す場合、完成イメージの絵ではなく**デザイントークン**
（配色・余白と角丸のスケール・影の定義・文字サイズの段階・カード面の仕様）を
受け取る形にする。絵だけでは実装に落ちず、目分量の近似になって外注の価値が出ない。

---

## 設計

### 1. 4方向の卓レイアウト

`TableScreen` を 3×3 の CSS Grid に組み替える。

```
        ┌───────────────┐
        │  対面   1,200 │
        │ ▧▧▧▧▧▧▧      │ ← 伏せ手札
        │ 河 ▢▢▢▢▢     │
┌───────┼───────────────┼───────┐
│ 上家  │               │ 下家  │
│  980  │   山札 71     │ 1,050 │
│ ▧▧▧  │  ボーナス ▢   │ ▧▧▧  │
│ 河▢▢ │               │ 河▢▢ │
└───────┼───────────────┼───────┘
        │ 河 ▢▢▢▢▢     │
        │ あなた  1,000 │
        │ ▢▢▢▢▢▢▢ ▢   │
        └───────────────┘
```

- 幅 30rem 以下では 1 列の縦積みに切り替える（`grid-template-areas` の差し替え）
- `PlayerSeat` は席の向き（`top` / `left` / `right`）を受け取り、伏せ手札と河の並べ方を変える
- **`.table__opponents` の 3 列グリッドは廃止**

`TableScreen` は 177 行あり、このままだと 400 行を超える。
中央の盤面（山札・ボーナス・グループ）を `BoardCenter.tsx` へ切り出す。
`table.css`（573 行）も `table.css` / `board.css` に分割する。

### 2. カードの絵（伏せ札・河・ボーナス）

- **伏せ手札**: `player.hand.length` 枚の裏面を並べる。
  **`.card--back` の CSS は Step 4 で書いたまま未使用**（`src/ui/table.css:315`）なので、
  これをそのまま使う。左右の席は 90 度回転させて縦に積む
- **河**: `DiscardPile` をチップから `CardView` に置き換え、4人分すべてを描画する。
  `.card--small` 修飾子を追加する（河のカードは手札より小さく）。
  河は最大 100 枚（`deckSize`）まで増えるため、画像付きカードの描画コストを実機で確認する
- **ボーナス**: 中央に「ドラ表示牌」のようにカード型で出す。
  `Card` 型は色を持つが**ボーナスはメンバー単位**なので、合成 `Card` は作らず
  `MemberTile.tsx` を新設して `.card` のスタイルを再利用する

### 3. プレイヤーアバター（新機能）

**保存先は既存の IndexedDB をそのまま使う**（`src/storage/assets.ts` の
`putImage` / `getImage` / `pruneImages`）。新しいストアは要らない。
座席 → `imageId` の対応だけを `prefs` に足す。

```ts
// src/storage/prefs.ts
readonly avatars: Record<string, string> | null // playerId -> imageId
```

- **絶対座席（`PlayerId`）でキーを持つ。** 席名（あなた/下家/…）は `humanSeat` からの
  相対表示なので、そちらで持つとアバターが対局ごとに移動する
- 画像変換は `fileToStoredImage`（`src/ui/imageResize.ts`）をそのまま再利用
- 新画面 `src/ui/screens/PlayerSettings.tsx`。タイトルから開く
  （`appReducer` の `Screen` に `'players'` を追加し、`GO_SETTINGS` の分岐を拡張）
- 行の UI は `MemberRow.tsx` と同じ形にそろえる
- `useAssetUrls` と同じ形の `useAvatarUrls(avatars)` を追加
- **書き出し形式**: `rosterBundle` に省略可能な `avatars` を足す。
  省略可能にすることで**既存の書き出しファイルはそのまま読める**
  （`BUNDLE_VERSION` は 1 のまま）

### 4. 和了演出と確認ゲート

**本ステップで最も影響範囲が広い。** 対局の自動進行を止める必要がある。

```ts
// src/ui/hooks/loopReducer.ts
export interface WinPresentation {
  readonly playerId: PlayerId
  readonly candidate: YakuCandidate
  readonly winKind: WinKind
  readonly payments: readonly Payment[]
  readonly scoresBefore: readonly number[]
  readonly scoresAfter: readonly number[]
}

readonly pendingWin: WinPresentation | null
```

- `applyEngine` で**適用前の点数を控えてから** `reduce` を呼び、
  `Declared` と `Paid` イベントを組にして `pendingWin` に積む
- 新アクション `CONFIRM_WIN` で解除する
- **`useGameLoop` の3つの効果すべてを止める**（依存配列に停止フラグを足す）
  1. 自動進行（`[autoKey]` → `[autoKey, isPaused]`）
  2. **持ち時間の時間切れ**（止め忘れると、演出を読んでいる間にツモ切りされる）
  3. イベントの排出

演出（`WinOverlay.tsx`）の内容:

- 勝者のアバターのカットイン（framer-motion）
- 役名・同色・ツモ/ロン・獲得点
- **得点の移動**: 支払い側に `−N`、勝者に `+N` を出す（`payments` から作る）
- **順位の移動**: 4人の順位表を `layout` アニメーションで並べ替える
- 確認ボタン

**順位の算出**: Step 5 で「順位はエンジンが確定させた値だけを使う」と決めているが、
**対局中の順位にはエンジン側の対応物がない**。二重実装を避けるため、
`finishGame`（`src/engine/turnFlow.ts:13`）内のソートを
`computeRanking(players)` として切り出し、**終局時と演出の両方が同じ関数を使う**ようにする。
振る舞いは変えない純粋な抽出。

---

## 既存への影響（見落としやすい点）

| 影響 | 対応 |
| ---- | ---- |
| **E2E の `playToEnd` が確認ボタンで止まって全滅する** | `table.spec.ts` / `casino.spec.ts` / `rules.spec.ts` の進行ヘルパに確認ボタンのクリックを足す。**これを忘れると対局を進める既存テストが軒並みタイムアウトする** |
| `YakuToast` が演出と役割重複 | トーストを廃止し `WinOverlay` に一本化。「トーストが一定時間で消える」E2E は演出の確認テストに置き換える（元のバグは仕組みごと無くなる） |
| `rules.spec.ts` の `getByText('あなた（3,000点）')` | レイアウト変更で文言が変わるなら追随する |
| `seat-score` の testid | 3件のまま維持する（既存アサーションを壊さない） |
| 河が4人分 × 最大100枚 | 画像付きカードの描画コストを実機で確認する |

---

## Critical Files

**新規**

| ファイル | 役割 |
| -------- | ---- |
| `src/ui/components/WinOverlay.tsx` | 和了演出と確認ボタン |
| `src/ui/components/MemberTile.tsx` | ボーナス表示（カード型・色なし） |
| `src/ui/components/BoardCenter.tsx` | 山札・ボーナス・グループ（`TableScreen` から分離） |
| `src/ui/screens/PlayerSettings.tsx` | アバターの設定 |
| `src/ui/hooks/useAvatarUrls.ts` | アバターの objectURL 管理 |
| `src/ui/board.css` | 卓レイアウトのスタイル |

**修正（主なもの）**

| ファイル | 内容 |
| -------- | ---- |
| `src/engine/turnFlow.ts` | `computeRanking` を切り出す（振る舞いは不変） |
| `src/ui/hooks/loopReducer.ts` | `pendingWin` / `CONFIRM_WIN` |
| `src/ui/hooks/useGameLoop.ts` | 3つの効果に停止フラグ |
| `src/ui/screens/TableScreen.tsx` | 4方向グリッド |
| `src/ui/components/PlayerSeat.tsx` | 向き・伏せ手札・河 |
| `src/ui/components/DiscardPile.tsx` | チップ → `CardView` |
| `src/ui/components/CardView.tsx` | `.card--small` / 裏面 |
| `src/storage/prefs.ts` / `src/ui/rosterBundle.ts` | アバターの保存と書き出し |
| `src/ui/appReducer.ts` / `src/App.tsx` | `players` 画面への遷移 |
| `src/ui/table.css` / `src/App.css` | 分割とカードのスタイル |

---

## 段階分割

各フェーズ終了時に全ゲートを通す。

**5ステップに分割する。** 各ステップは単独でレビュー可能で、依存は前→後の一方向。
コマンド文字列は [pokajan-mahjong-board-add-feature-commands.md](pokajan-mahjong-board-add-feature-commands.md) にある。

| Step | 内容 | 完了時に何が変わるか |
| ---- | ---- | -------------------- |
| 7-1 | **カードの表現** — `.card--small` / 裏面 / `MemberTile` / `DiscardPile` のカード化 | 河と伏せ札が絵になる |
| 7-2 | **4方向レイアウト** — `TableScreen` の再構成、`BoardCenter` 分離、CSS 分割 | 卓を囲む配置になる |
| 7-3 | **プレイヤーアバター** — `prefs` 拡張 → `PlayerSettings` → 書き出し形式 | 4人に顔がつく |
| 7-4 | **和了の確認ゲート** — `pendingWin` + `CONFIRM_WIN` + 3効果の停止 | 和了で止まり確認を押して進む |
| 7-5 | **演出の中身** — カットイン・得点移動・順位移動 | 和了が「見える」ようになる |

**アバター（7-3）を演出（7-4・7-5）より先に置く。** 逆順だと、カットインを
席名だけで一度作ってからアバターに差し替えることになり、同じ場所を二度書く。

> Step 7-1〜7-2 だけでも「卓を囲んでいる盤面」として単独で成立する。
> ここで一度スクリーンショットを出し、**見た目の作り込みをどうするか判断する**
> （そのまま 7-3 以降へ進む / 先に配色とカードの質感を詰める / 外部に出す）。

作業記録は各ステップごとに `.steering/[日付]-pokajan-07N-[名前]/` を作って進める
（他ステップと同じ形式）。

---

## 検証

**自動**

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

- 純粋関数の新規テスト: `pendingWin` の生成・`CONFIRM_WIN` での解除・
  停止中は自動進行の決定が発火しないこと・`computeRanking` が終局時の順位と一致すること
- `prefs` / `rosterBundle` にアバターを足した分の往復と後方互換
- **E2E: 確認ボタンを挟んでも1局が最後まで進むこと**（既存の進行ヘルパの回帰）

**目視（Playwright のスクリーンショット）**

1. 900px と 375px の両方で卓レイアウトが破綻しないこと
2. 他家の伏せ手札の枚数が `hand.length` と一致すること
3. 4人分の河にカードの絵が並ぶこと
4. 画像付きロスターで河が重くならないこと
5. 和了時にカットイン・得点移動・順位移動が出て、確認を押すまで進まないこと
6. アバターを設定すると演出とプレイヤー席に反映され、リロード後も残ること

---

## 関連ドキュメント

- [pokajan-plan.md](pokajan-plan.md) — 全体の実装計画（Step 1〜6）
- [pokajan-add-feature-commands.md](pokajan-add-feature-commands.md) — 各ステップの `/add-feature` コマンド
- `.steering/20260808-pokajan-04b-playtest/` — 前回のプレイテスト反映
- `.steering/20260809-pokajan-06b-card-visual/` — カードの見た目（画像・グループ記号）
