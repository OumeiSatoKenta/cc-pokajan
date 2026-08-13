variable "project" {
  type        = string
  description = "リソース名の接頭辞。関数名は <project>-game-api-<environment> の形になる。"
}

variable "environment" {
  type        = string
  description = "環境名（dev/prod）。関数名・ロググループに含める。"
}

variable "table_name" {
  type        = string
  description = "DynamoDB テーブル名（Lambda 環境変数 TABLE_NAME）。"
}

variable "table_arn" {
  type        = string
  description = "DynamoDB テーブル ARN。Lambda の DynamoDB 権限をこの1テーブルに限定する。"
}

variable "cognito_issuer" {
  type        = string
  description = "JWT authorizer の issuer（cognito module の issuer 出力）。"
}

variable "cognito_app_client_id" {
  type        = string
  description = "JWT authorizer の audience（cognito module の app_client_id 出力）。"
}

variable "lambda_memory_mb" {
  type        = number
  description = "Lambda のメモリ（MB）。arm64。"
  default     = 256
}

variable "lambda_timeout_s" {
  type        = number
  description = "Lambda のタイムアウト（秒）。1リクエストで人間 Action + CPU 複数手を解決する。"
  default     = 10
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch Logs の保持日数。"
  default     = 14
}

variable "cors_allow_origins" {
  type        = list(string)
  description = "CORS で許可するオリジン。既定は全許可（Step 6 で CloudFront ドメインへ絞る申し送り）。"
  default     = ["*"]
}

variable "throttling_burst_limit" {
  type        = number
  description = "API Gateway のスロットリング（バースト）。金銭 API の濫用/コスト暴走を抑える。"
  default     = 20
}

variable "throttling_rate_limit" {
  type        = number
  description = "API Gateway のスロットリング（定常 req/秒）。"
  default     = 10
}

variable "tags" {
  type        = map(string)
  description = "全リソースに付与するタグ。"
  default     = {}
}
