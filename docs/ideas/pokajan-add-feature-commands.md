# ポカジャン — `/add-feature` 実行コマンド一覧

本書は [pokajan-plan.md](./pokajan-plan.md) の実装を 6 つの独立した `/add-feature` コマンドに分割したものである。各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

なお **Step 4b** は当初計画にはなく、Step 4 完了後の実プレイで判明した課題に対応するために後から追加したステップである（詳細は該当節の冒頭を参照）。

**Step 6b（カードの見た目）と Step 7（麻雀風の盤面）は本書に含まれない。**

- **Step 6b** — アップロード画像の非トリミングとグループ記号。会話でのフィードバックから直接実装したため
  `/add-feature` コマンドを持たない。作業記録は `.steering/20260809-pokajan-06b-card-visual/`、
  設計は [functional-design.md](../functional-design.md) の「カードの見た目」節にある
- **Step 7** — 盤面を麻雀ゲームに近づける。計画は
  [pokajan-mahjong-board-plan.md](pokajan-mahjong-board-plan.md)、
  コマンド一覧は [pokajan-mahjong-board-add-feature-commands.md](pokajan-mahjong-board-add-feature-commands.md) にある

**重要**: 各 `/add-feature` コマンドのプロンプトには「参照ドキュメント: `docs/ideas/pokajan-plan.md`」が含まれており、実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**: リポジトリは空（`docs/ideas/` の計画書 2 点のみ）。Step 1 がプロジェクト初期化を兼ねる起点となる。

## 実行順の全体像

```
Step 1: 基盤・型定義・山札生成
   ↓   ← npm test / build が通る（UIなし・engine の土台が揃う）
Step 2: 役判定・点数・支払い
   ↓   ← 全役 × 通常/同色 × ボーナスの点数計算が正しい
Step 3: 対局状態機械 + CPU AI
   ↓   ← ★ CPU 四人の自動対局が 100 局完走（ゲームとして成立）
Step 4: 対局UI
   ↓   ← ★ ブラウザで人間が 1 局遊べる
Step 4b: プレイテスト反映（情報提示・持ち時間・手札整列）  ← 実プレイを受けて後から追加
   ↓   ← ★ 「遊べる」から「まともに勝負できる」へ
Step 5: カジノメタ（BET / 精算 / ウォレット）
   ↓   ← ★ BET → 対局 → 精算のループが完成
Step 6: ロスターエディタ + ルール設定
       ← ★ 素材アップロードでキャラを差し替えられる（全機能完成）
```

**ポイント**:

- Step 1〜3 は UI を一切書かずにゲームロジックを完成させる。ここでの不変条件テスト（点数保存則・手札7枚不変）が以降の全ての土台になる
- Step 3 完了時点で「ゲームとして成立している」ことが自動対局で証明されるため、Step 4 以降の UI 作業でロジックを疑う必要がなくなる
- Step 4・5 はそれぞれ単独でユーザーに価値が出る（遊べる → 賭けられる）ため、途中で止めても成果物になる
- **Step 4b は Step 5 より先に入れる**。BET を賭けさせる前に「勝負として成立している」必要があるため
- 各ステップ後に `npm run lint:fix && npm run format && npm run build && npm test` が PASS することをゲートとする

---

## Step 1: 基盤・型定義・山札生成

```
/add-feature ポカジャン 基盤・型定義・山札生成: Vite(react-ts) でプロジェクトを初期化し、ドメイン型・シード付き乱数・山札構築（144枚プールから100枚抽出）・配牌までを純粋TSで実装する。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 1 範囲のみ実装)
```

**実装内容**:

- 新規: プロジェクト基盤
  - `npm create vite@latest . -- --template react-ts`
  - `package.json` scripts: `dev` / `build` / `preview` / `test` / `lint` / `lint:fix` / `format`
  - 依存追加（dep）: `framer-motion`
  - 依存追加（devDep）: `vitest` / `@playwright/test` / `eslint` / `prettier` / 各種 TS 設定
  - `.gitignore` / `tsconfig.json` / `vitest.config.ts` / `.prettierrc`
- 新規: `src/engine/types.ts`
  - `ColorId` / `YakuKind` / `Phase` / `Card` / `Member` / `Group` / `Roster` / `YakuCandidate` / `Player` / `GameState` / `Action` / `GameEvent`
