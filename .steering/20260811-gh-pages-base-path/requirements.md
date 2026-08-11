# 要求内容 — GitHub Pages 公開 Step 1: 本番ビルドの base パス対応

## 背景

完全クライアントサイドのポカジャンを GitHub Pages（`https://oumeisatokenta.github.io/cc-pokajan/`）で
一般公開する。Pages はリポジトリ配下 `/cc-pokajan/` で配信されるため、本番ビルドのアセット URL に
`/cc-pokajan/` プレフィックスが必要。これは 2 ステップ計画の **Step 1**（base 対応）にあたる。

参照: [docs/ideas/pokajan-github-pages-deploy-plan.md](../../docs/ideas/pokajan-github-pages-deploy-plan.md)
（Step 1 範囲のみ実装。Step 2 の Actions デプロイは別 `/add-feature`）。

## スコープ

**やること**:

- `vite.config.ts` を `defineConfig` の関数形にし、`base` を Vite 公式の `command` / `isPreview` で出し分ける。
  base 解決は純関数 `resolveBase` に切り出し（`command === 'build' || isPreview === true` → `/cc-pokajan/`、
  それ以外〔dev / vitest〕 → `/`）、`tests/config/viteBase.test.ts` で回帰を固定する。
  ※ 当初 `mode === 'production'` 案だったが 3軸レビューで見直した（design.md 参照）。

**前提（元計画の事前調査で確認済み）**: `src/**` に `import.meta.env.BASE_URL` 依存箇所も、
ハードコードされた絶対アセットパスも無い（`index.html` の entry script は Vite が base 付きへ書き換える）。
このため base の付与だけでアプリは壊れない ─ 参照:
[計画書](../../docs/ideas/pokajan-github-pages-deploy-plan.md) の「事前調査で判明した事実」節。

**やらないこと（Step 1 スコープ外）**:

- `.github/workflows/deploy.yml` の作成（Step 2）
- README への公開 URL 追記（Step 2）
- `src/**` / `playwright.config.ts` / `package.json` の変更（不要・触らない）
  ※ `tests/` は当初「触らない」としていたが、3軸レビューの [推奨] を受け base 解決の回帰テスト
  `tests/config/viteBase.test.ts` を1本だけ追加する（既存テストは変更しない）。
- カスタムドメイン・リポジトリ改名（今回スコープ外）

## 受け入れ基準

1. **本番ビルドがサブパスで動く**: `npm run build && npm run preview` →
   `http://localhost:4173/cc-pokajan/` でアセット 404 が出ず、BET → 対局 → 精算まで一周回る。
2. **dev がルートのまま**: `npm run dev` は `http://localhost:5173/`（base `/`）で従来どおり動く。
3. **E2E が緑のまま**: `npx playwright test` が全 PASS（Playwright は dev サーバ＝development mode を叩くため、
   base は `/` のまま。ここが壊れないことが Step 1 最大の関門）。
   - 根拠: `playwright.config.ts` の `webServer.command` は `npm run dev -- --port 5174 --strictPort`
     （＝Vite dev＝development mode）で、各テストは `page.goto('/')` などルート相対（design.md 参照）。
4. **検証ゲート通過**: `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が全 PASS。

## 制約（CLAUDE.md 由来）

- エンジン層（`src/engine/`）は触らない（今回そもそも対象外）。
- 変更は最小限（`vite.config.ts` の 1 箇所のみ）。「影響の最小化」。
- 分岐は Vite 公式の `command` / `isPreview`（`resolveBase(env) = command === 'build' || isPreview === true ? …`）を使う。
  `mode === 'production'` 案は `vite build --mode X` で base が落ちる潜在脆さがあり、レビューで見直した（design.md 参照）。
