<!-- 生成日: 20260807 -->

# リポジトリ構造定義書 (Repository Structure Document)

本書は [architecture.md](architecture.md) で定義したレイヤー構造を、
具体的なディレクトリとファイルの配置規則に落とし込む。

## プロジェクト構造

```
cc-pokajan/
├── src/                        # ソースコード
│   ├── engine/                 # ゲームロジック（純粋TS・React非依存）
│   ├── config/                 # ルール値・同梱ロスター
│   ├── storage/                # localStorage / IndexedDB（Step 5〜）
│   ├── ui/                     # 画面とフック（Step 4〜）
│   │   ├── screens/            # 画面単位のコンポーネント
│   │   ├── components/         # 再利用する部品
│   │   └── hooks/              # React フック
│   ├── App.tsx                 # 画面ステートマシン
│   ├── App.css
│   ├── main.tsx                # エントリポイント
│   └── index.css
├── tests/                      # テストコード（src の構造を反映）
│   ├── engine/                 # エンジンのユニット + 統合テスト
│   ├── config/                 # 設定値の制約テスト
│   ├── ui/                     # UI のレンダリングテスト
│   ├── storage/                # 永続化のテスト（Step 5〜）
│   ├── e2e/                    # Playwright（Step 4〜）
│   └── helpers/                # テスト用の組み立てヘルパ
├── docs/                       # 永続ドキュメント
│   └── ideas/                  # 壁打ち・計画書
├── .steering/                  # 作業単位のドキュメント（コミットする）
├── .devcontainer/              # 開発コンテナ設定
├── .claude/                    # Claude Code 設定
├── scripts/                    # 補助スクリプト
├── index.html                  # Vite のエントリ HTML
├── vite.config.ts              # Vite + Vitest 設定
├── tsconfig*.json              # TypeScript プロジェクト参照
├── .oxlintrc.json              # 静的解析（依存方向の制約を含む）
├── CLAUDE.md                   # プロジェクトメモリ
└── README.md
```

**ルート直下に `config/` を置かない**。設定はアプリケーションのコードであり、
`src/config/` に置く。ルート直下はツール設定（`vite.config.ts` 等）のみとする。

## ディレクトリ詳細

### src/engine/ — ゲームロジック

**役割**: ポカジャンのルールそのもの。役判定・状態遷移・精算・CPU 思考。

**配置ファイル**:

| ファイル            | 責務                                                   |
| ------------------- | ------------------------------------------------------ |
| `types.ts`          | 全ドメイン型と定数。**ロジックを一切含まない**         |
| `errors.ts`         | `IllegalActionError`（複数モジュールが投げるため独立） |
| `rng.ts`            | シード付き乱数・シャッフル                             |
| `deck.ts`           | ロスター検証・グループ選出・山札構築・配牌             |
| `score.ts`          | 役種 × 同色 × ボーナス枚数 → 点数                      |
| `yaku.ts`           | 役候補の列挙・ロン判定・最良候補選択・待ち計算         |
| `yakuSelection.ts`  | 選択されたカードからの役の再導出（宣言・割り込み検証） |
| `settle.ts`         | ツモ1/3分配・ロン全額・0クランプ                       |
| `gameDraft.ts`      | リデューサ内部の可変表現と不変条件ガード               |
| `gameSelectors.ts`  | 状態からの導出（クエリ）                               |
| `claims.ts`         | 割り込み優先度解決・宣言された役の再計算による検証     |
| `turnFlow.ts`       | 手番の進行と終了判定                                   |
| `win.ts`            | 和了1回分の処理                                        |
| `game.ts`           | 状態機械の入口。`createGame` / `reduce`                |
| `ai.ts`             | CPU 思考                                               |
| `autoplay.ts`       | 全員 CPU で1局を回すヘルパ                             |

**命名規則**:

- ファイル名は **camelCase**（`gameDraft.ts`）。クラスではなく関数の集合であるため
  PascalCase は使わない
- 1ファイル1責務。ファイル名がそのまま責務を表すこと

**依存関係**:

