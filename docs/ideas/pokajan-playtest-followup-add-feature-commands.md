# ポカジャン Step 10 — `/add-feature` 実行コマンド一覧

本書は [pokajan-playtest-followup-plan.md](pokajan-playtest-followup-plan.md) の実装を
3 つの独立した `/add-feature` コマンドに分割したものである。
各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

Step 1〜8 は各 `pokajan-*-add-feature-commands.md`、Step 9 は
[pokajan-casino-table-redesign-add-feature-commands.md](pokajan-casino-table-redesign-add-feature-commands.md) にある。

**重要**: 各 `/add-feature` コマンドのプロンプトには
「参照ドキュメント: `docs/ideas/pokajan-playtest-followup-plan.md`」が含まれており、
実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**: Step 9（9-1〜9-3）が完了していること。Step 9-3 完了時点でユニット 760 件 / E2E 76 件が通る
（着手前に `npm test` で現件数を確認）。**エンジン層（`src/engine/`）は本 Step でも一切変更しない。**

## 実行順の全体像

```
Step 10-1: 待ちのホバー/タップ展開
   ↓   ← ★ テンパイ成立/崩れで手札が動かなくなる（＝横向き fit の前提が整う）
Step 10-2: ゲーム風ボタン（全画面）
   ↓   ← ★ ツモ=緑/ロン=赤/見送る、押下感。全画面のボタンが統一される
Step 10-3: 横向き専用レイアウト再設計
       ← ★ 844×390 の縦 fit を達成（9-3 の保留を解除。完成）
```

**ポイント**:

- **10-1 → 10-3 の順は動かせない**。待ちをフロー外（オーバーレイ）に出すと、9-3 で最大の
  縦あふれ要因だった待ちパネル（テンパイ時 最大 ~228px）が消え、10-3 の横向き fit が現実的になる。
