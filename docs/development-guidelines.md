<!-- 生成日: 20260807 -->

# 開発ガイドライン (Development Guidelines)

本書は [architecture.md](architecture.md) と
[repository-structure.md](repository-structure.md) を前提に、
実装時の規約と開発プロセスを定義する。

**本書の規約の多くは Step 1〜3 の実装で実際に踏んだ失敗に基づく。**
一般論ではなく「このプロジェクトで実際に問題になったこと」を優先して記載している。

## コーディング規約

### 命名規則

#### 変数・関数

```typescript
// ✅ 良い例
const activeMembers = collectMembers(roster, groups)
function findYaku(hand: readonly Card[], ctx: YakuContext): YakuCandidate[] {}
const hasPendingClaims = Object.values(claims).some((d) => d === null)

// ❌ 悪い例
const data = collect(r, g)
function check(h: any[]): any[] {}
const pending = Object.values(claims).some((d) => d === null) // 真偽値に接頭辞がない
```

**原則**:

| 対象           | 規則                        | 例                                    |
| -------------- | --------------------------- | ------------------------------------- |
| 変数           | camelCase、名詞             | `activeMembers` / `consumedFromHand`  |
| 関数           | camelCase、動詞で始める     | `findYaku` / `settleTsumo`            |
| 定数           | UPPER_SNAKE_CASE            | `DEFAULT_RULES` / `TRIPLE_SIZE`       |
| 真偽値         | `is` / `has` / `can` で始める | `isCpu` / `hasRefillShortage`        |
| 型・型エイリアス | PascalCase                | `YakuCandidate` / `ObservablePhase`   |

**ドメイン用語は [glossary.md](glossary.md) の表記に揃える。**
「役」を `yaku`、「和了」を `win`、「割り込み」を `claim` と訳すなど、
訳語を1つに固定する。同じ概念に複数の名前を付けない。

#### ファイル名

| 対象                     | 規則              | 例                |
| ------------------------ | ----------------- | ----------------- |
| 関数の集合（モジュール） | camelCase         | `turnFlow.ts`     |
| React コンポーネント     | PascalCase        | `CardView.tsx`    |
| React フック             | `use` + camelCase | `useGameLoop.ts`  |

**クラスファイルの PascalCase 規則は適用しない。**
本プロジェクトはクラスをほぼ使わず関数と型で構成されているため、camelCase に統一する。

### コードフォーマット

Prettier に一任する。**手で整形しない。**

| 設定           | 値      |
| -------------- | ------- |
| セミコロン     | なし    |
| クォート       | シングル |
| 行の長さ       | 100文字 |
| 末尾カンマ     | 全て    |
| インデント     | 2スペース |

```bash
npm run format        # 整形
npm run format:check  # 差分の確認のみ（CI 用）
```

### 型の使い方

#### `readonly` を既定にする

ドメイン型は**すべてのフィールドを `readonly`** にする。
配列も `readonly T[]` とする。可変性が必要な箇所は、その意図を型で明示する。

```typescript
// ✅ 良い例: 不変であることが型で分かる
interface Card {
  readonly uid: number
  readonly memberId: MemberId
  readonly color: ColorId
}

// リデューサ内部の可変表現は、GameState から導出して取りこぼしを防ぐ
type Writable<T> = { -readonly [K in keyof T]: T[K] }
interface Draft extends Writable<Omit<GameState, 'phase' | 'players'>> {
  phase: Phase
  players: DraftPlayer[]
}
```

**手書きの独立した可変型を作らない。** `GameState` にフィールドを足したのに
変換関数を更新し忘れても、独立した型だとコンパイルが通ってしまう。
導出型にすれば取りこぼしが型エラーになる。

#### `satisfies` で設定値を書く

```typescript
// ✅ 型との整合を検査しつつ、リテラル型を保持する
export const DEFAULT_RULES = {
  playerCount: 4,
  handSize: 7,
  // ...
} satisfies RulesConfig

// ❌ 型注釈だとリテラル型が失われる
export const DEFAULT_RULES: RulesConfig = { ... }
```

