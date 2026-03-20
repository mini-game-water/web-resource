output "alb_dns_name" {
  description = "ALB DNS name"
  value       = aws_lb.main.dns_name
}

output "app_url" {
  description = "Application URL"
  value       = "https://${var.domain_name}"
}

output "ec2_public_ip" {
  description = "EC2 instance public IP"
  value       = aws_instance.app.public_ip
}

output "private_key_pem" {
  description = "Private key for SSH access (save to .pem file)"
  value       = tls_private_key.ec2.private_key_pem
  sensitive   = true
}

output "log_bucket" {
  description = "S3 bucket for game event logs"
  value       = aws_s3_bucket.logs.id
}

output "athena_workgroup" {
  description = "Athena workgroup name"
  value       = aws_athena_workgroup.gamehub.name
}

output "athena_database" {
  description = "Glue/Athena database name"
  value       = aws_glue_catalog_database.gamehub.name
}

output "grafana_url" {
  description = "Amazon Managed Grafana workspace URL"
  value       = aws_grafana_workspace.gamehub.endpoint
}
