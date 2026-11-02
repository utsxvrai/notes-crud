output "url" { value = "http://${aws_lb.main.dns_name}" }
output "ecr_repository_url" { value = aws_ecr_repository.app.repository_url }
output "cluster_name" { value = aws_ecs_cluster.main.name }
output "service_name" { value = aws_ecs_service.app.name }
output "db_identifier" { value = try(aws_db_instance.main[0].identifier, "") }
output "bucket" { value = try(aws_s3_bucket.files[0].bucket, "") }
