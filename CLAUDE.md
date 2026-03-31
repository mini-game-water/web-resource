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

**Backend (`app.py`)**: Flask + Flask-SocketIO (async_mode=`gevent`). Routes: auth (`/login`, `/register`, `/logout`), pages (`/`, `/tetris`, `/omok`, `/chess`, `/yacht`, `/poker`, `/rummikub`, `/bang`, `/splendor`, `/halligalli`, `/room/<id>`), REST API (`/api/rooms`, `/api/rooms/<id>/join`, `/api/friends/request`, `/api/friends/accept`, `/api/friends/reject`, `/api/friends/pending`, `/api/notices`, `/api/dms/*`). SocketIO events handle lobby presence, waiting room coordination, friend invites, DM delivery, and real-time game moves.

**CSRF/CORS**: `WTF_CSRF_CHECK_DEFAULT = False` with manual `csrf.protect()` in `before_request` that skips `/socket.io` paths. SocketIO uses `cors_allowed_origins='*'` for ALB compatibility.

**Data layer (`db.py`)**: DynamoDB via boto3. Four tables:
- `gamehub-users` — PK: `user_id`. Fields: `pw`, `score`, `logged_in`, `public_ip`, `friends` (list), `status`. All access by user_id; friends use `BatchGetItem`.
- `gamehub-rooms` — PK: `room_id`. GSI `status-index` (PK: `status`, SK: `created_at`) for listing waiting rooms. TTL auto-deletes rooms after 1 hour.
- `gamehub-notices` — PK: `notice_id`. Admin-managed notice board.
- `gamehub-dms` — PK: `conversation_id` (sorted hash of user pair, e.g. `alice#bob`), SK: `timestamp`. GSI `recipient-index` (PK: `recipient_id`, SK: `timestamp`) for unread queries. Fields: `sender_id`, `recipient_id`, `message`, `read`.

**Auth**: Flask session-based. `login_required` decorator on all game/page routes. Public IP tracked on login for "nearby friend" detection.

**Frontend**: Each game lives on its own HTML page with a dedicated JS file:
- `static/js/tetris.js` — 10x20 grid, 7 tetrominoes, scoring/levels, next-piece preview, hold piece, lock delay, seeded RNG for multiplayer sync, garbage/attack system
- `static/js/omok.js` — 15x15 board, two-player (Black vs White), 5-in-a-row win detection
- `static/js/chess.js` — full piece rules, castling, en passant, check/checkmate/stalemate, move history, board flipping for black player
- `static/js/yacht.js` — Yahtzee-style dice game
- `static/js/poker.js` — Texas Hold'em style poker (multi-player, host-driven game loop)
- `static/js/rummikub.js` — Tile-based set/run game
- `static/js/bang.js` — Card game with roles (Sheriff, Outlaw, etc.)
- `static/js/splendor.js` — Gem/card engine-building game
- `static/js/halligalli.js` — Real-time bell-ringing card game

All games render to `<canvas>` elements. Each JS file is wrapped in an IIFE (`(() => { ... })()`) and supports both solo and multiplayer modes. Multiplayer is activated when the template sets `ROOM_ID`, `MY_USER`, `MY_PLAYER` globals; the JS files check `typeof ROOM_ID !== 'undefined'` to switch behavior. There is no bundler or build step — JS and CSS are served as-is.

**Font**: Pretendard (self-hosted `.woff2` in `static/fonts/`). CSS font stack: `'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', ...` for Mac/Windows/Linux compatibility.

**Multiplayer flow**: Create room (index modal, auto-generates `[Color] [Fruit]` default name) → waiting room (`/room/<id>`, SocketIO-based) → optionally invite friends (SocketIO `invite_friend`/`invite_response` events) → auto-redirect to game when enough players connect → real-time play via SocketIO events (`game_move`, `tetris_state`, `game_over_event`).

**Solo mode with invite receivability**: All 9 game templates load SocketIO in solo mode too. The `join_solo` event adds the user to `lobby_sids` without changing status, so friends can send invites. Solo mode shows an invite popup overlay; accepting redirects to the room page.

