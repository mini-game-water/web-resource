# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Game Hub — a Flask web app serving nine browser-based games via a card-based dashboard. Games support both solo play and real-time multiplayer via WebSocket (Flask-SocketIO). Flask handles routing, auth, and room management; all game logic runs client-side in vanilla JavaScript using the Canvas API.

**Games:** Tetris, Omok (Five-in-a-Row), Chess, Yacht, Poker, Rummikub, Bang, Splendor, Halli Galli.

## Running the App

```bash
# Install dependencies
pip install -r requirements.txt

# Development (requires AWS credentials or DynamoDB Local)
python app.py          # Starts Flask+SocketIO dev server on http://localhost:5000

# Production (Docker)
docker build -t gamehub:latest .
docker run -p 5000:5000 \
  -e AWS_REGION=us-east-1 \
  -e USERS_TABLE=gamehub-users \
  -e ROOMS_TABLE=gamehub-rooms \
  -e SECRET_KEY=your-secret \
  gamehub:latest
# Internally runs: gunicorn -k geventwebsocket.gunicorn.workers.GeventWebSocketWorker ...
```

Test accounts: `alice`/`1234`, `bob`/`1234`, `charlie`/`1234` (migrated via `python migrate_users.py`).

No test or lint commands are configured. No build step — JS and CSS are served as static files.

## Architecture

**Backend (`app.py`)**: Flask + Flask-SocketIO (async_mode=`gevent`). Routes: auth (`/login`, `/register`, `/logout`), pages (`/`, `/tetris`, `/omok`, `/chess`, `/yacht`, `/poker`, `/rummikub`, `/bang`, `/splendor`, `/halligalli`, `/room/<id>`), REST API (`/api/rooms`, `/api/rooms/<id>/join`, `/api/friends/add`). SocketIO events handle lobby presence, waiting room coordination, friend invites, and real-time game moves.

**CSRF/CORS**: `WTF_CSRF_CHECK_DEFAULT = False` with manual `csrf.protect()` in `before_request` that skips `/socket.io` paths. SocketIO uses `cors_allowed_origins='*'` for ALB compatibility.

**Data layer (`db.py`)**: DynamoDB via boto3. Two tables:
- `gamehub-users` — PK: `user_id`. Fields: `pw`, `score`, `logged_in`, `public_ip`, `friends` (list). All access by user_id; friends use `BatchGetItem`.
- `gamehub-rooms` — PK: `room_id`. GSI `status-index` (PK: `status`, SK: `created_at`) for listing waiting rooms. TTL auto-deletes rooms after 1 hour.

**Auth**: Flask session-based. `login_required` decorator on all game/page routes. Public IP tracked on login for "nearby friend" detection.

**Frontend**: Each game lives on its own HTML page with a dedicated JS file:
- `static/js/tetris.js` — 10×20 grid, 7 tetrominoes, scoring/levels, next-piece preview
- `static/js/omok.js` — 15×15 board, two-player (Black vs White), 5-in-a-row win detection
- `static/js/chess.js` — full piece rules, castling, en passant, check/checkmate/stalemate, move history, board flipping for black player
- `static/js/yacht.js` — Yahtzee-style dice game
- `static/js/poker.js` — Texas Hold'em style poker (multi-player, host-driven game loop)
- `static/js/rummikub.js` — Tile-based set/run game
- `static/js/bang.js` — Card game with roles (Sheriff, Outlaw, etc.)
- `static/js/splendor.js` — Gem/card engine-building game
- `static/js/halligalli.js` — Real-time bell-ringing card game

All games render to `<canvas>` elements. Each JS file is wrapped in an IIFE (`(() => { ... })()`) and supports both solo and multiplayer modes. Multiplayer is activated when the template sets `ROOM_ID`, `MY_USER`, `MY_PLAYER` globals; the JS files check `typeof ROOM_ID !== 'undefined'` to switch behavior. There is no bundler or build step — JS and CSS are served as-is.

**Multiplayer flow**: Create room (index modal, auto-generates `[Color] [Fruit]` default name) → waiting room (`/room/<id>`, SocketIO-based) → optionally invite friends (SocketIO `invite_friend`/`invite_response` events) → auto-redirect to game when enough players connect → real-time play via SocketIO events (`game_move`, `tetris_state`, `game_over_event`).

**Disconnect handling**: When a player disconnects and only 1 remains, server emits `game_winner` to the remaining player and calls `destroy_game_room()`. All 9 game JS files handle `game_winner` to show a win overlay.

**Real-time lobby**: The index page connects to a `lobby` SocketIO room. Server broadcasts `rooms_updated` whenever rooms change and `friend_status_changed` on login/logout. Server tracks connected users via `lobby_sids` dict for delivering invites.

**Templates**: All pages share a common navbar. Game pages use an overlay pattern (`.overlay` div) for game-over/win states. UI text is in Korean (`lang="ko"`).

**In-game chat**: All 9 multiplayer game pages include a draggable, resizable chat box (NW-resize handle on top-left corner). Chat uses SocketIO `game_chat` events.

