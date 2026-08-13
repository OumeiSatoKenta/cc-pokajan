output "user_pool_id" {
  description = "User Pool ID（フロント env VITE_COGNITO_USER_POOL_ID へ）。"
  value       = aws_cognito_user_pool.this.id
}

output "app_client_id" {
  description = "public app client ID（フロント env VITE_COGNITO_APP_CLIENT_ID へ）。"
  value       = aws_cognito_user_pool_client.this.id
}

output "user_pool_endpoint" {
  description = "User Pool のエンドポイント（cognito-idp.<region>.amazonaws.com/<pool_id>）。"
  value       = aws_cognito_user_pool.this.endpoint
}

output "issuer" {
  description = "JWT の issuer URL。Step 5 の API Gateway JWT authorizer が参照する。"
  value       = "https://${aws_cognito_user_pool.this.endpoint}"
}
