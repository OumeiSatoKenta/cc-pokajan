terraform {
  # backend の use_lockfile（S3 ネイティブロック）に 1.10 以上が要る。
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}
