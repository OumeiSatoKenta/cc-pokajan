# ポカジャン 対局画面 カジノ風テーマ移植 — `/add-feature` 実行コマンド一覧

本書は [pokajan-casino-table-redesign-plan.md](pokajan-casino-table-redesign-plan.md) の実装を
3 つの独立した `/add-feature` コマンドに分割したものである。
各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

Step 1〜6 のコマンドは [pokajan-add-feature-commands.md](pokajan-add-feature-commands.md)、
Step 7 は [pokajan-mahjong-board-add-feature-commands.md](pokajan-mahjong-board-add-feature-commands.md)、
Step 8 は [pokajan-presentation-and-counts-add-feature-commands.md](pokajan-presentation-and-counts-add-feature-commands.md) にある。
本書は Step 8 完了後の**見た目刷新**（第2稿デザイン反映）で、便宜上 Step 9 として通し番号を振る。

**重要**: 各 `/add-feature` コマンドのプロンプトには
「参照ドキュメント: `docs/ideas/pokajan-casino-table-redesign-plan.md`」が含まれており、
実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**: Step 1〜8（+ 4b / 6b）が完了していること。
Step 8-2 完了時点でユニット 748 件 / E2E 75 件が通る（着手前に `npm test` で現件数を確認する）。
**エンジン層（`src/engine/`）は本機能で一切変更しない。**

## 実行順の全体像

```
Step 9-1: カジノ風テーマの全面刷新（A・B・C）
   ↓   ← ★ 全画面が金・羅紗基調になり、卓が木縁＋フェルトに見える
Step 9-2: 河の直近5枚固定 ＋ ヘッダー（D・E）
   ↓   ← ★ 河で卓が縦に伸びなくなり、連続和了/BET が卓上部に出る
Step 9-3: 横向きレイアウト ＋ 待ちチップ（F・G）
       ← ★ 横持ちスマホで卓が破綻せず遊べる（完成）
```

**ポイント**:

- **9-1 → 9-2 → 9-3 の順は動かせない**。9-1 が木縁・羅紗のラッパ要素（`.table__frame` /
  `.table__felt`）を `TableScreen` に足し、9-2 のヘッダーはその枠の中に入る。
  9-3 の横向き 3 分割は、9-2 で確定した河とヘッダーの最終形を前提に組む。
- **9-1 と 9-2 を分ける理由**は、9-1 が「`var()` 経由でほぼ自動追従する見た目だけの変更」なのに対し、
  9-2 が「`DiscardPile` の表示枚数を変える（振る舞いに近い）」「`App.tsx` → `TableScreen` に
  `bet` を配線する」構造変更を含むから。混ぜると E2E が落ちたときに、
  テーマの問題か配線の問題かを切り分けられなくなる。
- **9-3 が唯一の重い項目**（新規メディアクエリ・下段 3 分割・実機目視）。
  切り戻しの重さが 9-1/9-2 と違うので独立させる。
- 各ステップ後に
  `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
  と `npx playwright test` が PASS することをゲートとする。

---

## Step 9-1: カジノ風テーマの全面刷新（A・B・C）

```
/add-feature ポカジャン カジノ風テーマの全面刷新: index.css の共通テーマ変数を木縁＋羅紗＋金基調に差し替え（ピンク→金、羅紗・木縁・窪みの新変数を追加）、全画面に波及させる。カード裏を赤斜線、待ち札の強調を白熱色＋恒常的な持ち上げにし、TableScreen に木縁・羅紗のラッパ要素を足す。カード面の色（桃/青/橙）は情報なので塗り替えない。参照ドキュメント: docs/ideas/pokajan-casino-table-redesign-plan.md (Step 9-1 範囲のみ実装、Step 8 完了前提)
```

**実装内容**:

- 修正: `src/index.css`
  - `:root` と `@media (prefers-color-scheme: light)` の共通変数を差し替え。値は第2稿の
    `THEMES.dark` / `THEMES.light` から採る（dark: `--bg #100c09` / `--text #f2ece1` /
    `--muted #a99f8d` / `--accent #d9a441` / `--panel rgba(255,255,255,.04)` /
    `--border rgba(255,255,255,.12)`）
  - 新規変数（kebab-case に統一）: `--gold-soft` / `--felt`（羅紗の放射グラデ） / `--felt-edge` /
    `--rim`（木縁グラデ） / `--rim-top` / `--slot`（内側の窪み） / `--sym-bg` /
    `--card-back`（赤斜線） / `--card-back-edge`。light 側の値も入れる
  - **`--accent` を金へ移すと `card--pink` とアクセントの色被りが解消する**（副次効果）
  - `--panel` / `--border` / `--accent` / `--muted` は `board.css` / `table.css` / `win.css` /
    `hints.css` / `casino.css` / `settings.css` / `App.css` が `var()` で参照しているため**自動追従**する
