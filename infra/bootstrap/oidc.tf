# GitHub Actions(OIDC) → AWS の信頼と、CI デプロイ用の最小権限ロール。
# CI は固定アクセスキーを持たず、この短命ロールを assume する。
# ロールは環境ごとに分離する（信頼条件だけでなく権限も dev/prod で分ける）。
# 単一共有ロールだと、信頼を environment スコープにしても権限側が両環境のバケットにマッチしてしまい、
# dev トークンで prod バケットへ書ける（環境保護の弱い dev 経由で prod を汚染できる）。

resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  tags           = var.tags

  # thumbprint_list は省略する。近年の AWS IAM は GitHub の OIDC 証明書を自身の信頼ストアで検証するため、
  # 明示指定は不要（provider ~> 6.0 では省略でき、apply/validate ともに通る）。
}

# 信頼ポリシー: 各 GitHub Environment 1つだけからの WebIdentity を許可（環境ごとに別ロール）。
# aud と sub の「両方」を必ず条件に入れる（aud が欠けると他リポからの assume を許す重大な穴）。
# sub は StringEquals で当該 environment のみに限定する。deploy-aws.yml の deploy ジョブが environment: を
# 設定するため、トークンの sub は repo:<org>/<repo>:environment:<name> になる。ブランチ/PR 経由の assume を塞ぐ。
data "aws_iam_policy_document" "github_assume" {
  for_each = toset(var.github_environments)

  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_org}/${var.github_repo}:environment:${each.key}"]
    }
  }
}

resource "aws_iam_role" "deploy" {
  for_each = toset(var.github_environments)

  name               = "${var.project}-github-deploy-${each.key}"
  description        = "GitHub Actions(OIDC) deploy role for ${each.key}: S3 sync + CloudFront invalidation + game-api Lambda code update."
  assume_role_policy = data.aws_iam_policy_document.github_assume[each.key].json
  tags               = var.tags
}

# 権限は deploy-aws.yml が実際に使うぶんだけ（S3 sync・CloudFront invalidation・game-api Lambda コード更新）。
# terraform apply 権限は付与しない（apply は管理者がローカル実行）。Lambda は UpdateFunctionCode のみ（作成/構成変更は apply）。
# S3 は「その環境のバケット名パターン」まで絞る（<prefix>-<env>-*）。これで dev ロールは prod バケットへ届かない。
# CloudFront invalidation はディストリビューション ID が bootstrap 時点で未確定のためアカウント内 distribution/* に留める
# （invalidation はキャッシュ無効化のみで内容改変はできない。初回 apply 後に ARN 指定へ締め直すのは申し送り）。
data "aws_iam_policy_document" "deploy" {
  for_each = toset(var.github_environments)

  statement {
    sid       = "FrontendBucketList"
    effect    = "Allow"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${local.frontend_bucket_prefix}-${each.key}-*"]
  }

  statement {
    sid       = "FrontendBucketObjects"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${local.frontend_bucket_prefix}-${each.key}-*/*"]
  }

  statement {
    sid       = "CloudFrontInvalidation"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = ["arn:aws:cloudfront::${data.aws_caller_identity.current.account_id}:distribution/*"]
  }

  # Step 5: CI が backend の esbuild バンドルを Lambda へ反映する（コード更新のみ）。
  # 当該環境の game-api 関数だけに絞る（設定変更・関数作成・他関数は不可。作成/構成変更は管理者の terraform apply）。
  statement {
    sid       = "GameApiLambdaCodeUpdate"
    effect    = "Allow"
    actions   = ["lambda:UpdateFunctionCode"]
    resources = ["arn:aws:lambda:${var.aws_region}:${data.aws_caller_identity.current.account_id}:function:${local.game_api_function_prefix}-${each.key}"]
  }
}

resource "aws_iam_role_policy" "deploy" {
  for_each = toset(var.github_environments)

  name   = "${var.project}-github-deploy-${each.key}"
  role   = aws_iam_role.deploy[each.key].id
  policy = data.aws_iam_policy_document.deploy[each.key].json
}
