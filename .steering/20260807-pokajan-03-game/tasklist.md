# タスクリスト

## フェーズ1: 型の拡張

- [x] `types.ts` に `GameState.declarer` を追加し、意味と `turn` との違いをコメントで説明する
- [x] `types.ts` に不正アクション用のエラー型を定義する（またはエラーを `game.ts` に置く方針を確定する）

## フェーズ2: 状態機械の骨格（`src/engine/game.ts`）

- [x] `createGame(roster, rules, seed)` — `setupGame` を呼び、`phase: 'draw'` の初期状態を組み立てる
- [x] `reduce(state, action, rules)` のディスパッチ構造とフェーズ別ハンドラの枠を作る
- [x] `gameOver` 到達後はどのアクションでも状態が変わらないようにする
- [x] フェーズが受け付けないアクションで例外を投げる

## フェーズ3: 通常進行（引く → 捨てる → 手番交代）

- [x] `DRAW` — 山札先頭を手番プレイヤーへ移し `selfDeclare` へ。空なら `gameOver(wallEmpty)`
- [x] `DRAW` で `declarer = turn` と `chainCount = 0` を設定する（省略すると手札枚数検査が静かに誤動作する）
- [x] チェーン脱出の共通処理 — `declarer === turn` なら `discard`、そうでなければ次の手番の `draw` へ
- [x] `SKIP_DECLARE` — チェーン脱出処理を呼ぶ（`discard` 固定にしない）
- [x] `DISCARD` — 手札から河へ移し `claimWindow` へ。手札にない uid は例外
- [x] 手番交代処理（反時計回り = ID 昇順）と `TurnChanged` イベントの発行
- [x] `expectedHandSize` ヘルパ（`declarer === turn` をゲート条件に含める）と、進行中の手札枚数検査

## フェーズ4: 割り込み宣言

- [x] `resolveClaimWinner` — 点数最大 → 捨て札プレイヤーから近い順の優先度解決（独立した純関数）
- [x] 候補の再計算による検証ヘルパ（偽装候補を弾き、エンジンが再計算した候補を採用する）
- [x] `CLAIM` — 受理の瞬間に `findYaku([...hand, discard], ctx, discard)` で再計算して格納する
- [x] `CLAIM` / `PASS` — 手番プレイヤー自身・二重表明は例外
- [x] `TICK` — 受付時間の減算と、時間切れ時の未表明プレイヤーのパス扱い
- [x] 全員の意思表示が揃った時点で解決まで一気に進める（`resolveClaim` のまま返らない）

## フェーズ5: 和了処理

- [x] `DECLARE`（ツモ） — `findYaku(hand, ctx)` で再計算して検証し、`state.declarer` 以外からの宣言は例外
- [x] `DECLARE` — `settleTsumo` で精算し、消費・補充・`Declared` / `Paid` / `Refilled` を発行
- [x] ロン成立時 — `settleRon` で精算し、消費・補充後に `declarer` をロンしたプレイヤーにして `selfDeclare` へ
- [x] 補充処理（補充枚数 = 手札から消費した枚数）と、山札が供給しきれない場合の `gameOver(wallEmpty)`
- [x] 処理順序を `精算 → 消費 → 補充 → 終了判定` に固定する（和了のロールバックはしない）
- [x] 連続宣言のカウントと、遷移時に適用する `maxChainDeclare` ガード（`DECLARE` を例外で弾かない）

## フェーズ6: 終了判定

- [x] 精算のたびに点数0以下を検査し `gameOver(bankrupt)` にする
- [x] 破産と山切れが同時成立したときは `bankrupt` を優先する
- [x] 順位確定（点数降順・同点は ID 昇順）と `GameOver` イベントの発行

## フェーズ7: CPU AI（`src/engine/ai.ts`）

- [x] `AiView` 型と `toAiView(state, playerId, rules)` — 公開情報だけを切り出す
- [x] `AiConfig` と `AI_PRESETS`（easy / normal / hard）
- [x] `evaluateTargets` — 各ターゲットの `need` と割引後の価値を算出
- [x] `chooseDiscard` — 損失最小のカードを決定的に選ぶ
- [x] `decideDeclare` / `decideClaim` — 役が成立していれば最良候補を返す
- [x] `safety` パラメータによる終盤の放銃回避（河の公開情報のみを根拠にする）

## フェーズ8: 自動対局（`src/engine/autoplay.ts`）

- [x] `playGameToEnd` — フェーズごとに AI の判断をアクションへ変換して回す
- [x] `onStep` フックと `maxSteps` による無限ループ検知
- [x] `AutoplayResult` の統計収集（終了理由・打牌数・宣言回数・ロン回数）

