# ポカジャン — ホロドリのカジノミニゲーム再現ウェブゲーム

## Context

`cc-pokajan`（空のリポジトリ）に、「ホロライブドリームス（ホロドリ）」のカジノミニゲーム **「ポカジャン！」** を再現したウェブゲームを新規構築する。1人 + CPU3人で対局が成立し、BET → 対局 → 精算のカジノループが回るところまでを対象とする。

**追加する機能**:

1. **ポカジャン対局エンジン** — 4人打ちの麻雀系カードゲーム。役判定・支払い・割り込み宣言・連続和了を含む純粋TSの状態機械
2. **CPU AI** — 3人の対戦相手。役の期待値評価と捨て札選択、終盤の放銃回避
3. **対局UI** — 手札・河・宣言窓・リーチ表示・カードアニメーション
4. **カジノメタ** — BET選択、順位倍率による精算、所持コインの永続化
5. **ロスターエディタ** — キャラクター素材をユーザーがアップロードして差し替えられる設定画面

**ユーザーの要件確認結果**:

- 技術スタック: **TypeScript + Vite + React**（ルールエンジンは純粋TSで分離、Vitest でテスト）
- スコープ: **コアゲーム + カジノメタ**。オンライン4人対戦は対象外（v2 以降で検討）
- キャラ素材: **設定画面から画像アップロードして設定できる**。同梱はオリジナルの仮キャラのみ
- ルール未確定値: **設定ファイルで可変**にし、判明値をデフォルト・推定値は `TODO(要実機確認)` 付き
- 追加パッケージ: **framer-motion**（カードアニメ）、**Playwright**（E2E）。状態管理ライブラリは追加せず `useReducer` + Context で賄う
- ステアリング: **使う**（各 Step で `.steering/[日付]-[slug]/` を作成する cc-base 標準運用）

**段階分割**: **6 ステアリングステップ**に分けて段階リリース。レイヤ別（型 → ロジック → 状態機械 → UI → メタ → 設定）に切り、依存が前→後の一方向になるよう順序付けする。Step 3 完了で CPU 同士の自動対局が完走し、Step 4 で人間がブラウザで遊べる状態になる。

**著作権上の注意**: ゲームルール自体に著作権は及ばないため再現に問題はないが、公式イラスト・ロゴ・キャラクター画像は一切同梱しない。デフォルトロスターはオリジナルの記号キャラで構成し、素材はユーザー自身がアップロードする設計とする。

---

## 調査結果: ポカジャンのゲーム性

**一言で**: 麻雀 / ドンジャラの簡略版。役は2種類しかないが、**和了しても局が終わらない**（カードを補充して連続和了できる）点が独特で、常に打点レースが続く。

### 基本フロー

1. 4人対戦。**反時計回り**で「山から1枚引く → 1枚捨てる」を繰り返す
2. 手札は常に **7枚**（自分の手番中のみ8枚）
3. 開局時に「今回登場するグループ（4つ）」と「ボーナスホロメン」が発表される
4. 山札が尽きる or 誰かの点数が0以下になったら終了。最終点数で順位決定

### 役（2系統のみ）

| 役      | 条件                        | 基本点 | 同色時          |
| ------- | --------------------------- | ------ | --------------- |
| 3カード | 同一ホロメン3枚             | 120    | **840**（=7倍） |
| 3人組   | 3人グループ全員を1枚ずつ    | 180    | 未確定（推定）  |
| 4人組   | 4人グループ全員             | 300    | **840**         |
| 5人組   | 5人グループ全員             | 480    | **1800**        |

- カードの色は **ピンク / 青 / オレンジ** の3色。役の構成カードが全て同色だと大幅加点
- **ボーナスホロメン**が役に含まれると **1枚につき +90点**
- 同色倍率は役ごとにバラバラ（7倍 / 2.8倍 / 3.75倍）＝ **計算式ではなくルックアップテーブル**
- 全ての点数が3で割り切れる（120 / 180 / 300 / 480 / 840 / 1800 / 90）ため、1/3分割は整数演算で完結する

