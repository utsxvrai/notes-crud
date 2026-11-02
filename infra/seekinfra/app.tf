resource "aws_ecr_repository" "app" {
  name                 = local.name
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 10 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/seekinfra/${var.app_name}"
  retention_in_days = 14
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

# --- Environment wiring: each env var's value comes from a resource in this stack. ---
locals {
  plain_sources = {
    db_host    = local.db_address
    db_port    = local.db_port
    db_user    = var.database.enabled ? "app" : ""
    db_name    = var.database.enabled ? "app" : ""
    s3_bucket  = try(aws_s3_bucket.files[0].bucket, "")
    aws_region = var.region
    port       = tostring(var.container_port)
  }
  secret_sources = {
    database_url = try(aws_secretsmanager_secret.database_url[0].arn, "")
    db_password  = try(aws_secretsmanager_secret.db_password[0].arn, "")
  }

  env_names = [for e in var.env : e.name]
  environment = concat(
    [for e in var.env : { name = e.name, value = e.source == "plain" ? e.value : local.plain_sources[e.source] }
    if e.source == "plain" || contains(keys(local.plain_sources), e.source)],
    contains(local.env_names, "PORT") ? [] : [{ name = "PORT", value = tostring(var.container_port) }],
  )
  secrets = concat(
    [for e in var.env : { name = e.name, valueFrom = local.secret_sources[e.source] } if contains(keys(local.secret_sources), e.source)],
    [for e in var.env : { name = e.name, valueFrom = aws_secretsmanager_secret.generated[e.name].arn } if e.source == "generated_secret"],
  )
  secret_arns = compact(concat(values(local.secret_sources), [for s in aws_secretsmanager_secret.generated : s.arn]))
}

# --- IAM: names start with seekinfra-, which is all the deploy role may manage. ---
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-exec"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "execution_secrets" {
  # Count from known inputs: secret ARNs themselves are unknown until apply.
  count = var.database.enabled || length(local.generated_secret_names) > 0 ? 1 : 0
  name  = "read-app-secrets"
  role  = aws_iam_role.execution.id
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = local.secret_arns }]
  })
}

# The app's own identity: AWS SDKs in the container pick these credentials up automatically.
resource "aws_iam_role" "task" {
  name               = "${local.name}-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "task_s3" {
  count = var.storage.enabled ? 1 : 0
  name  = "app-bucket"
  role  = aws_iam_role.task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = "${aws_s3_bucket.files[0].arn}/*" },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.files[0].arn },
    ]
  })
}

resource "aws_ecs_task_definition" "app" {
  family                   = local.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name         = "app"
    image        = "${aws_ecr_repository.app.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = var.container_port, protocol = "tcp" }]
    environment  = local.environment
    secrets      = local.secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.app.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "app"
      }
    }
  }])
}

# --- Load balancer ---
resource "aws_lb" "main" {
  name               = substr(local.name, 0, 32)
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "app" {
  name_prefix = "sk-"
  port        = var.container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path                = var.health_check_path
    matcher             = "200-399"
    interval            = 15
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
  deregistration_delay = 15
  lifecycle { create_before_destroy = true }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.app.arn
  }
}

resource "aws_ecs_service" "app" {
  name                              = local.name
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.app.arn
  desired_count                     = var.desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = var.container_port
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  depends_on = [aws_lb_listener.http, aws_iam_role_policy.execution_secrets]
}

# --- Autoscaling: keep average CPU around 60% between min and max tasks. ---
resource "aws_appautoscaling_target" "app" {
  count              = var.autoscaling.enabled ? 1 : 0
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.autoscaling.min
  max_capacity       = var.autoscaling.max
}

resource "aws_appautoscaling_policy" "cpu" {
  count              = var.autoscaling.enabled ? 1 : 0
  name               = "${local.name}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.app[0].service_namespace
  resource_id        = aws_appautoscaling_target.app[0].resource_id
  scalable_dimension = aws_appautoscaling_target.app[0].scalable_dimension
  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