- 依存可能: `src/engine/` 内の他モジュールのみ
- **依存禁止**: `react` / `react-dom` / `src/ui/` / `src/config/` / `src/storage/`

> この禁止は `.oxlintrc.json` の `no-restricted-imports` で機械的に検出される。
> ルール値は `RulesConfig` として**引数で受け取る**ため、設定層への依存が不要になる。

**モジュール間の依存の向き**（循環なし）:

```
game.ts
  ├─→ win.ts ─→ turnFlow.ts ─────────┐
  ├─→ claims.ts ─→ yakuSelection.ts ─┤
  ├─→ gameSelectors.ts               ├─→ gameDraft.ts ─→ errors.ts
  ├─→ deck.ts ─→ rng.ts              │
  └─→ yaku.ts ─→ score.ts            │
       ↑ yakuSelection.ts ──┘        │
                                      └─→ types.ts（全モジュールが参照）

ai.ts ─→ gameSelectors.ts, yaku.ts, score.ts   ← game.ts に依存しない
autoplay.ts ─→ game.ts, ai.ts
```

`yakuSelection.ts`（選択からの再導出）は `yaku.ts` の共有プリミティブ
（`toCandidate` / `signatureOf` / `achievableSignaturesWithout` / `CandidateDraft`）を使うため
`yaku.ts` に依存する一方向のみ。`claims.ts` の `verifyCandidate` は `yakuSelection.ts` を経由して
宣言／割り込みを検証する。

`ai.ts` が `game.ts`（状態機械本体）に依存しないのは意図的である。
AI は「状態を進めない、状態から値を引くだけ」の立場であり、
必要な導出関数は `gameSelectors.ts` から取る。

### src/config/ — 設定

**役割**: 可変な数値と同梱ロスターの提供。

**配置ファイル**:

- `rules.ts`: `DEFAULT_RULES`。**全ての可変数値の単一の置き場所**
- `defaultRoster.ts`: 同梱のオリジナル仮ロスター

**命名規則**: 定数は UPPER_SNAKE_CASE（`DEFAULT_RULES` / `DEFAULT_ROSTER`）

**依存関係**:

- 依存可能: `src/engine/types.ts`（型のみ）
- 依存禁止: `react` / `src/ui/` / エンジンのロジック関数

**重要な規約**: `satisfies` を使って型との整合を検査しつつリテラル型を保持する。
未確定の値には `TODO(要実機確認)` コメントと、判断の根拠を残す。

### src/storage/ — 永続化（Step 5 以降）

**役割**: ブラウザストレージへの読み書き。

**配置ファイル**:

- `prefs.ts`: localStorage（所持コイン・ロスター・ルール上書き）
- `assets.ts`: IndexedDB（画像 Blob の KV ストア）

**依存関係**:

- 依存可能: `src/engine/types.ts`（型のみ）
- 依存禁止: `react` / `src/ui/` / **ネットワーク API**

### src/ui/ — 画面とフック（Step 4 以降）

**役割**: 入力の受付、描画、アニメーション、時間の管理。

```
src/ui/
├── screens/
│   ├── TitleScreen.tsx
│   ├── BetScreen.tsx
│   ├── TableScreen.tsx
│   ├── ResultScreen.tsx
│   ├── RosterEditor.tsx
│   └── RulesSettings.tsx
├── components/
│   ├── CardView.tsx
│   ├── Hand.tsx
│   ├── DiscardPile.tsx
│   ├── PlayerSeat.tsx
│   ├── DeclareButton.tsx
│   ├── TimerBar.tsx
│   ├── BonusBanner.tsx
│   ├── WallCounter.tsx
│   └── YakuToast.tsx
└── hooks/
    ├── useGameLoop.ts
    └── useAssetUrls.ts
```

**命名規則**:

- コンポーネントファイル: **PascalCase**（`TableScreen.tsx`）。1ファイル1コンポーネント
- フック: **camelCase の `use` 始まり**（`useGameLoop.ts`）
- スタイル: コンポーネントと同名の `.css` を隣に置く

**依存関係**:

- 依存可能: 全レイヤー
- 依存禁止: なし（最上位レイヤー）
- **制約**: ゲームルールを再実装しない。判定は必ずエンジンに委ねる
- **制約**: `framer-motion` は対局画面（`TableScreen` とその配下）でのみ import する

### tests/ — テスト

**役割**: 全レイヤーの検証。

**構造は `src/` を反映する**。テンプレートが示す `unit/` / `integration/` /
`e2e/` の3分割は採用していない。

```
tests/
├── engine/          # src/engine/ の各モジュールに対応
│   ├── rng.test.ts
│   ├── deck.test.ts
│   ├── score.test.ts
│   ├── yaku.test.ts
│   ├── settle.test.ts
│   ├── game.test.ts
│   ├── ai.test.ts
│   └── autoplay.test.ts     ← 統合テスト（自動対局100局）
├── config/
│   └── rules.test.ts
├── ui/
│   └── App.test.tsx
├── storage/                  # Step 5 以降
├── e2e/                      # Step 4 以降（Playwright）
│   ├── table.spec.ts
│   ├── casino.spec.ts
│   └── roster.spec.ts
└── helpers/                  # テスト用の組み立てヘルパ
    ├── cards.ts              # 手札を文字列から組み立てる DSL
    └── game.ts               # GameState を直接組み立てる
```

**分割方針の理由**: ユニットテストと統合テストの境界がこのプロジェクトでは曖昧である。
`autoplay.test.ts` は「状態機械 + AI の結合」を検証する統合テストだが、
検証対象は `src/engine/` であり、対応するソースの隣に置くほうが見つけやすい。
**「どのソースを検証しているか」でディレクトリを決め、テストの種類では分けない。**

E2E だけは対象が「アプリケーション全体」で対応するソースがないため独立させる。

**命名規則**:

| 種別            | パターン           | 例                  |
| --------------- | ------------------ | ------------------- |
| Vitest のテスト | `[対象].test.ts`   | `yaku.test.ts`      |
| React のテスト  | `[対象].test.tsx`  | `App.test.tsx`      |
| Playwright      | `[シナリオ].spec.ts` | `table.spec.ts`   |
| ヘルパ          | 拡張子なしの通常モジュール | `helpers/cards.ts` |

**`.test.` と `.spec.` を使い分ける理由**: `vite.config.ts` の `include` が
`tests/**/*.test.{ts,tsx}` を拾うため、Playwright の `.spec.ts` は
Vitest の実行対象に入らない。**拡張子で実行系を分離している。**

### docs/ — 永続ドキュメント

| ファイル                    | 内容                             |
| --------------------------- | -------------------------------- |
| `product-requirements.md`   | プロダクト要求定義書             |
| `functional-design.md`      | 機能設計書                       |
| `architecture.md`           | 技術仕様書                       |
| `repository-structure.md`   | 本ドキュメント                   |
| `development-guidelines.md` | 開発ガイドライン                 |
| `glossary.md`               | 用語集                           |
| `ideas/`                    | 壁打ち・計画書（構造化は最小限） |

### .steering/ — 作業単位のドキュメント

**役割**: 「今回の作業で何をするか」の記録。

```
.steering/
└── [YYYYMMDD]-[タスク名]/
    ├── requirements.md      # 今回の要求内容
    ├── design.md            # 実装アプローチ
    └── tasklist.md          # タスクリスト + 振り返り
```

**命名規則**: `20260807-pokajan-03-game` 形式

**重要**: **`.steering/` は `.gitignore` に入れず、コミットする。**
テンプレートは一時ファイルとして除外を推奨しているが、本プロジェクトでは
設計判断の根拠と振り返りが蓄積される主要な記録であり、
`CLAUDE.md` からも「実装前に直近の `design.md` を読むこと」として参照している。
一時ファイルではなく**設計履歴**として扱う。

### scripts/ — 補助スクリプト

- `init-project.sh`: プロジェクト名の一括置換（scaffold 由来）

ビルド・テストは npm scripts で完結するため、ビルドスクリプトは置かない。

## ファイル配置規則

### ソースファイル