- 新規: `src/engine/rng.ts`
  - mulberry32 のシード付き PRNG、`shuffle(array, rng)`、状態のシリアライズ
  - **エンジン内で `Math.random()` を使わない**方針を明記
- 新規: `src/engine/deck.ts`
  - `selectGroups(roster, rules, rng)` — 今局の4グループを選出
  - `buildDeck(members, rules, rng)` — メンバー×3色×3枚のプール（108〜144枚）を作り、シャッフルして 100 枚を抽出
  - `selectBonusMembers(members, rules, rng)`
  - `deal(deck, rules)` — 4人に7枚ずつ配り、残りを壁として返す
  - `validateRoster(roster, rules)` — グループ数≥4 / 各3〜5人 / 総メンバー≥12
- 新規: `src/config/rules.ts`
  - `RulesConfig` 型と `DEFAULT_RULES`。未確定値には `TODO(要実機確認)` コメント
  - `group3.sameColor` と `startingScore` が推定値であることをコメントで明示
- 新規: `src/config/defaultRoster.ts`
  - オリジナル仮ロスター 6 グループ / 24 人（サイズ 3,3,4,4,5,5）。公式素材は一切使わない
- 新規テスト:
  - `tests/engine/deck.test.ts` — 山札がちょうど 100 枚 / 1メンバーあたり ≤9枚 / 1メンバー1色あたり ≤3枚 / 同一シードで完全再現 / 配牌後の壁が 72 枚 / `validateRoster` が不正ロスターを弾く

**動作確認**:

- `npm run lint:fix && npm run format && npm run build` PASS
- `npm test` PASS（新規テストのみ）
- `npm run dev` でデフォルトの Vite 画面が起動する

**依存**: なし（起点）

---

## Step 2: 役判定・点数・支払い

```
/add-feature ポカジャン 役判定・点数・支払い: 3カード/3〜5人組の役判定、同色ボーナスとボーナスホロメン加点を含む点数計算、ツモ1/3分配とロン全額の支払い処理、リーチ表示用の待ち計算を実装する。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 2 範囲のみ実装、Step 1 完了前提)
```

**実装内容**:

- 新規: `src/engine/yaku.ts`
  - `findYaku(hand, ctx, required?)` — 3カード / N人組の全候補を列挙。同色版も候補に含める
  - `required` 指定時は「その1枚を抜いた手札では成立しない候補のみ」に絞る（ロン判定）
  - `bestYaku(candidates)` — 点数最大 → 残り手札の価値が高い方で選択
  - `computeWaits(hand, ctx)` — 登場メンバー×3色（最大48通り）の総当たりで待ちカード集合と寄与する手札カードを返す
- 新規: `src/engine/score.ts`
  - `scoreCandidate(candidate, ctx, rules)` — `scores[kind][通常|同色] + bonusPerCard × ボーナス枚数`
  - 同色判定（候補の構成カードが全て同一 `ColorId`）
- 新規: `src/engine/settle.ts`
  - `settleTsumo(state, winner, score)` — 他3人が 1/3 ずつ支払い（全点数が3で割り切れるため整数演算）
  - `settleRon(state, winner, discarder, score)` — 放銃者が全額
  - 0 クランプ（点数が負にならない・不足分は残額のみ徴収）
- 新規テスト:
  - `tests/engine/yaku.test.ts` — 役4種 × 通常/同色 × ボーナスあり/なしの全組み合わせ、`required` 制約、複数候補からの最良選択、`computeWaits` の正しさ
  - `tests/engine/score.test.ts` — 点数表どおりの計算、ボーナス加点、同色ルックアップ
  - `tests/engine/settle.test.ts` — 1/3 分配の整数性、ロン全額、0 クランプで負値にならない

**動作確認**:

- `npm run lint:fix && npm run format && npm run build` PASS
- `npm test` PASS（Step 1 分 + 新規追加分）
- UI はまだないため、テストのみで検証する

**依存**: Step 1（型定義・山札構築・`DEFAULT_RULES`）

---

## Step 3: 対局状態機械 + CPU AI

```
/add-feature ポカジャン 対局状態機械とCPU AI: タイマーレスな純粋リデューサとして6フェーズの対局状態機械（割り込み宣言の優先度解決・連続宣言・カード補充・終了判定）と CPU AI を実装し、自動対局100局が完走することを検証する。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 3 範囲のみ実装、Step 1-2 完了前提)
```

**実装内容**:

