# Step 4b: プレイテスト反映 — タスクリスト

## フェーズ1: ルール値の再構成（R2 の土台）

- [x] `src/engine/types.ts` に `TurnTimerConfig` を追加し、`claimWindowMs` を `turnTimer` に置き換える
- [x] `src/engine/game.ts` の `applyDiscard` の参照先を `rules.turnTimer.initialMs` に付け替える
- [x] `src/config/rules.ts` に `turnTimer: { initialMs: 20_000, decrementMs: 5_000, minMs: 5_000 }` を置く
- [x] `claimWindowMs` の残存参照を全て解消する（`grep -rn claimWindowMs src tests`）
- [x] `npm run typecheck` が通ることを確認する

## フェーズ2: 持ち時間のロジック（`loopReducer.ts`）

- [x] `LoopState` に `timeLimitMs` / `drawnUid` を追加し、`createInitialLoopState` で初期化する
- [x] `nextTimeLimitMs(current, rules)` を実装する（下限で飽和）
- [x] `autoDiscardUid(hand, drawnUid)` を実装する（在籍確認 + 末尾フォールバック）
- [x] `decideTimeout(game, humanSeat, drawnUid, rules)` を実装する（3フェーズ + キー生成）
- [x] `LoopAction` に `TIMEOUT` を追加し、リデューサで処理する
      （成功時のみ減算・`IllegalActionError` では減算しない）
- [x] `CardDrawn` / `Discarded` イベントから `drawnUid` を更新する
- [x] `RESTART` で持ち時間が初期値に戻ることを確認する

## フェーズ3: 持ち時間の駆動（`useGameLoop.ts`）

- [x] 既存の「宣言受付の時間切れ」効果を `decideTimeout` ベースの効果に置き換える
- [x] `timeLimitMs` / `drawnUid` / `timerKind` を `GameLoop` から公開する
- [x] 依存が `[timeoutKey, timeLimitMs]` だけであることを確認する（`game` を含めない）

## フェーズ4: 表示（R1・R2 の UI・R3）

- [x] `src/ui/handOrder.ts` に `sortHand` を実装する
- [x] `BoardInfo` に各グループの構成メンバーを列挙する（所持・ボーナスの区別）
- [x] `TimerBar` を `turn-timer` に改名し `data-timer-kind` を付ける
- [x] `ActionBar` でバーの描画をボタンの有無から独立させる
- [x] `Hand` で引いた1枚を区別して描画する
- [x] `TableScreen` で `sortHand` を適用し、タイマーの props を配線する
- [x] `table.css` にメンバー一覧・ツモ牌・タイマーのスタイルを追加する
- [x] `App.tsx` に `?turnMs=` の読み取りを追加する
- [x] `?turnMs=` が下限も一緒に下げるようにする
      （追加タスク: 初期値だけ下げると時間切れのたびに持ち時間が**伸びる**）
- [x] `readOptions` / `withTurnMs` を `src/appOptions.ts` へ分離する
      （追加タスク: コンポーネント以外の export で Fast Refresh が効かなくなるため）

## フェーズ5: テスト

- [x] `tests/ui/handOrder.test.ts` を新規作成する
      （グループ順・メンバー隣接・色順・ツモ牌の位置・端条件）
- [x] `tests/ui/loopReducer.test.ts` に持ち時間のテストを追加する
      （時間切れで減る / 時間内なら減らない / 下限で飽和 / ロンと打牌で共有 /
      競合で無効だったときに減らない / ツモ切りの対象 / `decideTimeout` のキー安定性）
- [x] `tests/config/rules.test.ts` を `turnTimer` に追随させる
- [x] `tests/ui/App.test.tsx` を `turnTimer` に追随させる
- [x] `tests/e2e/table.spec.ts` のセレクタを `data-timer-kind="claim"` に変更する
- [x] `tests/e2e/table.spec.ts` に「打牌を放置するとツモ切りされて進行が続く」を追加する
- [x] E2E 全体が現実的な時間で通ることを確認する（12件 / 13.3秒）
- [x] `YakuToast` に `data-toast-key` を足し、トーストのテストを個体識別に変える
      （追加タスク: 進行が止まらなくなったため「トーストが1つも無い」では判定できない）

## フェーズ6: 検証

- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が全て通る
- [x] `npx playwright test` が通る（12件すべて）
- [x] ブラウザで実際に確認する（グループ一覧 / 打牌タイマー / ツモ切り / 手札の並び / 375px）
- [x] ファイルサイズを `wc -l` で測り、400行を超えたものがないか確認する
- [x] `loopReducer.ts`（555行）を `loopReducer` / `autoAction` / `turnTimer` に分割する
      （追加タスク: 基準超過を計測で検出）
