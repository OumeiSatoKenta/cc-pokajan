# Step 9-3 横向きレイアウトと待ちチップ — tasklist

## タスク

- [x] T1: `center.css` を新規作成し、`board.css` から中央（`.board*`）を移設（mobile 調整含む）
- [x] T2: `board.css` から中央セクションを削除（卓枠・席・河に絞る。296行＝閾値400を下回った）
- [x] T3: `TableScreen.tsx` に `center.css` を import（board.css の後）
- [x] T4: G — `hints.css` の待ちを丸チップ化（`.wait__list` flex、`.wait__row` 丸チップ、残0=42%）
- [x] T5: F — `landscape.css` を新規作成（横向き：密度低下・下段2カラム・グループのドット化・
      待ちの役名列を落とす）＋**媒体クエリの重複解消**（縦の `max-width:30rem` に `orientation: portrait`）
- [x] T6: `TableScreen.tsx` に `landscape.css` を import（最後）
- [x] T7: E2E（`table.spec.ts` に追記。844×390 で横スクロールなし＋`.table__mine` が grid＋縦の回帰ガード）
- [x] T8: 自動ゲート（lint/typecheck/test 760/build/format:check）＋ E2E 76
- [x] T9: 行数計測（board.css 296 / center.css 151 / landscape.css 243）

## 進捗

全タスク完了。ただし横向きの**縦 fit は未達（保留）**。詳細は振り返り参照。

## 振り返り（2026-08-09 完了）

### 計画と実績の差分

- **【要件を修正】横向きの完全 fit（高さ390px）は達成できなかった。** portrait 用の DOM を
  CSS で縮めるだけでは限界で、実測で 837px → 約540px まで下げたが 390px には届かない。
  完全 fit は**横向き専用の再設計（操作バーを手元へ取り込む DOM 再構成・他家席の簡略化）**が必要。
  requirements.md を「横スクロール無し＋密度低下＋横向きレイアウトが働く」までに修正した。
- **【3軸レビューが実測で捕まえた欠陥（重大）】**:
  - 私の当初 landscape.css は縦に**963px**あふれていた（docs レビューが dev サーバを立てて実測）。
    E2E が横スクロールしか見ておらず**偽陽性**だった。→ E2E に縦の検証を追加し、height を実測しながら
    詰めた（837→約540）。
  - **`grid-area: hand` が効いていなかった**。grid item は `.hand`（`<ul>`）ではなく親の
    `.hand-area`（`<div>`）。→ セレクタを `.hand-area` に修正。
  - **App.css と同詳細度の landscape ルールが import 順で負けていた**（伏せ札が 24px のまま）。
    → `.seat`/`.river`/`.board` を挟んで詳細度を上げて勝たせた（board.css の縦積みと同じ手）。
    これが縦を最も縮めた（left seat 210→99）。
  - **媒体クエリの重複**（縦 `max-width:30rem` と横 `orientation:landscape` が幅≤480の横向きで両立）。
    → 縦側に `and (orientation: portrait)` を足して排他化。
  - **待ち一覧がテンパイ時228px**（12rem幅で6チップが多段折り返し）。→ 横1列スクロール（nowrap+overflow-x）に。

### 学んだこと

- **CSS の「効いていない」を実測で疑う**。grid-area はグリッド item（直接の子）にしか効かない。
  同詳細度の上書きは import 順で負ける。どちらも「書いたのに効かない」形で、height 実測で初めて分かった。
- **レスポンシブの fit は E2E で数値化して初めて検証できる**。「横スクロール無し」だけ見ると縦の
  大あふれを見逃す（今回まさにそれ）。scrollHeight/scrollWidth を両方見る。
- **portrait の DOM を CSS で landscape に畳むのには限界がある**。密度低下はできるが、
  「1画面に収める」には DOM 設計から変える必要がある。安請け合いせず、達成できた線で要件を正直に直す。

### 次回への申し送り（Step 9 完了・残課題）

- **横向きの完全 fit＝別タスク**（横向き専用レイアウト。操作バーを手元レールへ統合し、
  他家席を簡略化する DOM 再構成）。commands.md の v2 候補に「下段の完全1レール化」を追記推奨。
- **横向きの見た目の最終目視が未了**（claude-in-chrome の手動スクショは常時アニメで取得不可）。
  E2E は「横スクロール無し＋レイアウト発火＋縦の回帰ガード」までしか担保しない。実機での目視が要る。
- **`board__member--bonus` は未使用クラス**（レビュー指摘・既存の負債）。center.css 集約の機会に
  整理する余地あり（今回は範囲外）。
- CLAUDE.md の CSS 記述と実装状況表（Step 9）を更新済み。