#### 判別共用体には網羅性検査を付ける

```typescript
// ✅ 良い例
switch (action.type) {
  case 'DRAW':
    return applyDraw(draft)
  // ... 他のケース
  default: {
    const exhaustive: never = action
    throw new IllegalActionError(`未知のアクションです: ${JSON.stringify(exhaustive)}`)
  }
}
```

**`switch` の後に `return` があると、`default` がなくても TypeScript は
エラーを出さない。** 未知の値がどの分岐にも入らず素通りし、
「状態が変わらない」という形で黙って成功してしまう。
Step 3 でこの穴が実際に見つかった（281件のテストも5つの検証ゲートも検出できなかった）。

#### 型アサーション（`as`）を避ける

```typescript
// ❌ 悪い例: 前提が崩れると undefined 添字という分かりにくい壊れ方をする
const discarder = draft.players[draft.lastDiscardBy as PlayerId]

// ✅ 良い例: 実行時に確かめ、他の検証と同じ形で表面化させる
function requireDiscarder(draft: Draft): PlayerId {
  if (draft.lastDiscardBy === null) {
    throw new IllegalActionError('捨て札を出したプレイヤーが記録されていません')
  }
  return draft.lastDiscardBy
}
```

### コメント規約

#### 「何を」ではなく「なぜ」を書く

```typescript
// ✅ 良い例: 判断の理由が書いてある
// 選出母集団を「登場メンバー全員」ではなく山札に実際に含まれるメンバーに限定する。
// プールから deckSize 枚を抜き出す際、あるメンバーの9枚すべてが山札外に落ちることがあり、
// その場合ボーナスが一度も引けない「死にボーナス」になってしまうため。
const presentMemberIds = [...new Set(deck.map((card) => card.memberId))].sort()

// ❌ 悪い例: コードを読めば分かる
// deck から memberId のセットを作る
const presentMemberIds = [...new Set(deck.map((card) => card.memberId))].sort()
```

#### 不変条件と設計判断は必ず書く

「なぜこの順序なのか」「なぜこの条件が要るのか」は、コードからは読み取れない。

```typescript
/**
 * そのプレイヤーが今持っているべき手札枚数。
 *
 * `declarer === turn` の条件が要る点に注意: ロンによる連続宣言の最中はフェーズが
 * `selfDeclare` のまま `turn` が捨て終わったプレイヤーを指し続けるため、
 * フェーズと `turn` だけで判定すると既に規定枚数へ戻っている人に +1 を期待してしまう。
 */
```

#### 未確定の値には根拠を残す

```typescript
// TODO(要実機確認): 初期点。攻略記事の精算例から1,000点と推定した。
// Step 3 の自動対局100局では、この値が終局のしかたを大きく左右することが分かっている
// （1000 で山切れ終了 40% / 1500 で 82% / 2000 で 98.5%）。
startingScore: 1000,
```

**日本語で書く。** 本プロジェクトのドメインは日本語のゲームであり、
「同色」「和了」「放銃」といった用語を無理に英訳すると意図が伝わりにくくなる。

### エラーハンドリング

#### 3つの分類

| 分類                     | 扱い                                     | 例                                     |
| ------------------------ | ---------------------------------------- | -------------------------------------- |
| **利用者の入力ミス**     | エラー一覧を返す（例外にしない）         | 壊れたロスターファイル                 |
| **プログラムの契約違反** | 専用の例外を投げる                       | 不正なアクション・偽装された役         |
| **内部の不変条件違反**   | 素の `Error` を投げる（バグの表明）      | 過渡フェーズのまま状態を返そうとした   |

```typescript
// 利用者の入力: 例外を投げず、エラー一覧として返す
export function validateRoster(roster: Roster, rules: RulesConfig): RosterValidationResult {
  // 配列でない・フィールドが欠けているといった壊れた構造でも例外を投げない
  return { ok: errors.length === 0, errors, warnings }
}

// 契約違反: ドメイン例外
export class IllegalActionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IllegalActionError'
  }
}

// 内部不変条件: バグなので素の Error
if (draft.phase === 'resolveClaim') {
  throw new Error('内部エラー: 過渡フェーズ resolveClaim のまま状態を返そうとしました')
}
```

