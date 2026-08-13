data "aws_caller_identity" "current" {}

locals {
  common_tags = {
    Project     = var.project
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  # 全世界一意にするためアカウント ID を含める。bootstrap の deploy ロール(その環境用)は
  # "${var.project}-frontend-${env}-*" をスコープする（bootstrap も同じ var.project から接頭辞を導出）ので一致する。
  frontend_bucket_name = "${var.project}-frontend-${var.environment}-${data.aws_caller_identity.current.account_id}"
}

module "frontend" {
  source = "../../modules/frontend"

  bucket_name = local.frontend_bucket_name
  price_class = var.price_class
  tags        = merge(local.common_tags, { Component = "frontend" })
}

module "cognito" {
  source = "../../modules/cognito"

  project     = var.project
  environment = var.environment
  tags        = merge(local.common_tags, { Component = "auth" })
}

module "dynamodb" {
  source = "../../modules/dynamodb"

  # アカウント内一意で足りる（S3 と違い全世界一意は不要）。GAME#/USER# を同居させる単一テーブル。
  name = "${var.project}-${var.environment}"
  tags = merge(local.common_tags, { Component = "data" })
}

module "game_api" {
  source = "../../modules/game-api"

  project     = var.project
  environment = var.environment

  table_name = module.dynamodb.table_name
  table_arn  = module.dynamodb.table_arn

  # JWT authorizer は Step 4 の cognito module の出力を使う（issuer=検証元・app_client_id=audience）。
  cognito_issuer        = module.cognito.issuer
  cognito_app_client_id = module.cognito.app_client_id

  cors_allow_origins = var.cors_allow_origins

  tags = merge(local.common_tags, { Component = "api" })
}
