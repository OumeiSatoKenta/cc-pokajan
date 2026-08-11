# ポカジャン GitHub Pages 公開 計画書

## Context

完全クライアントサイドのポカジャンを **GitHub Pages** に載せて、無料・サーバーレスで一般公開する。
バックエンド・DB・クラウドを持たない静的バンドルなので、Pages（静的ホスティング）が素直に噛み合う。

**追加する機能（インフラ）**:

1. **本番ビルドの base パス対応** — リポジトリ配下 `/cc-pokajan/` で配信されるため、Vite の `base` を
   build と preview だけ `/cc-pokajan/` にする。dev / Playwright / vitest を壊さないよう `command` / `isPreview` で切り替える。
2. **GitHub Actions による自動デプロイ** — `main` への push で CI が検証ゲートを回し、
   公式 Pages アーティファクト（`configure-pages` → `upload-pages-artifact` → `deploy-pages`）で公開する。

**公開 URL**: `https://oumeisatokenta.github.io/cc-pokajan/`

**ユーザーの要件確認結果**:

- デプロイ方式: **GitHub Actions（公式 Pages アーティファクト）**。`gh-pages` ブランチ push 方式は不採用。
  新規 npm 依存ゼロ。
- CI 検証範囲: **フルゲート（E2E 除く）** = `lint` + `typecheck` + `test` + `build` + `format:check`。
  Playwright E2E は CI に載せない（ブラウザ導入で重くなるため。ローカルで回す）。
- 公開 URL / base: **リポジトリ配下 `/cc-pokajan/`**。カスタムドメイン・ユーザーサイト改名は不採用。
- 段階分割: **2 ステップ**（① base 設定＋ローカル検証 → ② Actions デプロイ）。

**段階分割**: 2 ステアリングステップに分けて段階リリース（base 変更の可否をローカルで確定させてから CI を載せる。
Step 1 が壊れていると Step 2 のデプロイがアセット 404 になるため、検証済みの base を前提に CI を組む）。

### 事前調査で判明した事実（この計画の前提）

コードベース調査（Explore）で以下を確認済み。**アプリ本体は base に対してクリーン**で、`vite.config.ts` の
1 箇所だけで済む。

- **ハードコードされた絶対アセットパスは実質ゼロ**。`index.html` の `<script src="/src/main.tsx">` は
  Vite がビルド時に `base` 付きへ書き換えるため安全。favicon は `data:` URI。`public/` は存在せず、
  バンドルされる画像・フォント・音声は 0 件（アバター等は IndexedDB Blob → `URL.createObjectURL`。base 非依存）。
- **URL ルーターは無い**。画面遷移は `appReducer.ts` の `Screen` 判別共用体（`title`/`bet`/`table`/…）による
  内部 state のみ。`window.location` はクエリ（`seed`/`fast`/`turnMs`）の読み取りと ErrorBoundary の
  `reload()` だけ。**ディープリンク経路が無いので `404.html` の SPA フォールバックは不要**。
- **Playwright は dev サーバを叩く**。`playwright.config.ts` は `baseURL: http://localhost:5174`、
  `webServer` は `npm run dev`、各テストは `page.goto('/')` などルート相対。
  → **`base` を無条件に付けると e2e が全滅する**（後述の最大リスク）。
- **`dist/` は gitignore 済み**・出力先はデフォルト `dist/`・`.nojekyll` は Actions アーティファクト方式では不要
  （Jekyll は動かない。かつ Vite の出力は `assets/` でアンダースコア無し）。
- 既存 CI は無し（`.github/` が存在しない）。`gh-pages` パッケージも `deploy` スクリプトも無い。

> **AWS ポートフォリオ計画との関係**: `pokajan-aws-portfolio-plan.md` は S3+CloudFront+Cognito の
> **有料・認証付きポートフォリオ**版デプロイで、こちらは**無料・認証なしの一般公開**版。両者は競合せず併存できる
> （GitHub Pages で気軽に遊べる URL を出しつつ、AWS 版は次段のポートフォリオとして別リポジトリで進める）。

---

## 設計サマリ

### A. base パスの条件分岐（`vite.config.ts`）

