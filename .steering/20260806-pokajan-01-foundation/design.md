# 設計書

## アーキテクチャ概要

**レイヤ分離型**。ゲームルールを純粋 TypeScript の「エンジン層」に閉じ込め、React（UI 層）から完全に独立させる。Step 1 ではエンジン層の土台のみを構築し、UI 層はプレースホルダに留める。

```
┌─────────────────────────────────────────────┐
│ UI 層 (React)          ※Step 4 以降で実装    │
│   src/ui/, src/App.tsx                       │
└──────────────────┬──────────────────────────┘
                   │ 一方向依存（UI → エンジン）
┌──────────────────▼──────────────────────────┐
│ エンジン層 (純粋 TS・React非依存)             │
│                                              │
│   types.ts   全ドメイン型（値を持たない）      │
│      ▲                                       │
│   rng.ts     決定的PRNG・シャッフル            │
│      ▲                                       │
│   deck.ts    検証→選出→プール→抽出→配牌      │
│      ▲                                       │
│   config/rules.ts, config/defaultRoster.ts   │
└──────────────────────────────────────────────┘
```

**設計原則**:

1. **エンジン層は副作用を持たない** — I/O・DOM・タイマー・`Math.random()` を使わない
2. **乱数はすべて注入** — `Rng` を引数で受け取り、内部生成しない。これによりテストとリプレイの決定性が保証される
3. **設定は 1 箇所** — 可変数値は `RulesConfig` に集約し、関数は必ず `rules` を引数で受け取る（グローバル定数を直接参照しない）
4. **依存方向は lint で強制** — `RulesConfig` などの型は `engine/types.ts` に置き、具体値だけを `config/` に置く。これにより `engine/*` は `config/*` を import せずに済む。さらに `.oxlintrc.json` の `no-restricted-imports` で `src/engine/**` と `src/config/**` から `react` / `react-dom` / `**/ui/**` の import を禁止し、`npm run lint` で恒久的に検知する（レビュー時の目視確認に頼らない）

## コンポーネント設計

### 1. `src/engine/types.ts` — ドメイン型

**責務**:
- 全レイヤが共有する語彙（カード・ロスター・役・対局状態）の定義
- Step 2 以降の実装契約を先に固定する

**実装の要点**:
- **型と定数のみ**。ロジックを一切書かない
- `ColorId` は `COLOR_IDS` 配列から導出（`typeof COLOR_IDS[number]`）し、配列と型の二重管理を避ける
- `verbatimModuleSyntax: true` のため、型のみの import は必ず `import type` を使う
- `GameState` / `Action` / `GameEvent` は Step 3 で実装されるが、計画書で確定済みの契約として本 Step で定義する

主要な型:

```ts
export const COLOR_IDS = ['pink', 'blue', 'orange'] as const
export type ColorId = (typeof COLOR_IDS)[number]

export interface Card { uid: number; memberId: MemberId; color: ColorId }
export interface Member { id: MemberId; name: string; imageId?: string; accent?: string }
export interface Group { id: GroupId; name: string; memberIds: MemberId[] }
export interface Roster { version: number; members: Member[]; groups: Group[] }

export type YakuKind = 'triple' | 'group3' | 'group4' | 'group5'
export interface YakuCandidate {
  kind: YakuKind; sameColor: boolean; cards: Card[]; bonusCount: number; score: number
}

export type Phase = 'draw' | 'selfDeclare' | 'discard' | 'claimWindow' | 'resolveClaim' | 'gameOver'
export interface Player { id: number; isCpu: boolean; hand: Card[]; score: number; discards: Card[] }
export interface GameState { /* 計画書 A 節のとおり */ }
export type Action = ...   // DRAW / DECLARE / SKIP_DECLARE / DISCARD / CLAIM / PASS / TICK
export type GameEvent = ... // CardDrawn / Discarded / Declared / Paid / Refilled / TurnChanged / GameOver

// Step 2 の findYaku / computeWaits が受け取る局の文脈。
// 手札だけでは「今局のグループ」「ボーナスメンバー」が分からないため引数で渡す。
export interface YakuContext {
  activeGroups: readonly Group[]
  bonusMemberIds: readonly MemberId[]
  rules: RulesConfig
}

// ルール設定は「型は engine、値は config」に分ける。
export interface YakuScore { base: number; sameColor: number }
export interface BetConfig { options: readonly number[]; rankMultiplier: readonly number[] }
export interface RulesConfig { /* handSize / deckSize / scores / bet ほか */ }
```