- [x] 分割に合わせて `tests/ui/loopReducer.test.ts`（978行）も3ファイルに分割する
- [x] `docs/functional-design.md` の `claimWindowMs` 記述を更新する

## 実装後の振り返り

**実装完了日**: 2026-08-08

### 計画と実績の差分

計画どおりに進んだ範囲が大きい。追加になったのは5件で、いずれも
**実装中に「たまたま成り立っている条件」を見つけたことによる**。

| 追加項目                                   | 見つかったきっかけ                                             |
| ------------------------------------------ | -------------------------------------------------------------- |
| `?turnMs=` が下限も下げる                  | E2E で 1.5 秒を指定したら、時間切れ後に持ち時間が5秒へ**伸びた** |
| `createLoopReducer` に `humanSeat` を渡す   | `drawnUid` の追跡が「引くと捨てるが交互に来る」性質に依存していた |
| `applyEngine` の `accepted` フラグ         | 受理の可否をオブジェクト参照の同一性で判定しかけた              |
| `data-toast-key`                           | 進行が止まらなくなり、既存のトーストのテストが破綻した          |
| `loopReducer.ts` の分割                    | 555行。計測して初めて気づいた                                   |

計画になかった仕様判断を1つ入れた: **`selfDeclare`（ツモ宣言）にも持ち時間を適用した**。
要求は「ロンと打牌」だけだったが、このフェーズも人間の入力を無期限に待つため、
ここを無制限のままにすると「放置しても進行が止まらない」という R2 の目的が達成されない。
フリテンがないため自動見送りされても次巡に同じ役を宣言し直せる（回復可能）ことも根拠にした。

### 学んだこと

1. **プレイテストでしか見つからない欠陥がある。**
   Step 4 完了時点で 334 のユニットテストと 9 の E2E が通り、自動対局100局も完走していた。
   それでも「グループの構成メンバーが見えない」「打牌に制限時間がない」は残っていた。
   CPU は `AiView` から全グループを参照でき、思考時間を持たず、手札の並び順に影響されない。
   **CPU が代理できない情報経路は、CPU による自動対局では原理的に検証できない。**

2. **既存のテストが「進行が止まる」ことに暗黙に依存していた。**
   打牌に持ち時間を入れた結果、人間が操作をやめても対局が進み続けるようになり、
   「役成立のトーストは一定時間で消える」が壊れた。トーストが1件も無いことを
   期待していたが、CPU が打ち続けるので別のトーストが出る。
   個体を識別する属性（`data-toast-key`）で「**その1件が**消える」を見る形に直した。
   Step 4 でカードの検証を uid ベースに直したのと同じ構図で、同じ轍を踏んだ。

3. **同じ概念に2つの真実を置かない。**
   `claimWindowMs` を残したまま `turnTimer` を足すこともできたが、
   どちらも「受付が開いている長さ」を表すため、Step 6 の設定画面で
   片方だけ変更されたときに静かに食い違う。置き換えを選んだ結果、
   エンジンの変更は1行（参照先の付け替え）で済んだ。

4. **摩耗する値を扱うときは、境界の整合を型ではなく検査で守る必要がある。**
   `initialMs < minMs` は型としては正しいが、意味としては壊れている
   （時間切れのたびに持ち時間が伸びる）。`tests/config/rules.test.ts` に
   3値の関係を検査する項目を足し、`withTurnMs` 側でも下限を連動させた。

5. **ファイルサイズは計測しないと分からない。**
   CLAUDE.md に「フェーズの区切りごとに `wc -l` で測る」と書いてあり、
   実際に測ったから 555 行に気づけた。書いてあるだけでは Step 3 で機能しなかった。

### 次回への改善提案

- **Step 5 に入る前にもう一度プレイテストする。** 今回の3件はすべて実プレイ由来で、
  自動検証をいくら足しても出てこなかった。BET を賭けさせる前に体感を確かめる価値がある
- **人間の入力を無期限に待つ状態を作らない、を不変条件として明文化する。**
  今回 `selfDeclare` が該当したように、新しいフェーズを足すたびに同じ穴が空きうる。
  「`decideAutoAction` と `decideTimeout` のどちらかが必ず非 `null` を返す」形の
  検査をテストに入れることを検討する（今回は入れていない）
- **E2E の持ち時間は `?turnMs=` で明示する。** 既定の20秒で回すと
  1件あたり20秒かかる。時間に依存するテストを足すときは必ず指定する
