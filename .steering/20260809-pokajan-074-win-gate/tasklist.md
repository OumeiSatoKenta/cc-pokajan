# Step 7-4: 和了の確認ゲート — タスクリスト

## フェーズ1: リデューサ

- [x] `loopReducer.ts` に `WinPresentation` と `pendingWins` を足す
- [x] `applyEngine` で**適用前の点数を控え**、イベント列を畳んで演出を組み立てる
- [x] `CONFIRM_WIN` を足し、先頭を1つ落とす
- [x] `ENGINE` / `TIMEOUT` を停止中は弾く（画面の無効化だけに頼らない）
- [x] `createInitialLoopState` に `pendingWins: []` を足す

## フェーズ2: リデューサのテスト

- [x] ~~`tests/ui/loopReducer.test.ts` に追加する~~ → **`tests/ui/winGate.test.ts` を新規作成**
      （理由: `loopReducer.test.ts` が既に435行あり、足すと基準を大きく超える）
      - 和了で `pendingWins` が積まれ、`scoresBefore` / `scoresAfter` が正しいこと
      - `CONFIRM_WIN` で1つずつ解除されること・空でも落ちないこと
      - **停止中は `ENGINE` が受理されないこと**
      - **停止中は `TIMEOUT` で持ち時間が減らないこと**
      - 和了でないアクションでは積まれないこと

## フェーズ3: フックと画面

- [x] `useGameLoop` の3つの効果に停止を入れる（依存配列 + 本体の早期 return）
- [x] `useGameLoop` が `pendingWin` と `confirmWin` を公開する
- [x] `src/ui/components/WinOverlay.tsx` を新規作成する（最小限）
- [x] `TableScreen` に `WinOverlay` を足し、`ResultOverlay` より優先させる
- [x] `src/ui/table.css` に `.win__*` を足す

## フェーズ4: YakuToast の廃止

- [x] `src/ui/components/YakuToast.tsx` を削除する
- [x] `TableScreen` から取り除く
- [x] `src/ui/table.css` の `.toast*` を削除する

## フェーズ5: E2E の追随（**最重要**）

- [x] `tests/e2e/table.spec.ts` の `playToEnd` に確認クリックを足す
- [x] `tests/e2e/table.spec.ts` の `playUntilClaimWindow` に確認クリックを足す
- [x] `tests/e2e/table.spec.ts` の `waitForMyDiscard` に確認クリックを足す
- [x] `tests/e2e/casino.spec.ts` の `playToEnd` に確認クリックを足す
- [x] 「役成立のトーストは一定時間で消える」を確認ゲートのテストに置き換える
- [x] `tests/e2e/rules.spec.ts` が影響を受けないことを確認する
- [x] 既存の E2E 63 件が通ることを確認する（64件に増えて全て通過）
- [x] **回帰テストが実際に落ちることを確かめる**
      （追加タスク: 停止を外すと5秒で山札が10枚減って落ちる）
- [x] **E2E ヘルパを `tests/e2e/helpers/table.ts` に集約する**
      （追加タスク: `playToEnd` の写しが2箇所にあり、同じ修正を2回書いた）
- [x] 和了ゲートの E2E を `tests/e2e/winGate.spec.ts` に分ける（table.spec.ts が592行になったため）

## フェーズ6: 検証

- [x] ファイルサイズを `wc -l` で測り、400行を超えたものがないか確認する
- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
- [x] `npx playwright test`
- [x] ブラウザで確認する（自分のツモ / CPU の和了 / 持ち時間が減らない / 連続宣言）

## 実装後の振り返り

**実装完了日**: 2026-08-09

**規模**: 678 テスト / 29 ファイル（+11）、E2E 64件（+1、置換1）。
`loopReducer.ts` 344行 / `useGameLoop.ts` 303行 / `table.css` 311行 — いずれも基準内。
E2E は分割して `table.spec.ts` 314行 / `winGate.spec.ts` 99行 / `helpers/table.ts` 196行。

### 計画と実績の差分

