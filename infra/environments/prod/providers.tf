provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.common_tags
  }
}

# カスタムドメイン用 ACM 証明書は us-east-1 必須。Phase 1 は既定ドメインのため未使用だが、
# 将来 frontend module へ渡せるよう alias だけ宣言しておく。
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = local.common_tags
  }
}
