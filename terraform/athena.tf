# ──────────────── Athena Workgroup & Database ────────────────

resource "aws_s3_bucket" "athena_results" {
  bucket = "gamehub-athena-results-${data.aws_caller_identity.current.account_id}"
  tags   = { Name = "gamehub-athena-results" }
}

resource "aws_s3_bucket_lifecycle_configuration" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  rule {
    id     = "expire-query-results"
    status = "Enabled"
    filter {}
    expiration {
      days = 30
    }
  }
}

resource "aws_s3_bucket_public_access_block" "athena_results" {
  bucket = aws_s3_bucket.athena_results.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_athena_workgroup" "gamehub" {
  name = "gamehub"

  configuration {
    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.id}/results/"
    }
    enforce_workgroup_configuration = true
  }

  tags = { Name = "gamehub-athena" }
}

resource "aws_glue_catalog_database" "gamehub" {
  name = "gamehub_logs"
}

# ──────────────── Glue Tables (one per log category) ────────────────

resource "aws_glue_catalog_table" "user_activity" {
  database_name = aws_glue_catalog_database.gamehub.name
  name          = "user_activity"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"            = "json"
    "compressionType"           = "gzip"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2024,2030"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs.id}/year=$${year}/month=$${month}/day=$${day}/"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "TRUE"
      }
    }

    columns {
      name = "event_id"
      type = "string"
    }
    columns {
      name = "timestamp"
      type = "string"
    }
    columns {
      name = "epoch_ms"
      type = "bigint"
    }
    columns {
      name = "category"
      type = "string"
    }
    columns {
      name = "event_type"
      type = "string"
    }
    columns {
      name = "user_id"
      type = "string"
    }
    columns {
      name = "ip"
      type = "string"
    }
    columns {
      name = "old_status"
      type = "string"
    }
    columns {
      name = "new_status"
      type = "string"
    }
    columns {
      name = "fields_changed"
      type = "array<string>"
    }
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
}

resource "aws_glue_catalog_table" "room_activity" {
  database_name = aws_glue_catalog_database.gamehub.name
  name          = "room_activity"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"            = "json"
    "compressionType"           = "gzip"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2024,2030"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs.id}/year=$${year}/month=$${month}/day=$${day}/"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "TRUE"
      }
    }

    columns {
      name = "event_id"
      type = "string"
    }
    columns {
      name = "timestamp"
      type = "string"
    }
    columns {
      name = "epoch_ms"
      type = "bigint"
    }
    columns {
      name = "category"
      type = "string"
    }
    columns {
      name = "event_type"
      type = "string"
    }
    columns {
      name = "room_id"
      type = "string"
    }
    columns {
      name = "user_id"
      type = "string"
    }
    columns {
      name = "host"
      type = "string"
    }
    columns {
      name = "game"
      type = "string"
    }
    columns {
      name = "max_players"
      type = "int"
    }
    columns {
      name = "allow_spectate"
      type = "boolean"
    }
    columns {
      name = "allow_coaching"
      type = "boolean"
    }
    columns {
      name = "players"
      type = "array<string>"
    }
    columns {
      name = "forced"
      type = "boolean"
    }
    columns {
      name = "reason"
      type = "string"
    }
    columns {
      name = "old_host"
      type = "string"
    }
    columns {
      name = "new_host"
      type = "string"
    }
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
}

resource "aws_glue_catalog_table" "game_activity" {
  database_name = aws_glue_catalog_database.gamehub.name
  name          = "game_activity"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"            = "json"
    "compressionType"           = "gzip"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2024,2030"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs.id}/year=$${year}/month=$${month}/day=$${day}/"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "TRUE"
      }
    }

    columns {
      name = "event_id"
      type = "string"
    }
    columns {
      name = "timestamp"
      type = "string"
    }
    columns {
      name = "epoch_ms"
      type = "bigint"
    }
    columns {
      name = "category"
      type = "string"
    }
    columns {
      name = "event_type"
      type = "string"
    }
    columns {
      name = "room_id"
      type = "string"
    }
    columns {
      name = "user_id"
      type = "string"
    }
    columns {
      name = "game"
      type = "string"
    }
    columns {
      name = "move_data"
      type = "string"
    }
    columns {
      name = "winner"
      type = "string"
    }
    columns {
      name = "loser"
      type = "string"
    }
    columns {
      name = "scores"
      type = "string"
    }
    columns {
      name = "score"
      type = "int"
    }
    columns {
      name = "level"
      type = "int"
    }
    columns {
      name = "lines"
      type = "int"
    }
    columns {
      name = "hand_data"
      type = "string"
    }
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
}

