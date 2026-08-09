# ポカジャン 絵札選択（役の組み替え）— `/add-feature` 実行コマンド一覧

本書は [pokajan-yaku-card-selection-plan.md](pokajan-yaku-card-selection-plan.md) の実装を
3 つの独立した `/add-feature` コマンドに分割したものである。
各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

**重要**: 各 `/add-feature` コマンドのプロンプトには
「参照ドキュメント: `docs/ideas/pokajan-yaku-card-selection-plan.md`」が含まれており、
実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**: Step 10 まで完了していること（`main` に取り込み済み）。着手前に `npm test` で現件数を確認する
（想定: ユニット ~760 件 / E2E 80 件）。**このプランはエンジン層（`src/engine/`）を変更する数少ない作業**である
（Step 7〜10 は非エンジン）。`candidateFromSelection` は未実装（grep で `src/` に存在しないことを確認済み）。

## 実行順の全体像

```
Step 1: エンジン（選択の再導出＋検証再計算化）
   ↓   ← ★ プレイヤーが選んだ任意の合法カード集合をエンジンが受理する（UI はまだ無い／100 局不変）
Step 2: UI・ツモ（選択＋ライブプレビュー＋確定＋おまかせプレフィル）
   ↓   ← ★ 自分の番でカードをタップして役を組み、点数を見ながらツモできる
Step 3: UI・ロン＋仕上げ（割り込みの構成・E2E 強化）
       ← ★ 割り込みでも捨て札を固定してロンを組める（＝機能完成）
```

**ポイント**:

- **Step 1 → 2 → 3 の順は動かせない**。UI（Step 2/3）が渡す「非正準の合法選択」を、エンジン（Step 1）が
  先に受理できるようにしておく必要がある。逆順だと確定ボタンがエンジンに弾かれる。
- **エンジンを UI より先に単独で固める**ことで、最も危険な検証ロジックの変更を 100 局不変条件の下で確定させ、
  以降の UI 作業を安全な土台の上で進められる。
