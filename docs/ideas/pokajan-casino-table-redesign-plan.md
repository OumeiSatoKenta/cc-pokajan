# ポカジャン 対局画面 カジノ風テーマ移植（第2稿デザイン反映）計画書

## 背景（Context）

外注（他AI）に依頼したデザインの第2稿
（`麻雀ゲームのテーブルデザイン.zip` 内 `ポカジャン 対局画面 第2稿.dc.html`）が届いた。

第1稿は **実在作品名・存在しない機能（供託/局/親/ONLINE）・待ち札を緑で塗ってカードの色情報を壊す**、
という理由で差し戻された（`review-01.md`）。第2稿はその指摘をすべて解消した完成版で、
盤面を **木縁＋羅紗（フェルト）＋金基調のカジノ卓** に刷新するもの。

詳細レビューの結論:

- **構造は現行実装とほぼ一致**（デザイナーに `data.md` / `review-01.md` という正確な一次資料を
  渡した効果）。3×3卓・4方向・河・グループ進捗・待ち・状態依存の操作バー・タイマー3種は既に実装済み。
- 差分の大半は **見た目（テーマ）**。第2稿が見せる情報（河/待ち/残N/連続和了/BET）は
  すべて既存の状態から出せる。
- したがって **エンジン層（`src/engine/`）への変更はゼロ**。
  CLAUDE.md の「エンジンは React/config 非依存」を崩さない。
- 作業の実体は **inline-style プロトタイプ → 既存 React+CSS への「翻訳」**。

### 確定した方針

- テーマは **全画面に適用**（タイトル/BET/精算/設定も金・羅紗基調に統一）
- 重め項目もすべて採用: **D 河5枚固定 / E ヘッダー(連続和了・BET) / F 横向きレイアウト / G 待ちチップ**
- 小粒（A テーマ本体 / B カード裏 / C 待ち札強調）は必ず含む

### プロトタイプの出典

`ポカジャン 対局画面 第2稿.dc.html` の
`THEMES.dark` / `THEMES.light` / `SIZE.wide|land|narrow` に全変数値がある。
**視覚仕様書として参照する。そのままバンドルできるコードではない。**

---

## すでに実装済み＝作り直し不要（翻訳先の対応表）

| 第2稿の要素 | 現行の実装箇所 |
| --- | --- |
| 3×3 卓グリッド・4方向配置 | `board.css .table__board`（grid-template-areas） |
| 4人分の河（小カード） | `DiscardPile.tsx` |
| グループ進捗（1/4・所持金塗り・記号） | `board.css .board__group*` / `BoardCenter.tsx` |
| 待ち（残0淡色＋取消線・生存優先→点数降順・6件+他N件） | `WaitPanel.tsx`（思想まで一致） |
| 操作の状態依存（idle は案内のみ / 宣言・割り込み時のみボタン＋役名＋点数） | `ActionBar.tsx` + `actionBarItems.ts` |
| タイマー3種（打牌/宣言/割り込み）の kind とラベル | `TimerBar.tsx`（`data-timer-kind` 実装済み） |
| カード：色グラデ・BONUS・記号(左上/右下)・待ち枠・画像contain | `App.css .card*` / `CardView.tsx` |

---

## 変更内容（項目 A〜G）

### A. テーマ全面刷新（コア・全画面波及）— `src/index.css`

`:root` と `@media (prefers-color-scheme: light)` の共通変数を差し替え、新変数を追加する。
波及先: `App.css` / `board.css` / `table.css` / `win.css` / `hints.css` / `casino.css` / `settings.css`
（すべて `var()` 経由なので、多くは自動追従）。

既存 → 第2稿の対応（dark、値は THEMES より）:

| 既存変数 | dark 値 | 役割 |
| --- | --- | --- |
| `--bg` | `#100c09` | 卓外の背景 |
| `--text` | `#f2ece1`（=ink） | 本文 |
| `--muted` | `#a99f8d`（=ink2） | 副次テキスト |
| `--accent` | `#d9a441`（=gold・ピンクから金へ） | 強調（全画面） |
| `--panel` | `rgba(255,255,255,.04)` | パネル面 |
| `--border` | `rgba(255,255,255,.12)`（=panelBd） | 枠線 |

