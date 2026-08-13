# 設計: AWS デプロイ Step 3 — Terraform 静的配信 + OIDC CI/CD

## 全体像

```text
GitHub Actions (deploy-aws.yml, workflow_dispatch)
  build ジョブ（AWS 認証なし）: npm ci → gate → VITE_DEPLOY_TARGET=aws npm run build → artifact
  deploy ジョブ（OIDC id-token）: assume role → aws s3 sync → cloudfront invalidation
        │ assume (OIDC)
        ▼
  IAM DeployRole ── (S3 PutObject/Delete + CloudFront CreateInvalidation のみ)
        │
        ▼
Private S3 (dist) ◀── OAC ──  CloudFront (default *.cloudfront.net)
                                └ custom_error_response 403/404 → 200 /index.html（SPA）
```

state と権限の土台（**一度だけ** apply）:

```text
infra/bootstrap  →  S3(tfstate, versioned, SSE, private, TLS-only) + OIDC provider + 環境別 DeployRole(dev/prod)
infra/environments/{dev,prod}  →  backend "s3"(use_lockfile=S3 ネイティブロック) → module.frontend
```

## ディレクトリ構成

```text
infra/
  .gitignore                 # *.tfstate*, .terraform/, backend.hcl, crash.log
  README.md                  # apply 順序・backend.hcl・GitHub 変数の手順
  bootstrap/
    versions.tf              # required_version >= 1.10, required_providers(aws ~> 6.0)
    providers.tf             # provider aws (ap-northeast-1)。backend は書かない=ローカル state
    variables.tf             # project, aws_region, github_org, github_repo, github_environments, tags
    main.tf                  # state バケット(PAB/versioning/SSE/TLS-only/prevent_destroy) + locals.frontend_bucket_prefix(=project 由来)。DynamoDB は無し
    oidc.tf                  # OIDC provider + 環境別 DeployRole(for_each) + 環境別スコープの最小権限ポリシー
    outputs.tf               # state_bucket_name, oidc_provider_arn, deploy_role_arns(map), region
    .terraform.lock.hcl      # コミット対象（linux/mac 3 プラットフォームで aws 版・ハッシュ固定）
  modules/
    frontend/
      versions.tf            # required_version >= 1.10, aws ">= 6.0, < 7.0"
      variables.tf           # bucket_name, price_class(validation), tags, index_document, error_document
      main.tf                # S3(private+SSE+PAB) + OAC + CloudFront + bucket policy(SourceArn + TLS-only)
      outputs.tf             # bucket_name, bucket_arn, distribution_id, distribution_arn, distribution_domain_name
  environments/
    dev/
      versions.tf            # required_version >= 1.10, required_providers
      backend.tf             # backend "s3" { use_lockfile = true }（partial。bucket/key/region は backend.hcl）
      backend.hcl.example    # 実 init 用テンプレート（bucket/key=env/dev/.../region/encrypt）
      providers.tf           # provider aws(ap-northeast-1) + alias us_east_1（将来の ACM 用）
      variables.tf           # project, environment(validation), aws_region, price_class
      main.tf                # data.aws_caller_identity + module.frontend 配線（tags に Component=frontend）
      outputs.tf             # cloudfront_domain_name, cloudfront_distribution_id, bucket_name, aws_region
      terraform.tfvars       # project="cc-pokajan", environment="dev"
      .terraform.lock.hcl    # コミット対象
    prod/                     # dev と同型（environment="prod"・key=env/prod/...）
.github/workflows/deploy-aws.yml
```

## 主要な設計判断

### 1. engine 共有・src 非変更
Step 3 は AWS インフラと CI のみ。`src/**`・`tests/**`・`vite.config.ts` は触らない。Step 1 で用意した
`VITE_DEPLOY_TARGET=aws` の `/` 起点ビルドをそのまま S3 に載せる。フロントゲートは退行確認のためだけに回す。

### 2. CloudFront OAC（OAI 不使用）
- `aws_cloudfront_origin_access_control`（`origin_access_control_origin_type="s3"` / `signing_behavior="always"` /
  `signing_protocol="sigv4"`）。distribution の origin は `origin_access_control_id` で紐付け（`s3_origin_config`/OAI は書かない）。
- S3 は **完全非公開**（`aws_s3_bucket_public_access_block` 4 項目 true）。読み取りは**バケットポリシーで
  `cloudfront.amazonaws.com` サービスプリンシパル + `Condition StringEquals AWS:SourceArn = distribution.arn`** に限定
  （特定ディストリビューションのみ・混乱した代理を防ぐ）。`s3:GetObject` のみ許可（Put は CI ロール側で別途）。
- バケットポリシーに **`aws:SecureTransport=false` の Deny 文**を1つ足す（非 TLS リクエストを明示拒否・Well-Architected の保険）。
- キャッシュは AWS マネージド `Managed-CachingOptimized` を data source で参照（非推奨の `forwarded_values` を書かない）。
- レスポンスヘッダは マネージド `Managed-SecurityHeadersPolicy` を付与（HSTS 等・低コストの堅牢化）。
- `viewer_protocol_policy = "redirect-to-https"`、`compress = true`、`default_root_object = "index.html"`。
- `viewer_certificate { cloudfront_default_certificate = true }`（Phase 1・既定ドメイン）。

