resource "aws_iam_role" "ec2" {
  name = "gamehub-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })

  tags = { Name = "gamehub-ec2-role" }
}

resource "aws_iam_role_policy" "dynamodb" {
  name = "gamehub-dynamodb-access"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
      ]
      Resource = [
        aws_dynamodb_table.users.arn,
        aws_dynamodb_table.rooms.arn,
        "${aws_dynamodb_table.rooms.arn}/index/*",
        aws_dynamodb_table.notices.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy" "s3_logs" {
  name = "gamehub-s3-logs-access"
  role = aws_iam_role.ec2.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
      ]
      Resource = [
        aws_s3_bucket.logs.arn,
        "${aws_s3_bucket.logs.arn}/*",
      ]
    }]
  })
}

resource "aws_iam_instance_profile" "ec2" {
  name = "gamehub-ec2-profile"
  role = aws_iam_role.ec2.name
}