**Disconnect handling**: When a player disconnects and only 1 remains, server emits `game_winner` to the remaining player and calls `destroy_game_room()`. All 9 game JS files handle `game_winner` to show a win overlay.

**Real-time lobby**: The index page connects to a `lobby` SocketIO room. Server broadcasts `rooms_updated` whenever rooms change and `friend_status_changed` on login/logout. Server tracks connected users via `lobby_sids` dict for delivering invites. `on_join_waiting` also calls `broadcast_rooms()` for reliable SocketIO-context broadcast.

**Templates**: All pages share a common navbar. Game pages use an overlay pattern (`.overlay` div) for game-over/win states. UI text is in Korean (`lang="ko"`). Chat and game-help panels start minimized on game entry.

**In-game chat**: All 9 multiplayer game pages include a draggable, resizable chat box (NW-resize handle on top-left corner). Chat uses SocketIO `game_chat` events. Korean IME composition handled with `!e.isComposing` check.

**Styling (`static/css/style.css`)**: Single shared stylesheet. Light beige theme (`#faf6f0` background) with beige accents (`#a38b6d`, `#c4aa82`). Includes styles for login, friends sidebar, room list, waiting room, game layouts, and chat.

## Key Conventions

- All UI text is in Korean (`lang="ko"`). Keep new user-facing strings in Korean.
- SocketIO ephemeral state (`sid_info`, `waiting_conns`, `game_conns`, `lobby_sids`) is in-memory only — not persisted, resets on server restart. Rooms and users are in DynamoDB.
- Game JS files detect multiplayer mode by checking `typeof ROOM_ID !== 'undefined'` — templates set `ROOM_ID`, `MY_USER`, `MY_PLAYER` as global variables when a room context exists.
- **Always null-check DOM elements** before calling `.addEventListener()` in game JS files. Elements inside `{% if %}` / `{% else %}` template blocks may not exist in all modes (solo vs multiplayer vs spectator).
- The `_game_route()` helper in `app.py` handles the common pattern for all game routes. It sets `'practicing'` status for solo, `'ingame'` for multiplayer, `'spectating'` for spectators.
- DynamoDB room items use `room_id` as the key (not `id`). Templates reference `room.room_id`.
- Game-over overlay variable names differ per game: bang/halligalli use `gameOverOverlay`, others use `overlay`. All use `gameOverMsg` for the message element.
- Room navigation uses `window.location.replace()` (not `.href`) to avoid polluting browser history.
- Environment variables: `AWS_REGION`, `USERS_TABLE`, `ROOMS_TABLE`, `NOTICES_TABLE`, `DMS_TABLE`, `SECRET_KEY`, `LOG_BUCKET`, `LOG_FLUSH_INTERVAL`.
- Sound/animation guard pattern: Always use `if (typeof GameSounds !== 'undefined') GameSounds.play('name');` and `if (typeof GameAnimations !== 'undefined') GameAnimations.method();` to avoid errors if scripts aren't loaded.
- **User status states**: `online`, `chilling`, `waiting`, `ingame`, `spectating`, `practicing`, `offline`. Status is set in HTTP routes (`room_page` → `waiting`, `_game_route` → `ingame`/`spectating`/`practicing`) and SocketIO handlers (`join_lobby` → `online`, `join_solo` → no change, visibility change → `chilling`).
- **Status transition safety**: Lobby disconnect checks DB status before setting `offline` — skips if already `waiting`/`ingame`/`spectating`/`practicing` (user is navigating, not leaving). Solo disconnect restores `online` if status was `practicing`. Waiting disconnect sets `online` optimistically when room was still `waiting`.
- `broadcast_friend_status` is called from both HTTP routes (for immediate status broadcast) and SocketIO handlers. The key rule: **lobby disconnect must NOT blindly set `offline`** — always check current DB status first.

## Tetris Multiplayer Features