これにより Step 2 は `findYaku(hand: Card[], ctx: YakuContext, required?: Card): YakuCandidate[]` を、
Step 1 の型と `deck.ts` の出力だけを前提にそのまま書き始められる。

### 2. `src/engine/rng.ts` — 決定的乱数

**責務**:
- シードから再現可能な擬似乱数列を生成する
- 配列のシャッフルとランダム抽出を提供する

**実装の要点**:
- **mulberry32** を採用。32bit 状態・高速・実装が数行で、シード復元が `number` 1 個で済む
- `Rng` は内部状態を持つオブジェクト。`state()` で現在状態を取り出せるようにし、Step 3 の `GameState.rngState` によるリプレイに備える
- `shuffle` は **入力を破壊しない**（コピーしてから Fisher–Yates）。エンジン層の純粋性を守るため
- `pickSome` は「シャッフルして先頭 n 件」ではなく **部分 Fisher–Yates** で実装し、大きな配列でも無駄なコピーをしない

```ts
export interface Rng { next(): number; state(): number }
export function createRng(seed: number): Rng
export function shuffle<T>(items: readonly T[], rng: Rng): T[]
export function randomInt(rng: Rng, maxExclusive: number): number
export function pickSome<T>(items: readonly T[], count: number, rng: Rng): T[]
```

### 3. `src/config/rules.ts` — ルール設定

**責務**:
- 全ての可変数値の単一の置き場所
- 実機未確認値の所在を明示する

**実装の要点**:
- 型（`RulesConfig` / `YakuScore` / `BetConfig`）は `engine/types.ts` に置き、このファイルは `DEFAULT_RULES` という**値だけ**を持つ。エンジン層 → config 層の依存を作らないため
- **未確定値には `TODO(要実機確認)` コメントを必ず添える**。該当は 2 箇所のみ:
  - `scores.group3.sameColor = 540` — 3人組の同色点。出典が見つからず `180 × 3` で推定した。他の役の同色倍率は 7倍 / 2.8倍 / 3.75倍とばらつくため計算式では導けない
  - `startingScore = 1000` — 攻略記事の精算例（最終1,100点で1位）から推定
- 点数はすべて 3 の倍数。これは「ツモ時に他 3 人から 1/3 ずつ徴収」を整数演算で行うための前提であり、コメントで明示する
- `minGroupSize` / `maxGroupSize` を持たせ、`deck.ts` の検証がマジックナンバーを持たないようにする

### 4. `src/config/defaultRoster.ts` — デフォルトロスター

**責務**:
- 画像なしでも遊べるオリジナルの仮キャラ一式を提供する

**実装の要点**:
- **公式素材・実在キャラ名を一切含めない**（著作権上の方針）。天体・海・森・大地・風をモチーフにした創作名で構成
- 6 グループ / 22 名（サイズ **3, 3, 3, 4, 4, 5**）。`groupsPerGame = 4` より多く用意することで、局ごとに登場グループが変わる
- サイズ配分は **4 グループ選出時の合計人数が 13〜16 人**に収まるよう決めた。原作の実測レンジ（12〜16 種）とほぼ一致させるための意図的な設計判断である。3 サイズすべてを含めることで 3人組・4人組・5人組の全役が出現しうる
- 最悪ケース（人数の少ない 4 グループ = 13 人 = 117 枚）でも `deckSize`(100) を満たす
- 各メンバーに `accent`（16 進カラー）を持たせ、画像未設定時のカード描画（Step 4）に使う

### 5. `src/engine/deck.ts` — 山札構築・配牌

**責務**:
- ロスターの妥当性検証
- 局ごとのグループ選出 → カードプール構築 → 山札抽出 → ボーナス選出 → 配牌

**実装の要点**:

- **プールと山札を区別する**。プールは「選出メンバー × 3 色 × 3 枚」（108〜144 枚）、山札はそこからシャッフルして先頭 `deckSize`(100) 枚。**残りは山札に入らない**（＝残り枚数が完全には読めない）というポカジャン固有の仕様を再現する
- `uid` はプール構築時に 0 から連番で付与。同一シードなら同一の `uid` 割り当てになる
- **検証は「最悪ケース」で行う**: 総メンバー数ではなく、**サイズの小さい順に `groupsPerGame` 個のグループを取った場合のプール枚数**が `deckSize` 以上かを検証する。これによりどのグループ選出結果でも山札が必ず組める
- **1 メンバーの複数グループ所属を禁止**する。許すと「N 人組」役の構成カードが両グループで二重に成立し、役判定と点数が曖昧になるため
- **ボーナスは「山札に実在するメンバー」から選ぶ**。プールから 100 枚を抜き出す際、あるメンバーの 9 枚すべてが山札外に落ちることがあり、そのメンバーをボーナスにすると一局を通じて一度も引けない「死にボーナス」になってしまう。そのため `selectBonusMembers` は登場メンバー全体ではなく**構築済みの山札**を引数に取る。候補順はシャッフル順に依存させず ID 昇順に固定し、同一シードで同じボーナスが選ばれるようにする