- **10-2 は独立**だが、10-3 が最終ボタンサイズを横向き用に縮めるので 10-3 より前に置く。
- 各ステップ後に
  `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
  と `npx playwright test` が PASS することをゲートとする。

---

## Step 10-1: 待ちのホバー/タップ展開（ちらつき解消）

```
/add-feature ポカジャン 待ちのホバー展開: 待ち一覧を手札の上の常時フロー配置から「待ち N件」トリガ＋ホバー/タップで開くフロー外オーバーレイに変え、テンパイ成立/崩れで手札の位置が動かないようにする。並び・残0淡色・6件上限の振る舞いは維持し、残枚数ツールチップと同じ絶対配置の手法を使う。作業用の tmp-design.zip も削除する。参照ドキュメント: docs/ideas/pokajan-playtest-followup-plan.md (Step 10-1 範囲のみ実装、Step 9 完了前提)
```

**実装内容**:

- 修正: `src/ui/components/WaitPanel.tsx`
  - 「待ち N件」トリガ（常時はこれだけ）＋展開オーバーレイの開閉構造に。
    click/tap トグル（React state・ピン留め）＋ CSS `:hover` の覗き見。Escape / 外側クリックで閉じる。
    `aria-expanded` を付ける。
  - **並び（生存優先→点数降順）・6件＋「他N件」・残0淡色の算出は変えない**（表示の器だけ差し替え）。
- 修正: `src/ui/screens/TableScreen.tsx`
  - 待ちのトリガを `.table__mine-head`（**常時存在する行**）へ移し、手札の上の常時フロー配置をやめる。
  - オーバーレイの基準（`position: relative`）を `.table__mine` か `.hand-area` に置く。
- 修正: `src/ui/hints.css`
  - トリガ chip・展開オーバーレイのスタイル（`.wait` 系を流用/改称）。`.card-counts` と z-index を整理し、
    残枚数ツールチップと待ちオーバーレイが競合しないようにする。
- 修正: `tests/ui/waitPanel.test.tsx`
  - 新構造（トリガ＋オーバーレイ）に追随。**不変条件＝並び・残0・6件上限は引き続き検査**する
    （見た目の器が変わっても振る舞いが変わらないことを固定）。
- 新規/修正 E2E: 固定シードでテンパイに到達（既存 `playUntil…` を活用）→ トリガが出る→展開で待ちが読める
  →閉じられる。**手札の位置がテンパイ前後で不変**であることを座標で確認する。
- 付随: `tmp-design.zip`（プロジェクト直下・作業用）を削除。

**動作確認**:

- 自動ゲート一式 PASS ＋ `npx playwright test` PASS
- ブラウザ:
  1. テンパイ成立/崩れで**手札の位置が動かない**こと
  2. 「待ち N件」をホバー（PC）/タップ（タッチ）で一覧が開き、閉じられること
  3. 残0 が淡く落ちていること／6件超で「他N件」が出ること（振る舞い不変）
  4. 残枚数ツールチップと待ちオーバーレイが重なっても破綻しないこと

**依存**: なし（Step 9 完了が前提）

---

## Step 10-2: ゲーム風ボタン（操作ボタン＋全画面共通）

```
/add-feature ポカジャン ゲーム風ボタン: 対局中の操作ボタンをツモ=緑/ロン=赤/見送る=ゴーストに色分けし、グラデ・影・押下感を付ける。App.css の .button ベースも刷新して全画面（タイトル/BET/精算/設定）に波及させる。accent 地の文字色コントラストを検算し、reduced-motion で押下 transform を無効化する。参照ドキュメント: docs/ideas/pokajan-playtest-followup-plan.md (Step 10-2 範囲のみ実装、Step 9 完了前提)
```

**実装内容**:

- 修正: `src/ui/components/ActionBar.tsx`
  - `item.kind` で class を出し分け（`declare`→`button--tsumo` 緑 / `claim`→`button--ron` 赤 /
    `pass`→`button--ghost`）。ラベルは既存の役名＋点数入り（`actionBarItems`）のまま。
- 修正: `src/App.css`
  - `.button` ベースにグラデーション・影・`:active` の押下 transform を付ける（全画面波及）。
  - `@media (prefers-reduced-motion: reduce)` で押下 transform を無効化。
- 修正: `src/ui/table.css`
  - `.button--tsumo` / `.button--ron`（第2稿 `buildAction` の緑/赤グラデを一次資料に）、
    `.button--primary`（金）、操作エリアの軽い枠（第2稿 `--actionBg`）、タイマー3種の色分けの仕上げ。
- 確認: `src/ui/casino.css` / `src/ui/settings.css`
  - `.button` を使う他画面（精算・設定・補充など）が破綻しないか目視。
- テスト: `tests/ui/actionBarItems.test.ts` 相当＋ActionBar の class 出し分けを単体で（renderToStaticMarkup）。
  見た目は目視。

**動作確認**:

- 自動ゲート一式 PASS ＋ `npx playwright test` PASS
- ブラウザ:
  1. ツモ=緑 / ロン=赤 / 見送る=ゴースト で一目で区別できること
  2. 押下感（`:active`）があり、reduced-motion では動かないこと
  3. **タイトル / BET / 精算 / 設定のボタンも統一され、文字が読める**こと（コントラスト検算）
  4. ライト/ダーク両テーマで破綻しないこと

**依存**: なし（Step 9 完了が前提。10-1 とも独立）

**注意**: **全画面波及**。accent 地に白文字を置くと低コントラストになる（9-1 の `.wait__same` の轍）。
`.button--primary` 等の文字色は濃色（例 `#1b1b22`）で検算する。

---

## Step 10-3: 横向き専用レイアウト再設計（縦 fit を達成）

```
/add-feature ポカジャン 横向き専用レイアウト再設計: 下段の手札と操作バーを 1 つのラッパにまとめて横向きで「手札｜操作」のレールにし、他家席を横向きで簡略化して 844×390 の縦 fit（scrollHeight <= clientHeight）を達成する。E2E の高さ実測で詰め、縦375px・デスクトップ・座標検査を壊さない。参照ドキュメント: docs/ideas/pokajan-playtest-followup-plan.md (Step 10-3 範囲のみ実装、Step 10-1 完了前提)
```

**実装内容**:

- 修正: `src/ui/screens/TableScreen.tsx`
  - 手札（`.table__mine`）と操作バー（`.actions`）を包む `.table__controls` を導入（DOM 再構成）。
    **縦では現状と同じ積み順**、横向きでは `[手札 | 操作]` の横並びに CSS で切り替える。
    `data-testid`/`aria-label`/`grid-template-areas` の名前は維持。