#### 黙って無視しない

**これが本プロジェクトで最も重要なエラー方針である。**

```typescript
// ❌ 悪い例: UI のバグが「何も起きない」という形で隠れる
if (state.phase !== 'discard') return state

// ✅ 良い例: 進行不能な入力は必ず表面化させる
requirePhase(draft, 'discard', 'DISCARD')
```

#### 信頼できない入力は「検証」ではなく「再計算で置き換える」

```typescript
// 呼び出し側が渡した候補を捨て、エンジンが再計算した候補を採用する。
// 点数フィールドを偽装されても、精算に使われるのは必ずエンジンが計算した値になる。
const candidate = verifyCandidate(findYaku(hand, ctx), claimed, 'DECLARE')
```

### 設計原則

#### 1. 正しさを「たまたま成り立っている条件」に依存させない

Step 2・3 で見つかった欠陥は**すべてこの形**をしていた。

| 欠陥                                    | 依存していた偶然                           |
| --------------------------------------- | ------------------------------------------ |
| `sameColor` をループの出自から決めていた | 「同色 > 通常」という点数の大小関係        |
| `groupYakuKind` の範囲外チェックがなかった | `maxGroupSize` がたまたま5であること      |
| `pickGroupCards` が重複を除外していなかった | `validateRoster` が必ず先に呼ばれること  |
| `defaultMaxSteps` が固定係数だった      | プレイヤー数がたまたま4人であること        |

**Step 6 でルールがユーザー編集可能になった瞬間に、これらは全て壊れる。**

#### 2. 制約は文書ではなく仕組みで守る

| 制約                       | 守り方                                        |
| -------------------------- | --------------------------------------------- |
| エンジンが React に依存しない | oxlint `no-restricted-imports`               |
| AI が他家の手札を見ない    | `AiView` 型（到達する経路が存在しない）       |
| 点数がカードの選び方に依存しない | `scoreYaku` が `cards` を引数に取らない    |
| 過渡フェーズが漏れない     | `ObservablePhase` 型 + 実行時チェック         |
| ファイルが肥大化しない     | **フェーズごとに `wc -l` を測るタスクを置く** |

最後の項目は Step 3 の反省である。「400行を超えたら分割する」と設計書に書いておきながら
641行まで放置した。**基準を文書に書くだけでは機能しない。**

#### 3. エンジンは純粋に保つ

- `Math.random()` / `Date` を使わない（乱数は `Rng` を引数で受け取る）
- I/O・ストレージアクセス・ログ出力を行わない
- 引数を破壊しない（配列は必ずコピーしてから操作する）

これにより対局の全経過が「初期シード + アクション列」だけで再現でき、
テストが決定的になる。

## Git運用ルール

> **現状**: このプロジェクトはまだ Git リポジトリではない。
> 以下は `git init` 以降に適用する規約として定義する。

### ブランチ戦略

個人開発のため Git Flow は採らず、**シンプルな main + 作業ブランチ**とする。

```
main                    ← 常に検証ゲートが通る状態
  ├─ feat/pokajan-04-table-ui
  ├─ fix/claim-priority-tie-break
  └─ docs/update-architecture
```

| ブランチ      | 用途                             |
| ------------- | -------------------------------- |
| `main`        | 検証ゲートが全て通る状態を保つ   |
| `feat/[名前]` | 新機能（ステアリングの1ステップ）|
| `fix/[内容]`  | バグ修正                         |
| `refactor/[対象]` | リファクタリング             |
| `docs/[対象]` | ドキュメントのみの変更           |

**ステアリングの1ステップ = 1ブランチ = 1PR** を基本単位とする。

### コミットメッセージ規約

Conventional Commits に従う。

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type**: `feat` / `fix` / `docs` / `style` / `refactor` / `test` / `chore`