### 3. SPA rewrite
`custom_error_response` を 403 と 404 の両方に置き、`response_code = 200` / `response_page_path = "/index.html"` /
`error_caching_min_ttl = 10`。OAC + 非公開 S3 では存在しないキーは **403** を返すため、404 だけでは深いリンクが割れる。
両方入れるのが要（この構成の落とし穴）。

### 4. GitHub OIDC + 最小権限
- `aws_iam_openid_connect_provider`（url `https://token.actions.githubusercontent.com` / client_id `sts.amazonaws.com`）。
  `thumbprint_list` は近年 IAM 側が信頼ストアで検証するため**省略**（provider が取得。コメントで明記）。
- **DeployRole は環境ごとに分離**（`for_each = toset(var.github_environments)` で dev/prod 別々のロール）〔security-review 必須〕。
  単一共有ロールだと、信頼を environment スコープにしても**権限側が両環境のバケットにマッチ**し、弱い dev 経由で prod を汚染できる。
  信頼と権限の両方を環境で分けて初めて「環境の取り違えで本番を壊せない」が成立する。
- 各ロールの `assume_role_policy`: Federated=プロバイダ ARN / `sts:AssumeRoleWithWebIdentity` /
  `Condition StringEquals aud=sts.amazonaws.com` + **`StringEquals sub = repo:<org>/<repo>:environment:<env>`**（その環境1つのみ）。
  ワイルドカード `:*` は使わない〔security-review 高〕。deploy ジョブが `environment:` を設定するためトークンの sub が
  `...:environment:<name>` になり、ブランチ/PR 経由の assume を塞ぐ。
- 各ロールの権限は deploy-aws.yml が使うぶんだけ・**その環境のバケットのみ**:
  - `s3:ListBucket`（`arn:aws:s3:::<prefix>-<env>-*`）、`s3:GetObject/PutObject/DeleteObject`（`<prefix>-<env>-*/*`）
  - `cloudfront:CreateInvalidation` / `GetInvalidation`（`arn:aws:cloudfront::<account>:distribution/*`）
  - **`terraform apply` 権限は付与しない**（apply は管理者がローカル実行）。Lambda 更新は Step 5 で追加。
- **commands.md との差分（意図的）**: commands.md L127-129 は bootstrap ロールに「後続 Lambda 更新・terraform apply 権限」
  まで持たせると書くが、**本ステップは最小権限を優先して意図的に狭めている**（apply=管理者ローカル / Lambda=Step 5）。
  実装漏れではなく設計判断。
- CloudFront invalidation だけは実ディストリビューション ID が bootstrap 時点で未確定のため `distribution/*` に留める
  （invalidation はキャッシュ無効化のみで内容改変不可＝低影響。初回 apply 後に ARN 指定へ締め直すのは申し送り）。
  S3 のバケット名は環境名を含むため、命名規約（`<prefix>-<env>-*`）で apply を待たずに環境分離できている。
- `outputs.deploy_role_arns` は `{dev=..., prod=...}` のマップ。各 GitHub Environment に対応する ARN を設定する。

### 4b. deploy-aws.yml のジョブ分割（既存 deploy.yml と同じ防御姿勢）
- **build ジョブに AWS 認証を渡さない**（`npm ci`/test で第三者コードが走る）。
- **deploy ジョブだけ `id-token: write`** を持ち、build が上げた artifact を s3 sync するだけ。
  これは既存 `deploy.yml` の build/deploy 分離（侵害依存が公開権限を握らない）と同じ思想。
- バケット名・ディストリビューション ID・ロール ARN・リージョンは **GitHub Environment 変数**（`vars.*`）で渡す
  （apply 後にユーザーが設定）。CI から Terraform state を読む権限を増やさないための decoupling。
- トリガーは `workflow_dispatch`（`environment` を dev/prod から選択）。`main` 連動の自動 AWS デプロイは将来。

### 5. S3 backend（環境の state）
- ロックは **S3 ネイティブ（`use_lockfile = true`）** を使う〔doc-review 必須〕。DynamoDB ベースのロックは HashiCorp が
  非推奨化（将来削除予定）しており、Terraform 1.10+ の `use_lockfile` が現行の推奨。greenfield なので移行は不要、
  最初から非推奨機構を避ける。`use_lockfile = true` は静的・非機密のため `backend.tf` の `backend "s3"` ブロックに直書きし、
  bucket/key/region/encrypt はアカウント固有のため `backend.hcl`（gitignore）で init 時に渡す（partial 設定）。
