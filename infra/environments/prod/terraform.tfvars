project     = "cc-pokajan"
environment = "prod"
price_class = "PriceClass_200"

# game-api の CORS。prod の既定は空 `[]`（fail-closed＝全オリジン拒否。盗まれたトークンでの他オリジン読み取りを塞ぐ）。
# ブラウザ（Step 6）から使うには**自ドメインの明示設定が必須**。初回 apply 後に
# `terraform output cloudfront_domain_name` が確定したら以下をアンコメントして再 apply する:
# cors_allow_origins = ["https://<prod-cloudfront-domain>"]
