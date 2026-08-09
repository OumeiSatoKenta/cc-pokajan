# Step 5: カジノメタ — タスクリスト

## フェーズ1: 精算計算（エンジン）

- [x] `src/engine/types.ts` の `BetConfig` に `initialWallet` を追加する
- [x] `src/config/rules.ts` に `initialWallet: 10_000`（TODO 付き）を置く
- [x] `src/engine/payout.ts` に `PayoutBreakdown` / `computePayout` / `rankOf` を実装する
      （`floor` 丸め・BET 倍率は `min(options)` 基準・不正入力は例外）
- [x] `tests/engine/payout.test.ts` を作成する
      （倍率どおりの増減・4順位すべて・端数・不正な BET / 順位・素朴な別実装との突き合わせ）
- [x] `tests/config/rules.test.ts` に順位倍率と初期コインの不変条件を追加する
      （順位倍率は 0.5 の倍数・長さ = playerCount・単調非増加・初期コイン ≧ 最大 BET）
- [x] 精算式の期待値を自動対局200局で実測し、`rules.ts` と design.md に記録する
      （追加タスク: 実装前の確認で **1局あたり +1,017** という強いプレイヤー有利が判明）

## フェーズ2: 永続化

- [x] `src/storage/prefs.ts` に `Prefs` / `loadPrefs` / `savePrefs` を実装する
      （version・型検査・`try/catch`・localStorage 不在でも落ちない）
- [x] `tests/storage/prefs.test.ts` を作成する
      （往復・破損 JSON・型違い・負の残高・未知バージョン・storage 不在・書き込み失敗）
- [x] `.oxlintrc.json` に「エンジン → storage」「storage → UI」の禁止を追加する
      （追加タスク: 層の分離を文書ではなく lint で守る）
- [x] localStorage のキーを `docs/architecture.md` 記載の `cc-pokajan:prefs` に合わせる
      （追加タスク: 実装時に別名を使っており、既存ドキュメントと食い違っていた）

## フェーズ3: 画面ステートマシン

- [x] `src/ui/hooks/loopReducer.ts` の `LoopState` に `ranking` を追加し、`GameOver` から写し取る
- [x] `src/ui/hooks/useGameLoop.ts` で `ranking` を公開し、`restart` を削除する
- [x] `src/ui/screens/TableScreen.tsx` の順位の再導出を廃止し、`onSettle` を受け取る
- [x] `src/ui/components/ResultOverlay.tsx` の「もう1局」を「精算へ」に変える
- [x] `src/ui/appReducer.ts` に `AppState` / `AppAction` / `createAppReducer` を実装する
      （BET 不足と補充条件をリデューサ側で検査する）
- [x] `tests/ui/appReducer.test.ts` を作成する
      （遷移・BET 引き落とし・精算反映・不足時の拒否・補充条件・シード採番）
- [x] `tests/ui/loopReducer.test.ts` に「終局に至ると必ず順位が埋まる」不変条件を追加する
      （追加タスク: フォールバックを置かない判断の前提を固定する）

## フェーズ4: 画面

- [x] `src/ui/screens/TitleScreen.tsx` を作成する
- [x] `src/ui/screens/BetScreen.tsx` を作成する（不足時の無効化・補充導線）
- [x] `src/ui/screens/ResultScreen.tsx` を作成する（精算内訳・コイン増減）
- [x] `src/ui/casino.css` を作成する（375px でも破綻しないこと）
- [x] `src/App.tsx` を画面ステートマシンに差し替え、永続化を配線する
      （`TableScreen` は `key={seed}` で再マウント）
- [x] `appOptions.ts` に `seedFromUrl` を足し、URL 指定を保存値より優先する
      （追加タスク: 「指定が無かった」と「保存値と同じ値が指定された」を区別する）

## フェーズ5: テスト

- [x] `tests/ui/App.test.tsx` をタイトル画面の初期表示に追随させる
- [x] `tests/e2e/table.spec.ts` を BET 経由の導線に追随させる（`startGame` ヘルパへ集約）
- [x] `tests/e2e/casino.spec.ts` を作成する
      （BET → 対局 → 精算 → ウォレット反映 → リロード後も保持・BET 不足のガード・破損データ）

