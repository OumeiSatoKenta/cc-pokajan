# infra — AWS（静的配信 + 認証 + サーバー権威 API / Step 3〜5）

cc-pokajan を AWS(S3 + CloudFront + Cognito + Lambda + DynamoDB) に載せるための Terraform 一式。
GitHub Pages（`.github/workflows/deploy.yml`）とは**併存**で、こちらは無変更。

- **配信**: プライベート S3 ←(OAC)← CloudFront（既定 `*.cloudfront.net`）。SPA rewrite で 403/404 → `/index.html`。
- **state**: `infra/bootstrap` が作る S3（バージョニング + 暗号化 + 非公開）。ロックは **S3 ネイティブ（`use_lockfile`）** で
  DynamoDB テーブルは使わない（HashiCorp 現行推奨）。
- **認証（Step 4）**: AWS 版のみ **Cognito User Pool**（email/password・検証コード・public SPA クライアント）でログイン必須。
  Pages 版は無認証のまま（`deployConfig.isAuthEnabled` で分岐・aws-amplify は lazy chunk で Pages 実行時に読み込まれない）。
- **サーバー権威 API（Step 5）**: 単一 **HTTP API Lambda（node22/arm64）** が `src/engine` を共有し、GameState を
  **DynamoDB（1ゲーム=1item・`version` 楽観ロック）** で権威化する。認可は **Cognito JWT authorizer**。クライアントには
  他家手札・山札を含まない **PlayerView** だけを返す。wallet も **USER#sub item にサーバー権威化**（BET 差引・精算）。
  ※ フロントの transport 差し替え（remote 化）は Step 6。本 Step は backend + infra のみで、Pages 版の挙動は不変。
- **CI/CD**: GitHub OIDC で短命ロールを assume（固定キー無し・**環境ごとに別ロール**）。`deploy-aws.yml` は手動トリガ（`workflow_dispatch`）。
  Step 5 で **backend の esbuild バンドル → `aws lambda update-function-code`** を追加（Lambda の作成/構成は apply、コードは CI）。

> リージョンはアプリ資源が **ap-northeast-1**。CloudFront 用 ACM のみ us-east-1（カスタムドメイン導入時。今は未使用）。

## 前提

- Terraform >= 1.10（`use_lockfile` に必要）、AWS CLI v2。
- **bootstrap の apply には管理者相当の認証情報**が必要（IAM ロール/OIDC provider/S3 を作るため）。
- 以降の日常デプロイは CI の OIDC ロールが担い、固定アクセスキーは持たない。
- `.terraform.lock.hcl` は**コミット済み**（aws provider の版・ハッシュを linux/mac 向けに固定）。`terraform init` はこの版で解決する。

## ディレクトリ

```
infra/
  bootstrap/              # 一度だけ apply（ローカル state）: tfstate 用 S3 + OIDC provider + 環境別 DeployRole
  modules/frontend/       # private S3 + CloudFront(OAC) + SPA rewrite
  modules/cognito/        # User Pool + public SPA クライアント（Step 4）
  modules/dynamodb/       # 単一テーブル（PK pk・GAME#/USER# 同居・オンデマンド・TTL・PITR）（Step 5）
  modules/game-api/       # HTTP API + JWT authorizer + Lambda(node22/arm64) + IAM + Logs（Step 5）
  environments/dev/       # dev の配線（S3 backend + use_lockfile）
  environments/prod/      # prod の配線（S3 backend + use_lockfile）
```

> **apply の依存**: `game-api` は `cognito`（issuer/app_client_id を authorizer に使う）と `dynamodb`（table_arn を IAM に使う）の
> 出力に依存する。同一 root（environments/<env>）内なので `terraform apply` が順序を自動解決する（個別 apply は不要）。

## セットアップ手順

### 1. bootstrap（初回のみ・ローカル state）

```bash
cd infra/bootstrap
terraform init
terraform apply            # 管理者認証情報で
terraform output           # 次の手順で使う値を控える
```

出力される値:

| output              | 用途                                                                               |
| ------------------- | ---------------------------------------------------------------------------------- |
| `state_bucket_name` | environments の `backend.hcl` の `bucket`                                          |
| `deploy_role_arns`  | 環境別マップ `{dev=..., prod=...}`。各 GitHub Environment の `AWS_DEPLOY_ROLE_ARN` |
| `oidc_provider_arn` | 参考（信頼設定の確認用）                                                           |

