# 要求: AWS デプロイ Step 3 — Terraform 静的配信 + OIDC CI/CD

## 背景

参照計画: [docs/ideas/cc-pokajan-aws-deployment-plan-revised.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised.md)（Phase 1 = 静的配信）
とコマンド分割: [docs/ideas/cc-pokajan-aws-deployment-plan-revised-add-feature-commands.md](../../docs/ideas/cc-pokajan-aws-deployment-plan-revised-add-feature-commands.md)（Step 3）。

Step 1（Vite base 切替・`VITE_DEPLOY_TARGET=aws` で `/` 起点ビルド）と Step 2（engine 純ロジック抽出）は完了済み。
Step 3 は **AWS 上に静的サイトを載せる Phase 1 の本体**。S3（プライベート）+ CloudFront(OAC) 配信・Terraform 化・
GitHub OIDC による CI/CD を用意する。**サーバーコード（backend/）は Step 5 まで作らない**。

## スコープ（今回やること）

- `infra/bootstrap/**`: remote state 用 S3 バケット（ロックは S3 ネイティブ `use_lockfile`＝DynamoDB 不使用）+ GitHub OIDC
  プロバイダ + **環境ごとに分離した**デプロイ用 IAM ロール（dev/prod）。**一度だけ apply**。bootstrap 自身の state はローカル管理（鶏卵回避）。
- `infra/modules/frontend/**`: プライベート S3（public access 全ブロック）+ CloudFront + **OAC**（レガシー OAI 不使用）+
  SPA rewrite（403/404 → `/index.html`）。カスタムドメインは省略し既定 `*.cloudfront.net` を使う。
- `infra/environments/{dev,prod}/**`: S3 backend 配線・`aws`(ap-northeast-1) と `aws.us_east_1`(ACM 用・将来) プロバイダ・
  frontend module の配線・変数・出力。
- `.github/workflows/deploy-aws.yml`（新規）: OIDC で `configure-aws-credentials` → `VITE_DEPLOY_TARGET=aws npm run build` →
  `aws s3 sync dist/` → CloudFront invalidation。トリガーは当面 `workflow_dispatch`（誤爆防止）。
- `infra/README.md` / `infra/.gitignore`: apply 順序・backend 設定・必要な GitHub 変数の手順書、tfstate の除外。

## スコープ外（今回やらないこと）

- Cognito 認証（Step 4）、backend Lambda / DynamoDB ゲームテーブル / API Gateway（Step 5）、フロント remote 化（Step 6）。
- カスタムドメイン・ACM 証明書（`aws.us_east_1` alias は**宣言だけ**して将来に備える。frontend module には今は渡さない）。
- WAF・Route53・監視アラーム。
- `src/**` / `tests/**` / `vite.config.ts` / 既存 `.github/workflows/deploy.yml` の変更（Pages 併存は無変更で維持）。

## 受け入れ基準

1. `terraform fmt -check`（bootstrap / modules/frontend / environments/dev / environments/prod すべて）が通る。
2. `terraform validate`（各 root: bootstrap, environments/dev, environments/prod。`-backend=false` で init 後）が通る。
3. 既存フロントゲート `npm run lint && npm run typecheck && npm test && npm run build && npm run format:check` が**無変更で緑**
   （Step 3 は `src/**` を触らないため当然だが、退行が無いことを機械確認する）。
4. 設計レビューで redaction / 最小権限 / OAC / SPA rewrite の観点に `[必須]` が残っていない。
5. CloudFront は既定 `*.cloudfront.net`、S3 は非公開（バケットポリシーは CloudFront サービスプリンシパル + `AWS:SourceArn` 限定）。
6. `apply` と実ブラウザ確認（CloudFront 既定ドメインで表示・リロード 404 なし）は **AWS 認証情報が要るためユーザーが実施**する
   手順として README に明記する（この環境では実 apply しない）。

## 制約・前提

- **リージョン**: アプリ資源は ap-northeast-1（東京）。CloudFront 用 ACM のみ us-east-1（今回は未使用の alias 宣言のみ）。
- **OIDC 信頼**: `repo:OumeiSatoKenta/cc-pokajan:environment:{dev,prod}`（StringEquals・環境スコープ限定。ワイルドカード `:*` は使わない）。
  CI に固定アクセスキーを持たせない。
- **最小権限**: CI デプロイロールは Step 3 の deploy-aws.yml が実際に使う権限（S3 sync + CloudFront invalidation）に絞る。
  `terraform apply` はローカルで管理者が実行する前提（CI ロールには apply 権限を与えない）。Lambda 更新権限は Step 5 で追加。
- **tfstate をコミットしない**: `infra/.gitignore` で `*.tfstate*` / `.terraform/` / `backend.hcl` を除外。
- **awscli-bundle.zip / awscli-bundle/**（リポジトリ直下の未追跡物）には触れない・コミットしない。
- Terraform は手元に v1.15.8、AWS CLI v2 あり。tflint は未導入（fmt/validate をゲートにする）。
