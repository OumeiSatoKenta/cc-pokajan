# タスクリスト

## フェーズ1: 純粋ロジック（`src/ui/hooks/loopReducer.ts`）

- [x] `LoopState` / `LoopAction` の型定義
- [x] `createLoopReducer(rules)` — `ENGINE` / `EVENTS_CONSUMED` の処理、`default` で網羅性検査
- [x] `createInitialLoopState(roster, rules, seed)` — `createGame` を呼んで初期状態を作る
- [x] `decideAutoAction(game, rules, ai, humanSeat)` — フェーズごとの自動進行の判断
  - [x] `selfDeclare` は `declarer`、`draw` / `discard` は `turn` を対象にする
  - [x] `claimWindow` は**人間以外の未表明 CPU を優先して処理**する
  - [x] 人間に割り込める役がなければ自動 `PASS`（宣言フェーズと対称）
  - [x] `gameOver` では `null` を返す
- [x] `autoActionKey(game, action)` — 決定の同一性を表す文字列（タイマー維持の判定に使う）
- [x] アクション種別ごとの遅延値と `EVENT_HOLD_MS` を定数として定義する

## フェーズ2: フック（`src/ui/hooks/useGameLoop.ts`）

- [x] `useReducer` + `useMemo` でリデューサを1回だけ作る
- [x] 自動進行の `useEffect` — **依存は `autoKey`**（`loop.game` 丸ごとにしない）
- [x] 最新の決定を参照する `autoRef`（古いクロージャの値を dispatch しない）
- [x] 宣言受付の `useEffect` — **時間切れの1回だけ `TICK` を送る**（繰り返さない）
- [x] イベントキュー排出の `useEffect`
- [x] 派生値の算出（`waits` / `declarable` / `claimable` / `canDiscard`）を `useMemo` で
  - [x] 候補は `engine/yaku` の `findYaku` を直接使う（`ai.ts` は最良1件しか返さない）
- [x] 操作関数（`discard` / `declare` / `claim` / `pass` / `restart`）
  - [x] `pass()` はフェーズに応じて `SKIP_DECLARE` / `PASS` を切り替える
  - [x] `restart()` はシードを変えて新しい対局を作る
- [x] シードの決定（`?seed=` があれば使い、なければ `Date.now()`）
- [x] 高速モード（`?fast=1`）で遅延を 0 にする

## フェーズ3: 表示部品（`src/ui/components/`）

- [x] `CardView` — 色・名前・ボーナス印・待ちの黄色枠・裏面表示
- [x] `Hand` — 自分の手札。クリック可否の制御と `AnimatePresence`
- [x] `DiscardPile` — 河
- [x] `PlayerSeat` — 他家の伏せ枚数・点数・直近の捨て札
- [x] `BoardInfo` — 山札残り・ボーナスメンバー・今局のグループと達成状況
- [x] `TimerBar` — 宣言受付の残り時間
- [x] `ActionBar` — 宣言ボタン・見送るボタン・`TimerBar`
- [x] `YakuToast` — 役成立の演出
- [x] `ResultOverlay` — 終局時の順位と最終点数、もう1局

## フェーズ4: 対局画面（`src/ui/screens/TableScreen.tsx`）

- [x] `useGameLoop` を呼び、各部品へ状態を配る
- [x] レイアウト（CSS Grid の `grid-template-areas`）
- [x] 375px 幅への対応
- [x] `prefers-reduced-motion` への対応

## フェーズ5: アプリへの組み込み

- [x] `src/App.tsx` を画面ステートマシンに差し替え（本 Step では `table` のみ）
- [x] `src/App.css` の整理（動作確認画面用のスタイルを削除・移設）

## フェーズ6: テスト

