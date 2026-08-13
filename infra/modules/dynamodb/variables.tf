variable "name" {
  type        = string
  description = "テーブル名（アカウント内一意で足りる。環境側で <project>-<environment> を渡す）。"
}

variable "ttl_attribute" {
  type        = string
  description = "TTL に使う属性名。GAME item はこの属性に期限（epoch 秒）を入れて自動失効させる。"
  default     = "ttl"
}

variable "point_in_time_recovery" {
  type        = bool
  description = "ポイントインタイムリカバリ（誤更新・削除からの復旧）。"
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "全リソースに付与するタグ。"
  default     = {}
}