## フェーズ9: テスト

- [x] `tests/engine/game.test.ts` — フェーズ遷移の基本経路
- [x] `tests/engine/game.test.ts` — 不正アクション・偽装候補が例外になる
- [x] `tests/engine/game.test.ts` — 割り込み優先度（強い役優先・同点は近い順・頭ハネ）
- [x] `tests/engine/game.test.ts` — 連続宣言と、`maxChainDeclare` を小さくした `rules` での打ち切り（例外にならず脱出する）
- [x] `tests/engine/game.test.ts` — ロン後の連続宣言がツモとして精算される / 手番が捨てた人の次へ進む
- [x] `tests/engine/game.test.ts` — ロンチェーン中、捨て終わった手番プレイヤーの手札が `handSize` のままである
- [x] `tests/engine/game.test.ts` — 補充中に山札が尽きたとき、精算は確定し `gameOver(wallEmpty)` になる
- [x] `tests/engine/game.test.ts` — 両方の終了理由と順位確定
- [x] `tests/engine/game.test.ts` — `TICK` による時間切れのパス扱い
- [x] `tests/engine/game.test.ts` — `reduce` が入力を破壊しない / `rngState` が変化しない
- [x] `tests/engine/ai.test.ts` — 役が揃えば必ず宣言する・最高点を選ぶ
- [x] `tests/engine/ai.test.ts` — 不要なカードを捨てる・決定的である
- [x] `tests/engine/ai.test.ts` — `AiView` に隠し情報が含まれない
- [x] `tests/engine/autoplay.test.ts` — 100局が例外なく完走する
- [x] `tests/engine/autoplay.test.ts` — 全ステップで不変条件（点数保存則・カード保存則・手札枚数）が成立する
- [x] `tests/engine/autoplay.test.ts` — 統計を実測し、回帰テストのレンジを確定する

## フェーズ10: 検証と仕上げ

- [x] 100局の統計を実測し、計画書のレンジ（山切れ 60〜80% / 平均打牌 30〜45）との差を評価する
- [x] `src/App.tsx` に自動対局のサマリ表示を追加する
- [x] `README.md` の構成・実装状況・設計方針を更新する
- [x] `npm run lint` / `typecheck` / `test` / `build` / `format:check` をすべて PASS させる

## フェーズ11: レビュー指摘への対応

実装検証 + 3軸コードレビューの指摘に対応した分。

### [必須]

- [x] `game.ts`（641行）を責務ごとに分割し、design.md の400行の取り決めを満たす（→ 298行）
- [x] `reduce` の `switch` に `default` を追加し、`never` による網羅性検査を入れる

### [推奨]

- [x] `lastDiscardBy as PlayerId` の3箇所を `requireDiscarder()` に置き換える
- [x] `reduce` の入口で `rules.playerCount` と対局人数の整合を検査する
- [x] `verifyCandidate` に形の検証を追加し、壊れた入力でも素の `TypeError` にしない
- [x] `defaultMaxSteps` にプレイヤー数を反映する（4人固定への暗黙依存を解消）
- [x] `Draft` を `GameState` からのマップ型で導出し、フィールド追加の取りこぼしを型エラーにする
- [x] `GameState.phase` を `ObservablePhase` にして過渡フェーズを型から除く
- [x] `applyWin` を `settleWin` / `consumeAndRefill` / `continueOrExitChain` に分割する
- [x] `CLAIM` の偽装候補・点数偽装のテストを追加する
- [x] ロンチェーン側で `maxChainDeclare` に達する経路のテストを追加する
- [x] 重い処理を `describe` 直下（収集フェーズ）から `beforeAll` へ移す
- [x] `App.tsx` の JSDoc から誤った記述を削除する（`useMemo` は StrictMode の二重実行を防がない）

### [提案]

- [x] `claims` を `Partial<Record<...>>` にし、「対象外」と「未表明」を区別する
- [x] `TRIPLE_SIZE` の二重定義を解消する（`yaku.ts` から export）
- [x] `toAiView` に `playerId` の範囲検証を追加する
- [x] `evaluateTargets` から寄与ゼロの候補を除く
- [x] `ronCount` / `summarizeAutoplay` の JSDoc を実装に合わせる
- [x] 真偽値の命名を `has` 接頭辞に揃える（`hasRefillShortage` / `hasPendingClaims`）
- [x] `lastDiscard` と `lastDiscardBy` は対で読むことを型定義にコメントで明記する

## 検証ゲート