- [x] `tests/ui/loopReducer.test.ts` — `createLoopReducer` の遷移
- [x] `tests/ui/loopReducer.test.ts` — `EVENTS_CONSUMED` によるキューの排出
- [x] `tests/ui/loopReducer.test.ts` — 未知のアクションで例外
- [x] `tests/ui/loopReducer.test.ts` — `decideAutoAction` のフェーズごとの判断
- [x] `tests/ui/loopReducer.test.ts` — 人間の入力待ちで `null` を返す
- [x] `tests/ui/loopReducer.test.ts` — **`claimWindow` で人間より CPU が先に処理される**
- [x] `tests/ui/loopReducer.test.ts` — **人間に割り込める役がなければ自動 `PASS` になる**
- [x] `tests/ui/loopReducer.test.ts` — **`gameOver` では `null` を返す**
- [x] `tests/ui/loopReducer.test.ts` — **`autoActionKey` が決定の変化を検出し、無関係な変化では変わらない**
- [x] `tests/ui/actionBar.test.ts` — ボタンの出し分けを純粋関数として検証（配線テスト）
- [x] `tests/ui/App.test.tsx` — 対局画面が例外なくレンダリングされる
- [x] `playwright.config.ts` と `npm run test:e2e` の追加
- [x] `tests/e2e/table.spec.ts` — 手札が7枚表示される
- [x] `tests/e2e/table.spec.ts` — カードをクリックして捨てられる
- [x] `tests/e2e/table.spec.ts` — 固定シードで待ちの黄色枠が表示される
- [x] `tests/e2e/table.spec.ts` — **宣言窓で放置すると時間切れで自動パスされ進行が続く**
- [x] `tests/e2e/table.spec.ts` — **人間が宣言窓で迷っている間も CPU の意思表示が処理される**
- [x] `tests/e2e/table.spec.ts` — 1局を最後まで進めて終局に到達する

## フェーズ7: 検証と仕上げ

- [x] ファイルサイズの計測（`wc -l`。400行超があれば分割）
- [x] ブラウザでの目視確認（可能なら）
- [x] バンドルサイズの確認（gzip 150KB 以内）
- [x] `README.md` の実装状況・構成を更新
- [x] **`docs/functional-design.md` を更新**（`useGameLoop` のインターフェースと、
      `requestAnimationFrame` → 時間切れ1回の `TICK` への変更を反映）
- [x] `npm run lint` / `typecheck` / `test` / `build` / `format:check` をすべて PASS

## フェーズ8: レビュー指摘への対応

実装検証 + 3軸コードレビューの指摘に対応した分。

### [必須]

- [x] 受け付けられないアクションで**画面全体がクラッシュする経路**を塞ぐ
      （リデューサで `IllegalActionError` だけを見送り、それ以外は伝播させる）
- [x] `ErrorBoundary` を設置し、想定外の例外でも白画面にせず復帰導線を出す
- [x] 終局理由を UI で再導出せず、エンジンの `GameOver` イベントから写し取る

### [推奨]

- [x] **演出イベントの排出タイマーが毎回張り直される**問題を修正（トーストが消えなくなる）
- [x] `autoRef` のレンダー中書き換えを `useEffectEvent` に置き換える
- [x] `restart` のシードを `game.seed` から採番し、props とのドリフトをなくす
- [x] `seatName` を人間の席からの相対位置で解決する（`humanSeat !== 0` で破綻しない）
- [x] `autoActionKey` の `switch` に `never` による網羅性検査を追加
- [x] `hint` を純粋関数 `hintFor` に切り出してテスト可能にする
- [x] `BoardInfo` / `ResultOverlay` が `GameState` 丸ごとではなく必要な値だけ受け取る
- [x] `countPendingCpuClaims` を `loopReducer` に置き、`claims` の構造知識の重複を解消
- [x] E2E のクリック失敗の握りつぶしを減らし、可視性を確かめてから操作する
- [x] `docs/functional-design.md` の UC-2 シーケンス図を単発 `TICK` 設計に更新
- [x] `design.md` のレイアウト方式（grid → flex）とタイマー実装の記述を実装に合わせる

### [提案]

- [x] `nameOf` ヘルパを追加し、4ファイルの重複を解消
- [x] 未使用の `CardBack` を削除
- [x] `ResultOverlay` に `role="dialog"` / `aria-modal` / `aria-labelledby` を付与
- [x] 見出しレベルの飛び（h1 → h3）を解消
- [x] `TimerBar` を装飾扱い（`aria-hidden`）にする
- [x] `candidateKey` の同一性（役種・同色・消費カード・並び順）を直接テスト

### 検討したが採用しなかったもの

- [x] ~~`framer-motion` → `motion` パッケージへの移行~~
      （理由: `motion@13.0.0` は `framer-motion@^13.0.0` に**依存する**ラッパーであり、
      移行しても framer-motion は依存ツリーに残る。`framer-motion` に npm の
      非推奨マークもない。パッケージが1つ増えるだけで実質的な利点がないため見送る）

## 検証ゲート

