# Step 10-2 ゲーム風ボタン — tasklist

## タスク

- [x] T1: `index.css` に `--action-bg` / `--action-border` を追加（ライト＋ダーク）
- [x] T2: `App.css` の `.button` ベースに transition ＋ `:active` 押下 transform を追加。
      `.button--primary`（金グラデ＋影）と `.button--ghost` を table.css から移設・刷新。
      `@media (prefers-reduced-motion: reduce)` で `.button:active` 無効化
- [x] T3: `table.css` から `.button--primary` / `.button--ghost` を削除し、
      `.button--tsumo`（緑）/ `.button--ron`（赤）＋ hover を追加
- [x] T4: `table.css` の `.actions` に枠（`--action-bg`/`--action-border`）を追加。
      タイマー色を declare=緑 / claim=赤 / discard=金（既定）に
- [x] T5: `ActionBar.tsx` で `item.kind` に応じて declare→tsumo / claim→ron / pass→ghost に class 分け
- [x] T6: `landscape.css` の compact 上書きに `.button--tsumo, .button--ron` を追加
- [x] T7: 単体テスト `tests/ui/actionBar.test.tsx` を新規作成（色分けの配線・ラベルを固定）
- [x] T8: 検証ゲート（lint/typecheck/test 768/build/format:check）＋ `npx playwright test` 78
- [x] T9: 行数計測（App.css 345 / table.css 386 / landscape.css 229 / index.css 70）

## 進捗

全タスク完了。unit 768 / E2E 79 / build / format:check が PASS。

## 振り返り（2026-08-10 完了）

### 計画と実績の差分

- 計画通り、ツモ=緑/ロン=赤/見送る=ゴーストの色分け、`.button` ベースの押下感・全画面波及、
  操作エリア枠、タイマー色分け（宣言=緑/割り込み=赤/打牌=金）、reduced-motion を実装。
- ただし**初回実装は色分けが一切描画されていなかった**（下記）。3軸レビューで判明し、修正した。

### 3軸レビューが全緑の裏で捕まえた欠陥（最重大・本ステップの中核が無効）

**3軸すべてが独立に実ブラウザ getComputedStyle で確認**した:

- **色分けの幽霊ボタン**: `.button--tsumo`/`.button--ron`（table.css）が、後からバンドルされる
  App.css の `.button` ベースに**同詳細度 import 順で負け**、背景グラデ・文字色・太字が丸ごと消え、
  影だけ残っていた。`declare-button`/`claim-button` は見送るボタンと**見分けがつかない**状態だった。
  - 私の design.md の前提が**逆**だった：「App.css はバンドル内で早い位置」と書いたが、
    実際は `App.tsx` が `import './App.css'` を**最後**に置くため App.css が後勝ちする。
  - hover も同根で `.button:hover{color:var(--accent)}` に負け、直すと緑/赤地に**金文字＝不可読**
    （9-1 の再演）になるところだった。
  - landscape の compact 上書きも同根で無効（9-3 から primary/ghost で潜在していた）。
- **修正**: 変種を `.button.button--*`（複合クラス・詳細度 0,2,0、hover は 0,3,0）で書き、
  import 順に依存させず勝たせた（9-1 の `.card--clickable.card--waiting` と同じ手）。1手で全4クラス解消。
- **検出できなかった理由**: 追加した単体テストは class 名の文字列しか見ず、CSS 適用結果を見ない。
  → 実アプリのスタイルシート下でボタンを注入し `backgroundImage` に `gradient` が乗ることを
  実測する E2E を追加（「壊したら落ちる」形）。自分でもビルド後 CSS をハーネスで getComputedStyle し、
  修正前=幽霊／修正後=緑・赤グラデ・濃色文字・hover 維持 を確認した。

### 学んだこと

- **CSS 変種クラスは import 順に勝てるとは限らない。** 単一クラス同士は同詳細度で後勝ち。
  別ファイルの変種はベースより前に来がちなので、**複合クラス `.button.button--x` で詳細度を確保**する
  のが定石（このリポジトリは 9-1/9-3 で同じ結論に達している）。今回 design で前提を逆に書いた。
- **「見た目が出るか」は class 名テストでは担保できない。** renderToStaticMarkup は配線のみ。
  色・グラデ・詳細度勝敗は **computed style の実測**（ハーネス or E2E 注入）でしか固定できない。
- **カスケードの前提は書く前に実測で確かめる。** dist の byte offset は子孫セレクタ（`.x .button{`）に
  引っかかるので、offset 比較より getComputedStyle が確実。

### 次回への申し送り

- **table.css 386行**（400 目前）。10-3 で操作エリア/横向きに追記する前に、操作エリア関連
  （`.actions`/`.button--tsumo`/`--ron`/`.timer`）の別ファイル分離を検討する。
- **根治案（未採用）**: `@layer` か `.button` ベースの `:where()` 化で import 順への依存を断てる。
  今回は前例に倣い複合クラスの局所対応にした。同種のカスケード事故が3度目なので、10-3 以降で
  レイヤ化を一度検討する価値がある。
- 全画面波及のため、タイトル/BET/精算/設定/ロスター/ルールのボタンの最終目視はユーザーに依頼
  （E2E は色分けの描画までを機械で担保）。
