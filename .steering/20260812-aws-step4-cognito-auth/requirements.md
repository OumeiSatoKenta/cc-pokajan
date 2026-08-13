# 要求: AWS デプロイ Step 4 — Cognito 認証

## 背景

参照計画: [docs/ideas/cc-pokajan-aws-deployment-plan-revised.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised.md)（Phase 2）
と [同 -add-feature-commands.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised-add-feature-commands.md)（Step 4）。

Step 1（`deployConfig.isAuthEnabled` ほか）と Step 3（静的配信・OIDC・environments 基盤）は完了済み。
Step 4 は **AWS 版だけにログイン必須ゲート**を付ける（Phase 2）。GitHub Pages 版は**無認証のまま**。
backend の API / authorizer 本体は Step 5。ここでは Cognito と、フロントの認証土台（AuthGate・apiClient）まで。

## スコープ（今回やること）

- `infra/modules/cognito/**`: User Pool（email/password・email 検証・パスワードポリシー）+ **public な app client（secret 無し）**。
- `infra/environments/{dev,prod}/**`: cognito module を配線し、User Pool ID / App Client ID を outputs に出す。
- 依存追加 **`aws-amplify`**（`aws-amplify/auth` v6 モジュラー）。`@aws-amplify/ui-react` は追加しない（承認済み依存は aws-amplify のみ）。
- `src/ui/auth/AuthGate.tsx`（新規）: `deployConfig.isAuthEnabled` が真のときだけログインを要求。`github-pages` は素通し。
- `src/ui/auth/**`（認証 UI・Amplify 設定）: aws-amplify を **lazy chunk** に閉じ込め、Pages バンドルの実行時に読み込ませない。
- `src/main.tsx`: `<AuthGate><App/></AuthGate>` でマウント。
- `src/net/apiClient.ts`（新規）: `Authorization: Bearer <idToken>` を付与する fetch 土台（Step 6 で本格利用）。トークン取得は
  `fetchAuthSession()` を**動的 import**（Pages/テストの静的グラフに aws-amplify を載せない）。base/token は注入可能でテスト可能に。
- `src/vite-env.d.ts`: `VITE_COGNITO_USER_POOL_ID` / `VITE_COGNITO_APP_CLIENT_ID` を型宣言。
- `.github/workflows/deploy-aws.yml`: build 時に `VITE_COGNITO_*` を GitHub Environment 変数から注入。
- テスト: AuthGate 素通し（isAuthEnabled 偽）・apiClient のヘッダ付与/未付与/base 未設定・cognito の terraform validate。

## スコープ外（今回やらないこと）

- backend Lambda / API Gateway / JWT authorizer（Step 5。cognito の issuer/audience は Step 5 が参照する）。
- フロントの remote transport 化・wallet サーバー権威（Step 6）。
- MFA・パスワードリセット・ソーシャルログイン・Hosted UI（将来）。
- `src/App.tsx` の中身・対局ロジック・engine（一切触らない）。既存 Pages 挙動は不変。

## 受け入れ基準

1. 既存フロントゲート `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が緑
   （aws-amplify 追加後も既定 `github-pages` ビルドが通り、対局が従来どおり動く）。
2. `npx playwright test`（E2E・既定 github-pages）が緑＝**認証無効で挙動不変**（AuthGate 素通し）。
3. `terraform fmt -check` と `terraform validate`（bootstrap 含む 3 root）が緑。
4. **Pages バンドルの実行時に aws-amplify が読み込まれない**（lazy chunk 分離。isAuthEnabled 偽では取得されない）。
5. AWS ビルド（`VITE_DEPLOY_TARGET=aws`）で未ログインはログイン画面に留まり、サインアップ→メール検証→ログイン後に対局画面へ到達。
   ※ 実 Cognito を要するため**手動確認**（README 手順）。この作業では apply/実ログインはしない。
6. 設計レビューで [必須] が残っていない（特に「Pages 版に認証を漏らさない」「token をログ等に出さない」）。

## 制約・前提

- **エンジン非依存**: `src/engine/` は一切変更しない。認証は `src/ui/auth/` と `src/net/` に閉じる。
- **Pages 無認証を保全**: `isAuthEnabled` 偽の経路では aws-amplify を静的にも実行時にも読み込まない。
- **public app client（secret 無し）**: SPA なので `generate_secret = false`。SRP 認証（`ALLOW_USER_SRP_AUTH`）+ refresh。
- **VITE_COGNITO_* は秘密ではない**（フロントに埋め込まれる公開値）。GitHub Environment の **Variables** で渡す（Secrets 不要）。
- `.env*` ファイルには書かない（CI/CLI インライン）。既存の VITE_DEPLOY_TARGET と同じ運用。
- Terraform は v1.15.8、`required_version >= 1.10`。tflint 無し（fmt/validate ゲート）。
- 実 apply・実ログイン確認は AWS/Cognito が要るためユーザー作業（README 手順）。