| コマンド               | 結果                                    |
| ---------------------- | --------------------------------------- |
| `npm test`             | ✅ 334 tests / 12 files（Step 4 で +53） |
| `npm run test:e2e`     | ✅ 9 scenarios（Playwright / 実ブラウザ） |
| `npm run lint`         | ✅                                      |
| `npm run typecheck`    | ✅                                      |
| `npm run build`        | ✅ gzip 112.9KB（目標 150KB）           |
| `npm run format:check` | ✅                                      |

## 実装後の振り返り

**実装完了日**: 2026-08-07

### 計画と実績の差分

| 項目             | 計画                       | 実績                                        |
| ---------------- | -------------------------- | ------------------------------------------- |
| 新規ファイル     | 13                         | **16**（`labels.ts` / `ErrorBoundary` / `hintFor` を追加） |
| テスト数         | —                          | +53（281 → 334）+ E2E 9本                   |
| jsdom の導入     | 見送る                     | 見送ったまま完了。純粋関数 + E2E で足りた   |
| レイアウト方式   | CSS Grid + `min()`         | **flexbox で等分**（375px で溢れたため変更）|
| `src/engine/`    | 変更しない                 | ✅ 変更なし                                 |

### 学んだこと

**1. 同じ形の間違いは隣にもある**

`loop.game` を依存に置いた効果が別経路の状態変化でタイマーを潰す、という問題は
着手前のドキュメントレビューが見つけ、`autoActionKey` で対策した。
ところが**まったく同じ形の効果がもう1つあり、そちらは無対策のまま残っていた**
（イベント排出の効果が `pending` 配列を依存にしていた）。

結果として、演出の間隔（260〜900ms）が保持時間（1600ms）より短いため
キューが一度も掃けず、**役成立のトーストが消えなくなる**という defect になっていた。
実装検証と API レビューの2つが独立に指摘した。

対策を1つ入れたら、**同じ構造の箇所が他にないかをその場で洗う**。
「1箇所直した」で満足すると、直した箇所の隣に同じ穴が残る。

**2. 「起こりえない」と「起きたらクラッシュする」は別の話**

受付時間の経過とプレイヤーのクリックは互いに無関係なタイミングで発火するため、
「押した瞬間に受付が閉じていた」という競合が構造上起こりうる。
エンジンはこれを `IllegalActionError` として正しく弾くが、
**UI 側に受け皿がなく、例外がそのまま React を貫通して白画面になる**経路だった。

エンジンの「不正な入力は必ず表面化させる」という方針は正しい。
ただしその方針は、**受け取る側が用意されていて初めて機能する**。
例外を投げる設計を採るなら、投げた先の設計もセットで考える必要がある。

**3. スクリーンショットは E2E の代わりにならないし、逆も同じ**

E2E 9本が通っている状態で、375px でのレイアウト崩れと
「宣言ボタンが出ているのに『相手の手番です』と表示される」という2件を、
**スクリーンショットの目視だけが**見つけた。
逆に「トーストが消えない」は目視では気づけず、レビューの指摘で分かった。

自動テストは「動くか」を、目視は「まともに見えるか」を見ている。
どちらか一方では足りない。Chrome 拡張が使えなくても
**Playwright でスクリーンショットを撮れば目視の手段は確保できる**。

**4. 推奨をそのまま受け入れず、根拠を確かめる**

`framer-motion` → `motion` への移行を勧められたが、実際に調べると
`motion@13.0.0` は `framer-motion@^13.0.0` に**依存する**ラッパーで、
移行しても framer-motion は依存ツリーに残る。npm の非推奨マークもない。
公式のアップグレードガイドを引用した妥当な指摘だったが、
**このバージョンでは利点がなかった**ため見送った。

一方 `useEffectEvent` の提案は、実際に `@types/react` に型定義があることを
確認したうえで採用した。**確認してから判断する**という同じ手順で、
結論は逆になった。

### 次回への改善提案

- **効果（`useEffect`）を書いたら、依存配列に配列やオブジェクトを置いていないか
  ファイル内を通しで確認する**。1つ直したら同種を洗う
- **例外を投げる層と受ける層をセットで設計する**。Step 5 でストレージ層を足すときも、
  失敗時に誰が受けるかを先に決める
- Step 5 で画面遷移を追加する際、**`TableScreen` のアンマウントでタイマーが
  解除されることを実際に確認する**（現状は構造的に正しいだけで、
  アンマウント経路を通るテストがない）
- `claimWindowMs` が `(playerCount - 1) × CPU の判断遅延` より十分大きい、という
  暗黙の前提がある。Step 6 でルールを編集可能にする前に検証を入れる
