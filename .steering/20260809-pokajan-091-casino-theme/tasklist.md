# Step 9-1 カジノ風テーマの全面刷新 — tasklist

## タスク

- [x] T1: `src/index.css` の共通テーマ変数を差し替え（dark/light）＋新変数追加
      （`--gold-soft` / `--felt` / `--felt-edge` / `--rim` / `--slot` /
       `--sym-bg` / `--card-back` / `--card-back-edge`）
      ※ `--rim-top` はレビューで「未使用」の指摘を受け導入取りやめ（木縁ハイライトは box-shadow の inset で表現）
- [x] T2: `src/App.css` のカード裏（`.card--back`）を `--card-back` / `--card-back-edge` に
- [x] T3: `src/App.css` の待ち札（`.card--waiting`）を白熱色＋グロー＋恒常持ち上げに。面の色は不変
      ＋ホバー衝突対策 `.card--clickable.card--waiting:hover`（詳細度で hover と reduced-motion を上書き）
- [x] T4: `src/ui/screens/TableScreen.tsx` に羅紗ラッパ `.table__felt` を1枚追加（board を包む）
- [x] T5: `src/ui/board.css` に木縁（`.table`）＋羅紗（`.table__felt`）のスタイル、
      席（`.seat`）・中央（`.board`）背景を `var(--slot)` に
- [x] T6: `src/ui/table.css` の `.hand` に持ち上げ分の padding-top（0.9rem）、
      `.table__mine` 背景を `var(--slot)` に
- [x] T7: `hints.css` の旧ピンク残り（`.wait` 背景）を `--sym-bg` に。
      併せてレビュー指摘の `.wait__same` 白文字（金地で低コントラスト）を濃色 `#1b1b22` に
- [x] T8: 回帰テスト追加（`tests/ui/cardVisual.test.tsx`）:
      待ち札が面の色クラスを保持する（DOM 不変条件の固定）
- [x] T9: 自動ゲート（lint / typecheck / test 750件 / build / format:check）＋ `npx playwright test` 75件
- [x] T10: ブラウザ描画確認（Playwright が実ブラウザで全画面を描画し 75件 PASS。
      ※ claude-in-chrome の手動スクショは、常時アニメーションでページが idle にならず取得不可。
        他画面の見た目の最終目視はユーザーに委ねる）

## 進捗

全タスク完了。実装 → 3軸レビュー → 指摘反映 → 全ゲート再通過（750 / 75）まで到達。

## 振り返り（2026-08-09 完了）

### 計画と実績の差分

- **`--rim-top` を導入しなかった**。design.md では木縁上部のハイライトに `--rim-top`（グラデ）を
  使う想定だったが、`box-shadow` にグラデーションは使えず、実装は 1px の inset ハイライトで代替。
  変数だけ残すと死に変数になるため index.css から削除し、design.md も修正した。
- **待ち札の恒常持ち上げに詳細度の穴があった**（3軸レビュー全員が一致指摘＝実バグ）。
  `.card--waiting`(0,1,0) は `.card--clickable:hover`(0,2,0) に負け、テンパイ中に待ち札へ
  マウスを乗せる（残枚数を読む主要操作）と持ち上げが -12px→-6px に沈み、reduced-motion では
  消えていた。`.card--clickable.card--waiting:hover`(0,3,0) を足して解消。
  **これはユニット（renderToStaticMarkup は CSS 非適用）でも既存 E2E でも素通りしていた**。
- **`.wait__same` バッジのコントラスト劣化**。accent がピンク→金になり、金地に白は約2.25:1で
  WCAG 未達。accent 地の他要素（`.tag` / `.button--primary` / `.board__member--held`）は
  すべて濃色文字なので、それに合わせ `#1b1b22` に統一。

### 学んだこと

- **アクセントカラーを変えると、そのアクセント地に載る文字色を全部見直す必要がある**。
  今回は `.wait__same` だけが白文字のまま取り残されていた。「accent 地の文字は濃色」という
  パターンが既に他要素で確立していたのに、1箇所だけ外れていた（＝パターンの検算が要る）。
- **CSS の詳細度衝突は、既存の hover/reduced-motion ルールと新規の静的 transform が
  同じプロパティを奪い合うと起きる**。恒常表示を狙う transform は、hover 側の詳細度を
  必ず確認する。ユニットテストでは捕まらないので、この種は設計時に潰す。
- **常時アニメーションするページは claude-in-chrome の injection 型スクショと相性が悪い**
  （document_idle に到達せずタイムアウト）。目視は Playwright の描画通過で代替できるが、
  「見た目の良し悪し」の最終判断は人の目が要る。

### 次回（9-2）への申し送り

- **`board.css` が 425 行**（計画の自己申告閾値 400 を超過。CLAUDE.md の Step 3 と同じ兆候）。
  9-1 では分割しない判断とした——9-2 で河件数ラベル、9-3 で横向きレイアウトが同ファイルに
  入る計画で、そこで「卓の外枠（rim/felt）／卓内配置／レスポンシブ」の自然な切れ目が出る。
  **9-3 着手時に分割を必ず実施する**（先送りの再発を防ぐため、ここに明記）。
- **`TableScreen.tsx` は 293 行**。9-2 でヘッダー（連続和了・BET）が入ると 300 行を超えうる。
  ヘッダーは最初から別コンポーネント（例 `TableHeader.tsx`）に切り出して足すこと。
- **CSS レベルの見た目（translateY / 色）の回帰は現状ユニットで検証できない**。
  9-3 で横向きを入れる際、待ち札の持ち上げが hover/reduced-motion で保たれることを
  Playwright の `getComputedStyle(...).transform` で1件固定すると、この種のバグを機械で捕まえられる。