### 和了と支払い

| 和了種別 | タイミング                                       | 支払い                  |
| -------- | ------------------------------------------------ | ----------------------- |
| ツモ相当 | 自分の手番、引いた後                             | 他3人が **1/3ずつ**     |
| ロン相当 | 他家の捨て札で成立時、**手番に関係なく**割り込み | **捨てた人が全額**      |

- 和了後、消費した枚数を山札から即時補充 → **手札が7枚に戻る**。補充で新たな役ができたら **連続宣言可**
- **フリテンなし**。複数同時宣言は強い役が優先、同点なら捨て札プレイヤーから近い順
- あと1枚で揃うカードは黄色枠でハイライトされる（リーチ表示）

### 山札構成

- 1ホロメンにつき **9枚**（3色 × 各3枚）
- 1ゲームに登場するグループは **4つ**、ホロメンは **12〜16種**（108〜144枚）
- そこからシャッフルして **100枚** を山札にする → **山札に入らないカードが存在する**（＝残りカウントが完全には読めない）
- 初期手札 7×4 = 28枚を配り、残り72枚が壁

### カジノメタ

- BET: 1000コイン（1倍）/ 2000コイン（2倍）
- 精算: `(最終点数 × BET倍率 × 順位倍率) − BET額`
- 順位倍率: 1位 **2.5** / 2位 **1.5** / 3・4位 **1.0**

### 実測統計（AI 調整・回帰テストの目安）

- 1局平均 約35打牌（1人あたり約8.8巡）
- 山切れ終了 **69.7%** / 誰かの破産で終了 **30.4%**
- 初期配牌の良さと最終点の相関 0.17（配牌ゲーではない）
- 定石: **「役が揃ったら安手でも即宣言」**。安手連打で山を消費するのがトップ時の戦術

---

## 設計サマリ

### A. データモデル（`src/engine/types.ts`, `src/config/rules.ts`）

```ts
type ColorId = 'pink' | 'blue' | 'orange'
type YakuKind = 'triple' | 'group3' | 'group4' | 'group5'
type Phase = 'draw' | 'selfDeclare' | 'discard' | 'claimWindow' | 'resolveClaim' | 'gameOver'

interface Card { uid: number; memberId: string; color: ColorId }
interface Member { id: string; name: string; imageId?: string; accent?: string }
interface Group { id: string; name: string; memberIds: string[] }   // 3〜5人
interface Roster { version: number; members: Member[]; groups: Group[] }

interface YakuCandidate {
  kind: YakuKind
  sameColor: boolean
  cards: Card[]        // 消費するカード
  bonusCount: number   // 含まれるボーナスホロメン枚数
  score: number
}

interface Player { id: number; isCpu: boolean; hand: Card[]; score: number; discards: Card[] }

interface GameState {
  phase: Phase
  turn: number              // 手番プレイヤー index
  players: Player[]         // 4人
  wall: Card[]              // 山札
  activeGroups: Group[]     // 今局の4グループ
  bonusMemberIds: string[]
  lastDiscard: Card | null
  claims: Record<number, YakuCandidate | 'pass' | null>
  claimTimerMs: number
  rngState: number          // シード復元用
  log: GameEvent[]
}
```

**上限・定数**（`config/rules.ts` の `DEFAULT_RULES`）:

- `handSize = 7`（手番中のみ8）
- `playerCount = 4`
- `groupsPerGame = 4`
- `deckSize = 100`
- `copiesPerMemberColor = 3` → 1メンバー9枚
- `startingScore = 1000` — `TODO(要実機確認)`
- `bonusMemberCount = 1`、`bonusPerCard = 90`
- `claimWindowMs = 4000`
- `scores`: `triple {120, 同色840}` / `group3 {180, 同色540 ← TODO(要実機確認)}` / `group4 {300, 同色840}` / `group5 {480, 同色1800}`
- `bet: { options: [1000, 2000], rankMultiplier: [2.5, 1.5, 1, 1] }`
- `maxChainDeclare = 8`（無限ループ防止のガード）

