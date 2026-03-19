resource "aws_dynamodb_table" "users" {
  name         = "gamehub-users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "user_id"

  attribute {
    name = "user_id"
    type = "S"
  }

  tags = { Name = "gamehub-users" }
}

resource "aws_dynamodb_table" "rooms" {
  name         = "gamehub-rooms"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "room_id"

  attribute {
    name = "room_id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "created_at"
    type = "N"
  }

  global_secondary_index {
    name            = "status-index"
    hash_key        = "status"
    range_key       = "created_at"
    projection_type = "ALL"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  tags = { Name = "gamehub-rooms" }
}
