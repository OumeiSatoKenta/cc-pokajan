terraform {
  backend "s3" {
    # S3 ネイティブロック（DynamoDB 不要。HashiCorp 現行推奨）。静的・非機密なのでここに直書きする。
    use_lockfile = true

    # bucket / key / region / encrypt は backend.hcl（.gitignore 済み）で init 時に渡す:
    #   terraform init -backend-config=backend.hcl
    # validate は `terraform init -backend=false` で実バックエンド無しに通す。
  }
}