新規追加（kebab-case に統一）:
`--gold-soft` / `--felt`（羅紗の放射グラデ）/ `--felt-edge` / `--rim`（木縁グラデ）/ `--rim-top` /
`--slot`（内側の窪み）/ `--sym-bg` / `--card-back`（赤斜線）/ `--card-back-edge`。
light 側の値も `THEMES.light` から入れる。
`--accent` を金へ移すと `card--pink` とアクセントの色被りが解消する（副次効果）。

### B. カード裏 — `src/App.css .card--back`

灰の斜線 → `var(--card-back)`（赤 `#8d2536`/`#761d2c` の斜線）＋ `var(--card-back-edge)` の縁。

### C. 待ち札の強調 — `src/App.css .card--waiting`

`#ffd34d` → `#ffe58a` ＋外側グロー、さらに **恒常的に translateY(-12px)** で持ち上げる
（現行は hover 時のみ浮く）。**面の色は絶対に塗り替えない**（同色役の判定情報のため）。
`@media (prefers-reduced-motion: reduce)` で持ち上げの transition を無効化。

### D. 河を「直近5枚」固定長に — `src/ui/components/DiscardPile.tsx`（＋ `board.css`）

- 表示を `cards.slice(-5)` に制限。5枚超で小さな件数ラベル（例「直近5枚 / 計24」、5枚以下は「N枚」）。
  現行は「見出しを持たない」方針なので、**名前見出しではなく件数ラベル**として最小限に足す
  （review の「見えていない分はラベルに出す」に沿う）。
- 直前の1枚に白熱色（`#ffe58a`）の枠＋グローを付けロン対象を明示（`isLast` の props を追加）。
- **`残N` は不変**: `src/engine/unseen.ts` は表示枚数と無関係に全枚を数えるため、
  5枚に絞っても残枚数計算に影響しない（CLAUDE.md の設計どおり）。

### E. ヘッダー（連続和了・BET）— `src/ui/screens/TableScreen.tsx` ＋ `src/App.tsx`

- TableScreen 上部に木縁色のヘッダー行を新設: 「ポカジャン / CARD MAHJONG」＋連続和了ピップ＋BET。
- **BET の配線**: `App.tsx` は `state.bet`（`appReducer` の `bet: number | null`）を保持しているが
  TableScreen に渡していない。`bet` prop を1本追加して配る（`src/App.tsx` の `<TableScreen>`）。
- **連続和了は嘘のUIを作らない**: 値は `loop.state.chainCount` / 上限 `rules.maxChainDeclare`。
  ただし `chainCount` は「連続**宣言**中の回数」で解決後 0 リセットされる
  （`engine/game.ts` / `turnFlow.ts`）。design.md 作成時に意味を確定し、
  (a) ラベルを実態に合わせる（「連続和了 X/8」が正しいか）、または
  (b) `chainCount>0` のときだけ出す、のどちらかにする。
  **意味が一致しない場合はこのバッジだけ保留**し、BET は先行して入れる。

### F. 横向きレイアウト（844×390）— `src/ui/table.css` ＋ `src/ui/board.css`

- 新規メディアクエリ `@media (orientation: landscape) and (max-height: 480px)`（横持ちスマホ）。
- 下段を縦積み → 横3分割「待ち｜手札8枚｜操作」に。手札は中央、操作は右手側。
- グループ進捗はチップ → **人数分のドット**（所持=金）に密度を下げる（第2稿 SIZE.land の `grpDots`）。
- 待ちは役名列を落として色ドット・名前・残数・点数の4項目に（`waitYaku:'none'`）。
- 数値は第2稿 `SIZE.land`（midCols `132px 1fr 132px` など）を寸法の指針に使う。
- **最も重い項目**。実機（または `emulateMedia` での横向きエミュレーション）で目視必須。

### G. 待ちチップの見た目 — `src/ui/hints.css`（＋必要なら `WaitPanel.tsx` の class）

表形式 → 色ドット＋金枠の丸チップ。残0は不透明度42%＋取消線（**振る舞いは既実装なので見た目のみ**）。
色ドットは pink/blue/orange の deep 色（第2稿 `CLR.*.dot`）。

---

## エンジン層への影響

**なし。** `src/engine/` は一切触らない。読むだけで足りる値:
`state.chainCount`（連続和了）/ `rules.maxChainDeclare`（上限）/ `unseen`（残N）。

