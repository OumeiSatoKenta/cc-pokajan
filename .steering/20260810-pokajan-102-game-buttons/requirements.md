# Step 10-2 ゲーム風ボタン — requirements

## 背景

Step 9 完了後のプレイテストで「UI がゲームっぽくない」。操作ボタンが全部同じ金ピルで、
ツモ/ロン/見送るの区別も押下感も薄い。外注デザイン第2稿 `buildAction()` は操作を色で分け、
グラデ・影・押下感を与えている。これを反映する。

## 確定方針（ユーザー確認済み）

- **対局中の操作エリア＋全画面のボタン共通**。`.button` ベースにも手を入れ、
  タイトル/BET/精算/設定のボタンも一緒にゲーム風にする。

## 一次資料（第2稿 `buildAction()`）

- ツモ（自摸宣言）: `linear-gradient(180deg,#a8e6c2,#5cb185)` 濃色端 `#5cb185`
- ロン（割り込み）: `linear-gradient(180deg,#ffb3ab,#e0685f)` 濃色端 `#e0685f`
- 金（既存 primary）: `linear-gradient(180deg,#f4d78f,#d9a441)` 濃色端 `#d9a441`
- 文字色: `#1c1408`（本プロジェクトの `#1b1b22` と同義の濃色）、影 `0 6px 14px rgba(0,0,0,.35)`
- 操作エリア枠: `--actionBg`（dark `rgba(0,0,0,.3)` / light `rgba(255,255,255,.62)`）＋
  `--actionBd`（dark `rgba(255,255,255,.1)` / light `rgba(0,0,0,.14)`）
- タイマー3種: 打牌=金、宣言=緑 `#5cb185`、割り込み=赤 `#e0685f`

## 要件

### 機能要件

1. **操作ボタンの色分け**: `ActionBar` が `item.kind` で class を出し分ける。
   - `declare`（ツモ）→ `button--tsumo`（緑）
   - `claim`（ロン/割り込み）→ `button--ron`（赤）
   - `pass`（見送る）→ `button--ghost`（ゴースト）
   ラベル・testid（`declare-button`/`claim-button`/`pass-button`）は不変。
2. **全画面のボタン共通の質感**: `.button` ベースに transition と `:active` の押下 transform を付け、
   全画面（タイトル/BET/精算/設定/対局）に波及させる。`.button--primary`（金）はグラデ＋影で
   ゲーム風にする。フィル系（primary/tsumo/ron）は影付き、ゴースト/アウトラインは影なし。
3. **操作エリアの枠**: `.actions` に軽い枠（`--action-bg` / `--action-border`）を与えてボタン群をまとめる。
4. **タイマーの色分け**: 宣言=緑・割り込み=赤・打牌=金に仕上げる。
5. **reduced-motion**: `prefers-reduced-motion: reduce` で押下 transform を無効化する。

### 非機能要件

- **エンジン層（`src/engine/`）は変更しない。** UI（React/CSS）のみ。
- **コントラストの検算**: accent 地・緑地・赤地いずれも濃色文字（`#1b1b22`）で WCAG AA（≥4.5:1）を満たす。
  9-1 の `.wait__same`（金地に白＝2.25:1 で不合格）と同じ轍を踏まない。
  - WCAG 相対輝度式での実測値（グラデの最も暗い端で計算）:
    `#1b1b22` on `#5cb185`（緑濃色端）= **6.59:1** / on `#e0685f`（赤濃色端）= **5.15:1** /
    on `#d9a441`（金濃色端）= **7.61:1**。いずれも AA（4.5:1）を満たす。
  - **hover でも濃色文字を保つ**こと（金文字化すると緑/赤地で約1.2〜1.6:1に落ちる）。複合クラスで担保。
- **全画面波及なので他画面が破綻しないこと**（タイトル/BET/精算/設定の目視。アウトライン系ボタンが
  塗りつぶしに化けない）。
- テーマ対応: ボタンのグラデ色は明暗共通（濃色文字で両テーマ可読）。`--action-bg`/`--action-border` のみ
  ライト/ダークで定義する。

## スコープ外

- 待ちのホバー展開（10-1・完了）。
- 横向き専用レイアウトの再設計（10-3）。本 Step では landscape.css は
  「新クラス（tsumo/ron）が既存の primary/ghost と同じ compact 調整を受ける」最小追随に留める。

## 受け入れ基準

- ツモ=緑/ロン=赤/見送る=ゴーストで一目で区別できる（単体で class 出し分けを固定、見た目は目視）。
- 全画面のボタンに押下感があり、他画面が破綻しない。
- reduced-motion で押下 transform が無効。
- コントラストが AA を満たす（濃色文字）。
- 検証ゲート一式（lint / typecheck / test / build / format:check）＋ `npx playwright test` PASS。
