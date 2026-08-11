# 実装アプローチ — GitHub Pages 公開 Step 2: GitHub Actions で自動デプロイ

## 変更対象

- 新規: `.github/workflows/deploy.yml`
- 修正: `README.md`（公開 URL を 1 行）

## ワークフロー定義

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

# 既定は最小権限（build の checkout 用 contents:read のみ）。
# デプロイ用の pages:write / id-token:write は deploy ジョブにだけ付ける。
permissions:
  contents: read

# 進行中のデプロイは止めない（公開の取りこぼしを防ぐ）。同時に走る push はキューする。
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15 # ハング時に Runner を占有し続けない上限
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # CLAUDE.md の検証ゲート（E2E 除く）。どれか落ちれば artifact は上がらず deploy されない。
      - run: npm run lint
      - run: npm run typecheck
      - run: npm test
      - run: npm run build # production ＝ base '/cc-pokajan/' で dist/ を生成
      - run: npm run format:check
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    # デプロイ権限はこのジョブだけに絞る（deploy-pages は OIDC の id-token を要する）
    permissions:
      contents: read
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

## 設計判断

### 公式 Pages アーティファクト方式（gh-pages ブランチ方式ではない）

`configure-pages` → `upload-pages-artifact`（`dist/`）→ `deploy-pages` の 3 点セットが GitHub 公式の
現行推奨。`gh-pages` ブランチへ push する旧方式（peaceiris 等）と違い、**新規 npm 依存ゼロ**・
ブランチ汚染なし・Jekyll を通さない（＝`.nojekyll` 不要）。

### 2 ジョブ構成（build → deploy）

- **build**: 検証ゲート → `dist/` を artifact 化。ゲートが**壊れた版の公開を止める門番**。
- **deploy**: `needs: build` で build 成功後のみ。`environment: github-pages` は Pages デプロイに必須の
  デプロイ環境で、`url` に公開 URL が出る。

### 権限とセキュリティ（3軸レビューで per-job に強化）

- **権限はジョブ単位で最小化**: top-level は `contents: read` のみ（build の checkout 用）。
  デプロイ用の `pages: write` / `id-token: write` は **deploy ジョブにだけ**付ける。
  build は `npm ci` / `npm test` で第三者コード（postinstall 等）を走らせるため、そこに公開権限を渡すと
  **侵害された依存が OIDC トークンでゲートを迂回して直接デプロイ**しうる。これを構造的に断つ
  （欠陥・構造の両軸レビューが収束して指摘。GitHub 公式雛形は top-level 一括だが、より厳格な最小権限に倒す）。
- `id-token: write` は `deploy-pages` が OIDC で Pages 公開の署名トークンを取るために必須。
- `concurrency: { group: pages, cancel-in-progress: false }`: 同時 push をキューし、進行中デプロイを
  途中で殺さない（公開の取りこぼし防止）。
- `timeout-minutes: 15`（build）: `npm test` 等のハングで Runner を長時間占有し続けないための上限。
- **workflow injection なし**: `run:` に `github.event.*` 等の非信頼入力を差し込まない。唯一の `${{ }}` は
  `steps.deployment.outputs.page_url`（アクション出力）を `environment.url` に使うだけ。

### 検証ゲート（E2E 除く）

CLAUDE.md の順で `lint → typecheck → test → build → format:check`。`build` は artifact の生成も兼ねる。
**E2E は CI に載せない**（ユーザー確定方針。Playwright ブラウザ導入で CI が重くなる。ローカルで回す）。
各ステップは独立コマンドにして、落ちた箇所がログで一目で分かるようにする。

### アクションのバージョン（公式 starter-workflow に一致）

`checkout@v4` / `setup-node@v4` / `configure-pages@v5` / `upload-pages-artifact@v3` / `deploy-pages@v5`。
API 軸レビューが GitHub 公式 `starter-workflows`（`pages/nextjs.yml`）と実機で突き合わせ、いずれも現行テンプレートと
一致することを確認した。**`deploy-pages` は当初 `@v4` だったが、公式最新テンプレートが `@v5`**（v4→v5 は Node ランタイム
更新のみ・破壊的変更なし）のため合わせた。メジャー固定でパッチは自動追随、破壊的変更は避ける。
（`upload-pages-artifact@v4` は dotfiles 既定除外の破壊的変更あり。`@v3` のままなら無関係だが将来上げる際は注意。）

### Node 22 と `cache: npm`

Vite 8 は Node 20.19+ / 22.12+ を要求。LTS の `node-version: 22` を使う。`cache: npm` は
`package-lock.json`（tracked 済みを確認）からキャッシュキーを作る。`npm ci` も同ロックが要る。

### base は Step 1 で解決済み

`vite build` は production で `resolveBase` により base `/cc-pokajan/` を焼く（Step 1）。ワークフローは
`npm run build`（`--mode` 上書きなし）を固定で呼ぶだけ。**Actions 側で `--base` / `--mode` を渡さない**
（渡すと base 判定の前提が崩れる。Step 1 申し送り）。

### `dist/` は gitignore 済み

CI がビルドして artifact 化するので問題なし。`dist/` はコミットしない（従来どおり）。

## 手動手順（コードではない・実行者への申し送り）

初回のみ人手で:

1. GitHub → リポジトリ **Settings → Pages → Build and deployment → Source =「GitHub Actions」**。
2. `main` にこのワークフローを含むコミットをマージ（または `workflow_dispatch` で手動起動）。
3. Actions のログで build → deploy が緑になり、deploy ジョブの `url`（`https://oumeisatokenta.github.io/cc-pokajan/`）
   で開けることを確認。

## 検証（この Step でローカルにできること）

- `.github/workflows/deploy.yml` の **YAML 構文が妥当**であること（パーサで確認）。
- 検証ゲートのコマンド（`lint`/`typecheck`/`test`/`build`/`format:check`）がローカルで全 PASS すること
  （＝CI で同じゲートが通る前提）。
- `README.md` に公開 URL が入っていること。

**注**: 実際のデプロイ（push → Actions 実行 → 公開）は GitHub への push・Pages 有効化・リポジトリ管理権限を
要するため、この Step では実行しない（受け入れ基準にも「実デプロイはユーザー操作」と明記）。YAML の論理的な
正しさとゲートのローカル通過までを機械で担保する。

## リスクと対応

| リスク | 対応 |
| --- | --- |
| Pages 未有効だと deploy が失敗 | Source =「GitHub Actions」を初回手動設定（申し送り・手動手順に明記） |
| lockfile 不在で `npm ci`/`cache` が失敗 | `package-lock.json` が tracked 済みを確認（受け入れ基準3） |
| Actions が `--mode`/`--base` を渡すと base 崩れ | `npm run build` を素で呼ぶ（Step 1 申し送り。design に明記） |
| E2E 未搭載で本番回帰を CI が見ない | 意図的除外（ユーザー方針）。ローカル `npx playwright test` で担保。将来 v2 |
| 実デプロイ未実施 | この Step では YAML 妥当性＋ゲート通過まで。実公開はユーザー手動（正直に据え置き） |