**Scope**: `engine` / `ui` / `config` / `storage` / `test` / `docs`

**例**:

```
feat(engine): 対局状態機械と CPU AI を実装

6フェーズの純粋リデューサとして対局の進行を実装した。
- 割り込み宣言の優先度解決（強い役優先・同点は捨て札から近い順）
- ロン後の連続宣言（declarer と turn を分離して表現）
- 100局の全ステップで点数保存則・カード保存則を検証

Refs: .steering/20260807-pokajan-03-game/
```

**本文には「なぜ」を書く。** 何を変えたかは差分を見れば分かる。

### プルリクエストプロセス

#### 作成前のチェック

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
```

- [ ] 上記5つが全て通る
- [ ] ステアリングの `tasklist.md` に未完了タスク（`[ ]`）が残っていない
- [ ] `tasklist.md` の振り返りを記入した
- [ ] エンジン層に React / config の import がない

#### PRテンプレート

```markdown
## 概要

[変更内容の簡潔な説明]

## 変更理由

[なぜこの変更が必要か]

## 変更内容

- [変更点1]
- [変更点2]

## 検証

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`（[N] tests passed）
- [ ] `npm run build`
- [ ] `npm run format:check`
- [ ] ブラウザでの手動確認（該当する場合）

## 不変条件

- [ ] 点数保存則・カード保存則が維持されている
- [ ] エンジン層の依存制約に違反していない

## ステアリング

`.steering/[日付]-[タスク名]/`

## スクリーンショット（UI 変更の場合）

[画像]
```

### レビュープロセス

1. セルフレビュー（差分を通しで読む）
2. 自動検証（上記5コマンド）
3. **3軸レビュー**（構造 / 欠陥・セキュリティ / API・ドキュメント準拠）
4. 指摘への対応
5. マージ

**レビューで `[必須]` が0件になるまでマージしない。**

## テスト戦略

### テストの種類と配置

| 種別       | 配置              | 実行                    |
| ---------- | ----------------- | ----------------------- |
| ユニット   | `tests/[レイヤー]/` | `npm test`（Vitest）  |
| 統合       | `tests/engine/autoplay.test.ts` | 同上      |
| E2E        | `tests/e2e/`      | `npx playwright test`   |

**`.test.ts` と `.spec.ts` で実行系を分離している。**
`vite.config.ts` の `include` が `tests/**/*.test.{ts,tsx}` を拾うため、
Playwright の `.spec.ts` は Vitest の対象に入らない。

### カバレッジ目標

**数値目標を設けない。** 代わりに「**不変条件が検査されていること**」を基準とする。

> Step 2 で、186件のテストが全て通っている状態で実在の欠陥が3件見つかった。
> 行が実行されたことと、正しいことは別である。

### テストの書き方

#### 命名は日本語の説明文にする

```typescript
// ✅ 良い例: 何が保証されているかが読んで分かる
it('ロンチェーン中、捨て終わった手番プレイヤーの手札は規定枚数のままである', () => {})
it('クランプが発生しても4人の点数の総和が変わらない', () => {})
it('手の内で既に成立している役では割り込まない', () => {})

// ❌ 悪い例
it('test1', () => {})
it('works correctly', () => {})
```

テンプレートが示す `[対象]_[条件]_[期待結果]` 形式は採用しない。
ドメインが日本語のゲームであり、**ルールの記述としてそのまま読めること**を優先する。
テスト名の一覧が、そのまま仕様の一覧になる状態を目指す。

#### モックを使わない

```typescript
// ✅ 本プロジェクトの標準: 実装をそのまま使う
const result = playGameToEnd({ roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seed: 1 })
```

エンジン層は純粋関数の集合で外部依存を持たないため、**モックが不要**である。
乱数はシードで、時刻は `TICK` の引数で制御できる。

モックが必要になるのは `src/storage/`（IndexedDB / localStorage）のみで、
そこは fake 実装かブラウザ環境の E2E で検証する。

#### 重い処理は `beforeAll` に置く

