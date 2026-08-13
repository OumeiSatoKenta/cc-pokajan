# 設計: AWS デプロイ Step 1 — monorepo 土台 + Vite base 切替

## A. `resolveBase` の target 対応（`vite.config.ts`）

既存の純関数 `resolveBase(env)` に **target 引数**を足す。aws が最優先。

```ts
export const resolveBase = (
  env: Pick<ConfigEnv, 'command' | 'isPreview'>,
  target?: string,
): string => {
  if (target === 'aws') return '/'
  return env.command === 'build' || env.isPreview === true ? REPO_BASE : '/'
}
// defineConfig 内:
base: resolveBase(env, process.env.VITE_DEPLOY_TARGET),
```

- **なぜ config 側は `process.env`（`import.meta.env` でも `loadEnv` でもない）か**（Context7 / Vite 8 公式で確認）:
  vite.config の評価時に利用できる env は **既に process に存在する `process.env` のみ**。`.env*` ファイルは
  root/envDir/mode が確定する config 解決の**後**に読まれるため、config 実行中は `process.env` に注入されない。
  本 target は `.env` ファイルではなく **CI / CLI がインラインで渡す**（`VITE_DEPLOY_TARGET=aws npm run build`）ので、
  `process.env.VITE_DEPLOY_TARGET` で正しく拾える。`loadEnv` は `.env` 依存を増やすため不要。
- target 引数を **optional** にするため既存の呼び出し・テスト（`resolveBase({command,isPreview})`）は後方互換。
- base 解決は引き続き**純関数**に保ち、`process.env` の読み取りは `defineConfig` 側の 1 箇所に閉じる（テスト可能性）。

## B. `src/config/deploy.ts`（新規）

`resolveBase` と同じ思想で、**純関数 `deriveDeployConfig` を抽出**し、モジュール定数 `deployConfig` は
`import.meta.env` を渡すだけにする。純関数を単体テストする。

```ts
export type DeployTarget = 'github-pages' | 'aws'
export interface DeployConfig {
  readonly target: DeployTarget
  readonly authEnabled: boolean
  readonly transport: 'local' | 'remote'
  readonly walletSource: 'local' | 'server'
  readonly apiBaseUrl: string | null
}

export const deriveDeployConfig = (
  rawTarget: string | undefined,
  rawApiBaseUrl: string | undefined,
): DeployConfig => {
  const target: DeployTarget = rawTarget === 'aws' ? 'aws' : 'github-pages'
  const isAws = target === 'aws'
  return {
    target,
    authEnabled: isAws,
    transport: isAws ? 'remote' : 'local',
    walletSource: isAws ? 'server' : 'local',
    apiBaseUrl: isAws ? (rawApiBaseUrl ?? null) : null,
  }
}

export const deployConfig: DeployConfig = deriveDeployConfig(
  import.meta.env.VITE_DEPLOY_TARGET,
  import.meta.env.VITE_API_BASE_URL,
)
```

- **未知の target は握り潰して `github-pages`**（既定安全側）。`'aws'` だけを aws 扱いにする。
  この防御分岐を型の上でも意味あるものに保つため、後述 `ImportMetaEnv` の `VITE_DEPLOY_TARGET` は
  **union ではなく `string`** で型付けする（実行時は任意文字列が来うるため）。
- **なぜ app 側は `import.meta.env` か**（Vite 8 公式）: `VITE_` 接頭辞の変数のみクライアントに露出される。
  インラインで渡した `VITE_DEPLOY_TARGET` は process.env 経由でも `import.meta.env` に反映される。
- `src/config/**` は oxlint override で React 依存禁止。`deploy.ts` は React を import しないので抵触しない。
- **`DeployConfig` は revised.md の4フィールド（authEnabled/transport/walletSource/apiBaseUrl）に `target` を足した拡張**
  （superset・矛盾ではない）。`target` は後続ステップの分岐やデバッグ表示で参照する。

## B'. `src/vite-env.d.ts`（新規・型安全化）