| 項目 | 計画 | 実際 | 理由 |
| ---- | ---- | ---- | ---- |
| `pendingWin` | `WinPresentation \| null`（単数） | **`pendingWins` の配列** | 単数だと `reduce` が2つ `Declared` を出すようになった瞬間に片方が黙って消える |
| リデューサの停止 | 記載なし（効果の停止のみ） | **`ENGINE` / `TIMEOUT` を弾く**枝を追加 | 効果を止めても人間のクリックは止まらない |
| 単体テストの置き場 | `loopReducer.test.ts` に追加 | **`winGate.test.ts` を新設** | 既に435行あり、足すと基準を大きく超える |

追加タスクは3件。

| 追加項目 | 見つかったきっかけ |
| -------- | ------------------ |
| 回帰テストが落ちることの確認 | 7-3 で決めた手順をそのまま適用した |
| E2E ヘルパの集約 | `playToEnd` の写しが2箇所にあり、**同じ修正を2回**書いた |
| `winGate.spec.ts` への分割 | `table.spec.ts` が 592 行になった |

### 学んだこと

1. **「止める」は2層あり、効いている層を取り違えていた。**
   計画は `useEffect` の停止だけを挙げていたが、それだけでは
   **人間のクリックが止まらない**（オーバーレイの外側・キーボード・E2E からの直接操作）。
   リデューサ側で `ENGINE` / `TIMEOUT` を弾く枝を足した。
   実装後に確かめたところ、自動進行と持ち時間については
   **リデューサの弾きだけで止まる**（タイマーが1回発火して却下され、
   状態が変わらないので再予約もされない）。効果側の停止が単独で効いているのは
   **イベントの排出**だけで、そこは意図的にリデューサで弾いていないため。
   「両方入れた」で終わらせず、どちらが効いているかを確かめたことで、
   7-5 で `pending` を使うときに何を壊してはいけないかが分かった。

2. **写しがある処理は、変更が要るときに必ず片方を忘れる。**
   `playToEnd` は `table.spec.ts` と `casino.spec.ts` に別々にあった。
   確認クリックを足すとき、2箇所に同じコードを書いた。**今回は両方直したが、
   片方を忘れれば、そちらだけが原因の分かりにくいタイムアウトで落ちる**
   （テストが「押しているのに進まない」で止まるので、
   仕様変更のせいなのか新しい欠陥なのか区別しづらい）。
   `tests/e2e/helpers/table.ts` に集約した。7-5 で演出が入ると
   進行手順はもう一度変わるので、そのときに効いてくる。

3. **単数で持つと、失われたことに気づけない。**
   `reduce` は今のところ1回に最大1つしか `Declared` を出さない
   （`applyWin` の呼び出しは2経路で、連続宣言は次のアクションを待つ）。
   単数で持てば動く。しかし将来2つ出るようになったとき、
   単数なら**片方が黙って消え、点数だけが動く**——プレイヤーからは点数バグに見える。
   配列にしたうえで「1回の和了につき1回確認する」を要件どおり表現した。
   `scoresBefore` をイベント列の畳み込みで作ったのも同じ理由で、
   `reduce` 後の点数から逆算すると複数和了で全部が同じ値になる。

4. **計画に書いてあった落とし穴は、書いてあっただけでは防げない。**
   「E2E の `playToEnd` が全滅する」は計画にも CLAUDE.md にも書いてあった。
   それでも、着手時に**先にヘルパを直す**手順にしていなければ、
   実装を終えてから大量の赤を見ることになっていた。
   書いてある落とし穴は、**着手手順に落として初めて機能する**。

### 積み残し（意図的）

- `WinOverlay` は最小限（誰が・何の役で・何点 + 確認）。カットイン・得点移動・
  順位移動は 7-5。見せ方を作り込んでから止め方を直すと演出を2回書き直す
- `src/ui/board.css` 406行 / `src/engine/yaku.ts` 410行 / `deck.ts` 406行は基準超過のまま
- `tests/engine/game.test.ts` 923行ほか、エンジンのテストが大きい。今回は触っていない

### 次回への改善提案

- **Step 7-5 は `loop.events`（`pending`）を使う。** 確認待ちの間は排出が止まるので、
  演出は元データを確実に読める。ここを外すと演出が空振りする
- **順位の移動には `computeRanking` の抽出が要る**（`src/engine/turnFlow.ts:13`）。
  対局中の順位にはエンジン側の対応物がないため、終局時と演出で二重実装になりやすい
- E2E の進行手順を変えるときは `tests/e2e/helpers/table.ts` の1本だけを直す
