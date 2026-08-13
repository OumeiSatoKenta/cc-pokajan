output "function_name" {
  description = "GitHub Environment 変数 AWS_LAMBDA_FUNCTION_NAME に設定する値（CI の update-function-code 対象）。"
  value       = aws_lambda_function.this.function_name
}

output "function_arn" {
  description = "Lambda 関数の ARN。"
  value       = aws_lambda_function.this.arn
}

output "api_endpoint" {
  description = "HTTP API の既定エンドポイント（$default ステージ）。Step 6 の VITE_API_BASE_URL に使う。"
  value       = aws_apigatewayv2_api.this.api_endpoint
}

output "api_id" {
  description = "HTTP API の ID。"
  value       = aws_apigatewayv2_api.this.id
}
