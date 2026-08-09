# ポカジャン デザイン依頼書（外注・他AI向けインプット）

このファイル1つで依頼が完結するように書いてある。デザイナー・他の AI に渡すのはこれと
[shots/](shots/) の画像一式でよい。

---

## 0. まず結論：いま足りないのは CSS ではなく「世界観」

現状の画面は**機能的には完成しているが、視覚的な主張が一切ない**。
白いパネルに文字が並んでいるだけで、カジノにもゲームにも見えない。

この状態で「もっと凝ったデザインにして」と丸投げすると、
受け手ごとにバラバラの方向へ振れて統合できなくなる。**先に方向を1つ決める**（後述の依頼A）。

---

## 1. プロダクトの説明（依頼相手に読ませる前提知識）

「ホロライブドリームス」のカジノミニゲーム **「ポカジャン！」** を再現した、
**個人利用のブラウザゲーム**。麻雀 / ドンジャラの簡略版。

- 4人対戦（人間1 + CPU3）。手札は常に7枚、「山から1枚引く → 1枚捨てる」の繰り返し
- 役は2種類だけ（**3カード** = 同一メンバー3枚 / **N人組** = グループ全員を1枚ずつ）
- カードは **ピンク / 青 / オレンジ** の3色。役の構成が全て同色だと大幅加点（最大 1,800 点）
- **和了しても局が終わらない**。カードを補充して連続和了できるので、常に打点レースが続く
- BET → 対局 → 順位に応じた精算、というカジノのループで回る

サーバーは無く、完全にクライアントサイドのみ。所持コインは localStorage、
プレイヤー画像は IndexedDB に入る。

---

## 2. 絶対に守ってもらう制約

### 2-1. 著作権（最重要・交渉の余地なし）

> **公式イラスト・ロゴ・キャラクター画像・フォント・配色トレースを一切使わない。**
> ゲームのルール自体に著作権は及ばないため再現に問題はないが、**見た目を原作に寄せる依頼ではない。**
> 同梱のキャラクターはすべてオリジナルの創作で、ユーザーが自分の画像に差し替えて遊ぶ。

依頼相手が生成 AI の場合、「◯◯（実在の作品）風に」というプロンプトを**書かせない**こと。
「カジノ」「麻雀卓」「ネオン」といった**一般的なモチーフ**で組み立てる。

### 2-2. 技術（無視されると作り直しになる）

| 項目 | 制約 |
| ---- | ---- |
| フレームワーク | React 19 + TypeScript。**Tailwind も CSS-in-JS も使っていない** |
| スタイル | **素の CSS ファイル**（`src/ui/*.css`）。クラス名は BEM 風の既存命名を変えない |
| アニメーション | framer-motion 13 が入っている。**新しいライブラリは足さない** |
| テーマ | **ライト / ダークの両方**が必要（`prefers-color-scheme` で切り替わる） |
| 画面幅 | **375px で崩れない**こと。横スクロールを出さない |
| モーション | `prefers-reduced-motion: reduce` で**動きが消える**こと（滞留時間は消さない） |
| 画像 | リポジトリに重いバイナリを増やさない。**装飾は CSS（グラデーション・影・擬似要素）で作る**のが既定。どうしても要るならインライン SVG |
| フォント | 外部フォントの読み込みは不可（オフラインで完結させる）。`system-ui` 系のまま |

### 2-3. 壊してはいけない機能

- カードの色（ピンク/青/オレンジ）は**役の判定に直結する情報**。装飾で色を判別しにくくしない
- **待ちに寄与するカードの黄色枠**（`.card--waiting`）は攻略の中心。目立たなくしない
- 待ち一覧の**残0 の行**は淡く落として区別する。色だけに頼らない（数字も併記済み）
- 他家の手札（`.card--back`）に**中身が漏れる表現を足さない**

---

## 3. 現状の資材

### 3-1. スクリーンショット（[shots/](shots/)）