### B. ロジック構成

**役判定 `src/engine/yaku.ts`** — 本プロジェクトの中核。

```ts
findYaku(hand: Card[], ctx: YakuContext, required?: Card): YakuCandidate[]
```

1. **3カード**: `memberId` でグループ化 → 3枚以上のメンバーごとに候補生成。同一色が3枚あれば同色版も追加
2. **N人組**: 今局の各グループについて、全メンバーが手札に1枚以上あるか判定。**全メンバーが色 c を持つ色 c が存在すれば**同色版も追加
3. 点数 = `scores[kind][通常|同色] + bonusPerCard × 候補内のボーナス枚数`
4. `required` 指定時（ロン判定）は、**その1枚を抜いた手札では成立しない候補のみ**を残す
5. 複数候補は「点数最大 → 残り手札の価値が高い方」で選択

**リーチ表示 `computeWaits(hand, ctx)`**: 「登場メンバー × 3色」（最大48通り）を1枚ずつ仮に加えて `findYaku(hand + k, required: k)` を試す総当たり。48回の軽量判定で済むため最適化不要。待ちカード集合と、それに寄与する手札カードの両方を返す。

**状態機械 `src/engine/game.ts`**: `reduce(state, action) => { state, events }` の純粋関数。**タイマーを一切持たず**、宣言待ち時間は UI 層が `TICK` アクションで駆動する。

```
init → deal → [ draw → selfDeclare? → discard → claimWindow → resolveClaim? ] → … → gameOver
                  ↑                                              │
                  └──────────── nextTurn ────────────────────────┘
```

| Phase          | 意味                                                        | Action                        |
| -------------- | ----------------------------------------------------------- | ----------------------------- |
| `draw`         | 手番が山から1枚引く（手札8枚に）                            | `DRAW`                        |
| `selfDeclare`  | 引いた後の宣言チャンス。宣言→消費→補充→再度このPhase（連続） | `DECLARE`, `SKIP_DECLARE`     |
| `discard`      | 1枚捨てる（手札7枚に戻る）                                  | `DISCARD(uid)`                |
| `claimWindow`  | 他家3人の割り込み受付。CPUは即決、人間はタイマー付き        | `CLAIM(pid)`, `PASS(pid)`, `TICK` |
| `resolveClaim` | 優先度判定 → 支払い → 消費・補充 → 連続宣言判定             | 内部遷移                      |
| `gameOver`     | 山切れ or 誰かが0以下                                       | —                             |

**イベント駆動**: リデューサは状態と同時に `GameEvent[]`（`CardDrawn` / `Declared` / `Paid` / `Refilled` / `TurnChanged` / `GameOver`）を返す。UI はこれを見てアニメーションを再生する。**ロジックと演出を疎結合にするための要**。

**CPU AI `src/engine/ai.ts`**:

- 各ターゲット（メンバーの3カード / 各グループ）について **必要枚数（シャンテン相当）** と **期待点** を算出
- 捨て札: どのターゲットにも寄与しないカードから、`残り枚数の少なさ` と `終盤の放銃危険度` で選択
- 宣言: 攻略定石どおり **役が揃えば即宣言**（v1 では「ダマポカジャン」非搭載）
- 難易度パラメータ（読みの深さ・安全札回避の強さ）を設定で切り替え可能に

**乱数 `src/engine/rng.ts`**: mulberry32 のシード付き PRNG。テストの再現性とリプレイ機能（局の再現）の両方に使う。`Math.random()` はエンジン内で一切使わない。

### C. 新規ファイル

