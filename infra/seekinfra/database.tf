resource "aws_security_group" "db" {
  count       = var.database.enabled ? 1 : 0
  name        = "${local.name}-db"
  description = "Database: only the app containers may connect"
  vpc_id      = aws_vpc.main.id
  ingress {
    from_port       = var.database.engine == "postgres" ? 5432 : 3306
    to_port         = var.database.engine == "postgres" ? 5432 : 3306
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }
}

resource "aws_db_subnet_group" "main" {
  count      = var.database.enabled ? 1 : 0
  name       = local.name
  subnet_ids = aws_subnet.private[*].id
}

# Letters and digits only, so it is safe inside DATABASE_URL without escaping.
resource "random_password" "db" {
  count   = var.database.enabled ? 1 : 0
  length  = 32
  special = false
}

resource "aws_db_instance" "main" {
  count                   = var.database.enabled ? 1 : 0
  identifier              = local.name
  engine                  = var.database.engine
  engine_version          = var.database.version
  instance_class          = var.database.instance
  allocated_storage       = var.database.storage_gb
  storage_type            = "gp3"
  storage_encrypted       = true
  db_name                 = "app"
  username                = "app"
  password                = random_password.db[0].result
  multi_az                = var.database.multi_az
  db_subnet_group_name    = aws_db_subnet_group.main[0].name
  vpc_security_group_ids  = [aws_security_group.db[0].id]
  publicly_accessible     = false
  backup_retention_period = var.database.backup_days
  apply_immediately       = true
  # Protected databases also keep a final snapshot if they are ever deleted.
  deletion_protection       = var.database.deletion_protection
  skip_final_snapshot       = !var.database.deletion_protection
  final_snapshot_identifier = var.database.deletion_protection ? "${local.name}-final" : null
}

locals {
  db_address  = try(aws_db_instance.main[0].address, "")
  db_port     = try(tostring(aws_db_instance.main[0].port), "")
  db_password = try(random_password.db[0].result, "")
  db_scheme   = var.database.engine == "postgres" ? "postgres" : "mysql"
}

resource "aws_secretsmanager_secret" "database_url" {
  count                   = var.database.enabled ? 1 : 0
  name_prefix             = "${local.name}-database-url-"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database_url" {
  count         = var.database.enabled ? 1 : 0
  secret_id     = aws_secretsmanager_secret.database_url[0].id
  secret_string = "${local.db_scheme}://app:${local.db_password}@${local.db_address}:${local.db_port}/app"
}

resource "aws_secretsmanager_secret" "db_password" {
  count                   = var.database.enabled ? 1 : 0
  name_prefix             = "${local.name}-db-password-"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "db_password" {
  count         = var.database.enabled ? 1 : 0
  secret_id     = aws_secretsmanager_secret.db_password[0].id
  secret_string = local.db_password
}
