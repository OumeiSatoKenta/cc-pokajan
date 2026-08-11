# 要求内容 — GitHub Pages 公開 Step 2: GitHub Actions で自動デプロイ

## 背景

Step 1（base パス対応、commit `baee95d`）で本番ビルドが `/cc-pokajan/` サブパスで正しく動くことを確定した。
Step 2 はその成果物を **GitHub Actions（公式 Pages アーティファクト方式）**で `main` への push ごとに
自動公開する。これで 2 ステップ計画（GitHub Pages 公開）が完成する。

参照: [docs/ideas/pokajan-github-pages-deploy-plan.md](../../docs/ideas/pokajan-github-pages-deploy-plan.md)
（Step 2 範囲のみ。B 節のワークフロー定義が一次資料）。Step 1 完了前提。

公開 URL: `https://oumeisatokenta.github.io/cc-pokajan/`

## スコープ

**やること**:

- `.github/workflows/deploy.yml` を新規作成。`main` への push（＋手動 `workflow_dispatch`）で:
  - build ジョブ: 検証ゲート（`lint` → `typecheck` → `test` → `build` → `format:check`、**E2E は除く**）を
    通してから `dist/` を Pages アーティファクトにアップロード。
  - deploy ジョブ: `deploy-pages` で公開。
- `README.md` に公開 URL を 1 行追記（Live デモ導線）。
- Pages の Source を「GitHub Actions」にする**手動手順**を計画書／申し送りに明記（コードではない）。

**やらないこと（Step 2 スコープ外）**:

- アプリコード（`src/**`）・テスト（`tests/**`）・`vite.config.ts`・`playwright.config.ts` の変更。
- 新規 npm 依存（`gh-pages` パッケージ等）。デプロイは GitHub 公式 Actions のみ。
- E2E を CI に載せる（今回は除外。将来 v2）。
- カスタムドメイン・`public/CNAME`（今回スコープ外）。
- 実際の GitHub への push / Pages 有効化 / 本番デプロイ実行（リポジトリ管理権限とユーザー操作が必要）。

## 受け入れ基準

1. **YAML が妥当**: `.github/workflows/deploy.yml` が構文的に妥当で、GitHub Actions の Pages 標準構成
   （`configure-pages` → `upload-pages-artifact` → `deploy-pages`、`permissions` に `pages: write` / `id-token: write`）
   に沿っている。
2. **検証ゲートが deploy を守る**: build ジョブでゲート（E2E 除く）が全 PASS してからのみ artifact が上がる。
   どれか落ちれば deploy されない。順序は CLAUDE.md（`lint → typecheck → test → build → format:check`）。
3. **CI 前提が揃っている**: `npm ci` と `cache: npm` に必要な `package-lock.json` が tracked（確認済み）。
   `dist/` は gitignore 済みなので CI がビルドして上げる。
4. **README に公開 URL**: `https://oumeisatokenta.github.io/cc-pokajan/` が 1 行追記されている。
5. **既存の検証ゲートが緑のまま**: Step 2 はコードに触らないため
   `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` と
   `npx playwright test` が従来どおり PASS。

## 制約（CLAUDE.md 由来）

- 変更は最小限（`.github/workflows/deploy.yml` 新規 ＋ `README.md` 1 行）。「影響の最小化」。
- 検証ゲートの順序は CLAUDE.md の記載順に合わせる。
- `.nojekyll` は付けない（Actions アーティファクト方式では Jekyll が動かず不要。プラン B 節）。
- Actions ワークフローは `npm run build`（`--mode` 上書きなし）を固定で呼ぶ（Step 1 の申し送り。
  `--mode` を渡すと base 判定の前提が崩れる）。
