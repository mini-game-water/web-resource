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
