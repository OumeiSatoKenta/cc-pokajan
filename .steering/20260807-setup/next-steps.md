# 初回セットアップの完了と次のステップ

**実施日**: 2026-08-07

## 作成したドキュメント

| ファイル                                                         | 内容                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------- |
| [docs/product-requirements.md](../../docs/product-requirements.md) | 何を作るか。ペルソナ・KPI・機能要件（P0/P1/P2）          |
| [docs/functional-design.md](../../docs/functional-design.md)       | どう実現するか。データモデル・コンポーネント・アルゴリズム |
| [docs/architecture.md](../../docs/architecture.md)                 | 技術選定・レイヤー構造・永続化・セキュリティ             |
| [docs/repository-structure.md](../../docs/repository-structure.md) | ディレクトリ構造・命名規則・依存ルール                   |
| [docs/development-guidelines.md](../../docs/development-guidelines.md) | コーディング規約・Git運用・テスト戦略・レビュー基準  |
| [docs/glossary.md](../../docs/glossary.md)                         | 日本語のドメイン用語とコード上の識別子の対応             |

### このプロジェクト特有の記載事項

一般的なテンプレートから意図的に外した箇所を記録しておく。

| 項目               | 判断                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| KPI にユーザー行動指標を置かない | サーバーもテレメトリも持たないため測定不能。CI で自動測定できる品質指標に限定 |
| カバレッジの数値目標を設けない | Step 2 で186件のテストが通った状態で欠陥3件が見つかった。「不変条件が検査されていること」を基準にする |
| 実機統計との一致を KPI にしない | 一致させにいくと未確定のルール値に AI 由来の誤差を押し付けることになる。「乖離の原因を説明できる状態」を成功と定義 |
| テストを unit/integration/e2e で分けない | 「どのソースを検証しているか」でディレクトリを決める。E2E だけは対応するソースがないため独立 |
| テスト名を日本語の説明文にする | ドメインが日本語のゲーム。テスト名の一覧がそのまま仕様の一覧になる状態を目指す |
| モックを使わない   | エンジン層が純粋関数の集合で外部依存を持たないため不要                   |
| `.steering/` を gitignore しない | 設計判断の根拠と振り返りの記録であり、一時ファイルではない            |

## 現在の実装状況

全6ステップのうち **Step 3 まで完了**。

| Step | 内容                          | 状態    |
| ---- | ----------------------------- | ------- |
| 1    | 基盤・型定義・山札生成        | ✅ 完了 |
| 2    | 役判定・点数・支払い          | ✅ 完了 |
| 3    | 対局状態機械 + CPU AI         | ✅ 完了 |
| 4    | 対局UI                        | 未着手  |
| 5    | カジノメタ                    | 未着手  |
| 6    | ロスターエディタ + ルール設定 | 未着手  |

**現在の検証状態**: 281 tests / 10 files PASS、lint / typecheck / build / format すべて green。

## 次の `/add-feature` 候補

### 1. 対局UI（最優先・P0）

PRD の機能要件 #4 に対応。**これが完了するとブラウザで実際に遊べるようになる。**

```
/cc-base-project:add-feature ポカジャン 対局UI: エンジンを React に接続する useGameLoop フックと対局画面（手札・河・宣言窓・リーチ黄色枠・カードアニメーション）を実装し、ブラウザで1局遊べるようにする。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 4 範囲のみ実装、Step 1-3 完了前提)
```

**着手前に確認すること**:

- エンジンと React の接続方式は**決定済み**。
  `.steering/20260807-pokajan-03-game/design.md` の「決定: エンジンと React の接続」を参照。
  UI 層に `LoopState { game, pending }` を置き、`createLoopReducer(rules)` を `useReducer` に渡す
- `framer-motion` と `@playwright/test` の**インストールが必要**（未導入）
- Chrome 拡張のスクリプト注入が反応するか、着手前に `npm run dev` で確認しておく
  （Step 3 では5回連続でタイムアウトし、ブラウザでの目視確認ができなかった）

### 2. カジノメタ（P0）