- 新規: `src/engine/game.ts`
  - `createGame(roster, rules, seed)` — 初期化 + 配牌
  - `reduce(state, action) => { state, events }` — **純粋関数・タイマーを持たない**
  - Phase 遷移: `draw → selfDeclare → discard → claimWindow → resolveClaim → nextTurn`
  - 割り込み優先度: 強い役優先、同点なら捨て札プレイヤーから近い順
  - 連続宣言: 消費枚数分を即時補充し、再度 `selfDeclare` へ。`maxChainDeclare = 8` のガード
  - 終了判定: 山切れ or 誰かの点数が 0 以下
  - `GameEvent` の発行（`CardDrawn` / `Declared` / `Paid` / `Refilled` / `TurnChanged` / `GameOver`）
- 新規: `src/engine/ai.ts`
  - `evaluateTargets(hand, ctx)` — 各ターゲットの必要枚数（シャンテン相当）と期待点
  - `chooseDiscard(state, playerId)` — 寄与しないカードから残り枚数・終盤の放銃危険度で選択
  - `shouldDeclare` / `shouldClaim` — 役が揃えば即宣言（定石準拠）
  - 難易度パラメータ（読みの深さ・安全札回避の強さ）
- 新規: `src/engine/autoplay.ts`
  - `playGameToEnd(seed, rules, roster)` — 全員 CPU で最後まで回し、統計を返すテスト用ヘルパ
- 新規テスト:
  - `tests/engine/game.test.ts` — **点数保存則**（4人の合計点が常に `startingScore × 4`）、宣言後に手札が必ず7枚へ復帰、消費枚数 = 補充枚数、山札枚数の単調減少、割り込み優先度、山切れ／破産の両終了パターン
  - `tests/engine/ai.test.ts` — 役が揃っていれば必ず宣言する、明らかに不要なカードを捨てる
  - `tests/engine/autoplay.test.ts` — シード固定の自動対局 100 局が例外なく完走。統計回帰として山切れ終了率 60〜80%、平均打牌数 30〜45 に収まる

**動作確認**:

- `npm run lint:fix && npm run format && npm run build` PASS
- `npm test` PASS（自動対局 100 局を含む）
- ★ この時点で「ゲームとして成立している」ことがテストで証明される

**依存**: Step 1（型・山札）, Step 2（役判定・点数・支払い）

---

## Step 4: 対局UI

```
/add-feature ポカジャン 対局UI: エンジンを React に接続する useGameLoop フックと対局画面（手札・河・宣言窓・リーチ黄色枠・カードアニメーション）を実装し、ブラウザで1局遊べるようにする。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 4 範囲のみ実装、Step 1-3 完了前提)
```

**実装内容**:

- 新規: `src/ui/hooks/useGameLoop.ts`
  - **エンジンとの接続方式は決定済み**（`.steering/20260807-pokajan-03-game/design.md` の
    「決定: エンジンと React の接続」を参照）。`GameState` は変更せず、UI 層に
    `LoopState { game, pending }` というラッパー状態を置き、`createLoopReducer(rules)` で
    `rules` を束縛したリデューサを `useReducer` に渡す。`events` は `pending` キューに積み、
    演出が終わったら `EVENTS_CONSUMED` で削る
  - `reduce` を駆動し、`state` / `events` / `waits` / `myCandidates` と `discard` / `declare` / `pass` を返す
  - CPU の手番は 400〜900ms のディレイを挟む
  - `claimWindow` 中は `requestAnimationFrame` で `TICK` を送り `claimTimerMs` を減算、0 で自動パス
  - アンマウント時に全タイマーを解除
- 新規: `src/ui/screens/TableScreen.tsx`
  - 自分は下（手札7〜8枚・クリックで捨てる）、他3人は上・左・右（伏せ枚数 + スコア + 直近の捨て札）
  - 中央に山札残り枚数 / ボーナスホロメン / 今局の4グループ一覧（達成状況付き）
- 新規: `src/ui/components/`
  - `CardView` — 画像未設定時は頭文字 + アクセントカラーで描画（Step 6 の画像対応まで機能する）
  - `Hand` / `DiscardPile` / `PlayerSeat` / `DeclareButton` / `TimerBar` / `BonusBanner` / `WallCounter` / `YakuToast`
  - リーチ表示: `computeWaits` の結果に寄与する手札カードを**黄色枠**でハイライト、ホバーで待ち一覧