- **Seeded RNG**: Server sends a random seed via `game_ready` event. All players use a Linear Congruential Generator (LCG) with the same seed, ensuring identical piece sequences.
- **Hold piece**: Press Shift to swap current piece with hold slot. Can only hold once per piece drop. UI: `#hold-piece` canvas in left panel.
- **Lock delay**: 5-tick grace period after a piece lands. Player can still move/rotate during this window (enables T-spins). Resets on successful move. `LOCK_DELAY_MAX=5`, `lockDelayCounter`, `isLanding` variables.
- **Attack/garbage system**: Clearing N lines sends (N-1) garbage rows to a random opponent. Garbage rows have 1 random hole column. Server handler: `tetris_attack` event → `tetris_garbage` event to target. `GARBAGE_COLOR = "#888888"`, block type = 8.
- **Opponent panels on the right**: `.tetris-main-layout` flex container wraps both `.tetris-wrapper` and `.opponents-grid` side-by-side. Opponents stack vertically in a column layout.

## Solo Mode & Invite Receivability

- All 9 game templates load `socket.io.min.js` in BOTH solo and multiplayer modes.
- Solo mode emits `join_solo` event (NOT `join_lobby`) to avoid overwriting `practicing` status.
- `join_solo` handler: joins `lobby` room, adds to `lobby_sids`, sets context to `'solo'` in `sid_info`. Does NOT change DB status (already set to `practicing` by `_game_route`).
- Solo templates include `#solo-invite-overlay` popup with 10-second countdown timer.
- `invite_response` emit from solo mode MUST include `user_id` field — server's `on_invite_response` reads `data['user_id']`.
- On invite accept, `invite_accepted` event triggers `window.location.replace('/room/' + data.room_id)`.
- Solo disconnect: if status is `practicing`, restore to `online` and broadcast.

## Infrastructure (Terraform)

All infrastructure is defined in `terraform/`. Resources: VPC (2 public subnets), ALB (HTTPS with ACM cert, HTTP→HTTPS redirect, sticky sessions, `/grafana/*` path routing to port 3000), EC2 (Amazon Linux 2023 + Docker + Grafana OSS), DynamoDB (4 tables: users, rooms, notices, dms), Route53 (A record → ALB), ACM (DNS-validated cert), IAM (EC2 instance profile with DynamoDB + Athena/Glue access), Glue catalog (7 tables for log categories). Grafana OSS is self-hosted on EC2 (installed via `user_data.sh`), accessible at `https://domain/grafana/`.

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars  # Fill in domain_name, route53_zone_id, app_secret_key, grafana_admin_password
terraform init
terraform plan
terraform apply
```

Domain: `jeonmyeonghwan-security.cloud` (Route53 hosted zone). Region: `us-east-1`.

**Deploy automation**: `terraform/deploy-terraform.ps1` — PowerShell script that runs `terraform plan -out tfplan`, `terraform apply tfplan`, and extracts the PEM key to `C:\Users\ab550\OneDrive\Desktop\aws_keys\gamehub-ec2-key.pem`.

## Deployment

GitHub repo: `https://github.com/mini-game-water/web-resource.git`. Deploy via `deploy.sh` on EC2 — clones repo, builds Docker image, runs container with env vars. `user_data.sh` embeds `deploy.sh` into `/home/ec2-user/deploy.sh` at EC2 provisioning time.

## Logging & Observability

**Structured event logging** pipeline: App → S3 (gzipped NDJSON) → Athena (SQL) → Grafana (dashboards).

**Logger (`game_logger.py`)**: Buffers JSON events in memory per category, flushes to S3 every `LOG_FLUSH_INTERVAL` seconds (default 60). Falls back to stdout if `LOG_BUCKET` is not set. Best-effort — never crashes the app on logging failure.

**S3 storage structure**: `s3://{LOG_BUCKET}/{category}/year=YYYY/month=MM/day=DD/{category}-{suffix}.json.gz`

**7 log categories** with their event types:

