# remote state の土台: tfstate 用 S3（バージョニング + 暗号化 + 完全非公開 + 非 TLS 拒否）。
# ロックは S3 ネイティブ（backend の use_lockfile=true）を使うため DynamoDB テーブルは作らない
# （DynamoDB ロックは HashiCorp が非推奨化。Terraform >= 1.10 の use_lockfile が現行の推奨）。
# environments/{dev,prod} の backend "s3" がこのバケットを参照する。

data "aws_caller_identity" "current" {}

locals {
  # S3 は全世界一意。アカウント ID を含めて衝突を避ける。
  state_bucket_name = "${var.project}-tfstate-${data.aws_caller_identity.current.account_id}"

  # 配信バケット名の接頭辞。environments 側の "${var.project}-frontend-${env}-${acct}" と同じ var.project から導出し、
  # 2箇所で独立に文字列を書くこと（＝暗黙の同期）に依存させない。DeployRole の S3 スコープはこれを使う（oidc.tf）。
  frontend_bucket_prefix = "${var.project}-frontend"

  # game-api Lambda 関数名の接頭辞。modules/game-api の "${project}-game-api-${env}" と同じ var.project から導出する。
  # DeployRole の lambda:UpdateFunctionCode スコープはこれを使う（oidc.tf）。
  game_api_function_prefix = "${var.project}-game-api"
}

resource "aws_s3_bucket" "tfstate" {
  bucket = local.state_bucket_name
  tags   = var.tags

  # state バケットの誤削除を防ぐ。
  lifecycle {
    prevent_destroy = true
  }
}

resource "aws_s3_bucket_versioning" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# state には account_id / ARN が含まれるため、配信バケットと同水準で完全非公開にする。
resource "aws_s3_bucket_public_access_block" "tfstate" {
  bucket                  = aws_s3_bucket.tfstate.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# 配信バケットと同水準の保険として、非 TLS リクエストを明示拒否する。
data "aws_iam_policy_document" "tfstate" {
  statement {
    sid       = "DenyInsecureTransport"
    effect    = "Deny"
    actions   = ["s3:*"]
    resources = [aws_s3_bucket.tfstate.arn, "${aws_s3_bucket.tfstate.arn}/*"]

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "tfstate" {
  bucket = aws_s3_bucket.tfstate.id
  policy = data.aws_iam_policy_document.tfstate.json

  depends_on = [aws_s3_bucket_public_access_block.tfstate]
}
