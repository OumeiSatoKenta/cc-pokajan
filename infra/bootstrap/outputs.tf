output "state_bucket_name" {
  description = "environments/{dev,prod}/backend.hcl の bucket に貼る値。"
  value       = aws_s3_bucket.tfstate.bucket
}

output "oidc_provider_arn" {
  description = "GitHub OIDC プロバイダの ARN（信頼設定の確認用）。"
  value       = aws_iam_openid_connect_provider.github.arn
}

output "deploy_role_arns" {
  description = "環境ごとの DeployRole ARN。各 GitHub Environment(dev/prod) の変数 AWS_DEPLOY_ROLE_ARN に対応する値を設定する。"
  value       = { for env, role in aws_iam_role.deploy : env => role.arn }
}

output "region" {
  description = "アプリ資源のリージョン。"
  value       = var.aws_region
}