- 修正: `src/App.tsx`
  - `useReducer` の画面ステートマシン（`title | bet | table | result | roster | rules`）の骨格を置き、この Step では `table` のみ有効化
- アニメーション（framer-motion）: 山→手札→河のカード移動、役成立時のカード発光と点数トースト、コイン移動
- 新規テスト:
  - `tests/e2e/table.spec.ts`（Playwright）— 対局画面を開いて1局を最後まで進め、終了状態に到達すること + スクリーンショット取得

**動作確認**:

- `npm run lint:fix && npm run format && npm run build` PASS
- `npm test` PASS / `npx playwright test` PASS
- ブラウザ:
  1. 手札7枚が表示され、自分の手番で1枚引いて1枚捨てられる
  2. あと1枚で役が揃うカードに黄色枠が付く
  3. 他家の捨て札で役が成立すると宣言ボタンとタイマーバーが出て、押すと点数を獲得する
  4. 和了後にカードが補充され、続けて役ができれば再度宣言できる
  5. 山切れ／誰かの破産で対局が終了する

**依存**: Step 1-3（エンジン一式）

---

## Step 4b: プレイテスト反映（情報提示・持ち時間・手札整列）

> **このステップの位置づけ**
>
> 当初計画にはなかった追加ステップ。Step 4 完了後に実際にブラウザで 1 局遊んだ結果、
> **「テストは全部通っているのに、人間には遊べない」**種類の問題が 3 件見つかったため後から追加した。
> いずれも自動対局では検出できない。CPU は `AiView` から全グループの構成を参照でき、
> 思考時間も持たず、手札の並び順にも影響されないためである。
> **プレイテストでしか見つからない欠陥がある**ことの記録として、あえて独立したステップに切り出している。

```
/add-feature ポカジャン プレイテスト反映: グループ構成メンバーの可視化、ロン・打牌の持ち時間（初期20秒・使い切ると5秒ずつ短縮・下限5秒）と時間切れ時のツモ切り、手札のグループ／メンバー順整列を実装する。参照ドキュメント: docs/ideas/pokajan-add-feature-commands.md (Step 4b 範囲のみ実装、Step 1-4 完了前提)
```

### 背景: 実プレイで判明した課題

| #   | 症状                                                     | なぜ問題か                                                                                          |
| --- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1   | 各グループに誰が属しているか画面から分からない           | グループ役（3〜5人組・最大 1800 点）を**狙う判断ができない**。3カードしか成立させられず戦術が半分死ぬ |
| 2   | ロンの受付 4 秒は短く、打牌には制限時間そのものがない    | 手札を読む前に受付が閉じる。一方で打牌は無制限なので緊張感がなく、放置すると進行が止まる            |
| 3   | 手札が引いた順に並ぶため、関連するカードが離れて表示される | 揃いかけの組を目視で追えない。カードが増えるほど認知負荷が線形に増える                              |

### 実装内容

#### (1) グループ構成メンバーの可視化

- 修正: `src/ui/components/BoardInfo.tsx`
  - 現在は `{group.name} {所持数}/{総数}` のみ。ここに**各グループの全メンバー名を列挙**し、
    手札に持っているメンバーを視覚的に区別する（保持済み / 未所持）
  - ボーナスメンバーに該当する名前はグループ一覧の中でも識別できるようにする
  - 4 グループ × 最大 5 人 = 最大 20 名を並べても 375px 幅で破綻しないこと
- 修正: `src/ui/components/BoardInfo.css`（または既存のスタイル定義箇所）

#### (2) 持ち時間（ロン・打牌の共通制限時間）

**確定した仕様**（プレイテスト時に合意済み）:

| 項目           | 仕様                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| 初期持ち時間   | **20 秒**                                                                 |
| 適用範囲       | **ロン（`claimWindow`）と打牌（`discard`）の両方**。両者で同じ残量を共有する |
| 短縮の条件     | **使い切って時間切れになったときだけ** 5 秒減る（時間内に打てば減らない）  |
| 下限           | **5 秒**（20 → 15 → 10 → 5 で止まる）                                     |
| 打牌の時間切れ | **引いたカードを自動で捨てる（ツモ切り）**                                |
| ロンの時間切れ | 現行どおり自動パス                                                        |

