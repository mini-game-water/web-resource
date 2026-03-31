data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# Upload Grafana dashboard JSON to S3 (too large for user_data 16KB limit)
resource "aws_s3_object" "grafana_dashboard" {
  bucket  = aws_s3_bucket.logs.id
  key     = "grafana/dashboard.json"
  content = templatefile("${path.module}/grafana_dashboard.json.tftpl", {
    ds_uid     = "athena-gamehub"
    aws_region = var.aws_region
    database   = aws_glue_catalog_database.gamehub.name
  })
  content_type = "application/json"
}

resource "aws_instance" "app" {
  ami                    = data.aws_ami.al2023.id
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.public_a.id
  vpc_security_group_ids = [aws_security_group.ec2.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name
  key_name               = aws_key_pair.ec2.key_name

  user_data = base64encode(templatefile("${path.module}/user_data.sh", {
    aws_region             = var.aws_region
    app_secret_key         = var.app_secret_key
    docker_image           = var.docker_image
    log_bucket             = aws_s3_bucket.logs.id
    domain_name            = var.domain_name
    grafana_admin_password = var.grafana_admin_password
    athena_database        = aws_glue_catalog_database.gamehub.name
    athena_workgroup       = aws_athena_workgroup.gamehub.name
    athena_results_bucket  = aws_s3_bucket.athena_results.id
  }))

  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 2
  }

  root_block_device {
    volume_size = 30
    volume_type = "gp3"
  }

  tags = { Name = "gamehub-ec2" }

  depends_on = [aws_internet_gateway.main, aws_s3_object.grafana_dashboard]
}
