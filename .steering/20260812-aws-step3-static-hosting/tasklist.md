# タスクリスト: AWS デプロイ Step 3 — Terraform 静的配信 + OIDC CI/CD

## 事前

- [x] ベースライン確認: `terraform version`(v1.15.8) / `aws --version`(v2) / tflint 無し / フロントゲート緑（lint/typecheck/test 860/build/format すべて OK）
- [x] 実装前 doc-review 反映（[必須]0件。[高] backend.hcl key 環境別具体値 / [中] commands.md 権限差分の明記・ハードニング follow-up / [低] SecureTransport deny・bootstrap PAB・tfstate バックアップ を design.md へ反映済み）

## 実装

- [x] T1: `infra/.gitignore`（`*.tfstate*` / `.terraform/` / `backend.hcl` / `crash.log` / `*.tfplan`）
- [x] T2: `infra/modules/frontend/**`（versions / variables / main〔S3 private+PAB+SSE + OAC + CloudFront + SecureTransport deny 付き bucket policy〕/ outputs）
- [x] T3: `infra/bootstrap/**`（versions〔>=1.10〕/ providers / variables〔+github_environments〕/ main〔state S3: PAB+versioning+SSE+TLS-only+prevent_destroy。DynamoDB 無し〕/ oidc〔provider + **環境別 DeployRole**(for_each)・aud+sub 両条件・env スコープ権限〕/ outputs〔deploy_role_arns マップ〕）※ R2/R3/R4 反映後
- [x] T4: `infra/environments/dev/**`（versions〔>=1.10〕/ backend〔partial + use_lockfile〕/ backend.hcl.example〔key=env/dev・dynamodb_table 無し〕/ providers〔+us_east_1 alias〕/ variables〔environment validation〕/ main〔frontend 配線〕/ outputs〔+aws_region〕/ terraform.tfvars）
- [x] T5: `infra/environments/prod/**`（dev と同型・environment=prod・key=env/prod）
- [x] T6: `.github/workflows/deploy-aws.yml`（build ジョブ〔認証なし・gate・aws build・artifact〕/ deploy ジョブ〔OIDC・s3 sync --delete・invalidation〕・workflow_dispatch dev/prod）
- [x] T7: `infra/README.md`（apply 順序 bootstrap→env・backend.hcl 手順・GitHub Environment 変数一覧・実ブラウザ確認手順・撤去・ハードニング申し送り）

## 検証

- [x] V1: `terraform fmt -check -recursive infra` → FMT CLEAN（初回から整形済み）
- [x] V2: `infra/bootstrap` init(-backend=false) → validate `Success! The configuration is valid.`
- [x] V3: `infra/environments/dev` init(-backend=false) → validate Success
- [x] V4: `infra/environments/prod` init(-backend=false) → validate Success
- [x] V5: 既存フロントゲート lint/typecheck/test(860)/build/format:check すべて緑（退行なし。`.prettierignore` に `**/.terraform` 等を追加＝init 生成物対策）
- [x] V6: `wc -l` 最大 `modules/frontend/main.tf` 152 行（全 .tf 合計 685・レビュー反映後も 400 行超なし。次点 bootstrap/oidc.tf 91 行）
- [x] V7: `git status` OK（`infra/`・`deploy-aws.yml` は新規／`awscli-bundle*` は未 stage のまま／`backend.hcl`・`terraform.tfstate` は ignore 確認済み）

## レビュー反映タスク（実装後 3軸 + validator + doc-reviewer + security-review）

- [x] R1: [security-review 高] OIDC 信頼の `sub` をワイルドカード `repo:<org>/<repo>:*`（StringLike）から
  **environment スコープ限定 `:environment:{dev,prod}`（StringEquals）** に変更（`github_environments` 変数）。
  deploy ジョブが `environment:` を設定するため sub が環境付きになり、ブランチ/PR 経由の assume を構造的に遮断。
- [x] R2: [security-review 必須] **DeployRole を環境ごとに分離**（`for_each = toset(var.github_environments)`）。単一共有ロールでは
  信頼を環境スコープにしても権限が両環境のバケット（`<prefix>-*`）にマッチし、dev トークンで prod を汚染できた。
  S3 権限を `<prefix>-<env>-*` に絞り、信頼も各環境1つの sub に限定。`outputs.deploy_role_arns` をマップ化し README を環境別 ARN に更新。
- [x] R3: [doc-review 必須] **DynamoDB ロックを廃し S3 ネイティブ `use_lockfile=true`** に移行（HashiCorp が DynamoDB ロックを非推奨化）。
  `aws_dynamodb_table` と `lock_table_name` output を削除、`required_version >= 1.10`、backend.tf に `use_lockfile`、backend.hcl.example から `dynamodb_table` 削除。
- [x] R4: [security-review 推奨] tfstate バケットにも `aws:SecureTransport=false` の Deny を追加（配信バケットと同水準の非 TLS 拒否）。
- [x] R5: [3 reviewer 収束] `.terraform.lock.hcl` を**コミット対象**に変更（`.gitignore` から除外）＋ 3 プラットフォーム
  （linux_amd64/darwin_amd64/darwin_arm64）の可搬ロックを `terraform providers lock` で生成。aws 6.58.0 固定。
