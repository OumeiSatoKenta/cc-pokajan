# Step 9-1 カジノ風テーマの全面刷新 — design

## 方針

第2稿はプロトタイプ（`x-dc`/inline-style）で、そのままのコードではない。**視覚仕様書**として
`THEMES.dark` / `THEMES.light` の値を採り、既存の CSS 変数体系に翻訳する。
現行は `--bg / --panel / --border / --text / --muted / --accent` の6変数を `var()` で
全 CSS が参照しているため、**変数を差し替えるだけで大半が自動追従**する。

## 変数マッピング（既存名を維持し、新変数を追加）

既存変数の役割の対応（dark 値は第2稿 THEMES.dark、light 値は THEMES.light）:

| 既存変数 | dark | light | 対応（第2稿） |
| --- | --- | --- | --- |
| `--bg` | `#100c09` | `#e9e2d4` | bg |
| `--text` | `#f2ece1` | `#22201b` | ink |
| `--muted` | `#a99f8d` | `#6f6759` | ink2 |
| `--accent` | `#d9a441` | `#9a6d16` | gold（ピンクから金へ） |
| `--panel` | `rgba(255,255,255,.06)` | `rgba(255,255,255,.72)` | panel（dark はやや上げて他画面での可読性を確保） |
| `--border` | `rgba(255,255,255,.14)` | `rgba(0,0,0,.16)` | panelBd |

新規追加変数（kebab-case）:

| 新変数 | dark | light | 用途 |
| --- | --- | --- | --- |
| `--gold-soft` | `rgba(217,164,65,.45)` | `rgba(154,109,22,.4)` | 金の淡い枠 |
| `--felt` | `radial-gradient(90% 80% at 50% 40%,#1b6249,#124637 55%,#0a2b21)` | `radial-gradient(90% 80% at 50% 40%,#3f9a76,#2f8060 55%,#246650)` | 羅紗 |
| `--felt-edge` | `rgba(0,0,0,.4)` | `rgba(255,255,255,.25)` | 羅紗の内側の縁 |
| `--rim` | `linear-gradient(180deg,#4b3520,#2a1c0e)` | `linear-gradient(180deg,#c9a271,#a87f4d)` | 木縁 |
| `--slot` | `rgba(0,0,0,.32)` | `rgba(255,255,255,.7)` | 羅紗上の窪んだスロット |
| `--sym-bg` | `rgba(217,164,65,.16)` | `rgba(154,109,22,.16)` | 記号の下地・淡い金 |
| `--card-back` | `repeating-linear-gradient(45deg,#8d2536 0 4px,#761d2c 4px 8px)` | `repeating-linear-gradient(45deg,#b2495a 0 4px,#9c3b4c 4px 8px)` | カード裏 |
| `--card-back-edge` | `rgba(240,217,160,.28)` | `rgba(255,255,255,.5)` | カード裏の縁 |

> **`--panel` の dark を第2稿の `.04` から `.06` へ微増**するのは意図的。第2稿の `--panel` は
> 羅紗の上に置く前提の値だが、casino/settings/title など**羅紗でない暗い背景**の画面でも
> 同じ `--panel` を使うため、`.04` だとパネルがほぼ見えない。`.06` ＋ `--border` の金縁で
> 全画面で輪郭が立つ。テキストは明色（`--text`）なので可読性は担保される。

## 卓のラッパ（木縁＋羅紗）

`TableScreen` の DOM を**最小限**だけ変える。`.table__board` グリッド・`data-testid`・
`aria-label`・`grid-template-areas` は一切変えない（4方向配置と河の座標検査を守るため）。

- `.table` を**木縁**にする（`background: var(--rim)`、角丸、影）。上部の 1px ハイライトは
  `box-shadow` の `inset` で表現する（`box-shadow` にグラデーションは使えないため `--rim-top`
  変数は導入しない。1px の暖色線は両テーマで許容範囲）。
- `.table__board` を**羅紗ラッパ `.table__felt`** で1枚包む（`background: var(--felt)`、
  内側の影と `--felt-edge` の縁、角丸、パディング）。JSX 変更はこの1枚の `<div>` 追加のみ。
- `ActionBar` と各オーバーレイは `.table` 直下のまま（木縁の上・全画面固定）。

> **手札は 9-1 では羅紗の上のまま**にする。第2稿は手札を木縁の上に置くが、
> それには `.table__mine` を 3×3 グリッドの外へ出す構造変更が要り、レスポンシブの
> 縦積み規則も書き換わる。9-1（見た目）の範囲を超えるため将来の polish とする。

## カード（App.css）

- `.card--back`: `background` を `var(--card-back)`、`border-color` を `var(--card-back-edge)` に。
- `.card--waiting`: `#ffd34d` → `#ffe58a`、外側グローを強め、**`transform: translateY(-12px)` を恒常付与**。
  面の色クラス（`.card--pink` 等）は保持されるので同色役の情報は残る。
  持ち上げ分は `.hand` に `padding-top` を足して器からはみ出さないようにする（table.css）。
  - **ホバーとの詳細度衝突に注意**: 待ち札は自分の手番でクリック可能にもなり、
    `.card--clickable:hover`(0,2,0) が `.card--waiting`(0,1,0) に勝つ。素だと待ち札を
    ホバーした瞬間に -12px→-6px へ沈むため、`.card--clickable.card--waiting:hover`(0,3,0) で
    持ち上げを明示的に維持する。
  - **reduced-motion**: 持ち上げは静的な位置なので残す。持ち上げの「動き」は既存の
    `.card--clickable { transition: transform … }` 由来で、既存の reduced-motion ブロックの
    `.card--clickable { transition: none }` が既に無効化している（新規ルールは不要）。
    上のホバー上書き(0,3,0)が reduced-motion の `.card--clickable:hover{transform:none}`(0,2,0)にも勝つ。
- 面の色 `.card--pink/.card--blue/.card--orange`・`.card__name` の下地・`.card--tile` は**変えない**。

## 波及先 CSS（多くは自動追従・ハードコード色のみ寄せる）

`board.css` / `table.css` / `win.css` / `hints.css` / `casino.css` / `settings.css` は
`var()` 参照が中心。羅紗上のパネルを窪ませたい箇所（中央スロット・席プレート）は
必要に応じ `background: var(--slot)` に寄せる。ハードコードの `#ffd34d`（席の宣言権者枠など）は
金基調と競合しない範囲でそのまま／`--gold-soft` に寄せるかを実装時に目視で判断する。

## テスト

- 単体（`renderToStaticMarkup`）は CSS を適用しないため、色変更ではなく**クラスの有無**を検査する。
  - `.card--waiting` が付いても面の色クラス（例 `card--pink`）が残ること（面を殺していない）。
  - `.card--back` が描画されること（裏面の存在）。
- E2E（`table.spec.ts`）の 4方向座標検査・「4人全員が河を持つ」が引き続き通ること
  （ラッパ追加で `data-testid`/`grid-area` を壊していないことの担保）。
- 目視（ブラウザ）: 卓/カード/待ち札/他画面/ライトテーマ/reduced-motion。

## リスク

- **他画面のパネル可読性**（`--panel` を全画面共有）。→ dark を `.06` に微増＋金縁で対処。目視必須。
- **`.table__felt` 追加でレイアウトが動く**恐れ。→ グリッドは触らず外側に1枚包むだけ。座標 E2E で担保。
- **`translateY` の持ち上げが器からはみ出す**。→ `.hand` に padding-top を足す。
