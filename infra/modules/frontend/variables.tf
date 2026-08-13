variable "bucket_name" {
  type        = string
  description = "配信元 S3 バケット名。全世界一意である必要があるため、環境側でアカウント ID を含めて渡す。"
}

variable "price_class" {
  type        = string
  description = "CloudFront の価格クラス。PriceClass_200 は日本を含むエッジをカバーする。"
  default     = "PriceClass_200"

  validation {
    condition     = contains(["PriceClass_100", "PriceClass_200", "PriceClass_All"], var.price_class)
    error_message = "price_class は PriceClass_100 / PriceClass_200 / PriceClass_All のいずれか。"
  }
}

variable "index_document" {
  type        = string
  description = "既定ドキュメント（ルート / で返すオブジェクト）。"
  default     = "index.html"
}

variable "error_document" {
  type        = string
  description = "SPA rewrite で 403/404 を差し替える先。SPA なので index.html に集約する。"
  default     = "index.html"
}

variable "tags" {
  type        = map(string)
  description = "全リソースに付与するタグ。"
  default     = {}
}