## フェーズ6: 検証

- [x] `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が全て通る
- [x] `npx playwright test` が通る（21件すべて）
- [x] ブラウザで実際に確認する（タイトル / BET / 対局 / 精算 / 375px）
- [x] ファイルサイズを `wc -l` で測り、400行を超えたものがないか確認する
- [x] `docs/functional-design.md` / `docs/architecture.md` を更新する

## 実装後の振り返り

**実装完了日**: 2026-08-08

### 計画と実績の差分

計画どおりに進んだ範囲が大きい。追加は6件で、そのうち**2件は実装前の確認で見つかった**。

| 追加項目                            | 見つかったきっかけ                                            |
| ----------------------------------- | ------------------------------------------------------------- |
| 精算式の期待値の実測                | 実装前に自動対局へ式を当てて確かめた                          |
| localStorage キーの統一             | `docs/architecture.md` を読み直したら実装と違う名前だった      |
| lint による層の分離                 | 「storage をエンジンから参照しない」を文書だけに書きかけた     |
| `seedFromUrl`                       | 「URL 指定なし」と「保存値と同じ値の指定」が区別できなかった   |
| 「終局なら順位が埋まる」不変条件    | フォールバックを置かない判断の前提が無検査だった              |
| `useGameLoop.restart` の削除        | 残すと **BET を払わずに対局を始められる**ことに気づいた        |

### 学んだこと

1. **式は実装する前に一度動かして確かめられる。**
   `computePayout` を書く前に、自動対局200局の最終点へ式を当ててみた。
   結果は1局あたり **+1,017**（BET 1000 に対して約 +100%）で、
   所持コインが増え続ける設計だと分かった。計画書どおりに実装したうえで
   `TODO(要実機確認)` と実測値を残せたのは、書く前に測ったからである。
   実装後に気づいていたら「バランスが悪いのは実装のせいか仕様のせいか」を
   切り分けるところからやり直しになっていた。

2. **既定値では到達しないコードパスがある。**
   同じ実測で「`最終点 × 2.5` が端数になった局は0件」も分かった。
   役の点数もボーナス加点もすべて偶数なので最終点が常に偶数になり、
   切り捨てが一度も働かない。**通常の対局をいくら回しても丸めの正しさは検証されない。**
   奇数の点数を直接与える単体テストを別に用意した。
   Step 2・3 で繰り返し出てきた「たまたま成り立っている条件」の一種で、
   今回は測ったことで先に気づけた。

3. **機能を足すと、既存の導線が抜け穴になることがある。**
   `useGameLoop.restart` は Step 4 では正しい機能だった。BET を導入した瞬間に
   「無料で next game を始められる経路」に変わった。**新しい制約を入れたら、
   既存の入口をすべて数え直す必要がある。** 消したことで
   「対局を生成できるのは App だけ」という単純な不変条件も手に入った。

4. **ガードだけを実装すると詰みを作る。**
   「BET 額に満たなければ選べない」は要求どおりだが、それだけだと
   所持コインが尽きた時点で全ボタンが無効になり、localStorage に残るので
   リロードでも回復しない。要求に書かれていなくても、
   **回復不能な状態を作る実装は未完成**として補充導線を足した。

5. **ドキュメントは実装の前後で読み直す価値がある。**
   localStorage のキーは `docs/architecture.md` に既に決めてあったのに、
   実装では別の名前を使っていた。書いた本人が忘れる程度には、
   仕様は書いただけでは守られない。

### 次回への改善提案

- **Step 6 に入る前にプレイテストする。** Step 4b の教訓どおり、
  カジノループの体感（BET の刻み・初期コイン・1局の長さ）は遊ばないと分からない。
  特に今回の実測が示すとおり収支が右肩上がりなので、緊張感が出ない可能性が高い
- **`initialWallet` と順位倍率は Step 6 のルール設定画面に必ず載せる。**
  どちらも `TODO(要実機確認)` で、調整が要ると分かっている値である
- **`ResultOverlay` と `ResultScreen` の役割分担を維持する。**
  精算の情報を増やしたくなったとき、オーバーレイ側に足すと重複が戻る
