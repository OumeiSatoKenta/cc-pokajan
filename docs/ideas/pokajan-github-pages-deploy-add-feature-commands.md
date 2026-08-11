# ポカジャン GitHub Pages 公開 — `/add-feature` 実行コマンド一覧

本書は [pokajan-github-pages-deploy-plan.md](pokajan-github-pages-deploy-plan.md) の実装を
2 つの独立した `/add-feature` コマンドに分割したものである。
各ステップは単独でレビュー・マージ可能な粒度に揃え、依存関係が前→後へ一方向になるよう順序付けしている。

**重要**: 各 `/add-feature` コマンドのプロンプトには
「参照ドキュメント: `docs/ideas/pokajan-github-pages-deploy-plan.md`」が含まれており、
実装時には常に同プランを参照しながら該当ステップ範囲のみを実装する。プラン全体を一度に実装しないこと。

**前提**:

- 公開 URL は `https://oumeisatokenta.github.io/cc-pokajan/`（リポジトリ配下 base `/cc-pokajan/`）。
- 新規 npm 依存はゼロ（`gh-pages` パッケージも使わない）。デプロイは GitHub 公式 Actions のみ。
- アプリ本体は base に対してクリーン（絶対アセットパス無し・URL ルーター無し・`public/` 無し）。
  変更はビルド設定（＋Step 1 で base 解決の回帰テスト1本）と CI だけ。
  `src/**` / 既存の `tests/**` / `playwright.config.ts` は触らない。
- 着手前に `npm test` と `npx playwright test` で現件数を確認（Step 1 の受け入れに e2e 緑が要るため基準を控える）。

## 実行順の全体像

```
Step 1: 本番ビルドの base パス対応（vite.config.ts）
   ↓   ← ★ /cc-pokajan/ でビルドした成果物がローカル preview で正しく動き、dev/e2e は '/' のまま壊れない
Step 2: GitHub Actions で Pages へ自動デプロイ
       ← ★ main への push で検証ゲート通過 → 公式アーティファクトで公開（完成）
```

**ポイント**:

- **Step 1 → Step 2 の順は動かせない**。base が正しくないと Step 2 のデプロイがアセット 404 になる。
  Step 1 でサブパスのビルドをローカル `preview` で確定させてから CI を載せる。
- **Step 1 の最大の勘所は「e2e を壊さない」**。`base` を無条件に付けると Playwright（dev サーバ＋ルート相対 `goto('/')`）が
  全滅する。`command === 'build' || isPreview === true` で分岐し、dev=`/` を保つ。受け入れに `npx playwright test` 緑を含める。
- 各ステップ後に
  `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`
  と `npx playwright test` が PASS することをゲートとする。

---

## Step 1: 本番ビルドの base パス対応 ✅ 実装済み（2026-08-11）

```
/add-feature ポカジャン GitHub Pages base対応: vite.config.ts を defineConfig の関数形にして base を command/isPreview で出し分ける（build と preview だけ '/cc-pokajan/'、dev/e2e は '/'）。npm run build && npm run preview で http://localhost:4173/cc-pokajan/ が 404 なく動くことと、npm run dev がルートのまま・npx playwright test が緑のままであることを確認する。参照ドキュメント: docs/ideas/pokajan-github-pages-deploy-plan.md (Step 1 範囲のみ実装)
```

**実装内容**（実績）:

- 修正: `vite.config.ts`
  - `export default defineConfig((env) => ({ ... }))` の関数形に変更。base 解決は純関数
    `resolveBase(env) = env.command === 'build' || env.isPreview === true ? '/cc-pokajan/' : '/'` に切り出して export。
  - **`mode` ではなく `command` / `isPreview` を使う理由をコメントで残す**: `vite preview` の `command` は `'serve'`
    （dev と同じ）なので `command` 単独では preview を dev と区別できず、Vite 公式の専用フラグ `isPreview` で拾う。
    `isPreview` は undefined を取りうるため `=== true` で明示比較（Vite 公式推奨）。
    `mode === 'production'` 案は `vite build --mode X` で base が落ちる潜在脆さがあり 3軸レビューで見直した。
- 新規: `tests/config/viteBase.test.ts`
  - `resolveBase` の回帰テスト（build/preview → `/cc-pokajan/`、dev/vitest → `/`）。本番だけ効く分岐を CI で固定し、
    「テストは通るが本番だけ 404」を防ぐ。
- 触らない: `src/**`・`playwright.config.ts`・`package.json`（アプリコード・e2e 設定・依存は不変）。

**動作確認**:

- 自動ゲート一式 PASS（`npm run lint && npm run typecheck && npm test && npm run build && npm run format:check`）
- **`npx playwright test` が緑**（dev サーバが `/` のままなので壊れないことの砦）
- ブラウザ:
  1. `npm run build && npm run preview` → `http://localhost:4173/cc-pokajan/` を開く
  2. Console / Network に 404 が出ない。画面・フォント・アバター画像が表示される
  3. BET → 対局 → 精算まで一周回る
  4. `npm run dev` は `http://localhost:5173/`（ルート）のまま動く

**依存**: なし（起点）

---

## Step 2: GitHub Actions で Pages へ自動デプロイ