| パス                            | 役割                                                       |
| ------------------------------- | ---------------------------------------------------------- |
| `src/engine/types.ts`           | 全ドメイン型・Action・GameEvent の定義                     |
| `src/engine/rng.ts`             | シード付き乱数・シャッフル                                 |
| `src/engine/deck.ts`            | グループ選出・山札構築（144→100枚）・配牌                  |
| `src/engine/yaku.ts`            | 役判定・最良候補選択・待ち計算（**中核**）                 |
| `src/engine/score.ts`           | 候補の点数計算（同色・ボーナス加算）                       |
| `src/engine/settle.ts`          | ツモ1/3分配・ロン全額・0クランプ                           |
| `src/engine/game.ts`            | 対局状態機械（**中核**）                                   |
| `src/engine/ai.ts`              | CPU 思考                                                    |
| `src/engine/autoplay.ts`        | 全員CPUで最後まで回すテスト用ヘルパ                        |
| `src/engine/payout.ts`          | BET・順位倍率からの精算計算                                |
| `src/config/rules.ts`           | 全ての可変数値の単一の置き場所                             |
| `src/config/defaultRoster.ts`   | 同梱のオリジナル仮ロスター（6グループ / 24人）             |
| `src/storage/prefs.ts`          | localStorage: 所持コイン・ロスター・ルール上書き           |
| `src/storage/assets.ts`         | IndexedDB: 画像 Blob の保存（自前ラッパー約40行）          |
| `src/ui/hooks/useGameLoop.ts`   | エンジン駆動・CPU思考ディレイ・宣言窓タイマー              |
| `src/ui/hooks/useAssetUrl.ts`   | Blob → objectURL のメモリキャッシュ                        |
| `src/ui/screens/TableScreen.tsx`| 対局画面                                                    |
| `src/ui/screens/TitleScreen.tsx`| タイトル・所持コイン表示                                    |
| `src/ui/screens/BetScreen.tsx`  | BET 選択                                                    |
| `src/ui/screens/ResultScreen.tsx`| 順位・精算表示                                             |
| `src/ui/screens/RosterEditor.tsx`| キャラ/グループ設定・画像アップロード                      |
| `src/ui/screens/RulesSettings.tsx`| 点数表など数値の編集・デフォルト復元                       |
| `src/ui/components/*`           | CardView / Hand / DiscardPile / PlayerSeat / DeclareButton / TimerBar / BonusBanner / WallCounter / YakuToast |

**設計判断（クライアント完結）**: サーバを持たず全てブラウザ内で完結させる。CPU 対戦のみのため通信は不要で、静的ホスティング（GitHub Pages 等）にそのまま載る。

### D. UI 設計（`src/ui/screens/TableScreen.tsx`）

- **レイアウト**: 自分は画面下（手札7〜8枚を横並び、クリックで捨てる）、他3人は上・左・右に配置（手札は伏せ枚数のみ + スコア + 直近の捨て札）
- **中央**: 山札残り枚数 / ボーナスホロメン表示 / 今局の4グループ一覧（達成状況付き）
- **リーチ表示**: `computeWaits` の結果をもとに、寄与する手札カードを**黄色枠**でハイライト（原作準拠）。ホバーで待ちカード一覧をツールチップ表示
- **宣言ボタン**: 割り込み窓が開いたら大きく表示 + 残り時間のタイマーバー。`claimWindowMs` 経過で自動パス
- **アニメーション**（framer-motion）: カードの山→手札→河の移動、役成立時のカード発光と点数トースト、コイン移動
- **disabled 条件**: 自分の手番の `discard` フェーズ以外は手札クリック不可。役が成立していない時は宣言ボタン非表示

### E. ランタイム統合（`src/ui/hooks/useGameLoop.ts`）

```ts
// useGameLoop 戻り値
state: GameState
events: GameEvent[]          // 直近フレームで発生したイベント（演出トリガ）
waits: WaitInfo              // リーチ表示用
myCandidates: YakuCandidate[]// 宣言可能な役
discard: (uid: number) => void
declare: (candidate: YakuCandidate) => void
pass: () => void
```