- 修正: `src/App.css`
  - `.card--back`: 灰の斜線 → `var(--card-back)`（赤 `#8d2536`/`#761d2c`）＋ `var(--card-back-edge)` の縁
  - `.card--waiting`: `#ffd34d` → `#ffe58a` ＋外側グロー、さらに**恒常的に `translateY(-12px)` で持ち上げ**
    （現行は hover 時のみ浮く）。**面の色は塗り替えない**
  - `@media (prefers-reduced-motion: reduce)` に持ち上げ transition の無効化を追加
- 修正: `src/ui/board.css`
  - 卓を木縁（`--rim`）＋羅紗（`--felt`）で見せるためのラッパ用スタイル（`.table__frame` /
    `.table__felt`）を追加。席プレート・グループパネル・中央スロットを `--slot` / `--sym-bg` で調整
- 修正: `src/ui/screens/TableScreen.tsx`
  - `.table` の中身を木縁ラッパ（`.table__frame`）＋羅紗ラッパ（`.table__felt`）で包む。
    **既存の `.table__board` グリッドと `data-testid`・`aria-label` は変えない**
    （4方向配置・河・座標検査の E2E を壊さないため）
- 修正: `src/ui/table.css` / `src/ui/win.css` / `src/ui/hints.css` / `src/ui/casino.css` / `src/ui/settings.css`
  - 新変数を使う箇所の微調整のみ（多くは自動追従。ハードコード色が残っていれば `var()` に寄せる）
- 新規テスト:
  - `tests/ui/theme.test.tsx`（または既存 `cardVisual.test.tsx` に追加） — カード裏が新クラス/変数を
    参照する / `.card--waiting` が面の色クラス（`card--pink` 等）を保持したまま強調が付く
    （**面の色を殺していないこと**を明示的に検査）

**動作確認**:

- 自動ゲート一式 PASS（`npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`）
- `npx playwright test` PASS（4方向配置・河の座標検査が維持されること）
- ブラウザ:
  1. 卓が木縁＋羅紗＋金基調に見えること
  2. カード面の桃/青/橙が判別できること（同色役の情報が生きている）
  3. 待ち札が白熱色＋グロー＋持ち上げで強調され、**面の色は残っている**こと
  4. カード裏が赤斜線になっていること
  5. **タイトル / BET / 精算 / 設定画面も金・羅紗基調に統一**されていること
  6. ライトテーマ（`prefers-color-scheme: light`）でも破綻しないこと
  7. 視覚効果を減らす設定で待ち札の持ち上げの動きが消えること

**依存**: なし（Step 8 完了が前提）

---

## Step 9-2: 河の直近5枚固定 ＋ ヘッダー（D・E）

```
/add-feature ポカジャン 河の直近5枚固定とヘッダー: 各席の河を直近5枚だけ固定長で表示し、5枚超は件数ラベル（直近5枚/計N）を出す。直前の1枚を白熱色で強調してロン対象を示す。卓上部にヘッダー（連続和了ピップ・BET）を新設し、App.tsx から bet を TableScreen へ配線する。残枚数の算出は全枚数のまま変えない。参照ドキュメント: docs/ideas/pokajan-casino-table-redesign-plan.md (Step 9-2 範囲のみ実装、Step 9-1 完了前提)
```

**実装内容**:

- 修正: `src/ui/components/DiscardPile.tsx`
  - 表示を `cards.slice(-5)` に制限。5枚超で小さな件数ラベル（例「直近5枚 / 計24」、5枚以下は「N枚」）
    を出す。現行は「見出しを持たない」方針なので、**名前見出しではなく件数ラベル**として最小限に足す
  - 直前の1枚（`slice` 後の末尾）に白熱色（`#ffe58a`）の枠＋グローを付ける（`isLast` を `CardView` へ）。
    **CardView 側に `isLast`（強調）を足す**が、面の色は塗り替えない
  - **`残N` は不変**: `src/engine/unseen.ts` は表示枚数と無関係に全枚を数えるため、5枚に絞っても
    残枚数計算に影響しない（数え落としを 0 で埋めないという 8-2 の設計を維持）