PRD の機能要件 #5 に対応。BET → 対局 → 精算のループを完成させる。

```
/cc-base-project:add-feature ポカジャン カジノメタ: BET選択・順位倍率による精算・所持コインの localStorage 永続化と、Title / Bet / Result の3画面を実装する。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 5 範囲のみ実装、Step 1-4 完了前提)
```

**依存**: Step 4（対局画面と `useGameLoop`）

### 3. ロスターエディタ（P0・本プロダクトの中心的な価値）

PRD の機能要件 #6 に対応。**「自分たちだけの卓を作る」という中心的な価値を担う。**

```
/cc-base-project:add-feature ポカジャン ロスターエディタ: メンバー/グループのCRUD、画像アップロード（canvas で 256×256 webp 変換 → IndexedDB 保存）、バリデーション、画像込み単一ファイルの import/export を実装する。参照ドキュメント: docs/ideas/pokajan-plan.md (Step 6 範囲のみ実装、Step 1-5 完了前提)
```

**PRD で重みが増した点**（当初計画からの変更）:

- **共有機能が必須経路**になった。幹事が作って全員に配る使い方を想定するため、
  「別の端末・別のブラウザで読み込んでそのまま対局できる」ことが受け入れ条件
- **プライバシー要件が格上げ**された。実在人物の顔写真を扱う前提のため、
  「メンバー削除時に画像データも破棄される」「書き出しファイルに個人情報が含まれる旨の明示」を追加

### 4. ルール設定（P1）

PRD の機能要件 #7 に対応。Step 6 と同時実装でもよい。

```
/cc-base-project:add-feature ポカジャン ルール設定: 点数表・初期点・BET設定などの数値を画面から編集し、デフォルト復元とバリデーションを備えた設定画面を実装する。参照ドキュメント: docs/product-requirements.md (機能要件 #7、Step 1-3 完了前提)
```

**着手前に確認すること**: `validateRules` 相当の関数が未実装。
負の `handSize` などが `deal` の `slice` を静かに壊すため、
ユーザー編集を許す前に値の検証を追加する必要がある
（`.steering/20260807-pokajan-02-yaku/design.md` の申し送り事項）。

## プロジェクトタイプ別の補足（Webアプリ）

### セットアップ

```bash
npm install
npm run dev        # http://localhost:5173/
```

**環境変数の設定は不要。** 本プロジェクトは秘密情報を持たず、`.env` を使う場面がない。
`.gitignore` に `.env` 系を追加済みだが、これは将来の予防措置。

### 検証ゲート

作業の完了前に以下を全て通す。

```bash
npm run lint && npm run typecheck && npm test && npm run build && npm run format:check
```

### Step 4 で追加が必要な依存

```bash
npm install framer-motion
npm install -D @playwright/test
npx playwright install chromium
```

## 未着手の課題（ドキュメント作成中に判明したもの）

| 課題                             | 対応時期            | 備考                                                       |
| -------------------------------- | ------------------- | ---------------------------------------------------------- |
| **Git リポジトリになっていない** | 任意                | `git init` 以降に development-guidelines.md の Git 規約が適用される |
| `validateRules` が未実装         | Step 6 着手前       | ルールをユーザー編集可能にする前に必要                     |
| `startingScore` が推定値         | 実機情報が得られ次第 | 感度分析は design.md に記録済み。値の変更は1箇所で済む     |
| `group3.sameColor` が推定値      | 同上                | 出典が見つからなかった唯一の点数                           |
| ブラウザでの目視確認手段         | Step 4 着手前       | Chrome 拡張のスクリプト注入がタイムアウトする問題          |

## ドキュメントの使い方

- **編集は普通に会話で依頼する**
  例: 「PRD に新しいペルソナを追加して」「architecture.md の永続化戦略を見直して」
- **機能追加**: `/cc-base-project:add-feature [機能名]`
- **詳細レビュー**: `/cc-base-project:review-docs docs/product-requirements.md`
- **コードレビュー**: `/review-codes changed`

実装前には `CLAUDE.md` と、関連する `docs/` および直近の `.steering/*/design.md` を読むこと。