- 修正: `src/ui/landscape.css`
  - レール化（`.table__controls` の row 化）、他家席の簡略化、fit の詰め。9-3 の密度低下・ドット化・
    待ちチップ（→10-1 でオーバーレイ化済み）を土台にする。
- 修正: `src/ui/components/PlayerSeat.tsx` / `src/ui/board.css`
  - 横向きで伏せ札7枚縦積みを畳む（横並び or 「数枚＋×7」の枚数バッジ）。CSS で足りなければ最小の分岐。
- 修正: `tests/e2e/table.spec.ts`
  - 横向き E2E を **縦 fit（`vOverflow <= 1`）** に強化（9-3 は回帰ガード ≤200 だった）。
    **9-3 の教訓を踏襲**: grid-area は grid item（直接の子）にしか効かない／App.css と同詳細度は
    import 順で負ける（`.seat`/`.river` を挟む）。実測ループで詰める。
  - 375px 縦積み・4方向座標・「4人全員が河を持つ」が維持されることを確認。

**動作確認**:

- 自動ゲート一式 PASS ＋ `npx playwright test` PASS
- ブラウザ:
  1. 844×390 で**縦横ともスクロールが出ない**こと（E2E で実測）
  2. 下段が `[手札 | 操作]` のレールになっていること
  3. 縦 375px・デスクトップが破綻しないこと
  4. （実機/エミュレータ）横向きの見た目が使えること — **最終目視はユーザーに依頼**
     （claude-in-chrome の手動スクショは常時アニメで取得困難）

**依存**: Step 10-1（待ちがフロー外に出ていること。出ていないと縦あふれが残り fit しない）

---

## 参考: 各ステップ完了時点で何が動くか

| Step      | 動く状態                                                                 |
| --------- | ------------------------------------------------------------------------ |
| 10-1 完了 | ★ 待ちがホバー/タップ展開になり、テンパイ前後で手札が動かない             |
| 10-2 完了 | ★ ツモ=緑/ロン=赤/見送る＋押下感。全画面のボタンが統一される              |
| 10-3 完了 | ★ 横向き 844×390 が縦横とも収まる（9-3 の保留解除・完成）                 |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、問題発生時は該当ステップの PR を revert するだけで回復する。ただし:

- **10-3 を revert しても 10-1/10-2 は無傷**（10-3 は横向きの DOM 再構成と landscape.css が中心）。
  ただし 10-3 で `.table__controls` を入れた場合、revert 時に TableScreen の DOM を確実に元へ戻すこと
  （中途半端に残すと縦の積み順が崩れる）。
- **10-1 を revert すると 10-3 の前提が消える**（待ちがフローに戻り縦あふれが再発）。逆順の revert はしない。
- **10-2 は全画面のボタンに触る**。revert 時は `.button` ベースを確実に元へ戻す（他画面に波及するため）。

## 参考: 着手前の事前確認

- **新規依存追加**: なし。素の React/CSS と既存の framer-motion で足りる。
- **エンジン非依存**: `src/engine/` は触らない。`.oxlintrc.json` の `no-restricted-imports` に触れない。
- **既存の hover 実装を再利用**: 残枚数ツールチップ（`hints.css .card-counts` ＋ `Hand.tsx` の
  `.hand-area` 基準）が 10-1 の手本。待ちの算出（`computeWaits`）は再実装しない。
- **カード面の色（桃/青/橙）は情報**。ボタン色分けや横向きでも塗り替えない。
- **既存テストの状態**: Step 9-3 完了時点でユニット 760 件 / E2E 76 件。着手前に `npm test` で現件数を確認。

## 参考: v2 以降で検討する機能

- **待ちオーバーレイのタッチ最適化**（長押しプレビュー・ピン留めの明示トグルなど）
- **効果音・和了演出との連動**（PRD で P2。ボタン押下音など）
- **卓の質感の作り込み**（木目テクスチャ・フェルトの繊維感。Step 9 はグラデのみ）
- **横向きで他家席をさらに簡略化した専用ビュー**（10-3 で足りなければ）
- **アバターの写真フレーム**（第2稿の席プレートの写真枠）
