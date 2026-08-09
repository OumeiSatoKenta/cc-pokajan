# Step 10-3 横向き専用レイアウト再設計 — tasklist

## タスク

- [x] T1: `TableScreen.tsx` に `.table__controls` を導入し、`.table__mine` と `<ActionBar>` を包む。
      `<ActionBar>` を felt 外から `.table__controls` 内（mine の後）へ移す
- [x] T2: `board.css` の `.table__mine { grid-area: bottom }` を `.table__controls { grid-area: bottom }` に
      置換し、`.table__controls` の縦既定（flex column・gap）を定義
- [x] T3: `landscape.css` に app__header 隠し・下段レール（`.table__controls` row / mine flex / actions 幅）を追加
- [x] T4: E2E 高さ実測ループで詰め、844×390 の `vOverflow <= 1` を達成（4シードで v=0/h=0、
      割り込み受付〔2ボタン〕でも v=0。app__header 隠し＋レール化で 106→0。卓上マージンの
      相殺で残っていた 2px は `.table { margin: 0 auto }` で解消）
- [x] T5: `table.spec.ts` の横向き E2E を fit（`vOverflow <= 1`）に強化。発火判定を `.table__controls` の row に、
      app__header hidden も確認。座標・375px・デスクトップの回帰を確認（E2E 79 全通過）
- [x] T6: 検証ゲート（lint/typecheck/test 768/build/format:check）＋ `npx playwright test` 79
- [x] T7: 行数計測（board.css 305 / landscape.css 268 / table.css 395 / TableScreen.tsx 328）

## 進捗

全タスク完了。**844×390 の縦 fit を達成（9-3 の保留を解除）**。unit 768 / E2E 80 / build / format:check が PASS。

## 振り返り（2026-08-10 完了）

### 計画と実績の差分

- 計画通り DOM 再構成（`.table__controls` レール化・ActionBar を felt 内へ）＋他家席簡略化で
  844×390 の縦 fit（vOverflow 106→0）を達成。9-3 の保留を解除した。
- **縦を最も食っていたのは卓ではなく全画面共通の `app__header`（約51px）**だった。横向きの対局画面で
  畳んで回収（当初 design にも入れていた）。
- 残っていた 2px は `.table` 上マージンの **margin collapse**（`.app` min-height:100vh を貫通）で、
  `.table { margin: 0 }` で解消。原因を getBoundingClientRect で特定した（`.app` top=2 が手がかり）。

### 3軸レビューが全緑（unit 768 / E2E 79）の裏で捕まえた欠陥

1. **[必須] 宣言候補が多い局面（3〜4ボタン）で縦あふれ復活**（secondary が seed 17 で +56px 実測）。
   `.actions`（幅9.5rem）が縦に伸び `align-items: stretch` が手札まで引き伸ばして行高＝操作バー高に。
   **私の実測が初期状態・≤2ボタンに偏り見逃した**（CLAUDE.md「テストが緑でも正しいとは限らない」の実例）。
   → `align-items: flex-start` ＋ `.actions { max-height: 6.5rem; overflow-y: auto }`。ハーネスで
   controls=110（=mine）・actions=104・scrollHeight174 を確認。E2E にボタン注入の回帰ガードを追加。
2. **[必須] app__header 隠しが全画面グローバルに漏れ**、横向きでタイトル画面の heading が 0 件（a11y）。
   対局画面でも `.table__title` は span で heading 0 件だった。
   → `.app[data-screen='table']` にスコープ＋`display:none` でなく **sr-only**（h1 を残す）。
   タイトル画面の見出し保持を E2E で回帰ガード。
3. **[必須] 強化 E2E が初期状態しか見ず #1 を検出できず**／ドキュメント（CLAUDE.md 未更新・
   landscape.css 冒頭コメントが「1レール非対象」のまま・design のスコープ記述が実態と乖離）→ すべて是正。

### 学んだこと

- **横向きの縦 fit は「卓の外」も測る**。document/`.app`/body まで getBoundingClientRect で追わないと、
  卓を削っても減らない固定オーバーヘッド（app__header・margin collapse）を見逃す。
- **レスポンシブ fit の E2E は「代表状態」だけでなく最悪状態（多ボタン等）を作って測る**。
  初期状態は最も軽いので、そこだけ見ると通ってしまう。決定論的に作れないなら DOM 注入で模す。
- **`display:none` での「回収」は a11y を壊しうる**。見出しは sr-only で残す。CSS の副作用インポートは
  スコープを持たない＝`data-*` で明示スコープしないと全画面に漏れる。

### 次回への申し送り（既知の制限・正直に据え置き）

- **fit は 844×390 で担保。より狭い横向き（iPhone SE 568×320 等）はなお数十pxあふれる**
  （席見出しの折り返し等）。要求は 844×390。全端末幅対応は将来の per-width チューニング。
- **`max-height:480` の帯の外**（横長・高さ 481px 以上）は無圧縮グリッド（横持ちスマホの想定外）。
- **table.css 395行**（400目前・10-2 から継続）。次に操作エリア/横向きへ追記する前に分離を検討。
- **横向きの最終目視はユーザーに依頼**（スクショが常時アニメで撮れない。E2E は fit と発火・a11y までを担保）。
- カスケード同詳細度事故が 9-1/9-3/10-2 と続く。`@layer`/`:where()` によるレイヤ化を将来一度検討。