| Category | Event Types | Key Fields |
|----------|------------|------------|
| `user_activity` | `login`, `logout`, `register`, `status_change`, `profile_update`, `page_view` | `user_id`, `ip`, `page`, `game`, `user_agent`, `referrer` |
| `room_activity` | `room_create`, `room_join`, `room_leave`, `room_delete`, `game_start`, `host_transfer`, `poker_mid_join` | `room_id`, `user_id`, `host`, `game`, `max_players`, `reason` |
| `game_activity` | `game_move`, `game_over`, `player_eliminated`, `tetris_state`, `poker_hand`, `player_join_game` | `room_id`, `user_id`, `game`, `winner`, `loser`, `scores`, `move_data` |
| `chat_activity` | `chat_message` | `room_id`, `user_id`, `role`, `message` |
| `friend_activity` | `friend_add`, `invite_sent`, `invite_response` | `user_id`, `friend_id`, `room_id`, `inviter`, `invitee`, `accepted` |
| `spectate_activity` | `spectate_join`, `spectate_leave`, `coaching_suggest`, `coaching_clear` | `room_id`, `user_id`, `game` |
| `dm_activity` | `dm_sent` | `sender_id`, `recipient_id`, `conversation_id`, `message` |

## Sound & Animation System

**Sounds (`static/js/sounds.js`)**: Web Audio API-based procedural sound generation. 12 sounds: `click`, `place`, `capture`, `flip`, `roll`, `bell`, `win`, `lose`, `check`, `chip`, `buzz`, `tick`. Mute state persisted to `localStorage('gamehub_muted')`. Mute toggle button (`.sound-toggle-btn`) on all 9 game pages.

**Animations (`static/css/animations.css` + `static/js/animations.js`)**: CSS keyframe animations triggered via JS. Effects: `showConfetti()` (win), `showShake(el)` (lose/damage), `showFlash(el)`, `showRipple(el, x, y)`, `showGlow(el)`, `showSparkle(el, color)`, `showDamage(el)`, `bounceIn(el)`. All use `pointer-events: none` overlays.

## Direct Messaging (DM)

**Backend**: REST API (`/api/dms/send`, `/api/dms/<friend_id>`, `/api/dms/<friend_id>/read`, `/api/dms/unread`). Real-time delivery via `lobby_sids` dict — if recipient is online, `dm_received` SocketIO event is emitted directly to their SID.

**Frontend**: Fixed bottom-right panel (`.dm-panel`), CSS `resize: both` for user resizing, only one DM conversation open at a time (reuses same element by id `dm-panel`). Unread badges (`.dm-unread-badge[data-dm-uid]`) on friend list items, loaded on page load via `/api/dms/unread`.

**Conversation ID**: `'#'.join(sorted([user1, user2]))` — deterministic, order-independent key for 1:1 conversations.

## Notice Board

**List view**: Shows title only + "열기" button per notice. Full content stored in `data-content`, `data-image`, `data-author`, `data-time` attributes on `.notice-item`. Clicking "열기" opens `openNotice()` popup (`.notice-view-overlay`).

**Admin editing**: `editNotice()` reads from `item.dataset.content` / `item.dataset.image` (NOT from DOM child elements like `.notice-body`). When adding/removing DOM elements from notice items, always update `editNotice()` and `renderNotice()` to match.

## Known Pitfalls & Checklists

### Frontend (Game JS files)