**唯一のアプリ側変更**。`defineConfig` を関数形にし、Vite 公式の「Conditional Config」パターン
（`command` / `isPreview`）で `base` を出し分ける。base 解決は純関数 `resolveBase` に切り出し、
`tests/config/viteBase.test.ts` で回帰を固定する。

```ts
import react from '@vitejs/plugin-react'
import type { ConfigEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// build と preview だけ base を /cc-pokajan/ にする:
//   vite（dev）  → command 'serve', isPreview undefined/false → base '/'（Playwright の webServer）
//   vite build   → command 'build'                            → base '/cc-pokajan/'（デプロイ成果物）
//   vite preview → command 'serve', isPreview true            → base '/cc-pokajan/'（dist をサブパス検証）
//   vitest       → command 'serve', isPreview undefined/false → base '/'（base 非依存・無害）
// isPreview は undefined を取りうるため Vite 公式の推奨どおり `=== true` で明示比較する。
const REPO_BASE = '/cc-pokajan/' // ★ リポジトリ改名時はここを変える（＋必要なら public/CNAME）

export const resolveBase = (env: Pick<ConfigEnv, 'command' | 'isPreview'>): string =>
  env.command === 'build' || env.isPreview === true ? REPO_BASE : '/'

export default defineConfig((env) => ({
  base: resolveBase(env),
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
  },
}))
```

- **なぜ `mode` ではなく `command` / `isPreview` か**: 要件は「dev/e2e は `/`、build と preview は
  `/cc-pokajan/`」。ところが **`vite preview` の `command` は `'build'` ではなく `'serve'`**（dev と同じ）なので
  `command` 単独では preview を dev と区別できない。Vite はこの区別のために専用フラグ `isPreview` を用意しており、
  `command === 'build' || isPreview === true` が公式の正準パターン（`isPreview` は undefined を取りうるので
  `=== true` の明示比較が公式推奨）。`mode === 'production'` 案もあるが、
  `vite build --mode X` で mode だけ上書きされると base が黙って `/` に落ちる潜在脆さがあるため採らない
  （Step 1 の 3軸レビューで欠陥・API 両軸が収束して見直した）。
- **base 定数はリポジトリ名にハードコード**（`/cc-pokajan/`、先頭・末尾スラッシュ付き＝Vite 公式書式）。
  リポジトリ改名時はここを直す（リスク表参照）。

### B. GitHub Actions ワークフロー（新規 `.github/workflows/deploy.yml`）

`main` への push（と手動 `workflow_dispatch`）で起動。**build ジョブで検証ゲートを通してから**成果物を上げ、
deploy ジョブで公開する。ゲートのどれか 1 つでも落ちれば artifact は上がらず**壊れた版は公開されない**。

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

# 既定は最小権限（build の checkout 用 contents:read のみ）。デプロイ権限は deploy ジョブに絞る。
permissions:
  contents: read

# 進行中のデプロイは止めない（公開の取りこぼしを防ぐ）
concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    timeout-minutes: 15 # ハング時に Runner を占有し続けない上限
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # CLAUDE.md の検証ゲート（E2E 除く）。順序も CLAUDE.md に合わせる。
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
    # デプロイ権限はこのジョブだけに絞る（build に公開権限を渡さない）
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

- **Node 22**: Vite 8 は Node 20.19+ / 22.12+ を要求。LTS の 22 を固定。`cache: npm` で `npm ci` を高速化。
- **権限は per-job 最小化**: top-level は `contents: read` のみ。`pages: write` / `id-token: write` は deploy に絞る
  （build は `npm ci`/`npm test` で第三者コードを走らせるため、公開権限を渡さない＝ゲート迂回デプロイを構造的に防ぐ）。
  Step 2 の欠陥・構造の両軸レビューが収束して指摘。GitHub 公式雛形は top-level 一括だが、より厳格に倒す。
- **アクション版**: 公式 `starter-workflows`（`pages/nextjs.yml`）と実機で照合し `deploy-pages@v5`。
  `checkout` / `setup-node` は当初 `@v4`（公式雛形と同じ）だったが、初回 CI で **Node 20 deprecation 警告**
  （v4 は node20 ターゲットで node24 に強制実行）が出たため、現行最新の **`@v7`** に更新して警告を解消した
  （v4→v7 は Node ランタイム更新＋ESM 化が主で破壊的変更なし）。`configure-pages@v5` / `upload-pages-artifact@v3` は据え置き。