| ファイル種別         | 配置先              | 命名規則           | 例                    |
| -------------------- | ------------------- | ------------------ | --------------------- |
| ドメイン型           | `src/engine/`       | `types.ts` に集約  | `types.ts`            |
| エンジンのモジュール | `src/engine/`       | camelCase          | `gameSelectors.ts`    |
| 設定値               | `src/config/`       | camelCase          | `rules.ts`            |
| 永続化               | `src/storage/`      | camelCase          | `assets.ts`           |
| 画面                 | `src/ui/screens/`   | PascalCase + `.tsx`| `TableScreen.tsx`     |
| 部品                 | `src/ui/components/`| PascalCase + `.tsx`| `CardView.tsx`        |
| フック               | `src/ui/hooks/`     | `use` + camelCase  | `useGameLoop.ts`      |

### テストファイル

| テスト種別       | 配置先          | 命名規則             | 例                  |
| ---------------- | --------------- | -------------------- | ------------------- |
| エンジンのテスト | `tests/engine/` | `[対象].test.ts`     | `yaku.test.ts`      |
| UI のテスト      | `tests/ui/`     | `[対象].test.tsx`    | `App.test.tsx`      |
| E2E              | `tests/e2e/`    | `[シナリオ].spec.ts` | `table.spec.ts`     |
| ヘルパ           | `tests/helpers/`| camelCase            | `cards.ts`          |

### 設定ファイル

| ファイル種別   | 配置先         | 備考                                           |
| -------------- | -------------- | ---------------------------------------------- |
| ツール設定     | プロジェクトルート | `vite.config.ts` / `.oxlintrc.json` 等      |
| TypeScript     | プロジェクトルート | プロジェクト参照で app / node / test を分割 |
| アプリの設定値 | `src/config/`  | **ツール設定と混ぜない**                       |

**TypeScript のプロジェクト構成**:

```
tsconfig.json          ルート（references のみ）
├── tsconfig.app.json  src/ 用
├── tsconfig.node.json vite.config.ts 用
└── tsconfig.test.json tests/ 用（jsx / DOM lib / node types を有効化）
```

`tsconfig.test.json` は `tsconfig.app.json` を `references` しない。
Vite テンプレートの構成は `composite: true` を持たないため、
参照を足すと `tsc -b` が TS6306 / TS6310 で失敗する。
テストの型検査は `include` に `tests` と `src` を含めることで担保している。

## 命名規則

### ディレクトリ名

- レイヤー: 単数形の小文字（`engine/` / `config/` / `storage/` / `ui/`）
- UI の内訳: 複数形（`screens/` / `components/` / `hooks/`）
- ステアリング: `[YYYYMMDD]-[kebab-case]`

### ファイル名

| 対象                     | 規則           | 例                  |
| ------------------------ | -------------- | ------------------- |
| 関数の集合（モジュール） | camelCase      | `turnFlow.ts`       |
| React コンポーネント     | PascalCase     | `CardView.tsx`      |
| React フック             | `use` + camelCase | `useAssetUrls.ts` |
| テスト                   | `[対象].test.ts` | `settle.test.ts`  |

**クラスファイルの PascalCase 規則は適用しない**。本プロジェクトはクラスをほぼ使わず、
関数と型で構成されているため、モジュール名は camelCase に統一する
（例外: `RosterValidationError` / `IllegalActionError` はクラスだが、
それぞれ `deck.ts` / `errors.ts` に同居する）。

### 識別子

| 対象           | 規則                | 例                              |
| -------------- | ------------------- | ------------------------------- |
| 型・インターフェース | PascalCase     | `YakuCandidate` / `RulesConfig` |
| 関数・変数     | camelCase           | `findYaku` / `bestYaku`         |
| 定数           | UPPER_SNAKE_CASE    | `DEFAULT_RULES` / `TRIPLE_SIZE` |
| 真偽値         | `is` / `has` / `can` 接頭辞 | `isCpu` / `hasPendingClaims` |

## 依存関係のルール

### レイヤー間の依存

```
        UI レイヤー（src/ui/, App.tsx）
          ↓ OK        ↓ OK        ↓ OK
  永続化      設定       エンジン
（storage/）（config/） （engine/）
                ↓ OK        ↑
          engine/types.ts ──┘（型のみ）
```

