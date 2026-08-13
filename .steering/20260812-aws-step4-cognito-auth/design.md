# 設計: AWS デプロイ Step 4 — Cognito 認証

## 全体像

```text
[AWS ビルド (VITE_DEPLOY_TARGET=aws)]                 [Pages ビルド (既定)]
  main.tsx: <AuthGate><App/></AuthGate>                main.tsx: <AuthGate><App/></AuthGate>
       │ isAuthEnabled=true                                 │ isAuthEnabled=false
       ▼                                                     ▼
  AuthGate → lazy import('./AuthProvider')             AuthGate → <>{children}</>（素通し）
       │  （aws-amplify はこの chunk だけ）                    （aws-amplify を読み込まない）
       ▼
  AuthProvider: Amplify.configure(VITE_COGNITO_*)
    getCurrentUser() → signedIn ? <App/> : <AuthForm/>
       │ signIn/signUp/confirmSignUp (aws-amplify/auth)
       ▼
  Cognito User Pool（email/password・検証コード・public client）
```

- **認証は AWS 版のみ**。Pages 版は `AuthGate` が children を素通しし、aws-amplify を静的にも実行時にも触れない。
- **aws-amplify は lazy chunk に隔離**。`React.lazy(() => import('./AuthProvider'))` により、Pages バンドルの実行時に読み込まれない
  （chunk は生成されるが isAuthEnabled 偽では fetch されない）。
- **apiClient は aws-amplify を静的 import しない**（動的 import）。Step 6 の remote transport が使う土台を先に置く。

## 追加/変更ファイル

```text
infra/modules/cognito/
  versions.tf                # required_version >= 1.10, aws ">= 6.0, < 7.0"
  variables.tf               # project, environment, password policy, tags
  main.tf                    # aws_cognito_user_pool + aws_cognito_user_pool_client(public)
  outputs.tf                 # user_pool_id, app_client_id, user_pool_endpoint, issuer
infra/environments/{dev,prod}/
  main.tf                    # module "cognito" 追加
  outputs.tf                 # cognito_user_pool_id, cognito_app_client_id 追加

src/
  vite-env.d.ts              # VITE_COGNITO_USER_POOL_ID / VITE_COGNITO_APP_CLIENT_ID 追加
  main.tsx                   # <AuthGate><App/></AuthGate>
  ui/auth/
    authGate.ts              # 純関数 authGateMode(isAuthEnabled): 'gate' | 'passthrough'（React 非依存・両分岐テスト）
    AuthGate.tsx             # authGateMode で分岐。passthrough=素通し / gate=lazy AuthProvider（aws-amplify を含まない）
    AuthProvider.tsx         # lazy chunk 入口。Amplify.configure 読込 + checking/signedIn/signedOut 状態機械
    AuthForm.tsx             # signIn/signUp/confirmSignUp の最小フォーム
    amplifyConfig.ts         # VITE_COGNITO_* → Amplify.configure（値欠落は明示エラー）
  net/
    apiClient.ts             # authorizedFetch(path, init, {getIdToken?, baseUrl?}) + amplifyIdToken(動的 import)

tests/
  ui/authGate.test.tsx       # isAuthEnabled 偽で children を素通し（Pages 挙動）
  net/apiClient.test.ts      # Bearer 付与 / token 無しで未付与 / baseUrl 未設定で例外
.github/workflows/deploy-aws.yml  # build に environment: と VITE_COGNITO_* 注入
package.json                 # dependencies に aws-amplify
```

## 主要な設計判断

### 1. aws-amplify を Pages バンドルの実行時から隔離（lazy）
`AuthGate.tsx` は aws-amplify を**静的 import しない**。`isAuthEnabled` が偽なら `<>{children}</>` を返すだけ。
真のときのみ `const AuthProvider = lazy(() => import('./AuthProvider'))` を `<Suspense>` で描く。
`AuthProvider` とその子（`AuthForm`・`amplifyConfig`）が aws-amplify を静的 import する＝**その lazy chunk だけ**に閉じる。
Pages ビルドでは chunk は生成されるが、`isAuthEnabled` 偽なので実行時に fetch されない（＝Pages の実行時依存は増えない）。
`AuthGate` を import するテストも aws-amplify を引かない（lazy の矢印の先は import 時に評価されない）。