- 修正: `src/engine/types.ts` の `RulesConfig`
  - `claimWindowMs: 4000` を持ち時間の仕組みに統合する。少なくとも
    「初期値」「減少幅」「下限」の 3 値を持たせる（例: `turnTimer: { initialMs, decrementMs, minMs }`）
  - **既存の `claimWindowMs` を残すか置き換えるかはこのステップで決める。**
    Step 6 のルール設定画面から編集できる必要があるため、どちらにせよ `RulesConfig` に集約する
- 修正: `src/config/rules.ts` — 上記の既定値（20000 / 5000 / 5000）
- 修正: `src/ui/hooks/useGameLoop.ts` / `src/ui/hooks/loopReducer.ts`
  - **エンジンは時計を持たない原則を維持する**。残り持ち時間はプレイヤーごとに UI 層（`LoopState`）で管理し、
    時間切れの瞬間だけエンジンにアクションを送る
  - ロンの時間切れ → 従来どおり単発の `TICK`
  - 打牌の時間切れ → UI が「直前に引いたカード」の `DISCARD` を自動 dispatch する。
    **エンジンの変更は不要**（`GameEvent` の `CardDrawn` から対象 uid を特定できる）
  - 「使い切ったときだけ減る」ため、時間切れの判定と持ち時間の更新は同じ経路に置く
- 修正: `src/ui/components/TimerBar.tsx`
  - 現在は割り込み受付でのみ表示。打牌フェーズでも表示する
  - CSS アニメーションの duration を固定値ではなく現在の持ち時間から決める（`resetKey` の設計は流用できる）
  - 残量が減っていることが分かる表示（残り秒数など）を添える

#### (3) 手札の整列

- 新規: `src/ui/handOrder.ts`（純粋関数・React 非依存）
  - `sortHand(cards, ctx)` — **グループ順 → グループ内のメンバー順 → 色順** で安定ソートする
  - 引いたばかりのカード（8 枚目）の扱いを決める: 並べ替えの対象に含めるか、末尾に固定するか
    （**推奨: 末尾に固定**。整列すると「今引いた 1 枚」が見失われ、ツモ切りの判断ができなくなるため）
- 修正: `src/ui/components/Hand.tsx` — 表示直前に `sortHand` を通す
  - `AnimatePresence` の `key` は `card.uid` なので、並べ替えは `layout` アニメーションで自然に補間される
- **エンジンの手札配列は並べ替えない**。`GameState` の順序を変えると
  `tests/engine/autoplay.test.ts` のカード保存則やリプレイの再現性に影響するため、UI 表示層に閉じる

### 新規／修正テスト

- 新規: `tests/ui/handOrder.test.ts`
  - グループ順・メンバー順・色順で並ぶこと、同一メンバーのカードが必ず隣接すること
  - 引いた 1 枚の扱いが仕様どおりであること
  - 空の手札・全て同一メンバーなどの端条件
- 修正: `tests/ui/loopReducer.test.ts`
  - 持ち時間が時間切れのときだけ減ること、**時間内に打った場合は減らないこと**（この非対称性が仕様の核心）
  - 下限 5 秒で止まること（20 → 15 → 10 → 5 → 5 → 5）
  - ロンで使い切った持ち時間が、次の自分の打牌にも反映されること（残量の共有）
- 修正: `tests/e2e/table.spec.ts`
  - 打牌フェーズでもタイマーバーが出ること
  - **放置するとツモ切りされて進行が続くこと**（現在は打牌フェーズで無限に待つため、この検証がない）
  - `discardFirst()` は「手札の先頭」をクリックしているため、**整列によって対象カードが変わる**。
    テストの意図（任意の 1 枚を捨てる）は変わらないが、シード依存の期待値がある箇所は確認する

### 動作確認

- `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` PASS
- `npx playwright test` PASS
- ブラウザ:
  1. 場の情報から各グループのメンバーが読み取れ、手札に持っている人が区別できる
  2. 打牌フェーズでもタイマーが表示され、20 秒放置すると引いたカードが自動で捨てられる
  3. 時間切れを起こすたびに持ち時間が 15 → 10 → 5 秒と減り、5 秒で下げ止まる
  4. 時間内に打っている限り持ち時間は 20 秒のまま減らない
  5. 手札が同じグループ・同じメンバーごとにまとまって表示される
  6. 375px 幅でグループ一覧・手札ともにレイアウトが破綻しない

**依存**: Step 4（`BoardInfo` / `Hand` / `TimerBar` / `useGameLoop`）

