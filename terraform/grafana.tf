# ──────────────── Amazon Managed Grafana ────────────────

resource "aws_iam_role" "grafana" {
  name = "gamehub-grafana-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "grafana.amazonaws.com" }
      Condition = {
        StringEquals = {
          "aws:SourceAccount" = data.aws_caller_identity.current.account_id
        }
      }
    }]
  })

  tags = { Name = "gamehub-grafana-role" }
}

resource "aws_iam_role_policy" "grafana_athena" {
  name = "gamehub-grafana-athena"
  role = aws_iam_role.grafana.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "athena:GetDatabase",
          "athena:GetDataCatalog",
          "athena:GetTableMetadata",
          "athena:ListDatabases",
          "athena:ListDataCatalogs",
          "athena:ListTableMetadata",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:GetWorkGroup",
          "athena:StartQueryExecution",
          "athena:StopQueryExecution",
          "athena:ListWorkGroups",
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartition",
          "glue:GetPartitions",
          "glue:BatchGetPartition",
        ]
        Resource = [
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:catalog",
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:database/${aws_glue_catalog_database.gamehub.name}",
          "arn:aws:glue:${var.aws_region}:${data.aws_caller_identity.current.account_id}:table/${aws_glue_catalog_database.gamehub.name}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
        ]
        Resource = [
          aws_s3_bucket.logs.arn,
          "${aws_s3_bucket.logs.arn}/*",
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:ListBucket",
          "s3:GetBucketLocation",
          "s3:PutObject",
        ]
        Resource = [
          aws_s3_bucket.athena_results.arn,
          "${aws_s3_bucket.athena_results.arn}/*",
        ]
      },
    ]
  })
}

resource "aws_grafana_workspace" "gamehub" {
  name                     = "gamehub-grafana"
  account_access_type      = "CURRENT_ACCOUNT"
  authentication_providers = ["AWS_SSO"]
  permission_type          = "SERVICE_MANAGED"
  role_arn                 = aws_iam_role.grafana.arn
  data_sources             = ["ATHENA"]

  tags = { Name = "gamehub-grafana" }
}

# ──────────────── IAM Identity Center User ────────────────

data "aws_ssoadmin_instances" "this" {}

data "aws_identitystore_user" "grafana_admin" {
  identity_store_id = data.aws_ssoadmin_instances.this.identity_store_ids[0]

  alternate_identifier {
    unique_attribute {
      attribute_path  = "UserName"
      attribute_value = var.grafana_user_name
    }
  }
}

resource "aws_grafana_role_association" "admin" {
  workspace_id = aws_grafana_workspace.gamehub.id
  role         = "ADMIN"
  user_ids     = [data.aws_identitystore_user.grafana_admin.user_id]
}

# ──────────────── Grafana API Key & Provider ────────────────

resource "aws_grafana_workspace_api_key" "terraform" {
  key_name        = "terraform-provisioning"
  key_role        = "ADMIN"
  seconds_to_live = 2592000 # 30 days
  workspace_id    = aws_grafana_workspace.gamehub.id
}

provider "grafana" {
  url  = "https://${aws_grafana_workspace.gamehub.endpoint}"
  auth = aws_grafana_workspace_api_key.terraform.key
}

# ──────────────── Athena Data Source ────────────────

resource "grafana_data_source" "athena" {
  type = "grafana-athena-datasource"
  name = "GameHub Athena"

  json_data_encoded = jsonencode({
    defaultRegion  = var.aws_region
    catalog        = "AwsDataCatalog"
    database       = aws_glue_catalog_database.gamehub.name
    workgroup      = aws_athena_workgroup.gamehub.name
    outputLocation = "s3://${aws_s3_bucket.athena_results.id}/results/"
  })
}

# ──────────────── Grafana Dashboard ────────────────

