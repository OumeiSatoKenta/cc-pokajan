variable "project" {
  type        = string
  description = "リソース名の接頭辞。"
  default     = "cc-pokajan"
}

variable "environment" {
  type        = string
  description = "環境名。バケット名・タグ・state key に反映される。"
  default     = "dev"

  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "environment は dev または prod のいずれか。"
  }
}

variable "aws_region" {
  type        = string
  description = "アプリ資源のリージョン（東京）。"
  default     = "ap-northeast-1"
}

variable "price_class" {
  type        = string
  description = "CloudFront 価格クラス。"
  default     = "PriceClass_200"
}

variable "cors_allow_origins" {
  type        = list(string)
  description = "game-api の CORS 許可オリジン。dev は既定の全許可のまま（prod は CloudFront ドメインへ絞る）。"
  default     = ["*"]
}