**禁止される依存**:

| 禁止                          | 理由                                             | 検出方法                     |
| ----------------------------- | ------------------------------------------------ | ---------------------------- |
| `engine/` → `react`           | エンジンを UI 非依存に保つ                       | oxlint `no-restricted-imports` |
| `engine/` → `config/`         | ルール値は引数で受け取る                         | 同上                         |
| `engine/` → `ui/`             | 依存の逆流                                       | 同上                         |
| `config/` → `react`           | 設定を UI 非依存に保つ                           | 同上                         |
| `storage/` → ネットワーク API | プライバシー要件（画像を端末外へ出さない）       | レビュー                     |

### 循環依存の禁止

エンジン層は依存の向きを一方向に保つ。循環が生じそうになったら、
**共通部分を下位モジュールへ抽出する**。

実例: `game.ts` から和了処理を `win.ts` へ切り出す際、`win.ts` が
手番の進行（`exitChain`）を必要とした。`game.ts` から呼ぶと循環するため、
手番の進行を `turnFlow.ts` として独立させ、`game.ts` と `win.ts` の
両方がそれを参照する形にした。

## スケーリング戦略

### ファイルサイズの管理

| 行数        | 対応                     |
| ----------- | ------------------------ |
| 〜300行     | 問題なし                 |
| 300〜400行  | 分割の余地を意識する     |
| **400行超** | **分割する**             |

**この閾値は文書に書くだけでは機能しない。** Step 3 で「400行を超えたら分割する」と
設計書に明記していたにもかかわらず 641 行まで放置し、3つのレビューすべてから
同じ指摘を受けた。**フェーズの区切りごとに `wc -l` で機械的に測る**ことをタスクに含める。

```bash
wc -l src/engine/*.ts src/ui/**/*.tsx | sort -n | tail -20
```

### 分割の切り口

**良い切り口**（Step 3 の実例）:

| 抽出先             | 切り口                             |
| ------------------ | ---------------------------------- |
| `gameSelectors.ts` | 状態を**変えない**導出（クエリ）   |
| `gameDraft.ts`     | 内部表現と不変条件ガード           |
| `claims.ts`        | 特定フェーズに固有のロジック       |
| `turnFlow.ts`      | 複数箇所から呼ばれる共通処理       |
| `win.ts`           | ひとまとまりの手続き               |

**悪い切り口**: 行数を減らすためだけの機械的な分割。
「このファイルは何を担当するか」が1文で言えない分割はしない。

### 機能の追加

| 規模                       | 配置方針                                       |
| -------------------------- | ---------------------------------------------- |
| 小（既存モジュールの拡張） | 既存ファイルに追加                             |
| 中（新しい責務）           | レイヤー内に新しいモジュールを作る             |
| 大（新しいレイヤー）       | `src/` 直下に新ディレクトリ + 依存ルールを本書に追記 |

## 除外設定

### .gitignore

```
# Logs / ビルド成果物
logs, *.log, node_modules, dist, dist-ssr, *.local

# エディタ
.vscode/*（!.vscode/extensions.json）, .idea, .DS_Store 等

# 環境変数・シークレット
.env, .env.*, !.env.example
```

**除外しないもの（意図的）**:

| パス          | 理由                                                     |
| ------------- | -------------------------------------------------------- |
| `.steering/`  | 設計判断の根拠と振り返りの記録。一時ファイルではない     |
| `docs/`       | 永続ドキュメント                                         |
| `.claude/`    | プロジェクト共通の Claude Code 設定                      |
| `.mcp.json`   | 使用する MCP サーバの定義（秘密情報を含まない）          |

### .prettierignore

`dist/` / `node_modules/` / `package-lock.json` を除外する。
`.steering/` と `docs/` は**整形対象に含める**（ドキュメントの体裁を揃えるため）。

### oxlint の対象

`src/` と `tests/` を対象とする。`.oxlintrc.json` の `overrides` で
`src/engine/**` と `src/config/**` に対する import 制約を定義している。