- 修正: `src/ui/board.css`
  - 河の件数ラベル・直前札の強調のスタイル。固定長になった河の高さを `min-height` で確保
- 修正: `src/App.tsx`
  - `<TableScreen>` に `bet={state.bet}` を渡す（`appReducer` の `bet: number | null`）
- 修正: `src/ui/screens/TableScreen.tsx`
  - `bet` prop を受け取り、9-1 で足した木縁ラッパ内にヘッダー行を新設
    （「ポカジャン / CARD MAHJONG」＋連続和了ピップ＋BET）
  - **連続和了は嘘のUIを作らない**: 値は `loop.state.chainCount` / 上限 `rules.maxChainDeclare`。
    `chainCount` は「連続**宣言**中の回数」で解決後 0 リセットされる（`engine/game.ts` / `turnFlow.ts`）。
    実装時に意味を確定し、(a) ラベルを実態に合わせる か (b) `chainCount>0` のときだけ出す のどちらかにする。
    **意味が一致しない場合はこのバッジだけ保留し、BET は先行して入れる**（供託/ONLINE と同じ轍を踏まない）
- 新規テスト:
  - `tests/ui/discardPile.test.tsx` — 河が6枚以上で描画される `river-card` が5枚に留まる /
    件数ラベルが「直近5枚 / 計N」になる / 直前の1枚に強調クラスが付く /
    5枚以下では件数ラベルが「N枚」になる
  - `tests/ui/tableLayout.test.tsx`（既存に追加） — ヘッダーに BET が出る /
    連続和了バッジの表示条件（採用した方針どおり）
  - **突き合わせ**: `tests/engine/unseen.test.ts` は変更不要だが、河を5枚に絞っても
    `残N` が変わらないことを UI 側テストで1件確認する（`unseen` は全枚数のまま）

**動作確認**:

- 自動ゲート一式 PASS
- `npx playwright test` PASS（`my-river` の 0→1 観測・「4人全員が河を持つ」が維持されること）
- ブラウザ:
  1. 河が5枚を超えても卓の高さが変わらず、件数ラベルが出ること
  2. 直前の捨て札が白熱色で強調されること（ロン対象）
  3. ヘッダーに BET が出ること
  4. 連続和了バッジが採用方針どおりに出る/出ないこと（嘘のUIになっていないこと）
  5. 河を大量に捨てても待ちの「残N」が全枚数基準で正しいこと

**依存**: Step 9-1（木縁ラッパ `.table__frame` が無いとヘッダーの置き場がない）

---

## Step 9-3: 横向きレイアウト ＋ 待ちチップ（F・G）

```
/add-feature ポカジャン 横向きレイアウトと待ちチップ: 横持ちスマホ向けに横向きメディアクエリを追加し、下段を「待ち｜手札8枚｜操作」の横3分割に、グループ進捗を人数分のドットに、待ちを役名列を落とした4項目に密度を下げる。待ち一覧を色ドット＋金枠の丸チップの見た目にする（残0淡色・6件上限の振る舞いは既実装なので見た目のみ）。参照ドキュメント: docs/ideas/pokajan-casino-table-redesign-plan.md (Step 9-3 範囲のみ実装、Step 9-1・9-2 完了前提)
```

**実装内容**:

- 修正: `src/ui/table.css` / `src/ui/board.css`
  - 新規メディアクエリ `@media (orientation: landscape) and (max-height: 480px)`（横持ちスマホ）
  - 下段（`.table__mine` まわり）を縦積み → 横3分割「待ち｜手札8枚｜操作」に。手札は中央、操作は右手側
  - グループ進捗をチップ → **人数分のドット**（所持=金）に密度を下げる（第2稿 `SIZE.land` の `grpDots`）
  - 寸法は第2稿 `SIZE.land`（midCols `132px 1fr 132px`、カード寸法など）を指針に使う
- 修正: `src/ui/hints.css`（＋必要なら `src/ui/components/WaitPanel.tsx` の class 付与）
  - 待ちを表形式 → 色ドット＋金枠の丸チップに。残0は不透明度42%＋取消線（**振る舞いは既実装、見た目のみ**）
  - 色ドットは pink/blue/orange の deep 色（第2稿 `CLR.*.dot`）
  - 横向きでは役名列を落として色ドット・名前・残数・点数の4項目に（`waitYaku:'none'`）
