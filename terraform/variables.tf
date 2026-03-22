variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "domain_name" {
  description = "Domain name for the app (e.g. gamehub.example.com)"
  type        = string
}

variable "route53_zone_id" {
  description = "Route53 Hosted Zone ID for the domain"
  type        = string
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.small"
}

variable "docker_image" {
  description = "Docker image to run (e.g. your-account.dkr.ecr.us-east-1.amazonaws.com/gamehub:latest)"
  type        = string
  default     = "gamehub:latest"
}

variable "app_secret_key" {
  description = "Flask secret key for session signing"
  type        = string
  sensitive   = true
}

# ── Grafana SSO user ──
variable "grafana_user_name" {
  description = "IAM Identity Center username for Grafana admin (must already exist in IAM Identity Center)"
  type        = string
}