- CPU の手番は `setTimeout` で 400〜900ms のディレイを挟んでから `reduce` を呼ぶ（人間が追える速度に）
- `claimWindow` 中は `requestAnimationFrame` ベースで `TICK` を送り、`claimTimerMs` を減算
- 局終了時に `GameOver` イベントを検知して ResultScreen へ遷移
- アンマウント時に全タイマーを解除

**画面遷移**: `App.tsx` に `useReducer` の単純な画面ステートマシン（`title | bet | table | result | roster | rules`）を置く。ルーティングライブラリは導入しない。

### F. 永続化

**localStorage（`src/storage/prefs.ts`）** — JSON 1キーにまとめる:

```ts
{ wallet: number, roster: Roster, rulesOverride: Partial<RulesConfig>, lastSeed?: number }
```

**IndexedDB（`src/storage/assets.ts`）** — キャラ画像の Blob のみ。`imageId → Blob` の単純な KV ストア。localStorage の5MB制限を避けるため画像は必ずこちらに置く。

**保存しないもの（transient）**: 対局中の `GameState`（リロードで破棄。中断復帰は v2 以降）。

### G. i18n

**日本語固定**。i18n ライブラリは導入せず、文言はコンポーネント内に直接記述する。多言語化の要件が出た場合は v2 以降で検討。

---

## 段階分割（6ステップ）

各ステップ完了時に `npm run lint:fix && npm run format && npm run build && npm test` が全て PASS することをゲートとし、PR レビュー後にマージする。

### Step 1: `.steering/[実施日]-pokajan-01-foundation/`

- Vite（react-ts）でプロジェクト初期化、`npm run dev / build / test / lint / format` を整備
- 依存追加: `framer-motion`（dep）、`vitest` / `@playwright/test` / `eslint` / `prettier`（devDep）
- `src/engine/types.ts` — 全ドメイン型の定義
- `src/engine/rng.ts` — mulberry32 + シード付きシャッフル
- `src/engine/deck.ts` — グループ選出・山札構築（プール144枚→100枚）・ボーナス選出・配牌
- `src/config/rules.ts` — `DEFAULT_RULES`（未確定値に `TODO(要実機確認)`）
- `src/config/defaultRoster.ts` — オリジナル仮ロスター 6グループ / 24人（サイズ 3,3,4,4,5,5）
- テスト: `tests/engine/deck.test.ts` — 山札100枚 / メンバー毎≤9枚 / 色毎≤3枚 / 同一シードで完全再現 / 配牌後の壁が72枚

### Step 2: `.steering/[実施日]-pokajan-02-yaku/`

- `src/engine/yaku.ts` — `findYaku` / `bestYaku` / `computeWaits`
- `src/engine/score.ts` — 同色判定・ボーナス加算を含む点数計算
- `src/engine/settle.ts` — ツモ1/3分配・ロン全額・0クランプ
- テスト: `tests/engine/yaku.test.ts` / `score.test.ts` / `settle.test.ts`
  - 役4種 × 通常/同色 × ボーナスあり/なしの全組み合わせ
  - `required` 制約（その1枚がないと成立しない候補のみ返す）
  - 複数候補からの最良選択（点数最大 → 残り手札価値）
  - `computeWaits` が正しい待ちを返す

### Step 3: `.steering/[実施日]-pokajan-03-engine/`

- `src/engine/game.ts` — 状態機械（6 Phase、割り込み優先度解決、連続宣言、補充、終了判定）
- `src/engine/ai.ts` — `chooseDiscard` / `shouldDeclare` / `shouldClaim`
- `src/engine/autoplay.ts` — 全員CPUで最後まで回すヘルパ
- テスト: `tests/engine/game.test.ts` / `ai.test.ts` / `autoplay.test.ts`
  - **点数保存則**: 4人の合計点が常に `startingScore × 4`
  - 手札枚数不変: 宣言後に必ず7枚へ復帰、消費枚数 = 補充枚数
  - 割り込み優先度: 強い役優先、同点は捨て札プレイヤーから近い順
  - シード固定の自動対局100局が例外なく完走
  - 統計回帰: 山切れ終了率が 60〜80%、平均打牌数が 30〜45 に収まる

