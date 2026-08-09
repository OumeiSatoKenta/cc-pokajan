# Step 10-2 ゲーム風ボタン — design

## CSS の所在（重要な前提）

Vite は import された全 CSS を**1つのバンドル**に統合するため、どの component が import しても
ルールは実行時にグローバルに効く（build は単一 `index-*.css` を出す）。現状 `.button--primary` /
`.button--ghost` の実体は **table.css**（TableScreen だけが import）にあるが、タイトル/BET/精算/設定
でも効いているのはこのため。

**app 共通のボタン変種は App.css へ集約する**（App.tsx が常時 import＝概念的な所在が正しい）。
在庫が table.css に散っていると「対局画面用のはずが全画面に効く」読み違いを生む。

## トークン（index.css）

`:root`（ライト）と `@media (prefers-color-scheme: dark)` / `:root[data-theme]` に追加:

- `--action-bg`: dark `rgba(0,0,0,.3)` / light `rgba(255,255,255,.62)`
- `--action-border`: dark `rgba(255,255,255,.1)` / light `rgba(0,0,0,.14)`

ボタンのグラデ（緑/赤/金）は**明暗共通**なので token 化せず CSS に直書きする（濃色文字で両テーマ可読）。

## App.css（app 共通ボタン）

- `.button` ベース: `transition: transform .12s ease, border-color .12s ease, color .12s ease` と
  `:active { transform: translateY(1px) }`（全ボタンに押下感）。padding/border/radius/透明背景は現状維持。
- `.button--primary`（**table.css から移設**＋刷新）: `background: linear-gradient(180deg,#f4d78f,#d9a441)`、
  `color:#1b1b22`、`font-weight:700`、`border-color: transparent`、`box-shadow: 0 6px 14px rgb(0 0 0 / .35)`。
- `.button--primary:hover`: 既存の `color:#1b1b22; opacity:.9` を維持（濃色文字のまま）。
- `.button--ghost`（**table.css から移設**）: `color: var(--muted)`（透明背景・`var(--border)` 枠のまま。影なし）。
- `@media (prefers-reduced-motion: reduce) { .button:active { transform: none } }`。

## table.css（対局中の操作エリア）

- `.button--primary` / `.button--ghost` の定義は削除（App.css へ移設）。
- `.button--tsumo`: `background: linear-gradient(180deg,#a8e6c2,#5cb185)`、`color:#1b1b22`、
  `font-weight:700`、`border-color: transparent`、`box-shadow: 0 6px 14px rgb(0 0 0 / .35)`。
- `.button--ron`: `background: linear-gradient(180deg,#ffb3ab,#e0685f)`、他は tsumo と同じ。
- `.button--tsumo:hover` / `.button--ron:hover`: `color:#1b1b22; opacity:.9`（濃色文字を保つ）。
- `.actions`（枠）: `padding`、`background: var(--action-bg)`、`border: 1px solid var(--action-border)`、
  `border-radius: 0.75rem`。`.actions--idle`（min-height だけ）も同じ `.actions` を持つので一緒に枠が付く。
- タイマー色: 既存の `discard` 上書き（`#8ecfa0`）を撤去し `discard` は既定の金へ。
  `.timer[data-timer-kind='declare'] .timer__fill { background: #5cb185 }`（緑）、
  `.timer[data-timer-kind='claim'] .timer__fill { background: #e0685f }`（赤）を追加。
  → ボタンの色分け（ツモ=緑/ロン=赤）とタイマーの色が一致する。

## landscape.css

`.button--primary, .button--ghost` の compact 上書き（padding/font-size）に
`.button--tsumo, .button--ron` を加える（対局中の色分けボタンも横向きで小さくなる）。

## ActionBar.tsx

`item.kind` で class を出し分ける:

- `pass` → `button button--ghost`（現状のまま）
- `declare` → `button button--tsumo`
- `claim` → `button button--ron`

現状は declare/claim とも `button--primary`。分岐は既にあるので className を差し替えるだけ。
`data-testid` は `${item.kind}-button` のまま不変。

## テスト

- 単体（新規 `tests/ui/actionBar.test.tsx`・renderToStaticMarkup）:
  declarable を渡すと `button--tsumo` ＋ `declare-button`、claimable で `button--ron` ＋ `claim-button`、
  pass で `button--ghost` ＋ `pass-button` が出る。**色分けの配線をここで固定**（class を primary に
  戻すと落ちる）。ラベル（役名＋点数、見送る）も確認。
- コントラストは CSS 値の設計で担保（濃色文字）。見た目は目視（全画面波及のため）。
- 既存 E2E（`declare-button`/`claim-button`/`pass-button` の testid）はそのまま通る（testid 不変）。
- タイマー色は data 属性セレクタのテストのみで、色 assert は無い＝安全。

## リスク

- **全画面波及**: `.button` base に `:active` transform を足すと全ボタンが対象。塗りつぶし化はしないので
  破綻は少ないが、タイトル/BET/精算/設定の目視が必要（報告で明記）。
- 9-1 の教訓（accent 地に白は不可読）を踏まえ、緑/赤/金いずれも**濃色文字**で AA を検算済み。

## ⚠️ カスケード（3軸レビューで判明・修正済み）

**当初の想定は逆だった。** `App.tsx` は `import './App.css'` を import リストの**最後**（20行目）に
置くため、バンドルでは App.css の `.button` ベースが table.css の `.button--tsumo`/`--ron` より**後**に
来る。単一クラス同士（詳細度 0,1,0）は**後勝ち**なので、ベースの `background`/`color`/`border-color` と
`font: inherit`（font-weight を暗黙リセット）が変種を丸ごと潰し、**影だけ残る幽霊ボタン**になっていた
（実ブラウザの getComputedStyle で確認）。単体テストは class 名しか見ないため素通り。

- **対処**: 変種を **`.button.button--tsumo` / `.button.button--ron`** と複合クラス（0,2,0）で書き、
  import 順に依存せず勝たせる（9-1 の `.card--clickable.card--waiting` と同じ手）。hover も
  `.button.button--*:hover`（0,3,0）にして `.button:hover{color:var(--accent)}`（0,2,0）に勝たせ、
  hover でも濃色文字を保つ（怠ると緑/赤地に金＝不可読）。
- **landscape.css の compact 上書きも同根で無効だった**（9-3 から primary/ghost で潜在）。同じく
  `.button.button--*` に直し、4クラスまとめて解消。
- **`.button--primary`/`.button--ghost` は無害**（App.css 内で `.button` の後にあり後勝ちで勝つ）。
- 回帰ガード: 実アプリのスタイルシート下でボタンを注入し `backgroundImage` に `gradient` が乗ることを
  E2E で実測（`table.spec.ts`）。「壊したら落ちる」形にした。