- **Always null-check DOM elements** before `.addEventListener()`. Elements inside `{% if %}` / `{% else %}` Jinja blocks don't exist in all modes. Calling `.addEventListener()` on `null` crashes the entire IIFE and silently kills SocketIO.
- **Korean IME duplicate send on Mac**: The `keydown` event for Enter fires twice during IME composition. ALL chat input handlers (10 total: 9 game chat + 1 DM) MUST check `!e.isComposing` before processing Enter key: `if (e.key === 'Enter' && !e.isComposing)`. Without this, Korean messages send twice on Mac.
- **Chat/help panels start minimized**: Game chat has `class="game-chat minimized"` and button text `+`. Game help body uses CSS `display: none` (NOT inline style). Help toggle must use `getComputedStyle(body).display === 'none'` to check state (NOT `body.style.display`), and set `body.style.display = 'block'` to open (NOT `''`, which falls back to CSS `display: none`).
- **Chat resize math for NW-resize**: `newW = startW + (startX - e.clientX)`, NOT `startW + (e.clientX - startX)`. Must also adjust `left`/`top` position.
- **Use `window.location.replace()` not `.href`** for game redirects to avoid polluting browser history.
- **Game-over overlay variable names differ per game**: bang/halligalli use `gameOverOverlay`, others use `overlay`. All use `gameOverMsg`.
- **All 9 games must handle the `game_winner` socket event** — server emits it when only 1 player remains after disconnect.
- **CSRF token on ALL fetch calls**: Every `fetch()` with method POST/PUT/DELETE MUST include `headers: {'X-CSRFToken': CSRF_TOKEN}`. For `FormData` uploads (multipart), add ONLY the `X-CSRFToken` header — do NOT set `Content-Type` (browser sets it with boundary automatically).
- **No duplicate global variable declarations**: `index.html` defines `MY_USER`, `CSRF_TOKEN`, `IS_ADMIN` once at the top of `<script>`. Never redeclare them (e.g., `MY_UID` duplicating `MY_USER`). Same for utility functions like `escapeHtml` — define once, reuse everywhere.
- **When removing DOM elements, update ALL JS readers**: If a `.notice-body` div is removed from notice items, every JS function that reads from it (e.g., `editNotice`, `renderNotice`, socket handlers) must switch to the new data source (e.g., `dataset.content`). Search the entire file for the old selector before committing.
- **Solo invite overlay uses different IDs**: Solo mode uses `solo-invite-overlay`, `solo-invite-inviter`, `solo-invite-room-name`, `solo-invite-game`, `solo-invite-timer` — NOT the same IDs as spectator invite overlay. Don't accidentally create ID conflicts.

### Backend (app.py / SocketIO)

- **CSRF does NOT apply to SocketIO**: `WTF_CSRF_CHECK_DEFAULT = False` + manual `csrf.protect()` skipping `/socket.io` is the correct pattern.
- **`cors_allowed_origins='*'`** is required on SocketIO init when behind ALB/reverse proxy.
- **Disconnect handler must check `game_conns` count**: When 1 player remains, emit `game_winner` and call `destroy_game_room()`.
- **Lobby disconnect must check DB status before setting offline**: When a user navigates from index to room/game, the lobby socket disconnects. The handler must read `db.get_user(uid).status` and skip setting `offline` if already `waiting`/`ingame`/`spectating`/`practicing`. Otherwise, friends see a brief offline flicker.
- **Solo disconnect must restore `online` status**: When context is `'solo'` and current DB status is `'practicing'`, the disconnect handler sets status to `'online'`. This is separate from the lobby disconnect logic — use `if info['context'] == 'solo'` first, then `else` for lobby context.
- **`join_solo` must NOT update DB status**: The `_game_route()` HTTP handler already set `'practicing'` before the page rendered. `join_solo` only adds to `lobby_sids` and `sid_info`. If it called `db.update_user_status('online')`, it would overwrite `'practicing'`.
- **`join_lobby` MUST update DB status**: Unlike `join_solo`, the `join_lobby` handler sets `db.update_user_status(uid, 'online')`. This was a critical bug fix — without it, users showed as offline because the DB status was stale from a previous session.
- **`on_join_waiting` must call `broadcast_rooms()`**: Room list updates emitted from HTTP context (`create_room` endpoint) may not reliably reach lobby clients. Adding `broadcast_rooms()` in the SocketIO handler `on_join_waiting` ensures a reliable SocketIO-context broadcast when the room creator enters the waiting room.
- **`lobby_sids` must be updated in `on_join_waiting`**: When a user navigates from index to waiting room, the lobby socket disconnects and a new socket connects. The `on_join_waiting` handler MUST set `lobby_sids[uid] = request.sid` so invites can be delivered to the waiting room socket. Without this, invite delivery fails silently.
- **Set user status in HTTP routes before page render**: `room_page()` sets `waiting`, `_game_route()` sets `ingame`/`spectating`/`practicing` — this ensures DB status is correct before the lobby socket disconnects.
- **`invite_response` event must include `user_id` field**: The server handler `on_invite_response` reads `data['user_id']`. All client-side emits (game templates, solo invite code) MUST include this field. Missing it causes a KeyError on the server.
- **New DynamoDB tables/env vars must be added in 4 places**: `db.py` (table ref), `terraform/dynamodb.tf` (table resource), `terraform/iam.tf` (ARN + index ARN in policy), `terraform/user_data.sh` (env var in both `docker run` blocks).
- **Valid user statuses**: The `on_user_status` handler validates against `('online', 'chilling', 'ingame', 'spectating', 'waiting', 'practicing')`. When adding a new status, update this tuple, the disconnect handler status checks, `index.html` labels/filter, and CSS dot colors.