- [x] R6: [validator 中] deploy-aws.yml の `concurrency.group` を `inputs.*` → `github.event.inputs.environment`（トップレベルで確実に解決）。
- [x] R7: [docs 推奨] アクション版更新 `configure-aws-credentials@v6` / `upload-artifact@v7` / `download-artifact@v8`（checkout/setup-node の @v7 と方針統一）。
- [x] R8: [structural 中/低] `modules/frontend` に aws 版制約 `>= 6.0, < 7.0`／`environment` 変数に `contains(["dev","prod"])` validation／
  変数・output に description 補完／env タグに `Component=frontend`／`aws_region` output 追加（README の手打ち region を排除）／OIDC provider に tags。
- [x] R9: 実装後レビュー反映後の再検証: fmt clean・3 root validate Success・フロントゲート緑・lock 3 プラットフォーム tracked を再確認。
- [x] R10: [security 再レビュー 提案] `frontend_bucket_prefix` を bootstrap の独立変数から **`local = "${var.project}-frontend"`（project 由来）** に変更。
  environments 側のバケット名も同じ `var.project` 由来なので、2箇所で独立に文字列を書く暗黙同期を排除（片方だけ変えると fail-closed になる罠を解消）。
- [x] R11: 実装後 **security 再レビューで [必須]2件とも「解消確認」**・新規 [必須]/[高]/[推奨] 0件。docs（architecture.md / repository-structure.md）に Step 3 を追記。

## 実装後の振り返り（実装完了: 2026-08-12）

**計画と実績の差分**:

- 計画（Phase 1 / Step 3）どおり `infra/`（bootstrap / modules/frontend / environments/{dev,prod}）と `deploy-aws.yml` を追加し、
  `src/**` は無変更。既存 Pages（`deploy.yml`）は無変更で併存。フロントゲート lint/typecheck/test(860)/build/format は退行なし。
- **計画から意図的に変えた2点**（いずれもレビュー [必須] 由来）:
  1. **DynamoDB ロック → S3 ネイティブ `use_lockfile`**。計画は「DynamoDB ロック」だったが、HashiCorp が DynamoDB ロックを
     非推奨化しており、greenfield かつ Terraform 1.15 なら最初から現行推奨（`use_lockfile`・1.10+）に乗せるのが正。DynamoDB テーブルを作らない分シンプル。
  2. **単一 DeployRole → 環境別 DeployRole**。計画・初期実装は1ロールだったが、信頼を environment スコープにしても権限が
     両環境のバケットに届けば dev トークンで prod を汚染できる。ロード自体を `for_each` で分け、S3 権限も `<prefix>-<env>-*` に限定した。
- 機械ゲートは `terraform fmt -check` + `-backend=false` init → `validate`（3 root）。実 apply・ブラウザ確認は AWS 認証が要るため README 手順に落とした。

**学んだこと**:

- **「信頼スコープ」と「権限スコープ」は別物**。OIDC の `sub` を環境限定にしても、assume 後のロール権限が広ければ環境分離は成立しない。
  信頼・権限の両方を環境で分けて初めて「環境の取り違えで本番を壊せない」が言える。security 再レビューが `dev-` ≠ `prod-` の
  バケット名不一致まで突き合わせて解消確認した。
- **計画の文言 < 現行のベストプラクティス**。DynamoDB ロックは計画の明文だったが、doc-review が公式一次資料（Context7）で
  非推奨を裏取りしたため乗り換えた。「計画準拠」は目的ではなく手段で、非推奨機構をそのまま出す理由にはならない。
- **暗黙の同期に正しさを依存させない**（CLAUDE.md の核）。`frontend_bucket_prefix` を bootstrap と environments で独立に書くと
  片方だけ変えたとき fail-closed で気づきにくい。`var.project` から導出して単一ソースにした（security 再レビュー提案）。
- **プロバイダロックはコミット**（3 reviewer 収束）。native 単一だと別 OS の init がハッシュ不一致で割れるため、
  `terraform providers lock -platform=...` で linux/mac 3 プラットフォームの可搬ロックを生成して固定した。
- **`.prettierignore` に Terraform init 生成物**（`**/.terraform`）を足す必要があった。prettier は巨大なプロバイダバイナリを
  読もうとして落ちる。nested `.gitignore` を prettier は辿らないため root の `.prettierignore` で明示する。

**次回への申し送り**:

- **未コミット**: Step 1・2・3 が同一作業ブランチ（`feature/20260811-aws-step1-base-switch`）にスタック。PR を Step 単位で
  分けるなら ship-pr でコミットを分割する。`awscli-bundle.zip`/`awscli-bundle/`（リポジトリ直下の未追跡物）は**コミットしない**。
- **実 apply はユーザー作業**: bootstrap（管理者認証）→ environments（`backend.hcl` 作成・`key` 環境別）→ GitHub Environment 変数設定
  → `workflow_dispatch` デプロイ → CloudFront 既定ドメインでリロード 404 なし確認。手順は `infra/README.md`。
- **残ハードニング**: 初回 apply 後に `cloudfront:CreateInvalidation` の資源を `distribution/*` から具体 ARN に締め直す
  （S3 は既に環境別）。GitHub の各 Environment（特に prod）に protection rule を設定して sub 環境スコープの効果を最大化する。
- **Step 4（Cognito）/ Step 5（backend）** で cognito module・game-api/dynamodb module を environments へ配線し、DeployRole に
  `lambda:UpdateFunctionCode` を追記する。
