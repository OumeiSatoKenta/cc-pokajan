# タスクリスト — GitHub Pages 公開 Step 2: GitHub Actions で自動デプロイ

参照: requirements.md / design.md / [計画書](../../docs/ideas/pokajan-github-pages-deploy-plan.md)（B 節）

## フェーズ0: 前提確認

- [x] Step 1（base 対応）完了を確認（commit `baee95d`。`resolveBase` で production base `/cc-pokajan/`）
- [x] `package-lock.json` が tracked（`git ls-files` で確認。`npm ci` / `cache: npm` の前提を満たす）
- [x] `.github/` が未作成であること（新規作成でよい）

## フェーズ1: 実装

- [x] `.github/workflows/deploy.yml` を新規作成（design.md の定義どおり）
  - トリガー `push: [main]` ＋ `workflow_dispatch`
  - `permissions`（contents:read / pages:write / id-token:write）・`concurrency`（group pages / cancel false）
  - build ジョブ: checkout → setup-node(22, cache npm) → `npm ci` → 検証ゲート（lint/typecheck/test/build/format:check）
    → configure-pages → upload-pages-artifact(`./dist`)
  - deploy ジョブ: `needs: build` / `environment: github-pages` / deploy-pages
  - **セキュリティ**: `run:` に `github.event.*` 等の非信頼入力を差し込まない（唯一の `${{ }}` は
    `steps.deployment.outputs.page_url` ＝アクション出力を `environment.url` に使うだけ）。インジェクション経路なし
- [x] `README.md` に公開 URL（`https://oumeisatokenta.github.io/cc-pokajan/`）を 1 行追記（Live デモ導線）

## フェーズ2: 検証

- [x] `deploy.yml` の **YAML 構文が妥当**（Prettier のパーサで parse 成功。タブ無し）
- [x] ワークフローのゲート順が CLAUDE.md 準拠（lint→typecheck→test→build→format:check）で、E2E を含まない
- [x] ローカルで同ゲートが全 PASS（lint/typecheck clean・**test 772**・build OK・format clean）
- [x] `npx playwright test` は Step 2 でコード不変のため実行不要（前回 80/0 から変化なし。deploy.yml/README/steering のみ）
- [x] `README.md` に公開 URL が入っている（`<https://oumeisatokenta.github.io/cc-pokajan/>`）
- [x] **セキュリティ**: workflow injection 経路なし（`run:` に非信頼入力なし、唯一の `${{ }}` はアクション出力）

## フェーズ3: 申し送り（手動手順）

- [x] Pages の Source を「GitHub Actions」にする初回手動手順を design.md・計画書に明記
- [x] 実デプロイ（push → Actions → 公開）はユーザー操作である旨を明記（受け入れ基準・design 注記）

## 実装後の振り返り

- **実装完了日**: 2026-08-11

- **最終成果物**: `.github/workflows/deploy.yml`（新規）＋ `README.md`（公開 URL 1 行）。
  build（検証ゲート → artifact）→ deploy（Pages 公開）の2ジョブ。

- **検証結果**:
  - `deploy.yml` は Prettier のパーサで parse 成功（YAML 妥当・タブ無し）。
  - CI が回すゲートをローカルで実行し全 PASS: lint/typecheck clean・**test 772**・build OK・format clean。
  - `npx playwright test` は Step 2 でコード不変のため再実行せず（前回 80/0）。

- **3軸レビュー結果（読み取り専用・実成果物 deploy.yml に対して）**:
  構造 **A** / 欠陥 **B** / API **B**、**[必須] 0 件**。API 軸は GitHub 公式 `starter-workflows` を実機取得して照合。

- **計画と実績の差分（レビュー由来の改善を反映）**:
  - **権限を per-job 最小化**（構造・欠陥の両軸 [推奨] が収束）: top-level を `contents: read` のみにし、
    `pages: write`/`id-token: write` は deploy ジョブに絞った。build は `npm ci`/`npm test` で第三者コードを
    走らせるため、そこに公開権限を渡すとゲート迂回デプロイの余地が残る、という指摘。
  - **`deploy-pages@v4 → @v5`**（API 軸 [推奨]）: 公式最新テンプレート（`pages/nextjs.yml`）が `@v5`。
    v4→v5 は Node ランタイム更新のみで破壊的変更なし。他4アクションは現行テンプレートと一致。
  - **`timeout-minutes: 15`**（欠陥 [任意]）: build のハングで Runner を長時間占有しないための上限。
  - 計画書 B 節・design.md・コマンド一覧を実装に追随更新。

- **学んだこと**:
  - **workflow injection は「非信頼入力を `run:`/`ref:` に差さない」で構造的に断てる**。今回はトリガーが
    `push:[main]`＋`workflow_dispatch`（inputs なし）で issue/PR/comment を使わず、唯一の `${{ }}` は
    アクション出力。security hook の警告も実地で潰した。
  - **公式 starter-workflow の版に「合わせる」判断は実機照合してから**。API 軸が公式リポジトリを取得し、
    `deploy-pages` だけが1世代遅れていることを発見した（記憶では気づけなかった）。
  - **「公式雛形が top-level 権限だから OK」で止めない**。build が第三者コードを走らせる文脈では per-job 最小化の
    方が正しい。公式の簡易テンプレより厳格に倒すのが妥当な場面がある。

- **次回への改善提案 / 申し送り（実デプロイはユーザー操作）**:
  1. GitHub → **Settings → Pages → Build and deployment → Source =「GitHub Actions」**（初回のみ・手動）。
  2. この Step のコミットを `main` にマージ（または `workflow_dispatch`）で初回デプロイ。
  3. Actions で build→deploy が緑になり、deploy の `url`（`https://oumeisatokenta.github.io/cc-pokajan/`）で開けることを確認。
  4. 将来 `upload-pages-artifact` を v4+ に上げる際は dotfiles 既定除外に注意（現状 `dist/` に dotfile 無し）。
  - **GitHub Pages 公開の 2 ステップ計画はこれで完成**（Step 1 base 対応＋Step 2 自動デプロイ）。