```ts
export interface RosterValidationResult { ok: boolean; errors: string[] }
export interface GameSetup {
  activeGroups: Group[]
  activeMembers: Member[]
  bonusMemberIds: MemberId[]
  hands: Card[][]
  wall: Card[]
}

export function cardsPerMember(rules: RulesConfig): number
export function validateRoster(roster: Roster, rules: RulesConfig): RosterValidationResult
export function selectGroups(roster: Roster, rules: RulesConfig, rng: Rng): Group[]
export function collectMembers(roster: Roster, groups: readonly Group[]): Member[]
export function buildCardPool(members: readonly Member[], rules: RulesConfig): Card[]
export function buildDeck(members: readonly Member[], rules: RulesConfig, rng: Rng): Card[]
// 母集団は構築済みの山札。死にボーナスを防ぐため members ではなく deck を受け取る。
export function selectBonusMembers(deck: readonly Card[], rules: RulesConfig, rng: Rng): MemberId[]
export function deal(deck: readonly Card[], rules: RulesConfig): { hands: Card[][]; wall: Card[] }
export function setupGame(roster: Roster, rules: RulesConfig, rng: Rng): GameSetup
```

## データフロー

### 対局開始時のセットアップ（`setupGame`）

```
1. validateRoster(roster, rules)
     → NG なら RosterValidationError を throw（呼び出し側が UI でメッセージ表示）
2. selectGroups(roster, rules, rng)
     → 全グループをシャッフルし先頭 groupsPerGame(4) 個
3. collectMembers(roster, groups)
     → 選出グループの memberIds を展開（13〜16 名）
4. buildCardPool(members, rules)
     → members × COLOR_IDS(3) × copiesPerMemberColor(3) = 117〜144 枚、uid を連番付与
5. shuffle(pool, rng) → 先頭 deckSize(100) 枚を山札とする
     → 残り 17〜44 枚は使われない（山札に入らないカード）
6. selectBonusMembers(deck, rules, rng)
     → 「山札に実在するメンバー」から bonusMemberCount(1) 名
     → 全 9 枚が山札外に落ちたメンバーは候補から自動的に除外される
7. deal(deck, rules)
     → 先頭から playerCount(4) × handSize(7) = 28 枚を配り、残り 72 枚が壁
```

## エラーハンドリング戦略

### カスタムエラークラス

```ts
export class RosterValidationError extends Error {
  readonly errors: string[]
  constructor(errors: string[])
}
```

- `validateRoster` は **throw せず結果オブジェクトを返す**（UI でエラー一覧を表示したいため / Step 6 のロスターエディタで使う）
- `setupGame` は検証 NG のとき `RosterValidationError` を throw する（対局を開始できない致命的状態のため）

### エラーハンドリングパターン

- **不変条件違反はエラーではなくテストで防ぐ**。`buildDeck` などの内部関数は前提が満たされている前提で書き、前提は `setupGame` 入口の検証で担保する
- 例外は「呼び出し側の入力ミス」に限定し、エンジン内部の一貫性はテストで固定する
- `deal` は山札が不足している場合に明示的に `Error` を投げる（`deckSize < playerCount * handSize` の設定ミス検出）

## テスト戦略

### ユニットテスト

**`tests/engine/rng.test.ts`**
- 同一シードで乱数列が完全一致 / 異なるシードで不一致
- 生成値が `[0, 1)` に収まる（1000 回試行）
- `state()` が呼び出しごとに進む
- `shuffle` が入力を破壊しない / 多重集合が保存される / 同一シードで同一結果
- `randomInt` が `[0, max)` に収まる
- `pickSome` が重複なく指定数を返す