### Step 4: `.steering/[実施日]-pokajan-04-table-ui/`

- `src/ui/hooks/useGameLoop.ts` — エンジン駆動・CPUディレイ・`TICK` タイマー
- `src/ui/screens/TableScreen.tsx` + `src/ui/components/*`
- リーチ黄色枠、宣言ボタン + タイマーバー、framer-motion によるカード移動・役成立演出
- `src/App.tsx` を画面ステートマシンに差し替え
- テスト: `tests/e2e/table.spec.ts`（Playwright）— 1局を最後まで進めてスクリーンショット取得

### Step 5: `.steering/[実施日]-pokajan-05-casino/`

- `src/engine/payout.ts` — `(最終点数 × BET倍率 × 順位倍率) − BET額`
- `src/storage/prefs.ts` — localStorage ラッパー
- `src/ui/screens/TitleScreen.tsx` / `BetScreen.tsx` / `ResultScreen.tsx`
- 所持コインの増減・BET 不足時のガード
- テスト: `tests/engine/payout.test.ts` + `tests/e2e/casino.spec.ts`（BET→対局→精算→ウォレット反映）

### Step 6: `.steering/[実施日]-pokajan-06-roster-editor/`

- `src/storage/assets.ts` — IndexedDB Blob ストア（自前実装）
- `src/ui/hooks/useAssetUrl.ts` — objectURL キャッシュ
- `src/ui/screens/RosterEditor.tsx` — グループ/メンバー CRUD、画像アップロード（canvas で 256×256 webp 変換）、バリデーション、import/export
- `src/ui/screens/RulesSettings.tsx` — 点数表など数値編集、デフォルト復元
- テスト: `tests/storage/roster.test.ts`（バリデーション・import/export ラウンドトリップ）+ `tests/e2e/roster.spec.ts`（画像アップロード→リロード後も保持）

---

## 重要な制約・リスク

| リスク                                       | 対応                                                                                                       |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **同色役の点数など未確定値がある**           | `config/rules.ts` に全数値を集約し `TODO(要実機確認)` を付与。Step 6 の設定画面から1箇所の変更で追随可能    |
| **割り込み宣言の競合・タイミング**           | エンジンをタイマーレスな純粋リデューサにし、`claimWindow` を明示 Phase 化。優先度解決を純関数として単体テスト |
| **連続宣言による無限ループ**                 | 補充で必ず山札が減るため理論上は有限だが、`maxChainDeclare = 8` のガードと「山札が単調減少する」assert を追加 |
| **ロスター編集で山札が組めなくなる**         | `buildDeck` 前に `validateRoster`（グループ数≥4 / 各3〜5人 / 総メンバー≥12）。エディタ側でも保存時に検証     |
| **画像で localStorage が溢れる**             | 画像は IndexedDB に Blob 保存。アップロード時に 256×256 webp へ縮小。export 時にファイルサイズ警告          |
| **CPU AI の強さが不明**                      | 実測統計（山切れ率69.7% / 平均35打牌）を回帰テストの許容レンジに設定し、AI 変更時の破綻を検知               |
| **公式素材の混入**                           | デフォルトロスターはオリジナル仮キャラのみ。リポジトリに公式画像・ロゴを一切コミットしない                  |
| **framer-motion のバンドル増加**             | 対局画面（Step 4 以降）でのみ import し、他画面には持ち込まない                                             |

---

## Critical Files

**既存（修正）**: なし（新規リポジトリ）

**新規（中核）**:

- `src/engine/yaku.ts` — 役判定・待ち計算。ここの正しさがゲーム全体の正しさ
- `src/engine/game.ts` — 状態機械。割り込み宣言の優先度解決を含む
- `src/engine/ai.ts` — CPU 思考
- `src/config/rules.ts` — 全ての可変数値の単一の置き場所
- `src/ui/hooks/useGameLoop.ts` — エンジンと React の接続点
- `src/ui/screens/TableScreen.tsx` — 対局画面
- `src/ui/screens/RosterEditor.tsx` — 素材設定画面
- `src/storage/assets.ts` — IndexedDB 画像ストア

**新規（テスト）**:

- `tests/engine/yaku.test.ts` / `game.test.ts` / `autoplay.test.ts`
- `tests/e2e/table.spec.ts` / `casino.spec.ts` / `roster.spec.ts`

---

## Verification

### 自動

- `npm test` — 各 Step で追加した Vitest が全件 PASS
  - 重要な不変条件: **点数保存則**（4人の合計点が常に一定）、**手札7枚不変**、**山札枚数の単調減少**
  - シード固定の自動対局100局が例外なく完走
- `npx playwright test` — Step 4 以降の E2E が PASS
- `npm run lint:fix && npm run format && npm run build` — 0 errors

### 手動（`npm run dev`）

1. **対局**: 1局を通しでプレイし、山→手札→河のアニメーション、リーチの黄色枠、割り込み宣言ボタンとタイマー、役成立時の点数表示が正しく動く
2. **連続和了**: 和了後にカードが補充され、続けて役ができたら再度宣言できる
3. **終了判定**: 山切れと誰かの破産の両方で正しく終了し、順位が最終点数どおりに並ぶ
4. **カジノループ**: BET 1000 と 2000 で精算額が倍率どおりに変わり、所持コインがリロード後も保持される
5. **ロスターエディタ**: 画像を数枚アップロード → 対局画面のカードに反映 → リロード後も保持（IndexedDB）
6. **バリデーション**: グループを3つに減らす／メンバーを2人にするなど不正な状態で保存できないこと
7. **ルール設定**: 点数表を変更すると対局中の獲得点に即反映され、「デフォルトに戻す」で復元できる
8. **レスポンシブ**: スマホ幅（375px）でレイアウトが破綻しない

### ステアリングスキル運用

- 各 Step で `.steering/[日付]-[step-slug]/` の requirements / design / tasklist を作成
- tasklist の各タスクで `[ ]` → `[x]` をリアルタイム更新
- 全タスク完了後に申し送り（実装完了日 / 計画と実績の差分 / 学んだこと / 改善提案）を記録

---

## 続きの計画

本計画（Step 1〜6）は完了済み。以降の拡張は別ドキュメントにある。

- [pokajan-mahjong-board-plan.md](pokajan-mahjong-board-plan.md) — Step 7: 盤面を麻雀ゲームに近づける
- [pokajan-mahjong-board-add-feature-commands.md](pokajan-mahjong-board-add-feature-commands.md) — Step 7 のコマンド一覧

## 情報源

- [ホロドリ攻略Wiki（Gamerch） - ポカジャンのやり方と勝つコツ](https://gamerch.com/hololive-dreams/1000599)
- [ゲームエイト - ポカジャンの攻略と解放条件](https://game8.jp/hololive-dreams/801833)
- [ういんど - チョットデキルわたしによるポカジャン研究記事](https://note.com/uind/n/nec4e32bca732)（役・点数・支払いルールの最も詳細な出典）
- [ういんど - モウチョットデキルようになったポカジャン研究記事](https://note.com/uind/n/n7e65c88fbe07)（山札100枚・ホロメン12〜16種の出典）
- [かふぇもっと - ホロドリ・ポカジャン！攻略](https://note.com/cafemot/n/ndb547497fe3c)（統計値の出典）
- [洗濯科学 - 初心者向けポカジャンで負けない考え方](https://note.com/w_science_holo/n/n344683666cde)
- [Yahoo!知恵袋 - ポカジャンのルール詳細](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q14330042544)
- [Yahoo!知恵袋 - ポカジャンのルール（色・リーチ表示）](https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11330073256)