```
/add-feature ポカジャン GitHub Pages 自動デプロイ: .github/workflows/deploy.yml を新規作成し、main への push で検証ゲート（lint/typecheck/test/build/format:check、E2E は除く）を回してから公式 Pages アーティファクト（configure-pages → upload-pages-artifact(dist) → deploy-pages）で公開する。README に公開 URL を 1 行追記する。Pages の Source を「GitHub Actions」にする手動手順も案内する。参照ドキュメント: docs/ideas/pokajan-github-pages-deploy-plan.md (Step 2 範囲のみ実装、Step 1 完了前提)
```

**実装内容**:

- 新規: `.github/workflows/deploy.yml`
  - トリガー: `push` to `main` ＋ `workflow_dispatch`（手動）。
  - `permissions: contents: read / pages: write / id-token: write`、`concurrency: { group: pages, cancel-in-progress: false }`。
  - `build` ジョブ: `checkout@v4` → `setup-node@v4`（`node-version: 22`, `cache: npm`）→ `npm ci` →
    **検証ゲート（CLAUDE.md の順）** `npm run lint` → `npm run typecheck` → `npm test` → `npm run build` → `npm run format:check` →
    `configure-pages@v5` → `upload-pages-artifact@v3`（`path: ./dist`）。
  - `deploy` ジョブ: `needs: build`、`environment: github-pages`、`deploy-pages@v4`。
  - **`.nojekyll` は付けない**（Actions アーティファクト方式では Jekyll が動かず不要。プラン B 節・リスク表参照）。
- 修正: `README.md`
  - 公開 URL（`https://oumeisatokenta.github.io/cc-pokajan/`）を 1 行追記（Live デモへの導線）。
- 手動手順の案内（コードではない、実行者への申し送り）:
  - GitHub の **Settings → Pages → Build and deployment → Source =「GitHub Actions」**（初回のみ）。
  - `main` にマージして初回デプロイを走らせ、Actions のログとデプロイ URL を確認。

**動作確認**:

- 自動ゲート一式 PASS（ローカル）＋ CI 上でも build ジョブの全ステップが緑
- 本番:
  1. `main` へマージ → Actions が build → deploy とも成功
  2. `https://oumeisatokenta.github.io/cc-pokajan/` が読み込め、favicon（🃏）が出る
  3. 対局が最後まで回る。設定・ロスター編集・ルール変更が開く
  4. 画像アップロード → リロードして **localStorage / IndexedDB が保持**されている
  5. 縦・横・デスクトップの表示が破綻しない（横向きは 844×390 前提、Step 10-3 の据え置き踏襲）

**依存**: Step 1（base が `/cc-pokajan/` で正しくビルドされていること。誤っているとアセット 404 で公開が割れる）

---

## 参考: 各ステップ完了時点で何が動くか

| Step   | 動く状態                                                                              |
| ------ | ------------------------------------------------------------------------------------- |
| 1 完了 | `/cc-pokajan/` でビルドした成果物がローカル `preview` で正しく動く。dev/e2e は不変     |
| 2 完了 | ★ main への push で自動デプロイされ、`oumeisatokenta.github.io/cc-pokajan/` で公開（完成） |

## 参考: ロールバック戦略

各ステップは独立してマージ可能なため、問題発生時は該当ステップの PR を revert するだけで回復する。ただし:

- **Step 2 を revert すると自動デプロイが止まる**（ワークフロー削除）。既に公開済みのサイトは最後のデプロイ内容で
  残る。公開そのものを取り下げたい場合は Settings → Pages で Source を「None」に戻す（手動）。
- **Step 1 を revert すると base が `/` に戻る**。Step 2 が残っていると次のデプロイで**サブパスのアセットが 404** に
  なる。逆順の revert（Step 1 だけ戻す）はしない。両方戻すか、Step 2 を先に戻す。
- 新規 npm 依存は無いため、依存削除の後始末は不要。

## 参考: Step 1 着手前の事前確認

- **新規依存追加**: なし（`gh-pages` パッケージ不要。GitHub 公式 Actions のみ）。合意済み。
- **base はリポジトリ配下 `/cc-pokajan/`**: カスタムドメイン・ユーザーサイト改名は今回スコープ外（合意済み）。
- **e2e を壊さない設計**: `command` / `isPreview` 分岐で dev=`/` を保つ。着手前に `npx playwright test` の現件数を控える。
- **既存テストの状態**: 着手前に `npm test`（ユニット）と `npx playwright test`（E2E）で現件数を確認。
- **Pages 有効化は Step 2 の手動手順**: リポジトリ管理権限（Settings → Pages）が必要。

## 参考: v2 以降で検討する機能

- **カスタムドメイン**（`public/CNAME` + DNS + `base: '/'`）。
- **PR プレビュー環境**（Pages 単体では不可。Cloudflare Pages 等）。
- **E2E を CI に載せる**（今回は除外。Playwright ブラウザキャッシュ込みで別ジョブ化）。
- **公開タイミングをリリースタグ連動に**（`main` push 即公開をやめ、明示リリースで制御）。
- **AWS 版（`pokajan-aws-portfolio-plan.md`）との並行運用**（無料公開＝Pages / 認証付き＝AWS）。