resource "grafana_dashboard" "gamehub_logs" {
  config_json = jsonencode({
    title       = "GameHub Live Logs"
    description = "Real-time event monitoring for GameHub"
    editable    = true
    time = {
      from = "now-1h"
      to   = "now"
    }
    refresh = "30s"
    panels = [
      {
        id         = 1
        title      = "All Events Stream"
        type       = "table"
        gridPos    = { h = 10, w = 24, x = 0, y = 0 }
        datasource = { type = "grafana-athena-datasource", uid = grafana_data_source.athena.uid }
        targets = [{
          rawSQL = <<-EOT
            SELECT timestamp, category, event_type, user_id, room_id
            FROM user_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            UNION ALL
            SELECT timestamp, category, event_type, user_id, room_id
            FROM room_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            UNION ALL
            SELECT timestamp, category, event_type, user_id, room_id
            FROM game_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            UNION ALL
            SELECT timestamp, category, event_type, user_id, room_id
            FROM chat_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            UNION ALL
            SELECT timestamp, category, event_type, user_id, room_id
            FROM friend_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            UNION ALL
            SELECT timestamp, category, event_type, user_id, room_id
            FROM spectate_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            ORDER BY timestamp DESC
            LIMIT 200
          EOT
          format = "table"
        }]
      },
      {
        id         = 2
        title      = "Login / Logout / Register"
        type       = "table"
        gridPos    = { h = 8, w = 12, x = 0, y = 10 }
        datasource = { type = "grafana-athena-datasource", uid = grafana_data_source.athena.uid }
        targets = [{
          rawSQL = <<-EOT
            SELECT timestamp, event_type, user_id, ip
            FROM user_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND event_type IN ('login', 'logout', 'register')
            ORDER BY timestamp DESC
            LIMIT 50
          EOT
          format = "table"
        }]
      },
      {
        id         = 3
        title      = "Events per Minute"
        type       = "timeseries"
        gridPos    = { h = 8, w = 12, x = 12, y = 10 }
        datasource = { type = "grafana-athena-datasource", uid = grafana_data_source.athena.uid }
        fieldConfig = {
          defaults = {
            custom = {
              drawStyle   = "bars"
              fillOpacity = 50
            }
          }
        }
        targets = [{
          rawSQL = <<-EOT
            SELECT
              date_trunc('minute', from_iso8601_timestamp(timestamp)) AS time,
              category,
              COUNT(*) AS count
            FROM user_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            GROUP BY 1, 2
            ORDER BY 1
          EOT
          format = "table"
        }]
      },
      {
        id         = 4
        title      = "Room Activity"
        type       = "table"
        gridPos    = { h = 8, w = 12, x = 0, y = 18 }
        datasource = { type = "grafana-athena-datasource", uid = grafana_data_source.athena.uid }
        targets = [{
          rawSQL = <<-EOT
            SELECT timestamp, event_type, room_id, user_id, game, host
            FROM room_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            ORDER BY timestamp DESC
            LIMIT 50
          EOT
          format = "table"
        }]
      },
      {
        id         = 5
        title      = "Game Activity"
        type       = "table"
        gridPos    = { h = 8, w = 12, x = 12, y = 18 }
        datasource = { type = "grafana-athena-datasource", uid = grafana_data_source.athena.uid }
        targets = [{
          rawSQL = <<-EOT
            SELECT timestamp, event_type, room_id, user_id, game, winner, loser
            FROM game_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            ORDER BY timestamp DESC
            LIMIT 50
          EOT
          format = "table"
        }]
      },
      {
        id         = 6
        title      = "Chat Messages"
        type       = "table"
        gridPos    = { h = 8, w = 24, x = 0, y = 26 }
        datasource = { type = "grafana-athena-datasource", uid = grafana_data_source.athena.uid }
        targets = [{
          rawSQL = <<-EOT
            SELECT timestamp, room_id, user_id, role, message
            FROM chat_activity
            WHERE year = CAST(YEAR(CURRENT_DATE) AS VARCHAR)
              AND month = LPAD(CAST(MONTH(CURRENT_DATE) AS VARCHAR), 2, '0')
              AND day = LPAD(CAST(DAY(CURRENT_DATE) AS VARCHAR), 2, '0')
            ORDER BY timestamp DESC
            LIMIT 100
          EOT
          format = "table"
        }]
      }
    ]
  })
}
