# タスクリスト: AWS デプロイ Step 1 — monorepo 土台 + Vite base 切替

## 事前

- [x] ベースライン確認: `npm test`=43 files/829 tests、`npx playwright test`=90 passed、`format:check`=clean

## 実装

- [x] T1: root `package.json` に `"workspaces": ["backend"]` を追加
- [x] T2: `backend/package.json` プレースホルダを新規作成（`@pokajan/game-api` / private / prettier 準拠）
- [x] T3: `npm install` を実行し `package-lock.json` を workspaces 同期
- [x] T4: `src/config/deploy.ts` を新規作成（`DeployConfig` 型・純関数 `deriveDeployConfig`・定数 `deployConfig`）
- [x] T4b: `src/vite-env.d.ts` を新規作成（`ImportMetaEnv` を宣言マージで型付け・`export {}` を書かない）
- [x] T5: `vite.config.ts` の `resolveBase` を target 対応に変更（`aws`→`/`、optional 引数、`process.env` は defineConfig 側で読む）
- [x] T6: `tests/config/viteBase.test.ts` に aws ケース追加（build/preview/dev × aws → すべて `/`）
- [x] T7: `tests/config/deploy.test.ts` を新規作成（`deriveDeployConfig`: github-pages / aws /
      未知値→github-pages / aws かつ apiBaseUrl 未指定→null / github-pages で apiBaseUrl を渡しても強制 null）

## 検証

- [x] V1: `VITE_DEPLOY_TARGET=aws npm run build` で `dist/index.html` のアセットが `/` 起点（`/assets/...` を実測）
- [x] V2: 既定 `npm run build` で `/cc-pokajan/` 起点（`/cc-pokajan/assets/...` を実測・回帰なし）
- [x] V3: `npm ci` が成功（workspaces 同期）＋ `git diff package-lock.json` は workspaces/backend 追加のみ（依存版の巻き添えなし）
- [x] V4: `npm run lint && npm run typecheck && npm test（44 files/836）&& npm run format:check` PASS
- [x] V5: `npx playwright test` 緑（90 passed・dev=`/` 維持）
- [x] V6: ミューテーション確認（resolveBase の aws 分岐 / deriveDeployConfig の isAws を壊すと該当テストが落ちる→revert 済み）

## レビュー反映タスク（実装後 3軸+validator+doc-reviewer）

- [x] R1: [必須] `tests/config/workspaces.test.ts` で backend workspace の実在をガード（npm ci の暗黙スキップ対策）
- [x] R2: [高] `src/vite-env.d.ts` に `ViteTypeOptions.strictImportMetaEnv` を追加し、タイポ→`TS2551` をミューテーション実測
- [x] R3: [推奨] `.env*` 二重ソースの注意書きを `vite.config.ts` / `src/config/deploy.ts` に追記
- [x] R4: [中] `authEnabled` → `isAuthEnabled`（真偽値命名規約）。計画書2本も追随
- [x] R5: [提案] `apiBaseUrl` の空文字を null 扱い＋テスト追加 / `resolveBase` に大文字・空白境界テスト追加
- [x] R6: [高] `docs/architecture.md`・`docs/repository-structure.md` に AWS 版 monorepo（backend/・infra/）の注記

## 振り返り（実装完了: 2026-08-12）

**計画と実績の差分**:

- 計画どおり app-side の純コード変更で完結。既定挙動（`github-pages`）は不変で、既存 100 局テスト・E2E は無改変で緑。
- 実装後レビューで **2 つの前提誤りを是正**した:
  1. 「backend 不在なら `npm ci` が落ちる」は誤り。npm 11 は**黙ってスキップして exit 0**。→ 実在ガードのテストを新設。
  2. 「`ImportMetaEnv` を宣言すればタイポを検知」は不十分。`Record<string,any>` フォールバックが残る。→
     `strictImportMetaEnv` で根治し、`TS2551` をミューテーションで実測。
- 最終ゲート: lint / typecheck / **test 45 files・840**（起点 829 から +11）/ build×2（`/cc-pokajan/` と `/`）/ format:check / **E2E 90** すべて緑。

**学んだこと**:

- 「壊れているのに CI が緑」は、失敗を期待した動作（`npm ci` の失敗）が実は起きないときに生まれる。
  期待する失敗は**実測で確かめる**（このプロジェクトの「たまたま成り立つ正しさに依存しない」の実践）。
- ライブラリの型安全機構（Vite の `strictImportMetaEnv`）は、コメントで安全性を主張する前に**タイポを1つ入れて落ちることを確認**する。

**次回への申し送り**（design.md 末尾に詳細）:

- フラグと target の従属関係、Cognito 設定の置き場、`deployConfig` の DI 注入方針は Step 4 着手時に決める。
- **未コミット**: `backend/` はまだ git 未追跡。PR 作成（ship-pr）時に確実に含めること（実在ガードは working tree を見るため、
  git 追跡漏れそのものは別途 PR レビューで担保）。ルート直下の未追跡 `awscli-bundle*` はコミット対象に含めない。
