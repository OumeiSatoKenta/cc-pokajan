# ポカジャン 絵札選択（役の組み替え）— 段階計画

## Context

ポカジャンの対局に、**「役に使う絵札をプレイヤーがタップで選ぶ」**機能を追加する。

現状は宣言時にエンジンが**使うカードを自動選択**する。プレイヤーは役の種類ボタン
（`3カード 120点` / `3カード（同色）480点` など、混色/同色は別ボタンで既出）を押すだけで、
**どの色の絵札を何枚使うか＝何を手札に残すか**を選べない。色の取り方で役種・点数・その後の待ちが
変わる戦術が成立しないのが不満点。

**追加する機能**:

1. **カードタップによる役の構成** — 手札の絵札をタップして役を組み、色の取り方で役種・点数が
   リアルタイムに変わる。**どの絵札を消費し、どれを手札に残すか**を自分で決められる。
2. **ライブプレビューと確定** — 選択が作る役（役名＋同色＋点数）を即時表示し、有効な役のときだけ
   ツモ/ロンで確定できる。既存の候補ボタンは**「おまかせプレフィル」**として残す。

**ユーザーの要件確認結果**:

- **操作モデル**: カードをタップして役を構成（色の取り方で役・点数がライブに変わる）
- **候補ボタン**: 残す（押すと構成カードを選択欄にプレフィル、手動で上書き可）
- **範囲**: ツモ（`selfDeclare`）＋ロン（`claimWindow`）の両方を MVP に含める
- **段階分割**: 3 ステップ（レイヤ別）

**段階分割**: 3 ステアリングステップに分けて段階リリース。エンジン層（神聖・100 局不変条件が守る）を
UI より先に単独で固め、レビュー負荷と切り戻し範囲を最小化する。依存は前→後の一方向。

---

## 現状（調査で確定した中心事実）

- 宣言/割り込みは `YakuCandidate`（`cards` 付き）を渡し、**`verifyCandidate`（`src/engine/claims.ts:93`）が
  `kind:sameColor:sortedUids` で同定**する。渡された候補は `findYaku`（`src/engine/yaku.ts`）が
  列挙した候補の**カード uid 集合と完全一致**しなければ弾かれる。
- `findYaku` の列挙は**カードを決定的に自動選択**する（triple は `slice(0,3)`、group は各メンバー先頭一致）。
  → 受理される uid の組み合わせが固定されており、プレイヤーが**別の有効な組み合わせ**をタップしても
  現状のエンジンは受理しない。**これが「絵札を選べない」の根本原因**（＝ findYaku への uid 一致で
  代用できない理由でもある。正準以外の合法選択を受理するには再導出が要る）。
- DECLARE は `applyDeclare`（`src/engine/win.ts:137`）、CLAIM は `reduce` の `case 'CLAIM'`
  （`src/engine/game.ts:283`、`findYaku(hand+捨て札, ctx, required)` で検証）。両方が `verifyCandidate` 経由。
- 手札のタップは `Hand.tsx` にハードコードで **discard 専用**（`onClick={onDiscard}`, `disabled={!canDiscard}`）。
  `canDiscard = game.phase === 'discard' && game.turn === humanSeat`（`useGameLoop.ts:264`）。
  `selfDeclare`/`claimWindow` では全カードが `disabled` の `<button>`。**インタラクションの分岐点は Hand.tsx の1箇所**。
- 残枚数ホバーの受け口は `<li>`（無効ボタンにイベントが来ないため。`Hand.tsx` のコメント参照）。
- `loop.declare(candidate)` / `loop.claim(candidate)` は**任意の `YakuCandidate` を受理**（検証はエンジン側）。
  `autoAction`（`src/ui/hooks/autoAction.ts:143-187`）は**合法役がゼロのときだけ**自動 skip/pass するため、
  合法な構成が1つでもある限り受付窓は開いたまま。

---

## 設計サマリ

### A. データモデル／型（`src/engine/types.ts` は不変、`src/engine/yaku.ts` に追加）

型の追加は無し（`YakuCandidate` をそのまま使う）。エンジンに**純関数を1つ**追加する:

```ts
// src/engine/yaku.ts
// 選択された uid 集合から役を「再導出」する。列挙(findYaku)と違い、
// プレイヤーが選んだカードそのものから役種・同色・点数を決める。
export function candidateFromSelection(
  hand: readonly Card[],
  selectedUids: readonly number[],
  ctx: YakuContext,
  required?: Card,          // ロンのとき必須の捨て札。selectedUids に含まれること
): YakuCandidate | null
```

判定規則:

- 全カードが同一メンバーで枚数 = `TRIPLE_SIZE`(3) → `triple`
- あるアクティブグループの全メンバーをちょうど1枚ずつ過不足なく → `groupN`
- それ以外（枚数過不足・未所持 uid・混在）→ `null`
- `sameColor` = 消費カードが全同色（`new Set(cards.map(c=>c.color)).size === 1`、`yaku.ts:197` と同一規則）
- `bonusCount`/`score` は既存 `countBonusCards`/`scoreYaku` で**再計算**（点数はカードの色に依存しない）
- **ロン（`required` あり）**: 選択に `required` を含み、かつ同シグネチャの役が `hand \ {required}` では
  成立しない（既存 `findYaku(..., required)` の「反手内成立でロン不可」規則を流用）

### B. ロジック構成（検証を「列挙一致」から「選択の再導出」へ）

`findYaku`/`bestYaku`/`computeWaits` は**そのまま維持**（AI・待ち計算・おまかせ候補が使う）。
変えるのは**人間経路の検証**だけ。

- **DECLARE（`src/engine/win.ts:137` `applyDeclare`）**: `verifyCandidate(findYaku(hand,ctx), claimed, …)` を、
  `candidateFromSelection(hand, claimed.cards の uid, ctx)` による再導出＋合法性チェックに差し替える。
- **CLAIM（`src/engine/game.ts:283` `case 'CLAIM'`）**: 同様に
  `candidateFromSelection([...hand, discard], claimed.cards の uid, ctx, discard)` に差し替える。
- **`verifyCandidate`（`src/engine/claims.ts:93`）の扱い**（実装時に確定・**(i) 推奨**）:
  - (i) `verifyCandidate` を「選択から再計算して採用」する形に**統一**（単一検証点・drift 最小）。
    `isCandidateShape` の入口ガード（壊れた入力 → `IllegalActionError`、素の `TypeError` にしない）は維持。
  - (ii) 人間経路用に `verifySelection` を新設し、`verifyCandidate` と共通ロジックを共有。
- **保たれる安全性**（既存と同値）: 点数偽装不可（再計算した点数を採用）／未所持カード不可（uid 解決が null）／
  不要牌ロン不可（`required` 規則）。**AI は従来どおり `findYaku`/`bestYaku` の候補を渡す** → それも合法選択
  なので受理され、**100 局の点数保存則・カード保存則・手札枚数は不変**（AI の選ぶ uid・点数が変わらない）。

**横断的関心事**: エンジンは `Math.random`/`Date`/React/config 非依存を維持（`.oxlintrc.json` が検知）。

### C. 新規ファイル

| パス | 役割 |
| --- | --- |
| `src/ui/components/SelectionPreview.tsx` | 選択 uid → `candidateFromSelection` で役をライブ判定し、役名＋同色＋点数／未成立案内を表示 |
| `src/ui/selection.ts`（任意） | 選択 uid の集合操作（トグル・ロン必須固定・phase 変化リセット）を純関数に切り出す小ヘルパ |
| `tests/engine/yaku.test.ts`（既存に追記） | `candidateFromSelection` 単体（差分オラクル流用） |
| `tests/ui/selectionPreview.test.tsx` | プレビューの配線（renderToStaticMarkup） |

**クライアント完結**: 選択は一時的な UI 状態。エンジンは純関数追加のみで、永続化・サーバは不要。

### D. UI 拡張（`Hand.tsx` / `CardView.tsx` / `TableScreen.tsx` / `ActionBar.tsx`）

- **インタラクションモード**: `Hand` に `interaction: 'discard' | 'select' | 'none'`（または `onSelect`/`selectedUids`）を
  導入。`discard` フェーズ = タップで捨てる（**現状維持・座標 E2E を壊さない**）。`selfDeclare`/`claimWindow`（人間）=
  タップでトグル選択。`CardView` に `isSelected` を足し `.card--selected`（App.css）を付与。
  - **詳細度・import 順の罠**（9-1/10-2 と同型）: `.card--clickable:hover`(0,2,0) が単一 `.card--selected`(0,1,0) に勝つ。
    選択リングを hover 下でも残すなら**複合クラス `.card--clickable.card--selected`** で確保。`table.css` は
    `App.css` より先にバンドルされるため、選択スタイルは `App.css` 側か複合セレクタで後勝ちさせる。
  - **面の色は塗り替えない**（同色役の判定情報。選択はリング/持ち上げで表す。`card--waiting`/`card--last` に倣う）。
  - `CardView` のハードコード aria-label「…を捨てる」を**モード対応**（選択時は「…を選ぶ」）にする。
- **ライブプレビュー**: `SelectionPreview` を `.table__mine` 内（`.table__mine-head` の下）に置く
  （縦は積み、横向きは左カラムに乗るため landscape ルール追加不要）。未成立時は `あと1枚` /
  `この組み合わせでは役になりません`。文言は `YAKU_LABELS`/`COLOR_LABELS`＋`describe()` を流用。