| ファイル | 画面 |
| ---- | ---- |
| `01-title.png` | タイトル（アウトゲームの入口） |
| `02-roster.png` | ロスター設定（キャラ編集） |
| `03-players.png` | プレイヤー設定（座席アバター） |
| `04-rules.png` | ルール設定 |
| `05-bet.png` | BET 選択 |
| `06-gameover-overlay.png` | 終局オーバーレイ |
| `07-settlement.png` | 精算画面 |
| `10-table.png` | **対局画面（本体）** |
| `11-table-hover.png` | 手札ホバー時の残り枚数 |
| `12-table-375.png` | 対局画面 375px |
| `13-claim-window.png` | 割り込みの受付（ロンを選べる状態） |
| `20-normal-cutin.png` / `20-normal-result.png` | **和了演出（通常役）** |
| `21-big-cutin.png` / `21-big-result.png` | **和了演出（大物手＝同色役）** |
| `mock-01.png` | **外注モック第1稿**（差し戻し対象。指摘は [review-01.md](review-01.md)） |
| `t-a-*.png` / `t-b-*.png` / `t-c-*.png` | アートディレクション3案を実画面に当てたもの（[proposals.md](proposals.md)） |

> 撮り直しは Playwright で行った（`startGame` → 目的の局面まで進めて `page.screenshot`）。
> 演出は `?fast=1` を付けると 0 秒で閉じるため、**付けずに**撮ること。
> 大物手は自然には出にくいので `isBigWin`（`src/config/presentation.ts`）を
> 一時的に常時 true にして見た目だけ撮り、すぐ戻した。

### 3-2. 現在のデザイントークン（`src/index.css`・これが全部）

```css
:root {
  --bg: #16161d;      /* 背景 */
  --panel: #21212b;   /* パネル */
  --border: #34343f;  /* 罫線 */
  --text: #e8e8ef;    /* 文字 */
  --muted: #9a9aab;   /* 補助文字 */
  --accent: #f2789b;  /* 唯一の差し色（ピンク） */
}
@media (prefers-color-scheme: light) {
  :root { --bg:#f6f6f9; --panel:#fff; --border:#dcdce4; --text:#22222b; --muted:#6b6b7b; }
}
```

**トークンが6個しかない**のが今の弱さ。階層・状態・高度（elevation）・卓の面といった
概念が全部この6個に押し込まれていて、画面に奥行きが出ない。

カードの色だけは `src/App.css` に直接書かれている:

```css
.card--pink   { background: linear-gradient(160deg, #ffd4e2, #f7a8c4); }
.card--blue   { background: linear-gradient(160deg, #d2e6ff, #a3c6f5); }
.card--orange { background: linear-gradient(160deg, #ffe2c2, #f7bd85); }
```

### 3-3. CSS ファイルの分担（**この分担は維持する**）

| ファイル | 行 | 担当 |
| ---- | ---- | ---- |
| `src/index.css` | 38 | トークン・リセット・body |
| `src/App.css` | 274 | カード（表・裏・小・タイル）・ボタン・タグ |
| `src/ui/board.css` | 406 | 卓の 3×3 グリッド・他家の席・中央・河 |
| `src/ui/table.css` | 267 | 自分の手番まわり・操作バー・全画面の覆い（`.overlay*`） |
| `src/ui/win.css` | 230 | 和了演出（カットイン・大物手・点数結果・順位の移動） |
| `src/ui/hints.css` | 210 | 残り枚数のツールチップ・待ち一覧 |
| `src/ui/casino.css` | 211 | タイトル・BET・精算 |
| `src/ui/settings.css` | 314 | ロスター/プレイヤー/ルールの各設定 |

> **1ファイル400行を超えたら分割する**のがこのリポジトリの決まり。
> `board.css` は既に 406 行で余裕がないので、卓の装飾を足すなら
> `src/ui/theme-table.css` のような新規ファイルに分けてよい。

### 3-4. クラス名の目録（実装を頼む場合の契約）

**このクラス名に対して CSS を書いてもらう。** JSX の構造とクラス名は変えない前提。

<details>
<summary>全クラス名（クリックで展開）</summary>

**App.css（カード・ボタン）**
`.app` `.app__header` `.app__title` `.app__notice`
`.button` `.button--primary` `.tag`
`.card` `.card--pink` `.card--blue` `.card--orange` `.card--small` `.card--tile` `.card--back`
`.card--waiting` `.card__name` `.card__image` `.card__bonus` `.card__corner` `.card__corner--tl`
`.card__corner--br` `.card-backs` `.card-backs--horizontal` `.card-backs--vertical`
`.member-tile` `.member-tile__label`

**board.css（卓）**
`.table` `.table__board` `.table__mine` `.table__mine-title`
`.seat` `.seat--top` `.seat--left` `.seat--right` `.seat--turn` `.seat--declarer`
`.seat__head` `.seat__name` `.seat__score` `.seat__meta` `.seat__avatar`
`.board` `.board__stats` `.board__stat` `.board__bonus` `.board__groups` `.board__group`
`.board__group--done` `.board__group-head` `.board__group-name` `.board__group-count`
`.board__members` `.board__member` `.board__member--held` `.board__member-bonus`
`.river` `.river__list`

