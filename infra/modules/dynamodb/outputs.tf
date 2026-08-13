output "table_name" {
  description = "Lambda 環境変数 TABLE_NAME に渡すテーブル名。"
  value       = aws_dynamodb_table.this.name
}

output "table_arn" {
  description = "Lambda 実行ロールの DynamoDB 権限をこの ARN に限定する。"
  value       = aws_dynamodb_table.this.arn
}