**ゲート判断は純関数に切り出す [doc-review 必須]**。`AuthGate` の分岐を `authGateMode(isAuthEnabled): 'gate' | 'passthrough'`
（`src/ui/auth/authGate.ts`）に出し、`AuthGate.tsx` はこの戻り値で描画する。これで **両分岐を React 非依存でユニットテスト**でき、
「条件そのものが消えて常に素通しする」欠陥（AWS 版が実質無認証になる最悪の回帰）を機械的に固定できる（`interactionGate`・CLAUDE.md 7-5 と同型）。
補助として `renderToStaticMarkup(<AuthGate isAuthEnabled>…)` が children を**直接描画しない**ことも確認する
（React 19 の同期 SSR で Suspense は fallback を返す）。

### 2. apiClient は aws-amplify を静的に持たない（動的 import + 注入）
```ts
export type IdTokenProvider = () => Promise<string | null>
// 既定: 呼ばれたときだけ aws-amplify を動的 import（静的グラフ・テストに載せない）
export const amplifyIdToken: IdTokenProvider = async () => {
  const { fetchAuthSession } = await import('aws-amplify/auth')
  const session = await fetchAuthSession()
  return session.tokens?.idToken?.toString() ?? null
}
export async function authorizedFetch(path, init = {}, opts: {getIdToken?; baseUrl?} = {}) {
  const base = opts.baseUrl ?? deployConfig.apiBaseUrl
  if (base === null) throw new Error(...)      // AWS 版でのみ使う土台
  const token = await (opts.getIdToken ?? amplifyIdToken)()
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)   // token 無しなら付けない
  return fetch(`${base}${path}`, { ...init, headers })
}
```
`getIdToken`/`baseUrl` を注入可能にし、テストは aws-amplify も実ネットワークも使わずヘッダ生成を検証する。

### 3. Cognito（public client・email 検証）
- `aws_cognito_user_pool`: `username_attributes = ["email"]`（email でサインイン）、`auto_verified_attributes = ["email"]`、
  `password_policy`（min 8・大小英字・数字・記号を変数化）、`account_recovery_setting`（email）、
  `verification_message_template { default_email_option = "CONFIRM_WITH_CODE" }`、
  `admin_create_user_config { allow_admin_create_user_only = false }`（セルフサインアップ許可）、
  `mfa_configuration = "OFF"`（スコープ外を明示）、`deletion_protection = "ACTIVE"`（誤 destroy 防止。撤去時は README で外す）。
- `aws_cognito_user_pool_client`: **`generate_secret = false`**（SPA/public）、
  `explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]`（Amplify 既定の SRP）、
  `prevent_user_existence_errors = "ENABLED"`、トークン有効期限（access/id=60min・refresh=30day を変数化）。
- outputs: `user_pool_id` / `app_client_id`（フロント env へ）／ `issuer`（`https://cognito-idp.<region>.amazonaws.com/<pool_id>`。
  Step 5 の JWT authorizer が参照）。

### 4. CI での env 注入（build ジョブに environment: を付ける）
`VITE_COGNITO_*` は環境ごと（dev/prod で別プール）なので **GitHub Environment 変数**で渡す。build ジョブに
`environment: ${{ github.event.inputs.environment }}` を付けて `vars.VITE_COGNITO_*` を build 時 env に注入する。
**build に id-token は付けない**（AWS 認証は deploy ジョブだけ＝Step 3 の防御姿勢を維持）。`environment:` は保護ルール適用と
変数解決のためで、AWS クレデンシャルは付与しない。VITE_COGNITO_* は公開値なので Secrets ではなく Variables。

> **副作用（意図した多層防御）[doc-review 高]**: build ジョブにも `environment:` が付くため、prod で protection rule
> （required reviewers）を設定していると **build 前・deploy 前の2回**承認待ちが発生しうる。これは意図した二重ゲート
> （認証プールを注入するビルド自体も保護対象にする）。想定外の停止ではないことを README にも書く。

### 5. main.tsx は aws-amplify を持たない
`<AuthGate><App/></AuthGate>` を描くだけ。`AuthGate` が薄い（aws-amplify 無し）ので main も無害。
**参照計画からの意図的な逸脱 [doc-review 低]**: 計画は「main.tsx で `Amplify.configure`」だが、それだと main が aws-amplify を
静的 import して lazy 分離が壊れる。よって configure は lazy chunk 側（`amplifyConfig.ts`）へ移す。値欠落（VITE_COGNITO_* 未設定）は
起動時に**明示エラー**にする（黙って無認証にしない・fail-closed）。