> **⚠️ bootstrap の `terraform.tfstate` はコミットしない**（`.gitignore` 済み）。ただし OIDC/DeployRole/state バケットの
> 唯一の真実なので、**暗号化した安全な場所へ個人でバックアップ**すること。失うと復旧が `terraform import` 前提になる。

### 2. environments（dev / prod）

`backend.hcl` を作って init（`key` は dev/prod で必ず別にする）:

```bash
cd infra/environments/dev
cp backend.hcl.example backend.hcl
# backend.hcl の <ACCOUNT_ID> を bootstrap の state_bucket_name に合わせて編集
terraform init -backend-config=backend.hcl
terraform apply
terraform output           # cloudfront_domain_name / cloudfront_distribution_id / bucket_name
```

> **⚠️ dev と prod で `key` を絶対に取り違えない。** 同一 state バケットを共有するため、
> `key` が同じだと一方の apply が他方の環境の実 CloudFront/S3 を上書き・破壊する。
> `backend.hcl.example` には環境名入りの具体値（`env/dev/...` / `env/prod/...`）を最初から埋めてある。

初回 apply 直後は S3 が空なので、CloudFront はまだ中身を返さない。次の CI デプロイ（手順4）で `dist/` を載せる。

### 3. GitHub Environment 変数

リポジトリの **Settings → Environments** で `dev` と `prod` を作り、各環境に **Variables**（Secrets ではなく Variables で可）を設定:

| 変数                             | 値の出所                                               |
| -------------------------------- | ------------------------------------------------------ |
| `AWS_DEPLOY_ROLE_ARN`            | bootstrap output `deploy_role_arns` の**その環境の値** |
| `AWS_REGION`                     | environment output `aws_region`                        |
| `AWS_S3_BUCKET`                  | environment output `bucket_name`                       |
| `AWS_CLOUDFRONT_DISTRIBUTION_ID` | environment output `cloudfront_distribution_id`        |
| `VITE_COGNITO_USER_POOL_ID`      | environment output `cognito_user_pool_id`              |
| `VITE_COGNITO_APP_CLIENT_ID`     | environment output `cognito_app_client_id`             |
| `AWS_LAMBDA_FUNCTION_NAME`       | environment output `game_api_function_name`（Step 5）  |

> DeployRole は環境ごとに分離されている。`dev` Environment には `deploy_role_arns["dev"]`、`prod` には `["prod"]` を設定する
> （dev のロールは prod バケットへ届かない＝環境の取り違えで本番を汚染できない）。
>
> `VITE_COGNITO_*` は Secrets ではなく **Variables**（公開値・フロントに焼き込まれる）。`deploy-aws.yml` の **build ジョブも
> `environment:` を持つ**ため、prod に protection rule があると build 前・deploy 前の2回承認待ちが入る（意図した多層防御）。

### 4. デプロイ（CI）

GitHub Actions の **Deploy to AWS (S3 + CloudFront)** を `workflow_dispatch` で実行し、`environment`（dev/prod）を選ぶ。
build ジョブ（AWS 認証なし・ゲート → `VITE_DEPLOY_TARGET=aws` ビルド）→ deploy ジョブ（OIDC → `s3 sync --delete` → invalidation）。

## 動作確認

- `terraform output cloudfront_domain_name` の `https://<id>.cloudfront.net` を開き、対局画面が表示される。
- 深いリンクを直接開く／リロードして **404 にならない**（SPA rewrite が効いている）。
- DevTools の Network で `/assets/...`（`/` 起点）が 200 で解決している。

### 認証（Cognito）の手動確認（AWS 版のみ）

実 Cognito が要るため自動テストではなく手動で確認する:

1. AWS 版の CloudFront URL を開くと、未ログインでは**ログイン画面**に留まる（対局画面は出ない）。
2. 「アカウントを作成する」→ メールアドレス＋パスワードでサインアップ → 届いた**検証コード**を入力 → ログイン。
3. ログイン後に対局画面へ到達。リロードしても一瞬も対局画面が先に出ない（checking 中は App を描画しない）。
4. 右上の「ログアウト」でログイン画面へ戻る。
5. 一方、**Pages 版（GitHub Pages URL）はログインを要求しない**（無認証で対局が始まる）。DevTools の Network で
   `AuthProvider`/amplify のチャンクが**取得されない**ことも確認できる（E2E でも自動回帰）。

### サーバー権威 API（Step 5）の手動確認（AWS 版のみ）

実 Cognito / DynamoDB が要るため手動で確認する。フロントはまだ remote を叩かない（Step 6）ので、ここでは JWT 付き `curl` で API 単体を検証する。

