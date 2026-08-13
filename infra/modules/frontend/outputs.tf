output "bucket_name" {
  description = "配信元 S3 バケット名（deploy-aws.yml の s3 sync 先）。"
  value       = aws_s3_bucket.site.bucket
}

output "bucket_arn" {
  description = "配信元 S3 バケットの ARN。"
  value       = aws_s3_bucket.site.arn
}

output "distribution_id" {
  description = "CloudFront ディストリビューション ID（invalidation 対象）。"
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_arn" {
  description = "CloudFront ディストリビューションの ARN。"
  value       = aws_cloudfront_distribution.site.arn
}

output "distribution_domain_name" {
  description = "既定の *.cloudfront.net ドメイン（ブラウザ確認用）。"
  value       = aws_cloudfront_distribution.site.domain_name
}
