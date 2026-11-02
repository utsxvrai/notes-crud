resource "aws_s3_bucket" "files" {
  count         = var.storage.enabled ? 1 : 0
  bucket_prefix = "${local.name}-"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "files" {
  count                   = var.storage.enabled ? 1 : 0
  bucket                  = aws_s3_bucket.files[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  count  = var.storage.enabled ? 1 : 0
  bucket = aws_s3_bucket.files[0].id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

# Browsers upload/download directly with presigned URLs, only from the app's own address.
resource "aws_s3_bucket_cors_configuration" "files" {
  count  = var.storage.enabled && var.storage.cors ? 1 : 0
  bucket = aws_s3_bucket.files[0].id
  cors_rule {
    allowed_methods = ["GET", "PUT"]
    allowed_origins = ["http://${aws_lb.main.dns_name}"]
    allowed_headers = ["Content-Type"]
    max_age_seconds = 3000
  }
}