- **確定ボタン**: ツモ=緑（`button--tsumo`）/ ロン=赤（`button--ron`）。**有効な役のときだけ活性**。押下で
  `loop.declare(candidate)` / `loop.claim(candidate)` を呼ぶ（`candidate` は `candidateFromSelection` で構築）。
- **おまかせプレフィル**: `ActionBar` の既存候補ボタン（`actionBarItems`）は残し、押下で**その uid を選択欄へ
  プレフィル**（即確定ではなく上書き可能）に変える。速い宣言経路を温存しつつ手動構成を許す。

### E. ランタイム統合（`TableScreen.tsx` のローカル状態、`useGameLoop.ts` は最小変更）

```ts
// TableScreen 内（または src/ui/hooks の小フック）
const [selectedUids, setSelectedUids] = useState<readonly number[]>([])
// 有効なら候補、無効なら null。プレビューと確定活性の単一の真実。
const composed = useMemo(
  () => candidateFromSelection(handForPhase, selectedUids, yakuContextOf(state, rules), requiredForClaim),
  [handForPhase, selectedUids, state, rules],
)
```

- **選択リセット**: `phase`/`turn`/`declarer` が変わる、または受付が閉じた瞬間に `selectedUids` を空へ
  （`WaitPanel` の pinned 生存バグと同型。「常にマウントされ続ける」に依存した正しさは崩れる）。
- ロンでは `requiredForClaim = state.lastDiscard` を構成の固定要素にする。
- `useGameLoop` の戻り値は既存の `declare`/`claim`/`pass`/`declarable`/`claimable`/`canDiscard` を流用。
  必要なら `yakuContextOf` の公開だけ足す（既に `gameSelectors.ts` にある）。

### F. 永続化

**なし**。選択は一局中の一時的な UI 状態で、localStorage/IndexedDB には保存しない。

### G. 文言（`src/ui/labels.ts`＋インライン、CLAUDE.md 規約）

このプロジェクトは i18n を持たず日本語直書き＋`labels.ts`。新規文言はプレビューの案内数語
（`あと1枚` / `この組み合わせでは役になりません` / 選択用 aria-label）。`YAKU_LABELS`/`COLOR_LABELS` は流用。

---

## 段階分割（3 ステップ）

各ステップ完了時に検証ゲート全通過（下記 Verification）と PR レビュー後マージ。

### Step 1: `.steering/[YYYYMMDD]-pokajan-yaku-selection-engine/` — エンジン（選択の再導出＋検証再計算化）

- 追加: `src/engine/yaku.ts` に `candidateFromSelection`（triple/groupN 判定・同色/ボーナス/点数の再計算・ロン必須規則）
- 変更: `src/engine/win.ts`（`applyDeclare`）・`src/engine/game.ts`（`case 'CLAIM'`）・`src/engine/claims.ts`
  （`verifyCandidate` を再計算式に統一、または `verifySelection` 新設）を、**選択から再導出**する検証に差し替え
- 維持: `findYaku`/`bestYaku`/`computeWaits`（列挙。AI・待ち・おまかせが使う）
- テスト: `tests/engine/yaku.test.ts` に `candidateFromSelection` 単体（有効 triple/group・**正準以外の合法選択を受理**・
  色違いで役種/点数が変わる・未所持/枚数過不足で null・ロン必須規則・差分オラクル）。`game.test.ts` に
  **非正準の合法選択が DECLARE/CLAIM で通る**回帰（＝「正準のみ受理」に壊すと落ちる）。`autoplay.test.ts`（100 局）不変
- **UI は一切触らない**（エンジンを単独で固める）

### Step 2: `.steering/[YYYYMMDD]-pokajan-yaku-selection-ui-tsumo/` — UI・ツモ（選択＋プレビュー＋確定＋プレフィル）

- 変更: `Hand.tsx`/`CardView.tsx`（インタラクションモード・`isSelected`・`.card--selected`・aria-label モード対応）
- 追加: `src/ui/components/SelectionPreview.tsx`（`selfDeclare` のライブプレビュー）
- 変更: `TableScreen.tsx`（`selectedUids` 状態・`composed` 導出・phase 変化でリセット・確定配線）
- 変更: `ActionBar.tsx`（declare の候補ボタンを**おまかせプレフィル**化。確定ボタンは活性条件付き）
- 変更: `src/App.css`/`src/ui/table.css`（`.card--selected`・プレビュー枠。table.css 400 行規則に注意）
- テスト: `tests/ui/selectionPreview.test.tsx`（配線）、`tests/ui/actionBar.test.tsx`（プレフィル化の配線）、
  `tests/e2e/table.spec.ts`（`selfDeclare` でタップ構成→プレビュー更新→確定でツモ／**同色 triple と混色で点数が変わる**／
  `discard` フェーズのタップは従来どおり捨てる／座標・375px は不変）