**Styling (`static/css/style.css`)**: Single shared stylesheet. Light beige theme (`#faf6f0` background) with beige accents (`#a38b6d`, `#c4aa82`). Includes styles for login, friends sidebar, room list, waiting room, game layouts, and chat.

## Key Conventions

- All UI text is in Korean (`lang="ko"`). Keep new user-facing strings in Korean.
- SocketIO ephemeral state (`sid_info`, `waiting_conns`, `game_conns`, `lobby_sids`) is in-memory only — not persisted, resets on server restart. Rooms and users are in DynamoDB.
- Game JS files detect multiplayer mode by checking `typeof ROOM_ID !== 'undefined'` — templates set `ROOM_ID`, `MY_USER`, `MY_PLAYER` as global variables when a room context exists.
- **Always null-check DOM elements** before calling `.addEventListener()` in game JS files. Elements inside `{% if %}` / `{% else %}` template blocks may not exist in all modes (solo vs multiplayer vs spectator).
- The `_game_route()` helper in `app.py` handles the common pattern for all game routes.
- DynamoDB room items use `room_id` as the key (not `id`). Templates reference `room.room_id`.
- Game-over overlay variable names differ per game: bang/halligalli use `gameOverOverlay`, others use `overlay`. All use `gameOverMsg` for the message element.
- Room navigation uses `window.location.replace()` (not `.href`) to avoid polluting browser history.
- Environment variables: `AWS_REGION`, `USERS_TABLE`, `ROOMS_TABLE`, `SECRET_KEY`, `LOG_BUCKET`, `LOG_FLUSH_INTERVAL`.

## Logging & Observability

**Structured event logging** pipeline: App → S3 (gzipped NDJSON) → Athena (SQL) → Grafana (dashboards).

**Logger (`game_logger.py`)**: Buffers JSON events in memory per category, flushes to S3 every `LOG_FLUSH_INTERVAL` seconds (default 60). Falls back to stdout if `LOG_BUCKET` is not set. Best-effort — never crashes the app on logging failure.

**S3 storage structure**:
```
s3://{LOG_BUCKET}/{category}/year=YYYY/month=MM/day=DD/{category}-{suffix}.json.gz
```

**6 log categories** with their event types and fields:

| Category | Event Types | Key Fields |
|----------|------------|------------|
| `user_activity` | `login`, `logout`, `register`, `status_change`, `profile_update`, `page_view` | `user_id`, `ip`, `page`, `game`, `user_agent`, `referrer` |
| `room_activity` | `room_create`, `room_join`, `room_leave`, `room_delete`, `game_start`, `host_transfer`, `poker_mid_join` | `room_id`, `user_id`, `host`, `game`, `max_players`, `reason` |
| `game_activity` | `game_move`, `game_over`, `player_eliminated`, `tetris_state`, `poker_hand`, `player_join_game` | `room_id`, `user_id`, `game`, `winner`, `loser`, `scores`, `move_data` |
| `chat_activity` | `chat_message` | `room_id`, `user_id`, `role`, `message` |
| `friend_activity` | `friend_add`, `invite_sent`, `invite_response` | `user_id`, `friend_id`, `room_id`, `inviter`, `invitee`, `accepted` |
| `spectate_activity` | `spectate_join`, `spectate_leave`, `coaching_suggest`, `coaching_clear` | `room_id`, `user_id`, `game` |

Every event includes: `event_id` (UUID), `timestamp` (ISO 8601 UTC), `epoch_ms`, `category`, `event_type`.

**Athena** (`terraform/athena.tf`): 6 Glue catalog external tables with partition projection (year/month/day). JsonSerDe with malformed JSON tolerance. Workgroup: `gamehub`.

**Grafana** (`terraform/grafana.tf`): AWS Managed Grafana workspace (`gamehub-grafana`), SSO auth, Athena data source. Dashboard: "GameHub Analytics Dashboard" with 18 panels:
- **Row 0 — KPI Stats**: Active users, page views, games played, rooms created, chat messages, new registrations (stat panels)
- **Row 1 — Time Series**: Events per hour stacked bar chart, logins/logouts line chart
- **Row 2 — Distribution**: Page views by page (donut), games by type (donut), room event types (horizontal bar)
- **Row 3 — User Analysis**: Top 15 active users (bar), top winners (bar)
- **Row 4 — Detail Tables** (collapsed): Recent logins, page views, room activity, game results, chat messages

**S3 lifecycle**: 30 days → STANDARD_IA, 90 days → GLACIER, 365 days → expiration. Athena results expire after 30 days.

**Adding new log events**: Add convenience function in `game_logger.py`, call it from `app.py`, add column to Glue table in `athena.tf` if new fields are introduced, update Grafana dashboard if visualization is needed.

## Infrastructure (Terraform)