- **`configure-pages@v5`**: 慣例として置く。base は `vite.config.ts` で明示済みなので、その自動注入には依存しない。
- **`.nojekyll` は付けない**: Actions アーティファクト方式では Jekyll が動かず、かつ Vite 出力は `assets/`
  （アンダースコア無し）。付けても無害だが不要なので「影響の最小化」で省く。

### C. 新規ファイル

| パス                          | 役割                                                             |
| ----------------------------- | ---------------------------------------------------------------- |
| `.github/workflows/deploy.yml` | main への push で検証ゲート → 公式 Pages アーティファクトで公開 |

**クライアント完結の設計判断**: サーバー・DB を持たない静的バンドルなので、Pages（静的配信）だけで成立する。
永続化（localStorage / IndexedDB）はブラウザ内で完結し、Pages のオリジンで問題なく動く（下記リスクの origin 共有だけ留意）。

### D. UI 拡張

**なし**。画面・コンポーネントには一切手を入れない。base 対応はビルド時のアセット URL 書き換えだけで完結する。

### E. ランタイム統合

**なし**。実行時コード（フック・リデューサ・オーケストレータ）は不変。`import.meta.env.BASE_URL` を使う箇所も無い。

### F. 永続化

**変更なし**。localStorage キー `cc-pokajan:prefs`（`src/storage/prefs.ts`）と
IndexedDB DB 名 `cc-pokajan` / store `assets`（`src/storage/assets.ts`）はそのまま。
オリジン共有の注意はリスク表に記載（**今回は改名しない**＝既存ローカルデータの移行を避ける）。

### G. i18n

**なし**。文言追加は無い（インフラ変更のみ）。README への公開 URL 追記のみ Step 2 で行う。

---

## 段階分割（2 ステップ）

各ステップ完了時に `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が
PASS し、`npx playwright test` も緑であること（**特に Step 1 は e2e が壊れていないことが受け入れ条件**）。

### Step 1: `.steering/[YYYYMMDD]-gh-pages-base-path/` ✅ 実装済み（2026-08-11）

- `vite.config.ts` を関数形にし、純関数 `resolveBase(env) = env.command === 'build' || env.isPreview === true ? '/cc-pokajan/' : '/'`
  を切り出して `base: resolveBase(env)` を追加。`tests/config/viteBase.test.ts` で回帰を固定。
- **ローカル検証**: `npm run build && npm run preview` → `http://localhost:4173/cc-pokajan/` でアセットが 404 なく読め、
  対局が最後まで回ることを確認。`npm run dev` はルート `/` のまま、`npx playwright test` が緑のままであることを確認。
- ドキュメント・テスト以外のアプリコードは触らない。

### Step 2: `.steering/[YYYYMMDD]-gh-pages-actions-deploy/`

- `.github/workflows/deploy.yml` を新規作成（B 節の内容）。
- リポジトリ設定で **Pages の Source を「GitHub Actions」に変更**（GitHub UI での一度きりの手動操作。事前確認参照）。
- `main` へ push → Actions 実行 → ゲート通過 → デプロイ → `https://oumeisatokenta.github.io/cc-pokajan/` で実機確認。
- `README.md` に公開 URL の 1 行を追記（2 ステップ方針のため独立 Step にはせず、Step 2 に含める）。

---

## 重要な制約・リスク

