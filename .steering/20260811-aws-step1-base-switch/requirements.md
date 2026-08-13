# 要求: AWS デプロイ Step 1 — monorepo 土台 + Vite base 切替

## 背景

[cc-pokajan-aws-deployment-plan-revised.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised.md) の
Phase 1〜3 実装計画のうち **Step 1** を実装する。AWS には一切触れない **app-side の純コード変更**で、
以降の AWS 実体（Step 3〜）が乗る土台を作る。既定は現状の GitHub Pages（`github-pages`）のままで挙動不変。

## スコープ（Step 1 範囲のみ）

1. **monorepo 土台**: root `package.json` に `"workspaces": ["backend"]` を追加し、workspace を有効化するための
   **最小 `backend/package.json` プレースホルダ**を作成、`package-lock.json` を同期する。
2. **デプロイ設定モジュール**: `src/config/deploy.ts` を新規作成し、`import.meta.env.VITE_DEPLOY_TARGET`
   （`'github-pages' | 'aws'`、既定 `'github-pages'`）から
   `deployConfig { target, authEnabled, transport, walletSource, apiBaseUrl }` を導出する。
   併せて `src/vite-env.d.ts` を新規作成し `ImportMetaEnv` を型付け（`VITE_DEPLOY_TARGET` のタイポを compile 時に検知）。
3. **base の target 対応**: `vite.config.ts` の `resolveBase` を target 対応にし、`aws` → `'/'`、
   それ以外は既存の `command/isPreview` 分岐で `'/cc-pokajan/'` とする。
4. **回帰テスト**: `tests/config/viteBase.test.ts` に aws ケースを追加し、`deriveDeployConfig` の
   単体テスト `tests/config/deploy.test.ts` を新規作成する。

## 受け入れ基準

- `VITE_DEPLOY_TARGET=aws npm run build` → `dist/index.html` のアセットが **`/` 起点**。
- 既定 `npm run build` → 従来どおり **`/cc-pokajan/` 起点**（Pages 併存を壊さない）。
- `npm run dev` はルート `/` のまま。`npx playwright test` が緑のまま（E2E は既定 `github-pages`）。
- 既存検証ゲート `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が PASS。
- **`npm ci` が成功する**（workspaces 追加で CI = 本番 Pages デプロイのゲートを壊さないこと）。

## 非スコープ（後続ステップ）

- backend の **実質的な実装**（Lambda ハンドラ・エンジン共有など）は Step 5。今回はプレースホルダのみ。
- 認証・transport・wallet の実挙動（`deployConfig` はフラグを公開するだけ。消費は Step 4/6）。
- Terraform・CI ワークフロー（`deploy-aws.yml`）は Step 3。

## 制約

- **`src/**` の変更は新規 `src/config/deploy.ts` と `src/vite-env.d.ts` のみ**（既存 `src` ファイルは無改変）。
  `tests/**` は `viteBase.test.ts` と新規 `deploy.test.ts` のみ。
- `.oxlintrc.json` / 既存 tsconfig グラフ / `playwright.config.ts` / 既存 `deploy.yml` は変更しない。
- `deploy.ts` は `src/config/**`（oxlint override で React 依存禁止）に置くため React を import しない。