### Templates (HTML)

- **AdSense script must be in `<head>` of ALL 13 templates** for site verification — including `login.html` and `room_not_found.html`.
- **Ad containers must not be inside flex layouts** (e.g., `.waiting-layout`). Place ads outside/below.
- **`data-ad-slot` must be a real slot ID** from AdSense dashboard, not `"auto"`.
- **All 9 game templates must load socket.io in BOTH modes**: Socket.io script is loaded inside `{% if room_id %}` for multiplayer AND inside `{% if not room_id %}` for solo mode (with `join_solo`). Never remove the solo-mode socket block.
- **Solo-mode socket block pattern**: Each game template has a `{% if not room_id %}` block that loads socket.io, emits `join_solo`, listens for `invite_received` and `invite_accepted`, and includes the `#solo-invite-overlay` HTML. Changes to this pattern must be applied to ALL 9 templates.

### Infrastructure (Terraform / AWS)

- **Grafana OSS is self-hosted on EC2**, installed via `user_data.sh` (RPM + systemd). Accessible at `https://domain/grafana/` via ALB path-based routing. Default login: `admin` / password from `grafana_admin_password` tfvar.
- **Grafana Athena plugin** is installed via `grafana-cli plugins install grafana-athena-datasource` in `user_data.sh`. Datasource uses EC2 instance profile credentials (`authType: default`).
- **Grafana provisioning files**: Datasource at `/etc/grafana/provisioning/datasources/athena.yaml`, dashboard provider at `/etc/grafana/provisioning/dashboards/gamehub.yaml`, dashboard JSON at `/var/lib/grafana/dashboards/gamehub.json`.
- **Dashboard JSON template** (`grafana_dashboard.json.tftpl`) is uploaded to S3 via `aws_s3_object` and downloaded by `user_data.sh` at boot. This avoids the EC2 user_data 16KB size limit and Terraform double-interpolation of `${filter_*}` Grafana template variables.
- **`user_data.sh` contains Terraform template variables** (`${aws_region}`, `${app_secret_key}`, `${log_bucket}`, `${docker_image}`, `${domain_name}`, `${grafana_admin_password}`, `${athena_database}`, `${athena_workgroup}`, `${athena_results_bucket}`) interpolated at plan/apply time. The embedded `deploy.sh` also uses these — do NOT use single-quoted heredoc (`'EOF'`) if you want variable interpolation.
- **EC2 user_data has 16KB limit**: Do NOT embed large content (like dashboard JSON) directly in `user_data.sh`. Use S3 upload (`aws_s3_object`) + download (`aws s3 cp`) pattern instead. Base64-encoding makes the problem worse, not better.
- **S3 log path structure** must match Glue table partition projection exactly: `{category}/year=YYYY/month=MM/day=DD/`. If `game_logger.py` path format changes, update `storage.location.template` in `athena.tf`.
- **Escape `${...}` in Grafana dashboard SQL as `$${...}`**: In `grafana_dashboard.json.tftpl`, Grafana template variables like `${filter_user_id}` must be written as `$${filter_user_id}` so Terraform passes the literal string through.
- **New log categories require updates in 3 places**: `game_logger.py` (add to `CATEGORIES` list + logging function), `terraform/athena.tf` (Glue catalog table with matching columns), `terraform/grafana_dashboard.json.tftpl` (dashboard panels).
- **Grafana dashboard template variables**: Defined in `templating.list` inside the dashboard JSON. Use `type = "textbox"` for free-text filters. Reference in SQL as `$${variable_name}`. Filter pattern: `('$${filter_x}' = '' OR column = '$${filter_x}')`.
- **AWS Managed Grafana was removed** — it charged $9/user/month. Do NOT add `grafana` provider back to `main.tf`. All Grafana configuration is now via EC2 self-hosting.
- **Migrating from Managed Grafana requires state cleanup**: If Grafana provider resources exist in Terraform state, run `terraform state rm grafana_dashboard.gamehub_logs` and `terraform state rm grafana_data_source.athena` before `terraform init -upgrade`.