| リスク                                                        | 対応                                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **`base` を無条件に付けると Playwright が全滅**（最大リスク） | `command === 'build' || isPreview === true` で分岐し、dev（e2e の webServer）は `/` のまま。**Step 1 の受け入れに `npx playwright test` 緑を入れて機械的に担保**（実測 80 件緑）。 |
| **`vite preview` がサブパスで割れる**                         | preview の `command` は `'serve'`（dev と同じ）なので `isPreview` で拾う。ローカル検証は必ず `preview` で `/cc-pokajan/` を開く。             |
| **`vite build --mode X` で base が黙って落ちる**              | `mode` に依存せず `command`/`isPreview` で判定（Vite 公式の正準パターン）。当初 `mode` 案を 3軸レビューで見直した。                             |
| **`dist/` は gitignore 済み**                                 | CI がビルドして artifact を上げる。`dist/` はコミットしない（従来どおり）。                                                                    |
| **Pages の有効化は手動の一度きり**                            | Settings → Pages → Source =「GitHub Actions」を人手で設定（初回のみ）。事前確認に明記。                                                        |
| **公開は `main` 反映後**                                      | ワークフローは `main` への push で発火。作業はブランチ/PR で行い、マージ後に公開される（意図どおり）。                                         |
| **base がリポジトリ名にハードコード**                         | リポジトリ改名・カスタムドメイン化のときは `vite.config.ts` の `/cc-pokajan/` を更新（＋必要なら `public/CNAME`）。将来拡張として記録。        |
| **`github.io` はオリジン共有**（localStorage / IndexedDB）    | キー `cc-pokajan:prefs` は名前空間付き。IndexedDB 名 `cc-pokajan` は一意寄りだが未プレフィクス。単一公開では低リスク。**今回は改名しない**（既存データ移行を避ける）。 |
| **`.nojekyll` 論争**                                          | Actions アーティファクト方式では Jekyll が動かず不要。付けないことを明記（迷ったら「不要」が正）。                                             |

---

## Critical Files

**既存（修正）**:

- `vite.config.ts` — `resolveBase`（純関数）＋ `base` の条件分岐（唯一のアプリ側変更）
- `README.md` — 公開 URL の追記（Step 2、軽微）

**新規**:

- `tests/config/viteBase.test.ts` — `resolveBase` の回帰テスト（Step 1。本番だけ効く分岐を CI で固定）
- `.github/workflows/deploy.yml` — 検証ゲート付きの Pages デプロイ（Step 2）

**触らない**:

- `src/**`（エンジン・UI・ストレージ）、既存の `tests/**`、`playwright.config.ts`、`package.json`（新規依存ゼロ）

---

## Verification

### 自動

- `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` — 全 PASS
- `tests/config/viteBase.test.ts` — `resolveBase` の回帰（build/preview→`/cc-pokajan/`、dev/vitest→`/`）を CI で固定
- `npx playwright test` — **緑のまま**（Step 1 の base 変更で e2e が壊れないことの砦）
- CI（Step 2 以降）: 上記フルゲート（E2E 除く）が Actions 上で PASS してからのみ deploy

### 手動

**Step 1（ローカル）**:

1. `npm run build && npm run preview` → `http://localhost:4173/cc-pokajan/` を開く
2. DevTools Console / Network に 404 が出ない。画面・フォント・アバター画像が表示される
3. BET → 対局 → 精算まで一周回る
4. `npm run dev` は `http://localhost:5173/`（ルート）のまま動く

**Step 2（本番）**:

1. `main` へマージ → Actions が成功（build → deploy 両ジョブ緑）
2. `https://oumeisatokenta.github.io/cc-pokajan/` が読み込め、favicon（🃏）が出る
3. 対局が最後まで回る。設定・ロスター編集・ルール変更が開く
4. 画像アップロード → リロードして **localStorage / IndexedDB が保持**されている
5. 縦・横・デスクトップの各表示が破綻しない（横向き fit は 844×390 前提、Step 10-3 の据え置き踏襲）

### ステアリングスキル運用

- 各 Step で `.steering/[日付]-[step-slug]/` の requirements / design / tasklist を作成
- tasklist の各タスクで `[ ]` → `[x]` をリアルタイム更新
- 全タスク完了後に申し送り（実装完了日 / 計画と実績の差分 / 学んだこと / 改善提案）を記録

---

## v2 以降で検討する機能

- **カスタムドメイン**（`public/CNAME` + DNS + `base: '/'`）。ポートフォリオの見栄え向上。
- **PR プレビュー環境**（PR ごとに一時 URL を出す）。Pages 単体では不可のため Cloudflare Pages 等の検討。
- **E2E を CI に載せる**（今回は除外）。Playwright ブラウザキャッシュ込みで別ジョブ化する。
- **`deploy-pages` の `main` 限定を tags/リリース連動へ**（公開タイミングを明示リリースで制御）。
- **AWS 版（`pokajan-aws-portfolio-plan.md`）** との並行運用（無料公開＝Pages / 認証付き＝AWS）。