**エンジンへの影響**: なし（`src/engine/` は無変更で完了できる想定。
`RulesConfig` の型定義のみ `types.ts` を触るが、ロジックは変えない）

---

## Step 5: カジノメタ（BET / 精算 / ウォレット）

```
/add-feature ポカジャン カジノメタ: BET選択（1000/2000）と順位倍率（2.5/1.5/1/1）による精算計算、タイトル・BET・リザルトの各画面、所持コインのlocalStorage永続化を実装する。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 5 範囲のみ実装、Step 1-4 完了前提)
```

**実装内容**:

- 新規: `src/engine/payout.ts`
  - `computePayout(finalScore, bet, rank, rules)` — `(最終点数 × BET倍率 × 順位倍率) − BET額`
  - 順位判定（同点時のタイブレーク規則を明示）
- 新規: `src/storage/prefs.ts`
  - localStorage の JSON 1 キーラッパー（`wallet` / `roster` / `rulesOverride` / `lastSeed`）
  - 初回起動時の初期ウォレット付与、パースエラー時のフォールバック
- 新規: `src/ui/screens/TitleScreen.tsx` — 所持コイン表示、「遊ぶ」「設定」
- 新規: `src/ui/screens/BetScreen.tsx` — BET 1000 / 2000 の選択、所持コイン不足時のガード
- 新規: `src/ui/screens/ResultScreen.tsx` — 4人の最終点数・順位・精算内訳・ウォレット増減、「もう一局」「タイトルへ」
- 修正: `src/App.tsx` — 画面遷移を `title → bet → table → result → title` で接続
- 修正: `src/ui/hooks/useGameLoop.ts` — `GameOver` イベントで結果を確定して呼び出し元へ渡す
- 新規テスト:
  - `tests/engine/payout.test.ts` — 倍率どおりの精算、BET 1000/2000 の差、同点時の順位、ウォレットが負にならないこと
  - `tests/e2e/casino.spec.ts` — BET → 対局 → 精算 → ウォレット反映、リロード後もウォレットが保持されること

**動作確認**:

- `npm run lint:fix && npm run format && npm run build` PASS
- `npm test` PASS / `npx playwright test` PASS
- ブラウザ:
  1. タイトルに所持コインが表示され、BET を選んで対局を開始できる
  2. 対局終了後に順位と精算額が表示され、所持コインが増減する
  3. リロードしても所持コインが保持される
  4. 所持コインが BET 額に満たない場合、その BET を選べない

**依存**: Step 4（対局画面と `useGameLoop` の完了通知）, Step 4b（BET を賭ける前に勝負として成立している必要がある）

---

## Step 6: ロスターエディタ + ルール設定

```
/add-feature ポカジャン ロスターエディタとルール設定: IndexedDBによる画像Blobストア、キャラ/グループのCRUDと画像アップロード（256px webp変換）・バリデーション・import/export、点数表などを編集できるルール設定画面を実装する。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 6 範囲のみ実装、Step 1-5 完了前提)
```

**実装内容**:

- 新規: `src/storage/assets.ts`
  - IndexedDB の `imageId → Blob` KV ストア（自前実装・約40行、ライブラリ追加なし）
  - `putImage` / `getImage` / `deleteImage` / `listImageIds`
- 新規: `src/ui/hooks/useAssetUrl.ts`
  - Blob → `URL.createObjectURL` のメモリキャッシュと解放管理
- 新規: `src/ui/screens/RosterEditor.tsx`
  - グループの追加 / 削除 / リネーム、メンバーの追加 / 削除 / 割り当て（3〜5人制約）
  - 画像アップロード: `<input type="file" accept="image/*">` → canvas で 256×256 webp へ縮小 → IndexedDB 保存
  - `validateRoster` によるリアルタイム検証（グループ数≥4 / 各3〜5人 / 総メンバー≥12）。不正時は保存不可
  - import / export: ロスター + 画像 base64 を含む単一 JSON。export 時にファイルサイズ警告
- 新規: `src/ui/screens/RulesSettings.tsx`
  - 点数表・`startingScore`・`bonusPerCard`・持ち時間（Step 4b で導入。初期値 / 減少幅 / 下限）・CPU 難易度の編集
  - `TODO(要実機確認)` の項目に注記を表示、「デフォルトに戻す」ボタン