resource "aws_glue_catalog_table" "chat_activity" {
  database_name = aws_glue_catalog_database.gamehub.name
  name          = "chat_activity"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"            = "json"
    "compressionType"           = "gzip"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2024,2030"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs.id}/year=$${year}/month=$${month}/day=$${day}/"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "TRUE"
      }
    }

    columns {
      name = "event_id"
      type = "string"
    }
    columns {
      name = "timestamp"
      type = "string"
    }
    columns {
      name = "epoch_ms"
      type = "bigint"
    }
    columns {
      name = "category"
      type = "string"
    }
    columns {
      name = "event_type"
      type = "string"
    }
    columns {
      name = "room_id"
      type = "string"
    }
    columns {
      name = "user_id"
      type = "string"
    }
    columns {
      name = "role"
      type = "string"
    }
    columns {
      name = "message"
      type = "string"
    }
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
}

resource "aws_glue_catalog_table" "friend_activity" {
  database_name = aws_glue_catalog_database.gamehub.name
  name          = "friend_activity"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"            = "json"
    "compressionType"           = "gzip"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2024,2030"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs.id}/year=$${year}/month=$${month}/day=$${day}/"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "TRUE"
      }
    }

    columns {
      name = "event_id"
      type = "string"
    }
    columns {
      name = "timestamp"
      type = "string"
    }
    columns {
      name = "epoch_ms"
      type = "bigint"
    }
    columns {
      name = "category"
      type = "string"
    }
    columns {
      name = "event_type"
      type = "string"
    }
    columns {
      name = "user_id"
      type = "string"
    }
    columns {
      name = "friend_id"
      type = "string"
    }
    columns {
      name = "room_id"
      type = "string"
    }
    columns {
      name = "inviter"
      type = "string"
    }
    columns {
      name = "invitee"
      type = "string"
    }
    columns {
      name = "accepted"
      type = "boolean"
    }
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
}

resource "aws_glue_catalog_table" "spectate_activity" {
  database_name = aws_glue_catalog_database.gamehub.name
  name          = "spectate_activity"

  table_type = "EXTERNAL_TABLE"

  parameters = {
    "classification"            = "json"
    "compressionType"           = "gzip"
    "projection.enabled"        = "true"
    "projection.year.type"      = "integer"
    "projection.year.range"     = "2024,2030"
    "projection.month.type"     = "integer"
    "projection.month.range"    = "1,12"
    "projection.month.digits"   = "2"
    "projection.day.type"       = "integer"
    "projection.day.range"      = "1,31"
    "projection.day.digits"     = "2"
    "storage.location.template" = "s3://${aws_s3_bucket.logs.id}/year=$${year}/month=$${month}/day=$${day}/"
  }

  storage_descriptor {
    location      = "s3://${aws_s3_bucket.logs.id}/"
    input_format  = "org.apache.hadoop.mapred.TextInputFormat"
    output_format = "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat"

    ser_de_info {
      serialization_library = "org.openx.data.jsonserde.JsonSerDe"
      parameters = {
        "ignore.malformed.json" = "TRUE"
      }
    }

    columns {
      name = "event_id"
      type = "string"
    }
    columns {
      name = "timestamp"
      type = "string"
    }
    columns {
      name = "epoch_ms"
      type = "bigint"
    }
    columns {
      name = "category"
      type = "string"
    }
    columns {
      name = "event_type"
      type = "string"
    }
    columns {
      name = "room_id"
      type = "string"
    }
    columns {
      name = "user_id"
      type = "string"
    }
    columns {
      name = "game"
      type = "string"
    }
  }

  partition_keys {
    name = "year"
    type = "int"
  }
  partition_keys {
    name = "month"
    type = "int"
  }
  partition_keys {
    name = "day"
    type = "int"
  }
}
