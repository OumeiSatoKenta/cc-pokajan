# GameState / wallet の単一テーブル（single-table design）。
# - PK `pk` のみ（GAME#<ulid> と USER#<sub> を1テーブルに同居。Step 5 は GSI 不要）。
# - オンデマンド課金（低頻度・スパイキーなポートフォリオ用途に最適・容量計画不要）。
# - SSE 有効・TTL で古い GAME item を自動失効・PITR で誤更新から復旧可能。

resource "aws_dynamodb_table" "this" {
  name         = var.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"

  attribute {
    name = "pk"
    type = "S"
  }

  ttl {
    attribute_name = var.ttl_attribute
    enabled        = true
  }

  server_side_encryption {
    enabled = true
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }

  tags = var.tags
}