All infrastructure is defined in `terraform/`. Resources: VPC (2 public subnets), ALB (HTTPS with ACM cert, HTTP→HTTPS redirect, sticky sessions), EC2 (Amazon Linux 2023 + Docker), DynamoDB (2 tables), Route53 (A record → ALB), ACM (DNS-validated cert), IAM (EC2 instance profile with DynamoDB access).

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars  # Fill in domain_name, route53_zone_id, app_secret_key
terraform init
terraform plan
terraform apply
```

Domain: `jeonmyeonghwan-security.cloud` (Route53 hosted zone). Region: `us-east-1`.

## Deployment

GitHub repo: `https://github.com/mini-game-water/web-resource.git`. Deploy via `deploy.sh` on EC2 — clones repo, builds Docker image, runs container with env vars. `user_data.sh` embeds `deploy.sh` into `/home/ec2-user/deploy.sh` at EC2 provisioning time.

## Known Pitfalls & Checklists

Past bugs and infrastructure issues that have been resolved. Review these before making changes to avoid repeating them.

### Frontend (Game JS files)

- **Always null-check DOM elements** before `.addEventListener()`. Elements inside `{% if %}` / `{% else %}` Jinja blocks (e.g., `restart-btn`, `start-btn`) don't exist in all modes (solo vs multiplayer vs spectator). Calling `.addEventListener()` on `null` crashes the entire IIFE and silently kills SocketIO — making it look like a server bug. The 4 original games had null guards; 5 newer games did not. All 9 now have them.
- **Chat resize math for NW-resize**: The resize handle is on the top-left corner. Correct formula: `newW = startW + (startX - e.clientX)`, NOT `startW + (e.clientX - startX)`. Must also adjust `left`/`top` position to keep bottom-right anchored. bang.js was the only file with wrong math; now fixed.
- **Use `window.location.replace()` not `.href`** for game redirects (e.g., waiting room → game page). `.href` adds the waiting room to browser history, requiring 2 back-button presses to exit.
- **Game-over overlay variable names differ per game**: bang/halligalli use `gameOverOverlay`, others use `overlay`. All use `gameOverMsg`. When adding `game_winner` or similar handlers, use the correct variable for each game.
- **All 9 games must handle the `game_winner` socket event** — server emits it when only 1 player remains after disconnect. Without this handler, the last player gets stuck in an empty room.

### Backend (app.py / SocketIO)

- **CSRF does NOT apply to SocketIO**: Flask-SocketIO's WSGI middleware intercepts `/socket.io/` before Flask's `before_request` fires. `WTF_CSRF_CHECK_DEFAULT = False` + manual `csrf.protect()` skipping `/socket.io` is the correct pattern.
- **`cors_allowed_origins='*'`** is required on the SocketIO init when behind ALB/reverse proxy. Without it, `python-engineio` actively rejects connections with 400 "Not an accepted origin".
- **Disconnect handler must check `game_conns` count**: When `len(game_conns[rid]) == 1` after a disconnect, emit `game_winner` to the remaining player and call `destroy_game_room()`.

### Templates (HTML)

- **AdSense script must be in `<head>` of ALL 13 templates** for site ownership verification — including `login.html` and `room_not_found.html`, not just game pages.
- **Ad containers must not be placed inside flex layouts** (e.g., `.waiting-layout`). This breaks the 2-column layout. Place ads outside/below the flex container.
- **`data-ad-slot` must be a real slot ID** from the AdSense dashboard, not `"auto"`. Placeholder IDs (`1234567890`–`1234567894`) are currently in use and need to be replaced.

### Infrastructure (Terraform / AWS)

- **Grafana `grafana-athena-datasource` plugin must be explicitly installed** in the workspace `configuration` block: `plugins = ["grafana-athena-datasource"]`. Without it, Grafana shows "Datasource was not found" even though the data source resource exists in Terraform state. `data_sources = ["ATHENA"]` only grants IAM permissions — it does NOT install the plugin.
- **Grafana API key has 30-day TTL** (`aws_grafana_workspace_api_key`). If `terraform apply` fails with auth errors on Grafana resources, the key has expired. Taint and recreate: `terraform taint aws_grafana_workspace_api_key.terraform && terraform apply`.
- **After taining a Grafana data source**, the dashboard must also be re-applied since it references the data source UID. Always target both: `terraform apply -target=grafana_data_source.athena -target=grafana_dashboard.gamehub_logs`.
- **`user_data.sh` contains Terraform template variables** (`${aws_region}`, `${app_secret_key}`, `${log_bucket}`, `${docker_image}`) that are interpolated at plan/apply time. The embedded `deploy.sh` inside it also uses these variables — do NOT use heredoc with single-quoted delimiter (`'EOF'`) for the deploy script section if you want variable interpolation inside it.
- **S3 log path structure** must match Glue table partition projection exactly: `{category}/year=YYYY/month=MM/day=DD/`. If `game_logger.py` path format changes, update `storage.location.template` in `athena.tf` to match.

### Debugging Multiplayer Issues

- **Check browser console (F12) first** — client-side JS crashes silently prevent SocketIO from connecting, making issues look server-side. `TypeError: Cannot read properties of null` is the most common culprit.
- **Test with regular + incognito windows** to simulate 2 players.
- **Docker logs show NO SocketIO connections** → the problem is client-side (JS crash before socket connects), not server-side.
