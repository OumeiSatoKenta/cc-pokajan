# AWS 版のログイン用 Cognito User Pool と public な SPA アプリクライアント。
# - email/password・email 検証コード・セルフサインアップ許可。
# - アプリクライアントは secret 無し（public SPA）。Amplify 既定の SRP フローを使う。

resource "aws_cognito_user_pool" "this" {
  # 名前はアカウント内一意で足りるため、frontend module（グローバル一意の S3 名を呼び出し側が計算して渡す）と違い
  # 部品（project/environment）を受け取ってモジュール内部で組み立てる。意図的な非対称。
  name = "${var.project}-${var.environment}"

  # email をユーザー名にし、email を自動検証（検証コードで confirm）。
  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]

  password_policy {
    minimum_length                   = var.password_minimum_length
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  verification_message_template {
    default_email_option = "CONFIRM_WITH_CODE"
  }

  # セルフサインアップを許可（管理者作成のみにはしない）。
  admin_create_user_config {
    allow_admin_create_user_only = false
  }

  mfa_configuration   = "OFF"    # スコープ外を明示（将来 MFA を足すならここ）。
  deletion_protection = "ACTIVE" # 誤 destroy 防止。撤去時は README の手順で外す。

  tags = var.tags
}

resource "aws_cognito_user_pool_client" "this" {
  name         = "${var.project}-${var.environment}-web"
  user_pool_id = aws_cognito_user_pool.this.id

  # SPA/public クライアント。シークレットは生成しない。
  generate_secret = false

  # Amplify 既定の SRP と、トークン更新のみ許可（パスワードを平文で送る USER_PASSWORD_AUTH は使わない）。
  explicit_auth_flows = [
    "ALLOW_USER_SRP_AUTH",
    "ALLOW_REFRESH_TOKEN_AUTH",
  ]

  # ユーザーの存在有無を漏らさない（列挙攻撃対策）。
  prevent_user_existence_errors = "ENABLED"

  access_token_validity  = var.access_token_validity_minutes
  id_token_validity      = var.id_token_validity_minutes
  refresh_token_validity = var.refresh_token_validity_days

  token_validity_units {
    access_token  = "minutes"
    id_token      = "minutes"
    refresh_token = "days"
  }
}