| コマンド             | 結果                            |
| -------------------- | ------------------------------- |
| `npm test`           | ✅ 281 tests / 10 files（+84）  |
| `npm run lint`       | ✅                              |
| `npm run typecheck`  | ✅                              |
| `npm run build`      | ✅                              |
| `npm run format:check` | ✅                            |

## 実装後の振り返り

**実装完了日**: 2026-08-07

### 計画と実績の差分

| 項目             | 計画                          | 実績                                            |
| ---------------- | ----------------------------- | ----------------------------------------------- |
| 新規ファイル     | 3（game / ai / autoplay）     | **9**（責務分割で6ファイル追加）                |
| `game.ts` の行数 | 400行以内                     | 一度641行まで膨らみ、レビュー後に298行へ分割    |
| 統計の実機一致   | 山切れ 60〜80% / 平均打牌 30〜45 | **40% / 21.7**（乖離あり・原因分析を記録）    |
| テスト数         | —                             | +84（275 → 281、うちレビュー対応で +6）        |

### 学んだこと

**1. ドキュメントレビューは実装の手戻りではなく、設計の誤りそのものを潰せる**

着手前の `doc-reviewer` が、手札枚数の不変条件の式の誤りを指摘した。「手番プレイヤーはフェーズが
`selfDeclare`/`discard` なら +1枚」という定義は、ロンによる連続宣言中に破綻する（フェーズは
`selfDeclare` のまま `turn` が捨て終わったプレイヤーを指し続けるため）。

実装後に気づいていた場合、100局の不変条件チェックが**正しい実装を「壊れている」と誤検知する**か、
逆に**この誤った式に合わせて本物のカード保存則違反を作り込む**かのどちらかになっていた。
後者は特に危険で、テストが通っている状態で壊れたコードが残る。

Step 2 の教訓「テストが全部通っていることは正しいことを意味しない」の一段手前に、
**「そもそも検査式が正しいか」**という層があると分かった。

**2. 「自分で決めた基準」は自分では守れない**

design.md に「`game.ts` が400行を超えたら分割する」と、Step 2 の反省を踏まえて**先回りで**書いていた。
それにもかかわらず641行（1.6倍）まで書き進めてしまい、3つのレビューすべてから同じ指摘を受けた。

基準を文書に書くだけでは機能しない。書いた本人が実装中に自分の書いた閾値を参照しないからである。
Step 4 以降は、**フェーズの区切りごとに機械的に行数を測る**タスクをタスクリスト自体に埋め込む。

**3. 「黙って成功する」経路は例外を投げる経路より見つけにくい**

`reduce` の `switch` に `default` がなく、未知のアクションが**どの分岐にも入らずに素通りして
「状態が変わらない」形で正常終了**していた。281件のテストも、5つの検証ゲートも、
型検査もこれを検出できなかった。`switch` の後に `return` があると TypeScript の網羅性検査が
働かないためである。

同じファイルの `autoplay.ts` には `default: throw` があり、パターン自体は認識していた。
**「片方にはあるのに、もう片方にはない」**という非対称は、レビューで見つかりやすい欠陥の形をしている。

**4. 未確定値を1つの統計から逆算してはいけない**

実測の山切れ終了率40%が実機の69.7%と乖離しており、`startingScore` を1300〜1400にすれば
数字は一致した。しかし**破産を完全に取り除いても平均打牌数は28.1で飽和**し、実機の35には届かない。
これは初期点とは独立した差、すなわち CPU の宣言方針（役が揃えば即宣言）に由来する。

1つの統計に合わせて未確定値を調整すると、**AI 由来の誤差を初期点に押し付ける**ことになり、
「実機に合わせたつもりで、実機から二重に離れる」結果になる。推定値は推定値のまま残し、
感度分析を判断材料として記録するに留めた。

### 次回への改善提案

- **タスクリストにファイルサイズの計測タスクを入れる**。フェーズの終わりごとに `wc -l` を確認し、
  閾値を超えていたらその場で分割する。事後のレビューで指摘されてから直すと、
  テストの修正まで含めて手戻りが大きい
- **`switch` を書いたら `default` を書く**をルールとして `development-guidelines` 相当の場所に残す。
  判別共用体の網羅性検査は `never` への代入を伴わないと効かない
- **設計ドキュメントに「〜すれば検査で落ちる」と書いたら、その検査を実装するタスクを立てる**。
  今回 `rules` 差し替えの防御がドキュメント上の主張だけで存在しなかった。
  ドキュメントの記述と実装の対応を、レビューではなくタスクで担保する
- Step 4 着手前に **`reduce` と `useReducer` の接続方法**を決める（design.md の申し送り参照）。
  戻り値が `{ state, events }` なので素直には載らない
