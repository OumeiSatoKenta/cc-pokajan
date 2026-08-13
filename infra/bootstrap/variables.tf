variable "project" {
  type        = string
  description = "リソース名の接頭辞。"
  default     = "cc-pokajan"
}

variable "aws_region" {
  type        = string
  description = "アプリ資源のリージョン（東京）。"
  default     = "ap-northeast-1"
}

variable "github_org" {
  type        = string
  description = "OIDC 信頼を許可する GitHub Organization/User。"
  default     = "OumeiSatoKenta"
}

variable "github_repo" {
  type        = string
  description = "OIDC 信頼を許可するリポジトリ名。"
  default     = "cc-pokajan"
}

variable "github_environments" {
  type        = list(string)
  description = "OIDC で assume を許可する GitHub Environment 名（deploy-aws.yml の environment: と一致）。sub をこの環境スコープに限定する。"
  default     = ["dev", "prod"]
}

variable "tags" {
  type        = map(string)
  description = "全リソースに付与するタグ。"
  default = {
    Project   = "cc-pokajan"
    ManagedBy = "terraform"
    Component = "bootstrap"
  }
}