### Debugging Multiplayer Issues

- **Check browser console (F12) first** — client-side JS crashes silently prevent SocketIO from connecting, making issues look server-side.
- **Test with regular + incognito windows** to simulate 2 players.
- **Docker logs show NO SocketIO connections** → the problem is client-side (JS crash before socket connects), not server-side.
- **Friend invite not working**: Check that `lobby_sids[uid]` is set. Most common cause: `on_join_waiting` didn't update `lobby_sids` with the new SID after navigation. The fix was adding `lobby_sids[uid] = request.sid` to the handler.
- **Friend status shows offline when online**: Check that `on_join_lobby` calls `db.update_user_status(uid, 'online')`. Without the DB update, subsequent page loads read stale `offline` from DB even though the socket broadcast said `online`.
- **Room list not updating**: Verify `broadcast_rooms()` is called from a SocketIO handler context (e.g., `on_join_waiting`), not just from HTTP routes. HTTP-context `socketio.emit()` may not reliably reach all lobby clients. Also check for DynamoDB GSI eventual consistency on `list_waiting_rooms()`.
- **Korean text sends twice on Mac**: Check that the chat input `keydown` handler has `!e.isComposing`. Mac Korean IME fires Enter `keydown` twice — once during composition (`isComposing=true`) and once after (`isComposing=false`). Without the guard, the message sends on both events.

## Resolved Bugs Reference

These bugs were fixed and documented here to prevent regression:

| Bug | Root Cause | Fix | Files |
|-----|-----------|-----|-------|
| Korean IME duplicate send on Mac | `keydown` Enter fires twice during IME composition | Add `!e.isComposing` check to all 10 chat Enter handlers | All 9 game JS + `index.html` DM input |
| Friend invite fails silently | `lobby_sids` not updated when user moves to waiting room | Add `lobby_sids[uid] = request.sid` in `on_join_waiting` | `app.py` |
| Friend shows offline when online | `on_join_lobby` broadcast status but never updated DB | Add `db.update_user_status(uid, 'online')` in `on_join_lobby` | `app.py` |
| Room list not updating in real-time | `broadcast_rooms()` only called from HTTP context | Add `broadcast_rooms()` in `on_join_waiting` SocketIO handler | `app.py` |
| Help panel toggle broken with CSS | `body.style.display === 'none'` returns false for CSS-set display | Use `getComputedStyle(body).display === 'none'` | All 9 game templates |
| Help panel won't reopen | `body.style.display = ''` falls back to CSS `display: none` | Use `body.style.display = 'block'` explicitly | All 9 game templates |
| Solo disconnect leaves `practicing` status | Disconnect handler didn't handle `'solo'` context separately | Add `info['context'] == 'solo'` branch to restore `'online'` | `app.py` |
| `join_solo` overwrites practicing status | Using `join_lobby` in solo mode sets status to `online` | Created separate `join_solo` handler that doesn't change status | `app.py` |
| Tetris lock delay not reset on soft drop | `ArrowDown` didn't reset `lockDelayCounter` | Add `if (isLanding) { isLanding = false; lockDelayCounter = 0; }` on down move | `tetris.js` |
| Python `COLS` reference in server | `tetris_attack` handler used JS constant `COLS` in Python | Changed to `random.randint(0, 9)` | `app.py` |
| Grafana per-user charges | AWS Managed Grafana charges $9/editor/month | Migrated to self-hosted Grafana OSS on EC2 | `terraform/` |
| EC2 user_data exceeds 16KB | Dashboard JSON embedded in user_data via base64 | Upload to S3 via `aws_s3_object`, download in user_data | `terraform/ec2.tf`, `user_data.sh` |