1. `terraform output game_api_endpoint` で API のベース URL（`https://<id>.execute-api.ap-northeast-1.amazonaws.com`）を控える。
2. Cognito でログインして **idToken** を取得する（アプリのログイン後、DevTools の localStorage の `...idToken` か、
   `aws cognito-idp initiate-auth`/Amplify のいずれかで取得）。以下 `$TOKEN` に入れる。
3. 認証なしは弾かれる（401/403）: `curl -i "$API/games" -X POST` → 未認証。
4. 対局を作る:
   ```bash
   curl -s "$API/games" -X POST -H "Authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"bet":1000}' | jq
   ```
   → `id` / `version:1` / `wallet`（初期 10000 − BET）/ `view`（自分の手札のみ）が返る。**`view` に他家 `hand`・`wall` 中身・`seed` が無い**ことを確認。
5. 手を進める（`view.phase` が `discard` なら手札 uid を捨てる。`selfDeclare` なら `{"type":"SKIP_DECLARE"}`）:
   ```bash
   curl -s "$API/games/$ID/actions" -X POST -H "Authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"action":{"type":"DISCARD","uid":<UID>},"expectedVersion":1}' | jq
   ```
   → `version:2`。**同じ `expectedVersion:1` をもう一度送ると `409`**（楽観ロック）。`GET /games/$ID` で再同期できる。
6. 他人の対局は見えない: 別ユーザーの idToken で `GET /games/$ID` → **404**（存在を漏らさない）。
7. 精算: 終局まで進めると `outcome`（payout/ranking）が付き、`wallet` がサーバー計算で増減する。`localStorage` を書き換えても
   AWS 版の精算には影響しない（wallet は USER#sub item がサーバー権威）。

## 検証ゲート（コード側）

AWS 認証なしで機械確認できるのは fmt / validate:

```bash
terraform fmt -check -recursive infra
for d in infra/bootstrap infra/environments/dev infra/environments/prod; do
  terraform -chdir="$d" init -backend=false -input=false >/dev/null && terraform -chdir="$d" validate
done
```

> `terraform plan`/`apply` は実 AWS 認証が要るため CI には載せていない（`aws-vault exec <profile> -- terraform plan` などローカルで）。

## 撤去

- 環境: `cd infra/environments/<env> && terraform destroy`（S3 が空でないと消せない場合は先に `aws s3 rm s3://<bucket> --recursive`）。
- Cognito User Pool は `deletion_protection = "ACTIVE"`。destroy する前に `modules/cognito/main.tf` で `"INACTIVE"` にして apply してから消す。
- bootstrap: state バケットは `prevent_destroy = true`。撤去するときはこのフラグを外してから destroy し、最後に手動で片付ける。

## 将来のハードニング（申し送り）

- **DeployRole は既に環境別**（`cc-pokajan-github-deploy-dev` / `-prod`）で、S3 は各環境のバケット名パターン（`<prefix>-<env>-*`）に
  スコープ済み。残るのは `cloudfront:CreateInvalidation` の資源（現状アカウント内 `distribution/*`）を、初回 apply で
  ディストリビューション ID が確定したら **具体的な ARN に締め直す**こと（invalidation はキャッシュ無効化のみで内容改変はできないため優先度は低い）。
- **OIDC 信頼の `sub` は environment スコープ限定**（`repo:<org>/<repo>:environment:{dev,prod}`）。効果を出すため、GitHub の各
  Environment（dev/prod）に **protection rule（required reviewers 等。特に prod）** を必ず設定すること（ブランチ横断の assume を塞ぐ最後の鍵）。
- Step 4 で `VITE_COGNITO_*` を build に注入、Step 5 で DeployRole に `lambda:UpdateFunctionCode`（当該関数のみ）を追記。
- **CORS（Step 5）**: `game-api` の `cors_allow_origins` は既定 `["*"]`（dev 可）。**prod は CloudFront ドメインへ絞る**こと
  （初回 apply で `cloudfront_domain_name` が確定したら `environments/prod/terraform.tfvars` に
  `cors_allow_origins = ["https://<prod-cloudfront-domain>"]` を設定して再 apply）。Bearer 認証で Cookie 非依存のため
  `*` でも致命ではないが、金銭 API なので prod は明示オリジンにする。
- **Lambda コード配線位置（Step 6 申し送り）**: フロントの remote transport は `VITE_API_BASE_URL`（= `game_api_endpoint`）を
  GitHub Environment 変数に設定して build へ注入する。`amplifyIdToken` は AuthProvider マウント後（configure 済み）前提。