`tsconfig.app.json` は `"types": ["vite/client"]` を持つため `ImportMetaEnv` は既にグローバルに存在するが、
その既定型は `Record<string, any>` 継承で **`import.meta.env.VITE_DEPLOY_TARGET` は `any`**。名前を打ち間違えても
`strict` でも oxlint でも検知されず、`github-pages` に黙って落ちる（このプロジェクトが最も嫌う「たまたま成立」）。
`ImportMetaEnv` を宣言マージで明示して `string | undefined` に絞り、**タイポを compile 時に捕まえる**。

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEPLOY_TARGET?: string
  readonly VITE_API_BASE_URL?: string
}
```

- **module 化しない**（`export {}` を書かない）。ambient 宣言としてグローバル併合させる。
- `interface` の宣言マージなので vite/client の組み込み（BASE_URL/MODE/DEV 等）は保持される。
  named optional prop（`string`）は index 型（`any`）に代入可能なので競合しない。

## C. monorepo 土台（`package.json` + `backend/` プレースホルダ）

root に `"workspaces": ["backend"]` を足す。**ただし npm の workspace メンバーは実在が必須**
（ディレクトリと `package.json` が無いと `npm install`/`npm ci` が失敗しうる）。本番 Pages デプロイは `npm ci` を
ゲートに使うため、**最小の `backend/package.json` プレースホルダ**を同時に作り、`package-lock.json` を同期する。

```json
// backend/package.json（プレースホルダ。実体は Step 5）
{
  "name": "@pokajan/game-api",
  "version": "0.0.0",
  "private": true,
  "description": "AWS Lambda backend (server-authoritative game-api). Placeholder; implemented in Step 5."
}
```

- 依存ゼロなので `npm install` は `node_modules/@pokajan/game-api` へのシンボリックリンクを張るだけ（新規パッケージ無し）。
- **根本原因への対処**（CLAUDE.md「妥協の排除」）: 「workspaces だけ足してメンバー不在」は
  `npm ci` を壊す「たまたま動くかどうか環境依存」の状態。メンバーを実在させて確定的に解消する。
- 既存ツールへの影響なし: vitest `include:['tests/**']` / tsc `-b`（app/node/test 参照）/ oxlint（lint 対象の TS 無し）/
  prettier（`backend/package.json` は prettier 整形済みで書く）。

## リスクと対応

| リスク | 対応 |
| ------ | ---- |
| workspaces 追加で `npm ci` が壊れる | `backend/package.json` プレースホルダを同時作成し `npm install` で lock 同期。`npm ci` を実測。 |
| `resolveBase` 署名変更で既存呼び出し破損 | target を **optional** 引数にし後方互換。既存 4 テストは無改変で通す。 |
| aws target が `import.meta.env` に載らない | インライン env は Vite が `import.meta.env` へ反映（VITE_ 接頭辞）。build 成果物のアセットパスで実測。 |
| `format:check` が backend/ で落ちる | プレースホルダを prettier 準拠で書き、`npm run format:check` を実測。 |
| E2E 破損 | 既定は `github-pages`（target 未設定）で dev=`/` のまま。`npx playwright test` を実測。 |

## 検証（受け入れの実測方法）

1. `VITE_DEPLOY_TARGET=aws npm run build` → `dist/index.html` を確認しアセットが `/assets/...`。
2. 既定 `npm run build` → `/cc-pokajan/assets/...`。
3. `npm ci` 成功（workspaces 同期）。
4. 検証ゲート一式 + `npx playwright test` 緑。

## レビュー反映（3軸 + validator + doc-reviewer）

実装後レビューで採り入れた修正（すべて反映済み）:

- **[必須] workspace 実在ガード**: npm 11 は宣言した workspace メンバーが不在でも `npm ci` を**黙ってスキップして
  exit 0**（＝壊れているのに CI が緑）。npm の失敗に頼れないため `tests/config/workspaces.test.ts` で
  「宣言と実体の一致」を機械固定した。
- **[高] `strictImportMetaEnv`**: 当初の `ImportMetaEnv` 宣言だけでは `Record<string, any>` フォールバックが残り、
  タイポは `any` を素通りしていた（主張と不一致）。`ViteTypeOptions.strictImportMetaEnv` を宣言してフォールバックを外し、
  タイポが `TS2551` になることをミューテーションで実測。
- **[推奨] 二重ソースの注意書き**: `VITE_DEPLOY_TARGET` を `.env*` に書くと base（config=process.env）と実行時フラグ
  （app=import.meta.env）が食い違う。両ファイルに「インライン限定・両者を同時に直す」コメントを追記。
- **[中] 真偽値命名**: `authEnabled` → `isAuthEnabled`（development-guidelines の is/has/can 規約）。
- **[提案] 空文字 apiBaseUrl**: `''` も未設定として null に倒す（CI 変数未定義の '' 展開事故対策）。
- **[提案] 境界テスト対称化**: `resolveBase` にも大文字/空白ゆらぎのケースを追加（deploy.ts と対称）。

## 後続 Step への申し送り（design 上の未決事項）

- **フラグと target の従属**: 現状 `isAuthEnabled/transport/walletSource/apiBaseUrl` は `target` から 1:1 で決まる。
  Step 4 着手時に「認証はあるが transport はローカル」等の中間状態を許すか判断し、許すなら個別フラグの独立性を design に明記する。
- **Cognito 設定の置き場**: `Amplify.configure()` は User Pool ID / App Client ID / region を要する。`DeployConfig` に足すか
  別モジュール `src/config/authConfig.ts` に分けるかを Step 4 で先に決める（デプロイ環境フラグと Cognito クライアント設定の混在を避ける）。
- **`deployConfig` の消費形態**: 既存の `RulesConfig` は全関数が引数で受ける DI 方式（モック不使用でテスト可能）。
  Step 4/6 で `AuthGate`/`apiClient`/`remoteTransport` は `main.tsx` で一度 `deployConfig` を読んで**値として下流へ注入**し、
  各所での直接 import を避ける方針とする（`import.meta.env` の差し替えを不要にするため）。