- 修正: `src/ui/components/CardView.tsx` — `imageId` があれば画像を表示、なければ従来の頭文字表示にフォールバック
- 修正: `src/storage/prefs.ts` — `roster` / `rulesOverride` の保存・読み出しを接続
- 修正: `src/App.tsx` — タイトルから `roster` / `rules` 画面へ遷移
- 新規テスト:
  - `tests/storage/roster.test.ts` — `validateRoster` の全分岐、import/export のラウンドトリップ、破損 JSON のフォールバック
  - `tests/e2e/roster.spec.ts` — 画像を数枚アップロード → 対局画面のカードに反映 → リロード後も保持

**動作確認**:

- `npm run lint:fix && npm run format && npm run build` PASS
- `npm test` PASS / `npx playwright test` PASS
- ブラウザ:
  1. 設定画面でグループとメンバーを編集でき、不正な構成（グループ3つ・メンバー2人など）では保存できない
  2. 画像をアップロードすると対局画面のカードに反映される
  3. リロード後も画像とロスターが保持される
  4. ルール設定で点数表を変更すると獲得点に即反映され、「デフォルトに戻す」で復元される
  5. export した JSON を import して元の状態が復元される
  6. スマホ幅（375px）でレイアウトが破綻しない

**依存**: Step 4（`CardView`）, Step 5（`prefs.ts` とタイトル画面）

---

## 参考: 各ステップ完了時点で何が動くか

| Step    | 動く状態                                                                        |
| ------- | ------------------------------------------------------------------------------- |
| 1 完了  | 山札・配牌が正しく生成される（テストのみ。UI なし）                             |
| 2 完了  | 全役の判定と点数計算・支払い処理が正しい（テストのみ。UI なし）                 |
| 3 完了  | ★ CPU 四人の自動対局が最後まで完走する（ゲームとして成立）                      |
| 4 完了  | ★ ブラウザで人間が1局遊べる（リーチ表示・割り込み宣言・アニメーション込み）     |
| 4b 完了 | ★ 人間が CPU と対等に戦える（役を狙える・考える時間がある・手札が読める）       |
| 5 完了  | ★ BET → 対局 → 精算のカジノループが完成し、所持コインが永続化される             |
| 6 完了  | ★ キャラ素材をアップロードして差し替えられ、ルール数値も編集できる（全機能完成） |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、問題発生時は該当ステップの PR を revert するだけで回復する。ただし以下に注意:

- **Step 1 を revert するとプロジェクト自体が消える**ため、Step 1 は事実上 revert 対象外。問題があれば追加コミットで修正する
- **Step 4 を revert する場合**、`framer-motion` の依存も併せて削除する（Step 1 で追加済みだが、実利用は Step 4 から）
- **Step 4b を revert する場合**、`RulesConfig` の持ち時間フィールドが Step 6 のルール設定画面から参照されている可能性がある。Step 6 導入後は単純な revert ができないため、Step 6 側の該当項目も併せて外す
- **Step 6 を revert する場合**、IndexedDB に保存済みの画像は残る。`assets.ts` の削除だけでは消えないため、必要なら開発者ツールから手動削除する
- **Step 5 を revert する場合**、localStorage に保存済みのウォレットが残る。次回導入時に整合するようスキーマにバージョンを持たせておく

## 参考: Step 1 着手前の事前確認

- **新規依存追加の合意**: 取得済み（`framer-motion` / `@playwright/test`。状態管理ライブラリは追加せず `useReducer` + Context）
- **未確定ルール値の扱い**: 合意済み（`config/rules.ts` に集約し `TODO(要実機確認)`。Step 6 の設定画面から変更可能）
- **公式素材を同梱しない方針**: 合意済み（デフォルトロスターはオリジナル仮キャラのみ）
- **既存テストの状態確認**: なし（新規リポジトリ）
- **Node バージョン**: Vite 最新版の要件を満たすか確認する

## 参考: v2 以降で検討する機能

- **オンライン4人対戦**（原作のマルチプレイ相当。WebSocket サーバが必要）
- **対局の中断・復帰**（`GameState` の永続化）
- **リプレイ機能**（シードと行動ログからの完全再現。`rng.ts` のシード設計により実装は容易）
- **「ダマポカジャン」AI**（役を伏せて同色役を狙う上級戦術）
- **対局統計・戦績画面**（和了率・放銃率・平均順位）
- **サウンド / BGM**
- **多言語対応**（現状は日本語固定・i18n ライブラリ未導入）