**`tests/engine/deck.test.ts`**
- `validateRoster`: デフォルトロスターが OK / 5 種の不正パターンを個別に検出
- `selectGroups`: 重複なくちょうど 4 グループ / 同一シードで同一結果
- `buildCardPool`: 枚数 = メンバー数 × 9 / `uid` 一意 / 各メンバー各色ちょうど 3 枚
- `buildDeck`: ちょうど 100 枚 / メンバーあたり ≤9 枚 / メンバー×色あたり ≤3 枚 / 選出メンバー以外を含まない / シード決定性
- `selectBonusMembers`: 指定数・重複なし・**山札に実在するメンバーからのみ選ばれる**・要求数超過で throw
- `deal`: 4 × 7 枚 + 壁 72 枚 / 合計が元の山札と一致 / 山札不足時に throw
- `setupGame`: 一気通しの不変条件 + 検証 NG で `RosterValidationError`

**`tests/config/rules.test.ts`**
- 全役の点数が 3 で割り切れる（ツモ 1/3 分配の前提）
- `bonusPerCard` が 3 で割り切れる
- 「3 の倍数」の前提が `playerCount - 1 === 3` に結びついていることを明示
- `deckSize <= 最小構成のプール枚数`（設定の自己整合性）

**`tests/ui/App.test.tsx`**
- `renderToStaticMarkup` でプレースホルダ画面が例外なくレンダリングできる（React 経由で `setupGame` を呼ぶ経路の担保）
- Vite テンプレートのデモ内容を含まない
- 山札残り枚数と手札 7 枚が描画される

DOM を必要としない `renderToStaticMarkup` を使うことで、jsdom を導入せずに UI の疎通を確認できる。

### 統合テスト

Step 1 の範囲では「エンジン内の一気通し」が統合テストに相当する:
- `setupGame` をシード 0〜99 の 100 通りで実行し、全ケースで不変条件（枚数・一意性・所属）が保たれること
- デフォルトロスターに対し、どのグループ選出結果でも山札 100 枚が必ず組めること

## 依存ライブラリ

新規追加は Vite テンプレート標準構成 + **Vitest** + **Prettier** のみ。

```json
{
  "dependencies": {
    "react": "^19.2.8",
    "react-dom": "^19.2.8"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.4",
    "oxlint": "^1.75.0",
    "prettier": "^3.9.6",
    "typescript": "~6.0.2",
    "vite": "^8.2.0",
    "vitest": "^4.1.10"
  }
}
```

### 計画書からの変更点（技術的理由あり）

| 計画書の記載 | 実際 | 理由 |
|---|---|---|
| ESLint を devDep に追加 | **oxlint**（Vite 8 テンプレート標準） | Vite 8 の `react-ts` テンプレートは既定リンターが oxlint に変更されている。`--eslint` フラグで ESLint に戻すことは可能だが、テンプレート標準に従う方が依存が少なく高速で、`npm run lint` のゲートは同等に機能する |
| `framer-motion` を Step 1 で追加 | **Step 4 で追加** | Step 1 は UI を実装しないため未使用依存になる。未使用依存はレビュー指摘・バンドル汚染の原因になるので、実際に使う Step 4 で追加する |
| `@playwright/test` を Step 1 で追加 | **Step 4 で追加** | 同上。加えてブラウザバイナリのダウンロード（数百 MB）が Step 1 では完全に無駄になる |

## ディレクトリ構造

```
cc-pokajan/
├── .steering/20260806-pokajan-01-foundation/   # 本ステアリング
├── docs/ideas/                                  # 既存の計画書
├── index.html
├── package.json
├── vite.config.ts            # Vite + Vitest の統合設定
├── tsconfig.json             # プロジェクト参照のルート
├── tsconfig.app.json         # src/ 用
├── tsconfig.node.json        # vite.config.ts 用
├── tsconfig.test.json        # tests/ 用（新規追加）
├── .oxlintrc.json
├── .prettierrc.json
├── .prettierignore
├── .gitignore
├── README.md
├── src/
│   ├── main.tsx              # エントリ（プレースホルダ）
│   ├── App.tsx               # プレースホルダ画面（setupGame の結果を表示）
│   ├── App.css
│   ├── index.css
│   ├── engine/
│   │   ├── types.ts
│   │   ├── rng.ts
│   │   └── deck.ts
│   └── config/
│       ├── rules.ts
│       └── defaultRoster.ts
└── tests/
    ├── engine/
    │   ├── rng.test.ts
    │   └── deck.test.ts
    └── config/
        └── rules.test.ts
```

**tsconfig 構成の要点**: Vite テンプレートは `tsconfig.app.json`（`include: ["src"]`）と `tsconfig.node.json` の 2 参照構成。`tests/` が型検査から漏れるため、**`tsconfig.test.json` を追加してルートの `references` に加える**。これにより `npm run typecheck`（= `tsc -b`）が src と tests の両方を検査する。

