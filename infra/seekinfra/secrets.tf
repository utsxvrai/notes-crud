# One random secret per env var the plan marks as generated_secret (e.g. JWT keys).
locals {
  generated_secret_names = toset([for e in var.env : e.name if e.source == "generated_secret"])
}

resource "random_password" "generated" {
  for_each = local.generated_secret_names
  length   = 48
  special  = false
}

resource "aws_secretsmanager_secret" "generated" {
  for_each                = local.generated_secret_names
  name_prefix             = "${local.name}-${lower(replace(each.key, "_", "-"))}-"
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "generated" {
  for_each      = local.generated_secret_names
  secret_id     = aws_secretsmanager_secret.generated[each.key].id
  secret_string = random_password.generated[each.key].result
}