- 新規テスト:
  - `tests/e2e/landscape.spec.ts` — `page.emulateMedia()` で横向きをページへ届かせ、
    **到達したこと自体を DOM 属性で確認**してから 3 分割レイアウトを検査する
    （**7-5 の教訓**: `test.use({ reducedMotion })` はこの構成でページに届かない。偽陽性を作らない）
  - `tests/ui/waitPanel.test.tsx`（既存に追加） — 丸チップの class / 横向きで役名列が落ちること
- 進行の観測は**山札残**で行い、ボタン（見送る等）やタイマー表示では観測しない（8-2 の教訓）。
  E2E の進行手順は `tests/e2e/helpers/table.ts` の1本だけを直す

**動作確認**:

- 自動ゲート一式 PASS
- `npx playwright test` PASS
- ブラウザ（横持ちエミュレーション + 可能なら実機）:
  1. 横向き 844×390 で卓が破綻せず、下段が「待ち｜手札｜操作」に並ぶこと
  2. グループ進捗がドット表示になり、所持が金で分かること
  3. 待ちが丸チップになり、残0が淡く落ちていること
  4. 縦 375px（既存の1列積み）が引き続き破綻しないこと
  5. `wc -l src/ui/*.css` を測り、肥大していれば分割すること（`board.css` は既に 406 行）

**依存**: Step 9-1, 9-2（ヘッダーと河の最終形の上に横向きを組む）

---

## 参考: 各ステップ完了時点で何が動くか

| Step     | 動く状態                                                                       |
| -------- | ------------------------------------------------------------------------------ |
| 9-1 完了 | ★ 全画面が金・羅紗基調。卓が木縁＋フェルトに見え、カード裏・待ち札が刷新される   |
| 9-2 完了 | ★ 河が5枚固定で卓が伸びず、連続和了/BET が卓上部に出る                          |
| 9-3 完了 | ★ 横持ちスマホで卓が破綻せず遊べる（完成）                                      |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、問題発生時は該当ステップの PR を revert するだけで回復する。
ただし以下に注意。

- **9-2 を revert する場合、`App.tsx` の `bet` 配線も同時に戻すこと。** `TableScreen` 側の
  `bet` prop だけ残すと型エラーになる（必須 prop にした場合）。任意 prop にしておけば片方戻しでも通る
- **9-3 を revert しても 9-1/9-2 は無傷**（9-3 は横向きメディアクエリと待ちチップの見た目だけで、
  縦レイアウトと河・ヘッダーの振る舞いには触れない）
- **9-1 を revert すると 9-2/9-3 の木縁ラッパの前提が消える**ため、逆順の revert はしない
  （9-3 → 9-2 → 9-1 の順で戻す）

## 参考: 着手前の事前確認

- **新規依存追加**: なし。既存の CSS と framer-motion で足りる
- **エンジン非依存**: `src/engine/` は読むだけ（`state.chainCount` / `rules.maxChainDeclare` / `unseen`）。
  `.oxlintrc.json` の `no-restricted-imports` に触れる変更はしない
- **連続和了の意味確定**（9-2）: `chainCount` が「連続和了 X/8」として正しいか、
  design.md で確定してから実装する。不一致ならバッジは保留し BET のみ先行
- **カード面の色は情報**: 強調・写真・テーマのいずれでも桃/青/橙を塗り替えない
- **既存テストの状態**: Step 8-2 完了時点でユニット 748 件 / E2E 75 件。着手前に `npm test` で現件数を確認
- **作業に使った `tmp-design.zip`**（プロジェクト直下・1.6MB）は実装と無関係なので削除してよい

## 参考: v2 以降で検討する機能

- **河のタップで全履歴シートを開く**（第2稿の「全件を見たいときは河をタップ」。9 では直近5枚のみ）
- **待ちが多いとき（60件）の一覧シート**（メンバー×3色の表。9-3 は上位6件＋他N件のまま）
- **効果音・和了演出との連動**（PRD で P2）
- **卓の質感の作り込み**（木目テクスチャ・フェルトの繊維感。9 はグラデのみ）
- **アバターの写真フレーム**（第2稿の席プレートの写真枠。9 は円形のまま）