```typescript
// ✅ 良い例
describe('統計回帰', () => {
  let summary: AutoplaySummary
  beforeAll(() => {
    summary = summarizeAutoplay({ roster: DEFAULT_ROSTER, rules: DEFAULT_RULES, seeds: SEEDS })
  })
  it('...', () => expect(summary.wallEmptyRatio).toBeGreaterThan(0.25))
})

// ❌ 悪い例: describe 直下は収集フェーズで実行される。
// ここで例外が出るとテストの失敗ではなく「テストが見つからない」という壊れ方をする
describe('統計回帰', () => {
  const summary = summarizeAutoplay({ ... })
})
```

#### 不変条件は全ステップで検査する

```typescript
const check = (state: GameState): void => {
  expect(totalScore(state)).toBe(EXPECTED_TOTAL) // 点数保存則
  const uids = allCardUids(state)
  expect(uids).toHaveLength(DEFAULT_RULES.deckSize) // カード保存則
  expect(new Set(uids).size).toBe(DEFAULT_RULES.deckSize) // uid の一意性
}
playGameToEnd({ roster, rules, seed, onStep: check })
```

**カード保存則を最重要とする。** 手札枚数だけを見るテストでは
「補充で山札のカードが複製された」「消費したカードが河にも残っている」を見逃す。

#### 構造的整合性のテストだけでは不十分

構造的なテスト（枚数・部分集合）は「**返ってきたものの正しさ**」しか見ておらず、
**本来返るべきものが返っていない（偽陰性）を検出できない**。
候補が0件のとき、候補の形を検査するアサーションは何も検証せずに通ってしまう。

**対策**: 重要なロジックには**素朴な別実装との突き合わせ**を用意する。

```typescript
// 20行程度の総当たり実装と、全400手札で結果を突き合わせる
function naiveYakuKeys(cards: readonly Card[], ctx: YakuContext): Set<string> {
  /* ... */
}
expect(foundYakuKeys(findYaku(cards, ctx), ctx)).toEqual(naiveYakuKeys(cards, ctx))
```

#### 例外を投げることもテストする

```typescript
it('未知のアクション種別は黙って無視されず例外になる', () => {
  const unknown = { type: 'TELEPORT' } as unknown as Action
  expect(() => reduce(state, unknown, DEFAULT_RULES)).toThrow(/未知のアクション/)
})
```

## コードレビュー基準

### レビューポイント

**正しさ**:

- [ ] **正しさが「たまたま成り立っている条件」に依存していないか**
- [ ] 不変条件（点数保存則・カード保存則）が維持されているか
- [ ] エッジケースが考慮されているか（山札が尽きる・残高が足りない・同点）
- [ ] `switch` に `default` と網羅性検査があるか

**構造**:

- [ ] レイヤーの依存方向に違反していないか
- [ ] ファイルが400行を超えていないか
- [ ] 責務が1文で説明できるか
- [ ] 循環依存がないか

**エラーハンドリング**:

- [ ] 不正な入力が黙って無視されていないか
- [ ] 利用者の入力ミスと内部バグが区別されているか
- [ ] `as` による型アサーションで前提を隠していないか

**テスト**:

- [ ] 不変条件がテストで固定されているか
- [ ] 偽陰性を検出できる形になっているか
- [ ] 例外を投げることもテストされているか

**ドキュメント**:

- [ ] JSDoc が実装と一致しているか（**コメントが嘘をついていないか**）
- [ ] 「なぜ」が書かれているか
- [ ] 設計書に書いた主張が実装されているか

> 最後の項目は Step 3 の反省である。設計書に「途中で `rules` を差し替えたら検査で落ちる」と
> 書きながら、その検査がどこにも存在しなかった。
> **ドキュメントの記述と実装の対応をレビューで確認する。**

### レビューコメントの書き方

**優先度を明示する**:

- `[必須]`: 修正必須。これがあるとマージできない
- `[推奨]`: 修正推奨
- `[提案]`: 検討してほしい
- `[質問]`: 理解のための質問

