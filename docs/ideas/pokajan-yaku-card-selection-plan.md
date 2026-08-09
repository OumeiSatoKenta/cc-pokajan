# ポカジャン 役に使う絵札をタップで選ぶ（役の組み替え）計画

## Context

プレイテストの修正ポイント。**「役に使う絵札をプレイヤーが選べる」**ようにする。

現状は宣言時にエンジンが**使うカードを自動選択**しており、プレイヤーは役の種類ボタン
（混色/同色は別ボタンで既に出る）を押すだけ。**どの色の絵札を何枚使うか＝何を手札に残すか**を
選べないため、色の取り方で役・点数・その後の待ちが変わる戦術が成立しない。

→ **手札の絵札をタップして役を構成し、選び方で役・点数がリアルタイムに変わる**方式にする。

### 確定方針（ユーザー確認済み）

- **操作モデル: カードをタップして役を構成**。色の取り方で役種・点数がライブに変わり、
  残す札も自分で決められる。

---

## 現状（調査で確定した中心事実）

- 宣言/割り込みは `YakuCandidate`（`cards` 付き）を渡し、**`verifyCandidate`（`src/engine/claims.ts:93`）が
  `kind:sameColor:sortedUids` で同定**する。渡された候補は `findYaku`（`src/engine/yaku.ts`）が
  列挙した候補の**カード uid 集合と完全一致**しなければ弾かれる。
- `findYaku` の列挙は**カードを決定的に自動選択**する（triple は `slice(0,3)`、group は各メンバー先頭一致）。
  → 受理される uid の組み合わせが固定されており、プレイヤーが**別の有効な組み合わせ**をタップしても
  現状のエンジンは受理しない。これが「絵札を選べない」の根本原因。
- DECLARE は `applyDeclare`（`src/engine/win.ts:137`）、CLAIM は `reduce` の `case 'CLAIM'`
  （`src/engine/game.ts:283`、`findYaku(hand+捨て札, ctx, required)` で検証）。両方が `verifyCandidate` 経由。
- 手札のタップは `discard` フェーズでは捨て札（`Hand.tsx` → `CardView` の `onClick`、`disabled={!canDiscard}`）。
  残枚数ホバーの受け口は `<li>`（無効ボタンにイベントが来ないため。`Hand.tsx` のコメント参照）。

---

## 方針（エンジンは「再計算して採用」を維持したまま任意選択を受理）

エンジンの列挙（AI・待ち計算が使う）はそのまま残し、**検証を「列挙一致」から
「選択されたカードから役を再計算」へ**変える。全列挙に切り替える案は候補数が爆発し
（メンバー6枚で C(6,3)=20 通り等）、`computeWaits`・CPU AI・100 局不変条件テストに波及するため採らない。

### エンジン追加

`candidateFromSelection(hand, selectedUids, ctx, required?): YakuCandidate | null`（`src/engine/yaku.ts`）。
選択カードを解決し、

- 全カードが同一メンバーで枚数=`TRIPLE_SIZE` → `triple`
- あるアクティブグループの全メンバーを 1 枚ずつ過不足なく → `groupN`
- それ以外 → `null`

として役種を判定。`sameColor`/`bonusCount`/`score` は既存 `scoreYaku`/`countBonusCards` で**再計算**。
ロン（`required` あり）では **選択に `required` を含む**かつ**同シグネチャの役が
`hand \ {required}` では成立しない**（既存の `findYaku(..., required)` の反手内成立ルールを流用）ことを要求。

### 検証の差し替え

DECLARE/CLAIM は**渡された `cards`（＝プレイヤーの選択）から再計算**して採用する。
「点数を偽装できない」「持っていない札は使えない」「不要牌でロンできない」という既存の安全性は維持。
AI は従来どおり `findYaku`/`bestYaku` で選んだ候補を渡す → その選択も有効なので受理され、
**100 局の点数保存則・カード保存則は不変**（AI の選ぶ uid・点数が変わらないため）。

実装形態は 2 択（実装時に確定）:

- (i) `verifyCandidate` を再計算式に統一（単一検証点・drift 最小・**推奨**）
- (ii) 人間経路用に `verifySelection` を新設（`verifyCandidate` と共通ロジックを共有）

---

## UI（タップ構成 + ライブプレビュー + 確定）

- `selfDeclare` / `claimWindow`（人間が判断者）では手札カードを**トグル選択**にする。
  `discard` フェーズのタップは従来どおり捨て札（座標 E2E を壊さない）。フェーズで受け口を出し分ける。
- **ライブプレビュー**: 現在の選択が作る役を `役名＋同色バッジ＋点数` で表示。未成立時は
  `あと1枚` / `この組み合わせでは役になりません` の案内。確定ボタン（ツモ=緑/ロン=赤、Step 10-2 準拠）は
  有効な役のときだけ押せる。
- **クイック選択（おすすめ）**: 既存の列挙候補ボタンは残し、押すと**その uid をプレフィル**する。
  現状の速い宣言経路を温存しつつ、手動で上書きできる（規模が過大なら縮退可）。
- **ロン**: 必須の捨て札を構成の固定要素として提示し、残りを手札から組む。
- 選択状態の見た目は `CardView` に selected 表現を追加。CSS は `table.css`（400 行規則に注意、超えるなら分割）。

---

## 対象ファイル

- **エンジン**: `src/engine/yaku.ts`（`candidateFromSelection` 追加）、`src/engine/claims.ts`（検証を再計算式に）、
  必要に応じ `src/engine/win.ts`・`src/engine/game.ts`（選択を通す）。`findYaku`/`bestYaku` は列挙用に維持。
- **UI**: `src/ui/components/ActionBar.tsx`（または構成パネル新設）、`src/ui/components/Hand.tsx`（選択モード）、
  `src/ui/components/CardView.tsx`（selected 表現）、`src/ui/screens/TableScreen.tsx`（選択 state＋プレビュー配線）、
  `src/ui/hooks/useGameLoop.ts`（`declare`/`claim` は候補を取る。選択→候補の組み立て箇所を追加）。
- **テスト**: `tests/engine/` に `candidateFromSelection` 単体（有効/無効・色違いで役が変わる・ロン必須ルール）、
  `tests/ui/` に プレビュー配線（`renderToStaticMarkup`）、`tests/e2e/table.spec.ts` に
  タップ構成フロー（同色 triple と混色で点数が変わる／確定できる／`discard` と座標検査が不変）。
  **新規回帰は「わざと壊して落ちる」ことを確認**（CLAUDE.md 準拠）。`tests/engine/autoplay.test.ts`（100 局）が第一の砦。

---

## リスク

- **神聖なエンジン層の検証変更**。安全性（偽装・不所持・不要牌ロン）を落とさないこと。
  100 局不変条件＋`claims` テスト＋新規ミューテーションテストで担保。
- タップの二役（捨て札 vs 構成）と残枚数ホバー受け口（`<li>`）の整合。座標 E2E・375px・残枚数 E2E を維持。

---

## 実行と検証

CLAUDE.md 準拠で `.steering/[YYYYMMDD]-pokajan-yaku-card-selection/` を作成 → 実装 →
`implementation-validator` → 3 軸レビュー（structural / secondary / docs）→ 検証ゲート。

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
npx playwright test
```

第一の砦は `tests/engine/autoplay.test.ts`（100 局・点数/カード保存則・手札枚数）。
新規回帰はミューテーションで「落ちること」を確認する。
