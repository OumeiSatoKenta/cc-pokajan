terraform {
  # use_lockfile（S3 ネイティブロック）を environments で使うため 1.10 以上を要求する。
  required_version = ">= 1.10"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }

  # bootstrap 自身は remote state を「これから作る」ため、backend を書かずローカル state で apply する（鶏卵回避）。
  # 生成された terraform.tfstate は .gitignore 済み。暗号化した安全な場所へ個人でバックアップすること
  # （失うと OIDC provider / DeployRole / state バケットの復旧が terraform import 前提になる）。
}
