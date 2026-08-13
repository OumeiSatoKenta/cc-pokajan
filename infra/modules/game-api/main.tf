# サーバー権威の game-api: 単一 HTTP API Lambda（内部ルーティング）+ Cognito JWT authorizer。
# Lambda は src/engine を共有した esbuild バンドル（node22/arm64）。コード本体は CI が差し替える。

locals {
  function_name = "${var.project}-game-api-${var.environment}"

  # API Gateway の route_key。engine の内部ルーターと1対1で対応させる。
  route_keys = [
    "POST /games",
    "POST /games/{id}/actions",
    "GET /games/{id}",
  ]
}

# --- Lambda コード（初回のみ placeholder。以後 CI が update-function-code）---------------

data "archive_file" "placeholder" {
  type        = "zip"
  source_file = "${path.module}/placeholder/index.mjs"
  output_path = "${path.module}/build/placeholder.zip"
}

# --- CloudWatch Logs -------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "this" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# --- Lambda 実行ロール（最小権限）------------------------------------------------------

data "aws_iam_policy_document" "assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.function_name}-exec"
  assume_role_policy = data.aws_iam_policy_document.assume.json
  tags               = var.tags
}

data "aws_iam_policy_document" "lambda" {
  # 自分のロググループへの書き込みだけ（CreateLogGroup は terraform が作るので不要）。
  statement {
    sid       = "Logs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.this.arn}:*"]
  }

  # DynamoDB は「このテーブルのみ」。TransactWriteItems は内部の Put/Update を個別アクションとして認可されるため、
  # 使う個別アクション（GetItem/PutItem/UpdateItem）だけを列挙する（Batch* や Scan は付けない）。
  statement {
    sid       = "GameTable"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [var.table_arn]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${local.function_name}-policy"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda.json
}

# --- Lambda 関数 -----------------------------------------------------------------------

resource "aws_lambda_function" "this" {
  function_name = local.function_name
  role          = aws_iam_role.lambda.arn
  runtime       = "nodejs22.x"
  architectures = ["arm64"]
  handler       = "index.handler"

  filename         = data.archive_file.placeholder.output_path
  source_code_hash = data.archive_file.placeholder.output_base64sha256

  memory_size = var.lambda_memory_mb
  timeout     = var.lambda_timeout_s

  environment {
    variables = {
      # wallet 初期額は RulesConfig（gameConfig.INITIAL_WALLET）が単一の真実なので env で渡さない。
      TABLE_NAME = var.table_name
    }
  }

  # コード本体は CI（deploy-aws.yml）が update-function-code で反映する。
  # placeholder のハッシュ/ファイル名を以後の apply で戻さない（インフラと配信を分離）。
  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }

  depends_on = [aws_iam_role_policy.lambda, aws_cloudwatch_log_group.this]
  tags       = var.tags
}

# --- HTTP API + JWT authorizer ---------------------------------------------------------

resource "aws_apigatewayv2_api" "this" {
  name          = local.function_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = var.cors_allow_origins
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_headers = ["authorization", "content-type"]
    max_age       = 3600
  }

  tags = var.tags
}

resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id           = aws_apigatewayv2_api.this.id
  authorizer_type  = "JWT"
  identity_sources = ["$request.header.Authorization"]
  name             = "cognito-jwt"

  jwt_configuration {
    audience = [var.cognito_app_client_id]
    issuer   = var.cognito_issuer
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.this.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "this" {
  for_each = toset(local.route_keys)

  api_id             = aws_apigatewayv2_api.this.id
  route_key          = each.value
  target             = "integrations/${aws_apigatewayv2_integration.lambda.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.jwt.id
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.this.id
  name        = "$default"
  auto_deploy = true

  # 全ルート既定のスロットリング（濫用/コスト暴走の抑制）。
  default_route_settings {
    throttling_burst_limit = var.throttling_burst_limit
    throttling_rate_limit  = var.throttling_rate_limit
  }

  tags = var.tags
}

# HTTP API がこの Lambda を呼べるようにする（この API の全 route/stage から）。
resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.this.execution_arn}/*/*"
}