- 各ステップ後に
  `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
  と `npx playwright test` が PASS することをゲートとする。

---

## Step 1: エンジン（選択の再導出＋検証再計算化）

```
/add-feature ポカジャン 絵札選択エンジン: 選択された uid 集合から役を再導出する candidateFromSelection を src/engine/yaku.ts に追加し、DECLARE/CLAIM の検証を「findYaku 列挙との uid 一致」から「選択カードからの再計算」へ差し替える。findYaku/bestYaku/computeWaits は列挙用に維持し、AI 経路と 100 局不変条件を壊さない。UI は変更しない。参照ドキュメント: docs/ideas/pokajan-yaku-card-selection-plan.md (Step 1 範囲のみ実装、Step 10 完了前提)
```

**実装内容**:

- 追加: `src/engine/yaku.ts`
  - `candidateFromSelection(hand, selectedUids, ctx, required?): YakuCandidate | null`
  - triple（同一メンバー3枚）/ groupN（アクティブグループ全員1枚ずつ）を判定、それ以外は `null`
  - `sameColor` は消費カードの実色から、`bonusCount`/`score` は既存 `countBonusCards`/`scoreYaku` で再計算
  - ロン（`required` あり）: 選択に `required` を含み、同シグネチャの役が `hand \ {required}` で不成立
- 修正: `src/engine/claims.ts`
  - `verifyCandidate` を「選択から再計算して採用」する形に統一（**推奨**。単一検証点）。
    `isCandidateShape` の入口ガード（壊れた入力 → `IllegalActionError`）は維持。
    ※ 代替として人間経路用 `verifySelection` の新設も可（共通ロジックを共有）
- 修正: `src/engine/win.ts`（`applyDeclare`）/ `src/engine/game.ts`（`case 'CLAIM'`）
  - 渡された `candidate.cards` の uid から再導出して検証・採用するよう配線
- 維持: `findYaku` / `bestYaku` / `computeWaits`（AI・待ち計算・おまかせ候補が使う列挙）
- 新規テスト:
  - `tests/engine/yaku.test.ts`（追記）— `candidateFromSelection` 単体: 有効 triple/group、
    **正準以外の合法選択を受理**、色違いで役種/点数が変わる、未所持 uid・枚数過不足で null、
    ロン必須規則、素朴な別実装との**差分オラクル**（`実際の配牌に対する不変条件` の手法を流用）
  - `tests/engine/game.test.ts`（追記）— reducer 経由で**非正準の合法選択が DECLARE/CLAIM で通る**
    （「候補の再計算による検証」ブロックに追加）。偽装スコア無視・未所持・不要牌ロン不可の既存保証も再確認

**動作確認**:

- `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` PASS ＋ `npx playwright test` PASS
- `tests/engine/autoplay.test.ts`（100 局）が不変（点数/カード保存則・手札枚数・統計回帰）
- ミューテーション: `candidateFromSelection` を「正準のみ受理」に壊すと、Step 1 の新規回帰が落ちること
- **UI は無変更**（ブラウザ挙動は Step 1 時点では変わらない）

**依存**: なし（Step 10 完了が前提）

---

## Step 2: UI・ツモ（選択＋ライブプレビュー＋確定＋おまかせプレフィル）

```
/add-feature ポカジャン 絵札選択UIツモ: 自分の番(selfDeclare)で手札カードをタップして役を構成できるようにする。Hand/CardView に選択モードと .card--selected を足し、選択が作る役をライブプレビュー(役名＋同色＋点数)し、有効なときだけ緑のツモボタンで確定する。既存の候補ボタンはおまかせプレフィルにする。discard フェーズのタップは従来どおり捨て札。参照ドキュメント: docs/ideas/pokajan-yaku-card-selection-plan.md (Step 2 範囲のみ実装、Step 1 完了前提)
```

**実装内容**:

- 修正: `src/ui/components/Hand.tsx` / `src/ui/components/CardView.tsx`
  - インタラクションモード（`discard`=捨てる / `select`=トグル選択 / `none`）。`selfDeclare`（人間）で選択モードに。
  - `CardView` に `isSelected` を追加し `.card--selected` を付与。ハードコード aria-label「…を捨てる」を
    選択時「…を選ぶ」にモード対応。**面の色は塗り替えない**（同色役の情報。リング/持ち上げで表す）。
- 新規: `src/ui/components/SelectionPreview.tsx`
  - 選択 uid → `candidateFromSelection` で役をライブ判定。役名＋同色＋点数（`describe()`/`YAKU_LABELS`/`COLOR_LABELS`）。
    未成立は `あと1枚` / `この組み合わせでは役になりません`。
- 修正: `src/ui/screens/TableScreen.tsx`
  - `selectedUids` 状態・`composed` 導出（プレビューと確定活性の単一の真実）。`SelectionPreview` を
    `.table__mine` 内（head の下）に配置。**`phase`/`turn`/`declarer` 変化でリセット**（`useEffect` 依存）。
  - 確定（ツモ=緑 `button--tsumo`）は有効な役のときだけ活性 → `loop.declare(composed)`。
- 修正: `src/ui/components/ActionBar.tsx`
  - declare の候補ボタン（`actionBarItems`）を押下で**選択欄へプレフィル**（即確定ではなく上書き可）に変更。
- 修正: `src/App.css` / `src/ui/table.css`
  - `.card--selected`（**複合クラス `.card--clickable.card--selected` で詳細度確保**・import 順に注意）、
    プレビュー枠。`table.css` の行数を `wc -l` で監視（400 行規則）。
- 新規テスト:
  - `tests/ui/selectionPreview.test.tsx`（renderToStaticMarkup）— 選択に応じた役名/点数、未成立案内、確定活性/非活性
  - `tests/ui/actionBar.test.tsx`（追記）— 候補ボタンがプレフィル配線であることの検査
  - `tests/e2e/table.spec.ts`（追記）— `selfDeclare` 到達→タップ構成→プレビュー更新→確定でツモ／
    **同色 triple と混色で点数が変わる**／`discard` フェーズのタップは従来どおり捨てる／座標・375px 不変

**動作確認**:

- 自動ゲート一式 PASS ＋ `npx playwright test` PASS
- ブラウザ:
  1. 同一メンバー4枚のうち**どの3枚**を使うかで手札に残る札が変わること
  2. 同色でそろえると点数が上がり、混色にすると下がる（プレビューがライブに変わる）
  3. おまかせ候補ボタンでプレフィル→手動上書きできること
  4. `discard` フェーズのタップが従来どおり捨て札になること（構成モードに混ざらない）
- ミューテーション: 選択リセットを外すと「局をまたいで選択が残る」回帰が落ちること

**依存**: Step 1（エンジンが非正準の合法選択を受理できること）

---

## Step 3: UI・ロン＋仕上げ（割り込みの構成・E2E 強化）

```
/add-feature ポカジャン 絵札選択UIロン: 割り込み(claimWindow)でも手札カードをタップしてロンを構成できるようにする。捨て札(lastDiscard)を構成の固定要素として提示し、残りを手札から組む。ロンの候補ボタンもおまかせプレフィルにし、赤のロンボタンで確定する。横向き844×390・座標・375pxの回帰ガードを不変に保つ。参照ドキュメント: docs/ideas/pokajan-yaku-card-selection-plan.md (Step 3 範囲のみ実装、Step 1-2 完了前提)
```

**実装内容**:

- 修正: `src/ui/components/Hand.tsx` / `src/ui/components/SelectionPreview.tsx` / `src/ui/screens/TableScreen.tsx`
  - `claimWindow`（人間）へ選択モードを拡張。`lastDiscard` を構成の固定要素として提示し、残りを手札から組む。
    `composed` の導出に `required = state.lastDiscard` を渡す。確定（ロン=赤 `button--ron`）→ `loop.claim(composed)`。
- 修正: `src/ui/components/ActionBar.tsx`
  - claim の候補ボタンもおまかせプレフィル化（Step 2 の declare 側と同じ扱い）。
- 新規テスト:
  - `tests/e2e/table.spec.ts`（追記）— `playUntilClaimWindow` で割り込み到達→捨て札固定でロン構成→確定でロン。
    844×390 横向き fit（`vOverflow<=1`）・4方向座標・375px 縦積みが不変であることを確認
  - 新規回帰はミューテーションで「落ちること」を確認（捨て札固定を外すと不要牌ロンや二重消費が通ってしまう等）

**動作確認**:

- 自動ゲート一式 PASS ＋ `npx playwright test` PASS
- ブラウザ:
  1. 割り込みで捨て札が構成に固定され、残りを手札から組んで確定できること
  2. ロンの候補ボタンでもプレフィル→上書きできること
  3. 横向き 844×390・縦 375px・デスクトップが破綻しないこと（E2E で実測）
  4. （実機/エミュレータ）タッチでの選択・確定が使えること — **最終目視はユーザーに依頼**

**依存**: Step 1, 2（エンジン受理・選択モード/プレビュー/確定の土台）

---

## 参考: 各ステップ完了時点で何が動くか

| Step | 動く状態 |
| --- | --- |
| 1 完了 | ★ エンジンがプレイヤーの任意の合法カード集合を受理（UI は未変更・100 局不変） |
| 2 完了 | ★ 自分の番でタップして役を組み、点数を見ながらツモ確定できる（おまかせプレフィル併存） |
| 3 完了 | ★ 割り込みでも捨て札を固定してロンを組める（機能完成） |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、問題発生時は該当ステップの PR を revert するだけで回復する。ただし:

- **Step 1 を revert すると Step 2/3 の前提が消える**（UI の確定がエンジンに弾かれる）。逆順の revert はしない。
- **Step 2/3 は UI のみ**。revert してもエンジン（Step 1）は無傷。ただし `.card--selected`（App.css/table.css）と
  `Hand.tsx` のインタラクションモードを確実に元へ戻すこと（中途半端に残すと discard タップが壊れる）。
- **Step 1 のエンジン変更**は最も慎重に。revert 時は `verifyCandidate` の旧「列挙一致」形に確実に戻し、
  `autoplay.test.ts`（100 局）が通ることを確認する。

## 参考: Step 1 着手前の事前確認

- **新規依存追加**: なし。素の TS/React/CSS と既存の framer-motion で足りる。
- **エンジンの制約**: `src/engine/` は `Math.random`/`Date`/React/config 非依存を維持（`.oxlintrc.json` が検知）。
- **安全性の維持**: 偽装スコア無視・未所持カード不可・不要牌ロン不可を既存と同値に保つ
  （`game.test.ts` の「候補の再計算による検証」＋ 新規ミューテーションで担保）。
- **既存テストの状態**: 着手前に `npm test` で現件数を確認（想定 ユニット ~760 件 / E2E 80 件）。

## 参考: v2 以降で検討する機能

- **役の自動最適サジェスト**（同色を優先する等のヒント表示。`bestYaku` を流用）
- **連続宣言（チェーン）中の構成 UX の作り込み**（`maxChainDeclare` まわり）
- **タッチ操作の最適化**（ドラッグ選択・選択解除ジェスチャ）
- **CPU の絵札選択の戦術強化**（現状は `bestYaku` の残存価値近似。より精密な期待値評価）
- **選択に対する残り枚数プレビュー連動**（`unseen` を構成中の待ちに合わせて表示）
