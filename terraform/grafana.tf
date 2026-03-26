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

  configuration = jsonencode({
    plugins = {
      pluginAdminEnabled = true
    }
  })

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
    authType       = "default"
    defaultRegion  = var.aws_region
    region         = var.aws_region
    catalog        = "AwsDataCatalog"
    database       = aws_glue_catalog_database.gamehub.name
    workgroup      = aws_athena_workgroup.gamehub.name
    outputLocation = "s3://${aws_s3_bucket.athena_results.id}/results/"
  })
}

# ──────────────── Grafana Dashboard ────────────────

locals {
  athena_conn = {
    region   = var.aws_region
    catalog  = "AwsDataCatalog"
    database = aws_glue_catalog_database.gamehub.name
  }
  athena_ds = { type = "grafana-athena-datasource", uid = grafana_data_source.athena.uid }
}

resource "grafana_dashboard" "gamehub_logs" {
  config_json = jsonencode({
    title       = "GameHub Analytics Dashboard"
    description = "Real-time user analytics & event monitoring for GameHub"
    editable    = true
    time = {
      from = "now-24h"
      to   = "now"
    }
    refresh = "1m"

    # ── Template variables for interactive filtering ──
    templating = {
      list = [
        {
          name    = "date_filter"
          type    = "custom"
          label   = "Date"
          current = { text = "Today", value = "today" }
          options = [
            { text = "Today", value = "today", selected = true }
          ]
          hide = 2
        }
      ]
    }

    panels = [

      # ════════════════════════════════════════════════
      # ROW 0: KPI Stats (top summary cards)
      # ════════════════════════════════════════════════
      {
        id      = 100
        title   = ""
        type    = "row"
        gridPos = { h = 1, w = 24, x = 0, y = 0 }
        panels  = []
      },

      # ── Active Users Today (stat) ──
      {
        id         = 1
        title      = "Active Users Today"
        type       = "stat"
        gridPos    = { h = 4, w = 4, x = 0, y = 1 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            color = { mode = "thresholds" }
            thresholds = {
              steps = [
                { color = "#73BF69", value = null },
                { color = "#FF9830", value = 50 },
                { color = "#F2495C", value = 100 }
              ]
            }
          }
        }
        options = { colorMode = "background", graphMode = "area", textMode = "value" }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT COUNT(DISTINCT user_id) AS active_users
            FROM user_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'login'
          EOT
          format         = 0
        }]
      },

      # ── Total Page Views (stat) ──
      {
        id         = 2
        title      = "Page Views Today"
        type       = "stat"
        gridPos    = { h = 4, w = 4, x = 4, y = 1 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            color = { mode = "thresholds" }
            thresholds = {
              steps = [
                { color = "#73BF69", value = null }
              ]
            }
          }
        }
        options = { colorMode = "background", graphMode = "area", textMode = "value" }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT COUNT(*) AS page_views
            FROM user_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'page_view'
          EOT
          format         = 0
        }]
      },

      # ── Games Played Today (stat) ──
      {
        id         = 3
        title      = "Games Played Today"
        type       = "stat"
        gridPos    = { h = 4, w = 4, x = 8, y = 1 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            color = { mode = "thresholds" }
            thresholds = {
              steps = [
                { color = "#5794F2", value = null }
              ]
            }
          }
        }
        options = { colorMode = "background", graphMode = "area", textMode = "value" }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT COUNT(*) AS games_played
            FROM room_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'game_start'
          EOT
          format         = 0
        }]
      },

      # ── Rooms Created Today (stat) ──
      {
        id         = 4
        title      = "Rooms Created"
        type       = "stat"
        gridPos    = { h = 4, w = 4, x = 12, y = 1 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            color = { mode = "thresholds" }
            thresholds = {
              steps = [
                { color = "#B877D9", value = null }
              ]
            }
          }
        }
        options = { colorMode = "background", graphMode = "area", textMode = "value" }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT COUNT(*) AS rooms_created
            FROM room_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'room_create'
          EOT
          format         = 0
        }]
      },

      # ── Chat Messages Today (stat) ──
      {
        id         = 5
        title      = "Chat Messages"
        type       = "stat"
        gridPos    = { h = 4, w = 4, x = 16, y = 1 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            color = { mode = "thresholds" }
            thresholds = {
              steps = [
                { color = "#FADE2A", value = null }
              ]
            }
          }
        }
        options = { colorMode = "background", graphMode = "area", textMode = "value" }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT COUNT(*) AS chat_messages
            FROM chat_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
          EOT
          format         = 0
        }]
      },

      # ── New Registrations (stat) ──
      {
        id         = 6
        title      = "New Registrations"
        type       = "stat"
        gridPos    = { h = 4, w = 4, x = 20, y = 1 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            color = { mode = "thresholds" }
            thresholds = {
              steps = [
                { color = "#FF9830", value = null }
              ]
            }
          }
        }
        options = { colorMode = "background", graphMode = "area", textMode = "value" }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT COUNT(*) AS registrations
            FROM user_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'register'
          EOT
          format         = 0
        }]
      },

      # ════════════════════════════════════════════════
      # ROW 1: Time-series charts
      # ════════════════════════════════════════════════
      {
        id      = 101
        title   = "Activity Over Time"
        type    = "row"
        gridPos = { h = 1, w = 24, x = 0, y = 5 }
        panels  = []
      },

      # ── Events per Hour (stacked bar - all categories) ──
      {
        id         = 7
        title      = "Events per Hour (by Category)"
        type       = "timeseries"
        gridPos    = { h = 8, w = 12, x = 0, y = 6 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            custom = {
              drawStyle    = "bars"
              fillOpacity  = 80
              stacking     = { mode = "normal", group = "A" }
              barAlignment = 0
            }
          }
        }
        options = { tooltip = { mode = "multi", sort = "desc" } }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT
              date_trunc('hour', from_iso8601_timestamp(timestamp)) AS time,
              category,
              COUNT(*) AS count
            FROM (
              SELECT timestamp, 'user' AS category FROM user_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT timestamp, 'room' FROM room_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT timestamp, 'game' FROM game_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT timestamp, 'chat' FROM chat_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT timestamp, 'friend' FROM friend_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT timestamp, 'spectate' FROM spectate_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
            )
            GROUP BY 1, 2
            ORDER BY 1
          EOT
          format         = 0
        }]
      },

      # ── Logins per Hour (line chart) ──
      {
        id         = 8
        title      = "Logins & Logouts per Hour"
        type       = "timeseries"
        gridPos    = { h = 8, w = 12, x = 12, y = 6 }
        datasource = local.athena_ds
        fieldConfig = {
          defaults = {
            custom = {
              drawStyle   = "line"
              lineWidth   = 2
              fillOpacity = 20
              pointSize   = 5
              showPoints  = "auto"
            }
          }
        }
        options = { tooltip = { mode = "multi" } }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT
              date_trunc('hour', from_iso8601_timestamp(timestamp)) AS time,
              event_type,
              COUNT(*) AS count
            FROM user_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type IN ('login', 'logout', 'register')
            GROUP BY 1, 2
            ORDER BY 1
          EOT
          format         = 0
        }]
      },

      # ════════════════════════════════════════════════
      # ROW 2: Pie / Bar distribution charts
      # ════════════════════════════════════════════════
      {
        id      = 102
        title   = "Distribution Analysis"
        type    = "row"
        gridPos = { h = 1, w = 24, x = 0, y = 14 }
        panels  = []
      },

      # ── Page Views by Page (pie chart) ──
      {
        id         = 9
        title      = "Page Views by Page"
        type       = "piechart"
        gridPos    = { h = 8, w = 8, x = 0, y = 15 }
        datasource = local.athena_ds
        options = {
          legend        = { displayMode = "table", placement = "right", values = ["value", "percent"] }
          pieType       = "donut"
          tooltip       = { mode = "single" }
          reduceOptions = { calcs = ["sum"], fields = "", values = false }
        }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT page, COUNT(*) AS views
            FROM user_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'page_view'
              AND page IS NOT NULL
            GROUP BY page
            ORDER BY views DESC
          EOT
          format         = 0
        }]
      },

      # ── Games Popularity (pie chart) ──
      {
        id         = 10
        title      = "Games Played by Type"
        type       = "piechart"
        gridPos    = { h = 8, w = 8, x = 8, y = 15 }
        datasource = local.athena_ds
        options = {
          legend        = { displayMode = "table", placement = "right", values = ["value", "percent"] }
          pieType       = "donut"
          tooltip       = { mode = "single" }
          reduceOptions = { calcs = ["sum"], fields = "", values = false }
        }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT game, COUNT(*) AS games_started
            FROM room_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'game_start'
              AND game IS NOT NULL
            GROUP BY game
            ORDER BY games_started DESC
          EOT
          format         = 0
        }]
      },

      # ── Room Events Distribution (bar chart) ──
      {
        id         = 11
        title      = "Room Event Types"
        type       = "barchart"
        gridPos    = { h = 8, w = 8, x = 16, y = 15 }
        datasource = local.athena_ds
        options = {
          orientation = "horizontal"
          legend      = { displayMode = "hidden" }
          tooltip     = { mode = "single" }
        }
        fieldConfig = {
          defaults = {
            color = { mode = "palette-classic" }
          }
        }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT event_type, COUNT(*) AS count
            FROM room_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
            GROUP BY event_type
            ORDER BY count DESC
          EOT
          format         = 0
        }]
      },

      # ════════════════════════════════════════════════
      # ROW 3: User-level analysis
      # ════════════════════════════════════════════════
      {
        id      = 103
        title   = "User Analysis"
        type    = "row"
        gridPos = { h = 1, w = 24, x = 0, y = 23 }
        panels  = []
      },

      # ── Top Active Users (bar chart) ──
      {
        id         = 12
        title      = "Top 15 Active Users (by Events)"
        type       = "barchart"
        gridPos    = { h = 8, w = 12, x = 0, y = 24 }
        datasource = local.athena_ds
        options = {
          orientation = "horizontal"
          legend      = { displayMode = "hidden" }
          tooltip     = { mode = "single" }
        }
        fieldConfig = {
          defaults = {
            color = { mode = "palette-classic" }
          }
        }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT user_id, COUNT(*) AS total_events
            FROM (
              SELECT user_id FROM user_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT user_id FROM room_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT user_id FROM game_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
              UNION ALL
              SELECT user_id FROM chat_activity
              WHERE year = YEAR(CURRENT_DATE) AND month = MONTH(CURRENT_DATE) AND day = DAY(CURRENT_DATE)
            )
            WHERE user_id IS NOT NULL AND user_id != ''
            GROUP BY user_id
            ORDER BY total_events DESC
            LIMIT 15
          EOT
          format         = 0
        }]
      },

      # ── Top Winners (bar chart) ──
      {
        id         = 13
        title      = "Top Winners Today"
        type       = "barchart"
        gridPos    = { h = 8, w = 12, x = 12, y = 24 }
        datasource = local.athena_ds
        options = {
          orientation = "horizontal"
          legend      = { displayMode = "hidden" }
          tooltip     = { mode = "single" }
        }
        fieldConfig = {
          defaults = {
            color = { fixedColor = "#73BF69", mode = "fixed" }
          }
        }
        targets = [{
          connectionArgs = local.athena_conn
          rawSQL         = <<-EOT
            SELECT winner, COUNT(*) AS wins
            FROM game_activity
            WHERE year = YEAR(CURRENT_DATE)
              AND month = MONTH(CURRENT_DATE)
              AND day = DAY(CURRENT_DATE)
              AND event_type = 'game_over'
              AND winner IS NOT NULL AND winner != ''
            GROUP BY winner
            ORDER BY wins DESC
            LIMIT 10
          EOT
          format         = 0
        }]
      },

      # ════════════════════════════════════════════════
      # ROW 4: Detailed activity tables
      # ════════════════════════════════════════════════
      {
        id        = 104
        title     = "Recent Activity (Detail)"
        type      = "row"
        gridPos   = { h = 1, w = 24, x = 0, y = 32 }
        collapsed = true
        panels = [

          # ── Recent Logins (table) ──
          {
            id         = 14
            title      = "Recent Logins / Logouts"
            type       = "table"
            gridPos    = { h = 8, w = 12, x = 0, y = 33 }
            datasource = local.athena_ds
            targets = [{
              connectionArgs = local.athena_conn
              rawSQL         = <<-EOT
                SELECT timestamp, event_type, user_id, ip
                FROM user_activity
                WHERE year = YEAR(CURRENT_DATE)
                  AND month = MONTH(CURRENT_DATE)
                  AND day = DAY(CURRENT_DATE)
                  AND event_type IN ('login', 'logout', 'register')
                ORDER BY timestamp DESC
                LIMIT 50
              EOT
              format         = 0
            }]
          },

          # ── Recent Page Views (table) ──
          {
            id         = 15
            title      = "Recent Page Views"
            type       = "table"
            gridPos    = { h = 8, w = 12, x = 12, y = 33 }
            datasource = local.athena_ds
            targets = [{
              connectionArgs = local.athena_conn
              rawSQL         = <<-EOT
                SELECT timestamp, user_id, page, game, room_id
                FROM user_activity
                WHERE year = YEAR(CURRENT_DATE)
                  AND month = MONTH(CURRENT_DATE)
                  AND day = DAY(CURRENT_DATE)
                  AND event_type = 'page_view'
                ORDER BY timestamp DESC
                LIMIT 50
              EOT
              format         = 0
            }]
          },

          # ── Room Activity (table) ──
          {
            id         = 16
            title      = "Room Activity Stream"
            type       = "table"
            gridPos    = { h = 8, w = 12, x = 0, y = 41 }
            datasource = local.athena_ds
            targets = [{
              connectionArgs = local.athena_conn
              rawSQL         = <<-EOT
                SELECT timestamp, event_type, room_id, user_id, game, host, reason
                FROM room_activity
                WHERE year = YEAR(CURRENT_DATE)
                  AND month = MONTH(CURRENT_DATE)
                  AND day = DAY(CURRENT_DATE)
                ORDER BY timestamp DESC
                LIMIT 50
              EOT
              format         = 0
            }]
          },

          # ── Game Results (table) ──
          {
            id         = 17
            title      = "Game Results"
            type       = "table"
            gridPos    = { h = 8, w = 12, x = 12, y = 41 }
            datasource = local.athena_ds
            targets = [{
              connectionArgs = local.athena_conn
              rawSQL         = <<-EOT
                SELECT timestamp, event_type, room_id, game, user_id, winner, loser
                FROM game_activity
                WHERE year = YEAR(CURRENT_DATE)
                  AND month = MONTH(CURRENT_DATE)
                  AND day = DAY(CURRENT_DATE)
                ORDER BY timestamp DESC
                LIMIT 50
              EOT
              format         = 0
            }]
          },

          # ── Chat Messages (table) ──
          {
            id         = 18
            title      = "Chat Messages"
            type       = "table"
            gridPos    = { h = 8, w = 24, x = 0, y = 49 }
            datasource = local.athena_ds
            targets = [{
              connectionArgs = local.athena_conn
              rawSQL         = <<-EOT
                SELECT timestamp, room_id, user_id, role, message
                FROM chat_activity
                WHERE year = YEAR(CURRENT_DATE)
                  AND month = MONTH(CURRENT_DATE)
                  AND day = DAY(CURRENT_DATE)
                ORDER BY timestamp DESC
                LIMIT 100
              EOT
              format         = 0
            }]
          }
        ]
      }
    ]
  })
}
