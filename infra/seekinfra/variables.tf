variable "app_name" { type = string }
variable "region" { type = string }

variable "image_tag" {
  type        = string
  default     = "bootstrap"
  description = "Container image tag in ECR; the workflow sets it to the commit SHA."
}

variable "container_port" { type = number }
variable "health_check_path" { type = string }
variable "cpu" { type = number }
variable "memory" { type = number }
variable "desired_count" { type = number }

variable "autoscaling" {
  description = "Scale tasks between min and max on average CPU."
  type = object({
    enabled = bool
    min     = number
    max     = number
  })
  default = { enabled = false, min = 1, max = 1 }
}

variable "database" {
  type = object({
    enabled             = bool
    engine              = string # postgres | mysql
    version             = string
    instance            = string
    storage_gb          = number
    multi_az            = bool
    backup_days         = optional(number, 1)
    deletion_protection = optional(bool, false)
  })
}

variable "storage" {
  type = object({
    enabled = bool
    cors    = bool
  })
}

variable "env" {
  description = "Environment variables and where each value comes from."
  type = list(object({
    name   = string
    source = string
    value  = optional(string, "")
  }))
  default = []
}