### 6. AuthProvider の3状態（fail-closed）[doc-review 高]
`AuthProvider` は `checking | signedIn | signedOut` の3状態を持つ。マウント直後は **`checking`**（`getCurrentUser()` 解決前）で、
この間は **`<App/>` を描画しない**（中立の読み込み表示）。楽観的に signedIn 初期化するとリロード直後に一瞬 `<App/>` が見える
ゲート漏れ（AWS 版内部・CLAUDE.md 7-4「両層で止める」と同型）になるため、初期値は必ず未認証側に倒す。
`getCurrentUser()` 成功→`signedIn`（children）／失敗→`signedOut`（`AuthForm`）。`signOut` 後は `signedOut` に戻す。

## テスト・検証方針

- **authGateMode 純関数**（`tests/ui/authGate.test.ts`）: `authGateMode(false)='passthrough'` / `authGateMode(true)='gate'` の
  **両分岐**を直接検証。「条件が消えて常に素通し」欠陥を捕まえる（[必須]）。
- **AuthGate 素通し**（`tests/ui/authGate.test.tsx`）: 既定（isAuthEnabled 偽）で `renderToStaticMarkup(<AuthGate><marker/></AuthGate>)`
  が marker を含む＝Pages は認証 UI を出す前に素通し。真のときは children を直接描画しないことも確認。
- **E2E ネットワーク実測**（[doc-review 中]）: 既定 github-pages の E2E に、ページロード〜1局の間 `page.on('request')` で
  amplify/auth 関連ファイルへのリクエストが**0件**であることを実測（受け入れ基準4を静的比較でなく実行時で固定・CLAUDE.md 9-3/10-2 の轍）。
- **apiClient**（`tests/net/apiClient.test.ts`）: 注入 token でヘッダ付与／token null で未付与／baseUrl null で例外。
  `fetch` は spy。aws-amplify・実ネットワーク不要。
- **deriveDeployConfig**: 既存テストで isAuthEnabled=aws を担保済み（追加不要）。
- **Terraform**: `fmt -check` + `-backend=false` init → `validate`（3 root）。
- 認証フロー本体（サインアップ→検証→ログイン）は実 Cognito が要るため **手動**（README）。E2E は github-pages で認証無効＝挙動不変を守る。
- **わざと壊す**: AuthGate の素通し条件を反転させると authGate テストが落ちること、apiClient のヘッダ付与を消すと落ちることを確認。

## リスク / 落とし穴

1. **Pages に認証を漏らす**。AuthGate が aws-amplify を静的 import すると Pages バンドルに載る → lazy 分離を厳守。E2E（github-pages）が
   認証 UI を出さない＝素通しを回帰で守る。
2. **env 欠落で黙って無認証**。VITE_COGNITO_* 未設定を握り潰すと「ログイン画面のはずが素通し」になりうる。isAuthEnabled 真かつ
   env 欠落は amplifyConfig で**明示エラー**にする（fail-closed）。
3. **build ジョブに AWS 認証を渡さない**。`environment:` は付けるが id-token は付けない（Step 3 の分離を壊さない）。
4. **token の露出**。idToken を console/DOM に出さない。apiClient はヘッダに載せるだけ、ログしない。
5. **aws-amplify が大きい**。lazy 分離で Pages 実行時に影響させない。build/typecheck は通ることを早期に確認する。
6. **StrictMode 二重実行**。Amplify.configure と getCurrentUser は冪等な読み取り。二重呼び出しは無害。

## 申し送り（次ステップ向け）

- Step 5（backend）: cognito の `issuer`（output）と `app_client_id`（audience）を API Gateway の JWT authorizer に配線。
  `apiClient` を remote transport から使い始める。
- Step 6: `AuthProvider` の signOut 導線と wallet サーバー権威を結線。transport 選択で `authorizedFetch` を実利用。
- 実運用: GitHub の各 Environment に `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_APP_CLIENT_ID`（cognito outputs 由来）を設定。
- **docs/architecture.md の追記（Step 8）[doc-review 中]**: セキュリティ／依存関係の節にある「外部通信しない」「秘密情報を持たない」
  「実行時依存は react/react-dom のみ」は **AWS 版に限り不正確**になる（aws-amplify で Cognito と通信）。「（Pages 版のみ。AWS 版は
  Cognito と通信・aws-amplify を lazy 読込）」と注記する。