**table.css（手番まわり・覆い）**
`.hand` `.hand__drawn` `.card--clickable`
`.actions` `.actions--idle` `.actions__buttons` `.button--primary` `.button--ghost`
`.timer` `.timer__track` `.timer__fill` `.timer__fill--static` `.timer__label`
`.table__mine-head` `.table__hint`
`.overlay` `.overlay__panel` `.overlay__title` `.overlay__reason` `.overlay__ranking`
`.overlay__rank` `.overlay__rank--top` `.overlay__rank-score`

**win.css（和了演出）**
`.win-overlay` `.win-cutin` `.win-cutin--big` `.win-cutin__avatar` `.win-cutin__avatar-image`
`.win-cutin__yaku` `.win-cutin__kind` `.win-cutin__badge`
`.win-result__who` `.win-result__yaku` `.win-result__bonus` `.win-result__cards` `.win-result__score`
`.win-rank` `.win-rank__row` `.win-rank__row--win` `.win-rank__no` `.win-rank__name`
`.win-rank__score` `.win-rank__delta` `.win-rank__delta--up`

**hints.css（残り枚数）**
`.hand-area` `.card-counts` `.card-counts__name` `.card-counts__list` `.card-counts__item`
`.card-counts__item--pink` `.card-counts__item--blue` `.card-counts__item--orange`
`.card-counts__value` `.card-counts__note`
`.wait` `.wait__title` `.wait__list` `.wait__row` `.wait__row--dead` `.wait__card`
`.wait__card--pink` `.wait__card--blue` `.wait__card--orange` `.wait__color`
`.wait__remaining` `.wait__yaku` `.wait__same` `.wait__score` `.wait__more`

**casino.css（アウトゲーム）**
`.casino` `.casino__title` `.casino__lead` `.casino__panel` `.casino__wallet` `.casino__cta`
`.casino__sub-actions` `.casino__note`
`.bet__options` `.bet__option` `.bet__amount` `.bet__multiplier` `.bet__topup` `.bet__topup-text`
`.result__rank` `.result__net` `.result__net--plus` `.result__breakdown` `.result__actions`

**settings.css（設定）**
`.settings` `.settings__head` `.settings__title` `.settings__actions` `.settings__fields`
`.settings__field` `.settings__label` `.settings__input` `.settings__number` `.settings__note`
`.settings__message` `.settings__errors` `.settings__warnings` `.settings__ok`
`.settings__validation` `.settings__group` `.settings__group-title` `.settings__file`
`.settings__hidden-file`
`.roster__groups` `.roster__group` `.roster__group-head` `.roster__group-name` `.roster__count`
`.roster__members` `.roster__member` `.roster__symbol` `.roster__select` `.roster__thumb`
`.roster__thumb-image` `.roster__orphan-title`
`.avatars__list` `.avatars__row` `.avatars__name` `.avatars__thumb` `.avatars__thumb-image`

</details>

---

> **依頼A は実施済み。** 3案と推薦は [proposals.md](proposals.md)、
> テーマ CSS は [proposals/](proposals/) にある。依頼B・C はその結論を前提に出す。
>
> **モック第1稿の指摘は [review-01.md](review-01.md)。**
> **第2稿の依頼一式は [handoff/](handoff/)**（`prompt.md` / `wireframe.md` / `data.md` /
> `state-sample.json`）。デザイナーに渡すのはこの4点 + 第1稿の画像でよい。

## 4. 依頼を3つに分ける

**1回で全部頼まない。** A が決まらないと B も C も評価できない。

| # | 依頼 | 成果物 | 誰に向くか |
| - | ---- | ---- | ---- |
| **A** | アートディレクション | 方向性3案 + 採用案のトークン表 | 生成 AI / デザイナー |
| **B** | カットインのモーション設計 | 時間軸つきの演出仕様 | モーションが得意な相手 |
| **C** | CSS 実装 | 既存クラス名に対する CSS | コードが書ける AI |

---

## 5. 依頼A：アートディレクション（最初にこれ）

### そのまま貼れるプロンプト