- **dev/prod の `key` 衝突を構造で防ぐ [doc-review 高]**: dev/prod は同じ state バケットを共有するため、`key` が同一だと
  一方の apply が他方の実 CloudFront/S3 を上書き・破壊しうる。`backend.hcl.example` に**環境名入りの具体値をあらかじめ埋める**
  （dev=`env/dev/terraform.tfstate` / prod=`env/prod/terraform.tfstate`）。「人間が2ファイルで別の値を書くこと」に正しさを
  依存させない（CLAUDE.md の戒め）。README にも衝突警告を明記。
- `terraform validate` は `terraform init -backend=false` 後に実行（`use_lockfile` を含む backend 設定は評価されず無害）。

### 5b. プロバイダロックのコミット [3 reviewer 収束]
- `.terraform.lock.hcl`（bootstrap / environments/{dev,prod} の3 root）を**コミットする**（`.terraform/`・`*.tfstate` は引き続き無視）。
  root 構成はプロバイダ版・ハッシュを固定して再現性とサプライチェーン検知（改竄プロバイダのハッシュ不一致）を得るのが公式推奨。
- `terraform providers lock -platform=linux_amd64 -platform=darwin_amd64 -platform=darwin_arm64` で **3 プラットフォーム**の
  ハッシュを含む可搬なロックを生成（native 単一だと別 OS の init がハッシュ不一致で割れるため）。aws は 6.58.0 に固定。

### 6. バケット名の一意化
S3 は全世界一意。environment 側で `data.aws_caller_identity` を引き、
`"${var.project}-frontend-${var.environment}-${account_id}"` を module に渡す（module は受け取った名前を使うだけ）。

## テスト・検証方針

Terraform には単体テストの土壌が薄いため、**`fmt -check` + `init -backend=false` + `validate`** を機械ゲートにする。
加えて設計上の不変条件をレビュー（3軸）で担保する:
- S3 は非公開（PAB 4 項目 true）、ポリシーは OAC の SourceArn 限定であること。tfstate バケットも同水準（PAB + TLS-only）。
- SPA rewrite が 403/404 両方にあること。
- OIDC 信頼条件に `sub`(StringEquals environment) と `aud`(StringEquals sts) の**両方**があること（aud 欠落は他リポからの assume を許す）。
- DeployRole が**環境ごとに分離**され、権限も `<prefix>-<env>-*` でその環境のバケットに限定されていること（dev で prod を汚染できない）。
- CI ロールに apply 相当の広い権限が無いこと（最小権限）。

実 apply・ブラウザ確認は AWS 認証情報が必要なため README の手順に落とし、この作業では実施しない。

## リスク / 落とし穴

1. **OAC + 非公開 S3 は存在しないキーで 403**。404 だけの SPA rewrite だと深いリンクが割れる → 403 も入れる。
2. **OIDC 信頼の `aud` 欠落**は重大な穴（他リポが assume 可能に）。`aud`+`sub` 両方を必ず入れる。
3. **backend にアカウント固有の literal を書かない**（partial + backend.hcl）。コミットに account_id/bucket を残さない。
4. **CI ロールへの過剰権限**。plan の「terraform apply 権限」は付けない（apply は管理者ローカル）。
5. **CloudFront の `default_root_object`** を忘れるとルート `/` が ListBucket 相当で割れる → `index.html` を指定。
6. bootstrap の state をコミットしない（`infra/.gitignore`）。account_id を git 履歴に残さない。
7. **単一共有 DeployRole の罠**〔security-review 必須〕。信頼だけ環境スコープにしても権限が両環境に届けば無意味。
   ロール自体を環境ごとに分け、S3 権限も `<prefix>-<env>-*` に絞る。
8. **DynamoDB ロックは非推奨**〔doc-review 必須〕。`use_lockfile`（S3 ネイティブ・Terraform 1.10+）を使う。

## 申し送り（次ステップ向け）

- Step 4（Cognito）: `environments/*` に cognito module を配線し `outputs` に User Pool / App Client ID を出す。
  deploy-aws.yml の build に `VITE_COGNITO_*` を注入する。
- Step 5（backend）: DeployRole に `lambda:UpdateFunctionCode` を追記。`modules/{dynamodb,game-api}` を追加し
  environments へ配線。API URL を outputs に。
- `aws.us_east_1` alias は今回宣言のみ。カスタムドメイン導入時に ACM 証明書を us-east-1 に作り frontend module へ渡す。
- **OIDC `sub` の環境スコープ限定・DeployRole の環境分離は本ステップで実装済み**〔security-review 必須/高〕。残る follow-up は
  **CloudFront invalidation の資源 ARN 締め直しのみ**: 初回 apply でディストリビューション ID が確定したら
  `cloudfront:CreateInvalidation`（現状 `distribution/*`）を **具体 ARN に締め直す**〔doc-review 中〕（S3 は既に `<prefix>-<env>-*` 限定）。
  併せて GitHub Environment protection（reviewer 必須。特に prod）を有効化すると sub 環境スコープの効果が最大化する。
- **bootstrap tfstate のバックアップ [doc-review 低]**: bootstrap state は git 管理しない代わりに、
  暗号化した安全な場所へ個人でバックアップする（失うと OIDC/DeployRole/state バケットの復旧が import 前提になる）。README に明記。
