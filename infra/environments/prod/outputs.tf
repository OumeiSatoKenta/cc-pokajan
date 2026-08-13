output "cloudfront_domain_name" {
  description = "ブラウザ確認用の既定 *.cloudfront.net ドメイン。"
  value       = module.frontend.distribution_domain_name
}

output "cloudfront_distribution_id" {
  description = "GitHub Environment 変数 AWS_CLOUDFRONT_DISTRIBUTION_ID に設定する値。"
  value       = module.frontend.distribution_id
}

output "bucket_name" {
  description = "GitHub Environment 変数 AWS_S3_BUCKET に設定する値。"
  value       = module.frontend.bucket_name
}

output "aws_region" {
  description = "GitHub Environment 変数 AWS_REGION に設定する値。"
  value       = var.aws_region
}

output "cognito_user_pool_id" {
  description = "GitHub Environment 変数 VITE_COGNITO_USER_POOL_ID に設定する値。"
  value       = module.cognito.user_pool_id
}

output "cognito_app_client_id" {
  description = "GitHub Environment 変数 VITE_COGNITO_APP_CLIENT_ID に設定する値。"
  value       = module.cognito.app_client_id
}

output "cognito_issuer" {
  description = "Step 5 の JWT authorizer 用 issuer URL。"
  value       = module.cognito.issuer
}

output "game_api_endpoint" {
  description = "HTTP API エンドポイント。Step 6 の GitHub Environment 変数 VITE_API_BASE_URL に設定する。"
  value       = module.game_api.api_endpoint
}

output "game_api_function_name" {
  description = "GitHub Environment 変数 AWS_LAMBDA_FUNCTION_NAME に設定する値（CI の Lambda コード更新対象）。"
  value       = module.game_api.function_name
}