---

## 対象ファイル一覧

| ファイル | 変更 |
| --- | --- |
| `src/index.css` | **A**: 共通テーマ変数（dark/light）差し替え＋新変数追加 |
| `src/App.css` | **B/C**: カード裏・待ち札強調。カード面の色は現状維持 |
| `src/ui/board.css` | **A/D/F**: 木縁・羅紗ラッパ、席プレート、河件数ラベル、横向き |
| `src/ui/table.css` | **A/E/F**: ヘッダー、手札の持ち上げ、操作バー、タイマー3色、横向き3分割 |
| `src/ui/win.css` / `hints.css` / `casino.css` / `settings.css` | **A/G**: 新変数での微調整（多くは自動追従） |
| `src/ui/screens/TableScreen.tsx` | **E**: 木縁/羅紗ラッパ＋ヘッダー、`bet` prop 受け取り |
| `src/App.tsx` | **E**: `<TableScreen bet={state.bet} />` を配線 |
| `src/ui/components/DiscardPile.tsx` | **D**: 直近5枚 slice ＋件数ラベル ＋直前札の強調 |
| `src/ui/components/WaitPanel.tsx` | **G**: 丸チップ用の class 付与（振る舞いは不変） |
| `src/ui/components/TimerBar.tsx` | **F/A**: 3色は CSS 側。必要なら data 属性の確認のみ |

---

## 進め方（CLAUDE.md 準拠・段階分割）

`Skill('steering')` モード1で `.steering/20260809-casino-table-redesign/`
（`requirements.md` / `design.md` / `tasklist.md`）を作成してから着手する。
**実装前のドキュメントレビューを省略しない**（Step 3 の教訓）。E の連続和了の意味確定は design.md で行う。

段階（各段の終わりに検証ゲートを通す）:

1. **テーマ変数の差し替え**（A・B・C）＝ 見た目の8割。まず「卓に見える」を達成
2. **河5枚固定＋ヘッダー**（D・E）＝ 情報密度と上部の整理
3. **横向きレイアウト＋待ちチップ**（F・G）＝ 実機確認を伴う仕上げ

各段で `wc -l` を測り、CSS が肥大したら分割する（`board.css` は既に 406 行）。

---

## テスト戦略

- **既存テストへの影響は軽微**: D の河5枚は既存テストが ≤2 枚しか使わず
  （`tableLayout.test.tsx:104`、E2E `table.spec.ts:242` は 0→1）、5枚上限に触れない。
  4方向配置（`table.spec.ts` の座標検査）と「4人全員が河を持つ」も維持される。
- **新規回帰テスト（わざと壊して落ちることを確認）**:
  - D: 河が6枚以上で表示は5枚に留まり件数ラベルが出る／`残N` は全枚数のまま
    （`unseen` に影響しないことを別実装で突き合わせ）
  - E: BET がヘッダーに出る／連続和了バッジの表示条件
  - F: 横向き（`page.emulateMedia({...})` で orientation を届かせ DOM 属性で到達確認。
    **偽陽性の教訓**: `reducedMotion` は `test.use` では届かない）
- 進行の観測は **山札残** で行い、ボタンやタイマー表示では観測しない（Step 8-2 の教訓）。
- E2E の進行手順は `tests/e2e/helpers/table.ts` の1本だけを直す。

## 検証ゲート（完了前に全通過）

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
```

加えて **実機/ブラウザで各状態を目視** する（`/run` またはブラウザ自動化）:
残0の待ち / 写真入りカード / 375px縦 / 横向き844×390 / ライトテーマ / 0点の席 / 連続和了。
`autoplay.test.ts` の不変条件（点数保存則・カード保存則・手札枚数）が最初の砦。

---

## リスク・注意

- **F（横向き）が唯一の重い項目**。実機目視必須。外すと縦積みのまま。
- **E の連続和了は意味確認が先**（供託/ONLINE と同じ轍を踏まない）。BET は先行可。
- **全画面テーマ**なので、卓以外（casino/settings/title/result）の目視も範囲に入る。
- カード**面**の色（桃/青/橙）は情報。強調・写真・テーマのいずれでも塗り替えない。
- 作業に使った `tmp-design.zip`（プロジェクト直下・1.6MB）は実装とは無関係なので削除してよい。
