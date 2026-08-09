# Step 9-2 河の直近5枚固定とヘッダー — tasklist

## タスク

- [x] T1: `CardView` に `isLast?: boolean` を追加（`card--last` クラス。面の色は残す）
- [x] T2: `App.css` に `.card--last`（白熱色の枠＋グロー、持ち上げ無し）
- [x] T3: `DiscardPile` を直近5枚 slice ＋件数ラベル ＋ `highlightLast` → 最後の札に `isLast`
- [x] T4: `PlayerSeat` に `highlightLast`（必須）を足し `DiscardPile` へ素通し
- [x] T5: `TableHeader.tsx` 新規（タイトル＋連続和了ピップ＋BET）
- [x] T6: `table.css` にヘッダーのスタイル（`.table__header` / `.streak*` / `.bet`）。
      ＋レビュー反映で `board.css` に `.river__count`（件数ラベルの控えめなスタイル）を追加
- [x] T7: `TableScreenProps` に `bet: number`、ヘッダー描画、`highlightLast` 配線
      （他家＝`lastDiscard !== null && lastDiscardBy === player.id`。**自席は強調しない**）
- [x] T8: `App.tsx` を `state.bet !== null` ガードにして `bet` を渡す
- [x] T9: テスト追加（`cardVisual.test.tsx` に DiscardPile／`tableHeader.test.tsx` 新規／
      `tableLayout.test.tsx` に PlayerSeat 素通し）
- [x] T10: 自動ゲート（lint/typecheck/test 760件/build/format:check）＋ E2E 75件

## 進捗

全タスク完了。実装 → 3軸レビュー → 指摘反映（実バグ1件含む）→ 全ゲート再通過（760 / 75）。

## 振り返り（2026-08-09 完了）

### 計画と実績の差分

- **【実バグ】ロン後に古い捨て札へ誤って「直前札」強調が付いた**（secondary が `reduce()` を
  実行して確認）。design の前提「`lastDiscardBy` はクレーム窓の間だけ非 null」が**誤り**だった。
  実際は `win.ts consumeAndRefill` がロン時に `lastDiscard=null` だけを設定し、`lastDiscardBy` は
  `advanceTurn` まで残す。`lastDiscardBy===席` だけで判定すると、ロン消費後の古い札を光らせる。
  → `state.lastDiscard !== null &&` を条件に足して受付中に限定。
- **自席の河の直前強調を廃止**。一次資料（第2稿）は自席の河を強調しておらず、自分の捨て札は
  自分のロン対象でもない。当初は「今出した札」として付けていたが、根拠が弱く逸脱だったので削除。
- **`.river__count` の CSS を入れ忘れていた**（design で「小さく muted に」と書いたのに未実装で
  無装飾の改行になっていた）。board.css に追加。
- **TableHeader の JSDoc が不正確**だった（「ロンで0に戻る」→ 実際は 0→即+1 で UI は0を経由しない）。
- **【偽陽性テスト】highlightLast のテストが回数しか見ておらず位置を検証していなかった**
  （secondary が `i===0` に改変しても pass すると実証）。`class="card ..."` を1枚ずつ取り出し、
  **末尾だけに `card--last`** が付くことを位置で固定するテストに書き直した。
  ＋ PlayerSeat → DiscardPile の素通しテストも追加（配線ミスを捕まえる）。

### 学んだこと

- **状態の「いつ null になるか」を実コードで確かめてから UI 条件に使う**。`lastDiscard` と
  `lastDiscardBy` はリセットのタイミングが違う（前者はロン消費時、後者は手番交代時）。
  片方の思い込みで条件を書くと、演出が数秒残る時間帯にちょうど嘘表示になる。
- **「回数」だけを数えるテストは位置バグを見逃す**。`i===0` でも1回は1回。
  どのカードかを位置で固定しないと、CLAUDE.md の言う「何も見ていないテスト」になる。
- **一次資料が描いていない状態を足すときは根拠を明記する**。自席強調のように「良かれ」で足すと、
  逸脱の説明責任が残る。今回は削除して一次資料に寄せた。

### 次回（9-3）への申し送り

- **`board.css` が 433 行**（9-1 の 425 からさらに増加。閾値 400 超過が続く）。
  **9-3 着手時に必ず分割する**（9-1 の申し送りどおり。横向きメディアクエリを足すと確実に肥大する）。
  分割案: 卓の外枠/羅紗（rim・felt）と河（river）を別ファイルに、`board.css` は席配置に絞る。
- **`table.css` が 351 行**、9-3 で横向き3分割が入ると 400 に迫る。ヘッダー（`.table__header*`）は
  卓まわりなので、分割時に board 系へ寄せる選択肢もある。
- **連続和了ピップの実プレイ確認**が未了（chainCount は平常時0で、和了チェーン中だけ灯る）。
  9-3 の実機確認時に、和了を重ねてピップが灯るのを目視する。
- ブラウザ手動スクショは 9-1 同様、常時アニメーションで idle にならず取得困難。E2E の描画通過で代替。