```
あなたはブラウザゲームのアートディレクターです。
以下のゲームの「見た目の方向性」を3案提案してください。実装コードは不要です。

## ゲーム
麻雀/ドンジャラを簡略化した4人対戦のカードゲーム。1人 + CPU3人。
手札7枚、引いて捨てるの繰り返し。役は「同一キャラ3枚」と「グループ全員を1枚ずつ」の2種類だけ。
カードはピンク/青/オレンジの3色で、役が全て同色だと大幅加点。
和了しても局が終わらず、常に打点レースが続く。
BET → 対局 → 順位に応じた精算、というカジノのループで回る。
キャラクターはユーザーが自分の写真に差し替えて、身内のチームで遊ぶ想定。

## 絶対の制約
- 既存作品の意匠・ロゴ・キャラクターを参照しない。一般的なモチーフだけで組む
- 装飾は CSS（グラデーション・影・擬似要素・インライン SVG）で表現できる範囲に収める。
  画像アセットを前提にしない
- ライトテーマとダークテーマの両方が要る
- 375px 幅で成立する
- カードの3色は役の判定に直結する情報なので、装飾で色を判別しにくくしてはいけない

## 出してほしいもの（3案それぞれ）
1. コンセプト名と一行説明
2. 世界観の説明（3〜5行）。「どこで誰が遊んでいる卓なのか」
3. カラーパレット: 背景 / 卓面 / パネル / 罫線 / 文字 / 補助文字 / 差し色 / 強調
   をライト・ダーク両方の16進数で。カード3色もこの案に合わせて調整した値を出す
4. 質感の指針（角丸・影の強さ・境界線・グラデーションの方向・余白のリズム）
5. タイポグラフィの指針（system-ui 前提。ウェイト・字間・数字の扱い）
6. この案で「和了の瞬間」がどう見えるか（3行）
7. 実装コスト（低/中/高）と、その案の弱点

## 最後に
3案を比較する表を出し、このゲームに最も向く1案を理由つきで推薦してください。
```

### 添付するもの

`shots/` の全画像。特に `10-table.png`（対局画面）と `01-title.png`（タイトル）。

---

## 6. 依頼B：カットインのモーション設計

現状の演出は **カットイン(1.2秒) → 点数獲得結果(2.5秒) → 自動で閉じる** の2段。
同色役のときだけ「大物手」バージョン（金の輪郭・放射状の光・バッジ）になる。
`20-normal-cutin.png` と `21-big-cutin.png` を見ると分かるが、**モーダルにしか見えない**のが不満。

### そのまま貼れるプロンプト

```
あなたはゲーム UI のモーションデザイナーです。
カードゲームの「和了（あがり）演出」を設計してください。実装コードは不要です。仕様書だけ出してください。

## 現状
- 2段構成: カットイン(1.2秒) → 点数獲得結果(2.5秒) → 自動で閉じる
- カットイン段: 円形のアバター(未設定なら席名の頭文字)、席名、役名、ツモ/ロン
- 結果段: 役の構成カード3〜5枚、獲得点、4人の順位表(順位が入れ替わるとき行が動く)
- 同色役のときだけ「大物手」バージョン(金の輪郭・放射状の光・「大物手」バッジ)
- 画面中央に白い角丸パネルが出るだけで、モーダルにしか見えないのが不満

## 制約
- framer-motion 13 と CSS のみ。新しいライブラリは足さない
- 画像アセットは使わない。CSS のグラデーション・擬似要素・インライン SVG で作る
- 375px 幅で成立する
- prefers-reduced-motion: reduce のとき「動き」は消えるが「滞留時間」は変えない
  (動きを減らす設定であって、読む時間を減らす設定ではない)
- 連続和了があるので、最大8回続けて再生されうる。毎回見ても飽きない/邪魔にならないこと
- 段の長さ(1.2秒 / 2.5秒)は変更提案してよいが、合計4秒を大きく超えないこと

## 出してほしいもの
1. 通常役と大物手それぞれの、時間軸つきの絵コンテ
   (0.0s / 0.2s / ... と刻んで、何がどこからどう動くか)
2. 各要素の easing・duration・delay の具体値
3. 「モーダルに見えない」ようにするための構造的な提案
   (画面全体を使う / 斜めに走る帯 / 卓そのものを動かす など、案を3つ以上)
4. 大物手を「別格」に見せるための差分を5つ
5. reduced-motion のときの代替表現
6. 実装難易度と、費用対効果が高い順の優先度

## 添付
現状のスクリーンショット(通常役・大物手)を見て、良い点と悪い点を先に指摘してください。
```