`tsconfig.test.json` からは `tsconfig.app.json` への `references` を **張らない**。テンプレートが `composite: true` を使わない `noEmit` 構成のため、リーフ間で参照を張ると `tsc -b` が TS6306 / TS6310 で失敗する。`tests/` は `src/` を相対パスで import しており、その解決結果がテストプロジェクトのプログラムに取り込まれるので、参照なしでも型検査は効く（テストにわざと型エラーを入れて `tsc -b` が検知することを実地で確認済み）。

UI のレンダリングテスト（`tests/ui/App.test.tsx`）が `src/App.tsx` を取り込むため、`tsconfig.test.json` には `jsx: "react-jsx"`、`lib` の `DOM`、CSS の side-effect import を許す `vite/client` 型と `allowArbitraryExtensions` が必要になる。

## 実装の順序

1. Vite スキャフォールドをプロジェクト直下に展開（`docs/` と `.steering/` を壊さないよう手動配置）
2. `package.json` のスクリプトと依存を調整、`npm install`
3. `vite.config.ts` に Vitest 設定を統合、`tsconfig.test.json` を追加
4. Prettier 設定を追加
5. `src/engine/types.ts` — 型定義
6. `src/config/rules.ts` — ルール設定
7. `src/config/defaultRoster.ts` — デフォルトロスター
8. `src/engine/rng.ts` + `tests/engine/rng.test.ts`
9. `src/engine/deck.ts` + `tests/engine/deck.test.ts` + `tests/config/rules.test.ts`
10. `src/App.tsx` をプレースホルダに差し替え
11. 品質ゲート（test / lint / typecheck / build）

## セキュリティ考慮事項

- Step 1 の成果物は外部入力を受け取らず、ネットワーク I/O もないため攻撃面は存在しない
- ただし Step 6 でユーザー提供 JSON を `Roster` として読み込むため、**`validateRoster` を「信頼できない入力の検証点」として設計しておく**。具体的には、メンバー ID・グループ ID の重複確認、メンバー ID の存在確認、グループ人数の範囲確認、複数グループ所属の禁止、最悪ケースのプール枚数確認をすべて行い、型アサーションに頼らない
- 公式素材をリポジトリに含めない（`defaultRoster.ts` は創作名のみ）

## パフォーマンス考慮事項

- カードプールは最大 144 枚、シャッフルは O(n)。パフォーマンス上の懸念はない
- `pickSome` は部分 Fisher–Yates で O(count) に抑える（全体シャッフルの O(n) を避ける）
- `setupGame` は対局開始時に 1 回だけ呼ばれるため、最適化より可読性を優先する

## Step 6 へ申し送る設計課題

コードレビューで挙がった、本 Step のスコープ外だが Step 6（ルール設定画面・ロスターエディタ）で必ず必要になる論点:

- **`RulesConfig` 自体の妥当性検証が存在しない**。`Roster` には `validateRoster` があるが、`RulesConfig` には対になる検証がない。`handSize` が負値だと `deal` の `slice` が負インデックスを「末尾からのオフセット」と解釈して**エラーにならず意味不明な配牌を返す**。`minGroupSize > maxGroupSize` なら全グループが必ずサイズ違反になる。ルール設定画面を作る際に `validateRules` を用意し、保存時に通すこと
- **`createRng(seed)` は不正なシードを黙って受け入れる**。`seed | 0` で 32bit に丸めるため `NaN` は `0` と同義になる。リプレイ共有機能でシードが URL やセーブデータ経由の外部入力になったら、呼び出し側で検証すること
- **`reduce` への `rules` の渡し方**。`YakuContext` は `rules` を内包する一方、`GameState` は持たない設計になっている。Step 3 で `reduce(state, action, rules)` を書くときに、`ctx` 的なオブジェクトへ統一するか素の引数のままにするかを決めること

## 将来の拡張性

- **リプレイ**: `Rng.state()` を `GameState` に持たせる設計により、Step 3 以降でシード + 行動ログから局を完全再現できる
- **ルール可変**: 全関数が `RulesConfig` を引数で受けるため、Step 6 のルール設定画面から任意の値を注入できる。グローバル定数を直接参照しないことが前提条件
- **ロスター差し替え**: `setupGame` が `Roster` を引数で受けるため、Step 6 のユーザー定義ロスターをそのまま渡せる
- **色数の変更**: `COLOR_IDS` と `rules.colors` を参照する実装にしておくことで、将来 4 色構成にしても `deck.ts` の変更が不要