**建設的に書く**:

```markdown
## ✅ 良い例

`sameColor` をループの出自から決めていますが、これは「同色の点数 > 通常の点数」という
関係に暗黙に依存しています。`RulesConfig` はこの大小関係を強制していないため、
Step 6 でユーザーが点数を編集した瞬間に壊れます。
実際に消費するカードの色から導出してはどうでしょうか。

## ❌ 悪い例

この書き方は良くないです。
```

### サブエージェントによるレビュー

出力が壊れていたら**受け入れず、指示を明確にして再実行する**。
Step 2 で壊れた出力を再実行した結果、実在の欠陥が3件見つかった。

## 開発環境セットアップ

### 必要なツール

| ツール  | バージョン | インストール方法              |
| ------- | ---------- | ----------------------------- |
| Node.js | LTS 以降   | [nodejs.org](https://nodejs.org) / nvm |
| npm     | Node に同梱 | —                            |

**環境変数は不要。** 本プロジェクトは秘密情報を持たず、`.env` を使う場面がない。

### セットアップ手順

```bash
# 1. 依存関係のインストール
npm install

# 2. 開発サーバーの起動
npm run dev        # http://localhost:5173/

# 3. テストの実行
npm test
```

devcontainer を使う場合は VS Code で「Reopen in Container」を実行する。

### npm scripts

| コマンド               | 内容                          |
| ---------------------- | ----------------------------- |
| `npm run dev`          | 開発サーバを起動              |
| `npm run build`        | 型検査 + 本番ビルド           |
| `npm run preview`      | ビルド結果をローカルで確認    |
| `npm test`             | Vitest を1回実行              |
| `npm run test:watch`   | Vitest をウォッチモードで実行 |
| `npm run typecheck`    | `src/` と `tests/` の型検査   |
| `npm run lint`         | oxlint による静的解析         |
| `npm run lint:fix`     | 自動修正つき lint             |
| `npm run format`       | Prettier で整形               |
| `npm run format:check` | 整形差分の確認のみ            |

## 開発プロセス

### ステアリング駆動の開発

作業ごとに `.steering/[YYYYMMDD]-[タスク名]/` を作成する。

| ファイル          | 内容                                       |
| ----------------- | ------------------------------------------ |
| `requirements.md` | 今回の要求内容・受け入れ条件・スコープ外   |
| `design.md`       | 実装アプローチ・設計判断とその理由         |
| `tasklist.md`     | タスクリスト（進捗を随時更新）+ 振り返り   |

### 実装の流れ

```
1. 要求・設計・タスクリストを書く
2. ドキュメントレビュー        ← 省略しない
3. 指摘を反映してから実装に入る
4. タスクを1つずつ消化し、tasklist.md をリアルタイムに更新
5. フェーズの区切りで wc -l を測る
6. 実装検証 + 3軸コードレビュー
7. 指摘への対応（[必須] が0件になるまで）
8. 検証ゲート5つを通す
9. 振り返りを tasklist.md に記録
```

**ステップ2を省略しない。** Step 3 では着手前のドキュメントレビューが
不変条件の定義式の誤りを検出した。実装後に気づいた場合、
正しい実装を「壊れている」と誤検知するか、
誤った式に合わせて本物のバグを作り込むかのどちらかになっていた。

### タスクの扱い

- 未完了タスクを残したまま完了としない
- タスクが大きすぎたら**分割**する（スキップしない）
- 技術的な理由で不要になった場合のみ、理由を明記してスキップする

```markdown
- [x] ~~タスク名~~（実装方針変更により不要: アーキテクチャを X から Y に変更したため）
```

### 振り返りの記録

各ステップの完了時に `tasklist.md` へ記録する。

- 実装完了日
- 計画と実績の差分（表形式）
- 学んだこと（**次のステップで再発を防げる形で**）
- 次回への改善提案

**振り返りは形式的な儀式にしない。** Step 2 の「テストが全部通っていることは
正しいことを意味しない」という教訓は、Step 3 のテスト設計に直接反映された。