### 添付するもの

`20-normal-cutin.png` `20-normal-result.png` `21-big-cutin.png` `21-big-result.png`

---

## 7. 依頼C：CSS 実装

依頼A の方向が決まってから。**JSX は触らせない**のが要点。

### そのまま貼れるプロンプト

```
既存のブラウザゲームに、決まったアートディレクションを CSS だけで適用してください。

## 守ること
- 素の CSS のみ。Tailwind / CSS-in-JS / 新規ライブラリは使わない
- **JSX とクラス名は一切変更しない**。下のクラス名に対して CSS を書く
- ライトテーマ(prefers-color-scheme: light)とダークテーマの両方を出す
- 375px 幅で横スクロールを出さない
- prefers-reduced-motion: reduce で動きを消す
- 外部フォント・外部画像を読み込まない(オフラインで完結する)
- 変更は CSS カスタムプロパティ(:root のトークン)経由を優先し、
  個別クラスへのハードコードは最小にする

## 機能を壊さない
- .card--pink / .card--blue / .card--orange の3色は役の判定に直結する情報。
  装飾で色を判別しにくくしない
- .card--waiting(あと1枚で役が完成するカードの強調)を目立たなくしない
- .wait__row--dead(もう場に無い待ち)は淡く落とすが、読めなくはしない
- .card--back(他家の伏せ札)に中身を示す表現を足さない

## 成果物
1. src/index.css に置く新しいトークン定義(ライト/ダーク両方)
2. 各 CSS ファイルへの差分。ファイルごとに分けて出す
3. 1ファイルが400行を超える場合は、新規ファイルへの分割案も添える

## クラス名の目録
(この依頼書の「3-4. クラス名の目録」をここに貼る)

## 現在の CSS
(該当ファイルの中身をここに貼る)
```

---

## 8. 受け入れ基準（納品物をこれで判定する）

実装が返ってきたら、マージ前に必ず確認する。

- [ ] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が通る
- [ ] `npx playwright test` が通る（**75件**。見た目を変えると DOM 構造の変更で落ちることがある）
- [ ] ライトテーマとダークテーマの両方を目視した
- [ ] 375px で横スクロールが出ない
- [ ] OS の「視覚効果を減らす」設定で動きが消える
- [ ] **画像付きロスターで崩れない**（テキストだけのロスターで確認して満足しない。
      6b では画像を入れずに確認して CSS の欠落を見逃した）
- [ ] カードの3色が一目で区別できる
- [ ] 待ちの黄色枠が目立つ
- [ ] 1ファイル400行を超えていない
- [ ] 既存作品の意匠・ロゴ・キャラクターが混入していない

---

## 9. 参考：どこに頼むか

| 相手 | 向いている依頼 | 注意 |
| ---- | ---- | ---- |
| **このリポジトリの Claude Code** | C（CSS 実装）、A の実装可能性チェック | 制約とテストを把握しているので手戻りが少ない。`frontend-design` / `theme-factory` スキルがある |
| **Figma 系（このセッションのプラグイン）** | A の視覚化、B の絵コンテ | 出力をそのままコードにせず、トークンだけ抜いて実装は手元でやるほうが安全 |
| **汎用の生成 AI（ブラウザ版）** | A、B | **画像を添付できる相手を選ぶ**。添付なしだと現状を無視した提案が返る |
| **v0 / Lovable などの UI 生成サービス** | （非推奨） | React + Tailwind を吐くため、素の CSS のこの構成とは噛み合わない。移植コストのほうが高い |
| **人間のデザイナー / イラストレーター** | カード裏面・卓の面・ロゴなどの**絵**、A の最終判断 | AI で代替しにくいのはここ。著作権の制約（2-1）を発注時に明記する |

**費用対効果の順**: A（方向決め）→ B（カットイン）→ C（全画面の適用）。
Bだけ先に頼んでも、Aが無いと「どの色でどう光るのか」が決まらず評価できない。

---

## 10. 関連ドキュメント

- [../../README.md](../../README.md) — 設計方針と実装状況
- [../../CLAUDE.md](../../CLAUDE.md) — プロジェクト固有のルール（著作権の方針もここ）
- [../ideas/pokajan-presentation-and-counts-plan.md](../ideas/pokajan-presentation-and-counts-plan.md) — 和了演出と残り枚数の計画（Step 8）
- `.steering/20260809-pokajan-081-win-stages/design.md` — カットインの2段構成を決めた経緯