### Step 3: `.steering/[YYYYMMDD]-pokajan-yaku-selection-ui-ron/` — UI・ロン＋仕上げ

- 変更: `Hand.tsx`/`SelectionPreview.tsx`/`TableScreen.tsx`（`claimWindow` へ選択モードを拡張。`lastDiscard` を
  構成の固定要素として提示、残りを手札から組む）
- 変更: `ActionBar.tsx`（claim の候補ボタンもおまかせプレフィル化）
- テスト: `tests/e2e/table.spec.ts`（`playUntilClaimWindow` で割り込み到達→捨て札固定でロン構成→確定でロン。
  844×390 横向き fit・座標・375px の回帰ガードが不変）。ミューテーションで新規回帰の有効性を確認

---

## 重要な制約・リスク

| リスク | 対応 |
| --- | --- |
| **神聖なエンジン層の検証変更**（偽装・未所持・不要牌ロンの穴） | 100 局不変条件（`autoplay.test.ts`）＋ `game.test.ts` の「候補の再計算による検証」＋ 新規ミューテーションテストで担保。安全性は既存と同値を維持 |
| **タップの二役**（discard 捨て vs 構成選択）の取り違え | `discard` フェーズの捨てタップと座標/375px E2E を不変に保つ。モード分岐は Hand.tsx の1箇所に集約 |
| **選択の一時状態が局をまたいで残る**（WaitPanel pinned と同型） | `phase`/`turn`/受付終了でリセット。`useEffect` 依存に入れて表示条件が偽になる瞬間に空へ |
| **`.card--selected` の詳細度・import 順負け**（9-1/10-2 の轍） | 複合クラス `.card--clickable.card--selected`／App.css 側で後勝ち。E2E で選択見た目を実測 |
| **無効ボタンにマウス/クリックが来ない** | 選択モードでは対象カードのボタンを活性化（または受け口を `<li>` へ）。残枚数ホバーの `<li>` 受け口は維持 |
| **CSS 肥大**（table.css が 400 行に接近） | フェーズ区切りごとに `wc -l`。超えたら分割（Step 3 の教訓） |

---

## Critical Files

**既存（修正）**:

- `src/engine/yaku.ts`（`candidateFromSelection` 追加）
- `src/engine/claims.ts`（`verifyCandidate` を再計算式に）
- `src/engine/win.ts`（`applyDeclare`）/ `src/engine/game.ts`（`case 'CLAIM'`）
- `src/ui/components/Hand.tsx` / `src/ui/components/CardView.tsx` / `src/ui/components/ActionBar.tsx`
- `src/ui/screens/TableScreen.tsx` / `src/ui/hooks/useGameLoop.ts`
- `src/App.css` / `src/ui/table.css` / `src/ui/labels.ts`

**新規**:

- `src/ui/components/SelectionPreview.tsx`（＋任意 `src/ui/selection.ts`）
- `tests/ui/selectionPreview.test.tsx`
- `tests/engine/yaku.test.ts`・`tests/engine/game.test.ts`・`tests/e2e/table.spec.ts` への追記

---

## Verification

### 自動

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

- 既存ユニット ~760 件 ＋ E2E 80 件（着手前に `npm test` で現件数を確認）に新規追加分がすべて PASS
- **第一の砦は `tests/engine/autoplay.test.ts`（100 局・点数/カード保存則・手札枚数）**。エンジン変更後に最初に見る
- **新規回帰はミューテーションで「落ちること」を確認**（CLAUDE.md 規約）。特に Step 1 の
  「非正準の合法選択を受理」テストは、実装を「正準のみ受理」に壊すと落ちることを確かめる

### 手動（`npm run dev`）

1. テンパイ手で、同一メンバー4枚のうち**どの3枚**を使うかで手札に残る札が変わること
2. 同色でそろえると点数が上がり、混色にすると下がる（役名の同色バッジと点数がライブに変わる）
3. 候補ボタン（おまかせ）を押すと選択欄がプレフィルされ、そこから手動で上書きできる
4. ロンで、捨て札が構成に固定され、残りを手札から組んで確定できる
5. `discard` フェーズのタップは従来どおり捨て札になる（構成モードに混ざらない）

### ステアリングスキル運用

- 各 Step で `.steering/[日付]-[step-slug]/` の requirements / design / tasklist を作成
- tasklist の各タスクで `[ ]` → `[x]` をリアルタイム更新
- 全タスク完了後に申し送り（実装完了日 / 計画と実績の差分 / 学んだこと / 改善提案）を記録
- 実装前に本プランと直近の `.steering/*/design.md`、CLAUDE.md を読む
