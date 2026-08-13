variable "project" {
  type        = string
  description = "リソース名の接頭辞。"
}

variable "environment" {
  type        = string
  description = "環境名（dev/prod）。User Pool 名に含める。"
}

variable "password_minimum_length" {
  type        = number
  description = "パスワード最小長。"
  default     = 8
}

variable "access_token_validity_minutes" {
  type        = number
  description = "アクセストークンの有効期限（分）。"
  default     = 60
}

variable "id_token_validity_minutes" {
  type        = number
  description = "ID トークンの有効期限（分）。"
  default     = 60
}

variable "refresh_token_validity_days" {
  type        = number
  description = "リフレッシュトークンの有効期限（日）。"
  default     = 30
}

variable "tags" {
  type        = map(string)
  description = "全リソースに付与するタグ。"
  default     = {}
}
