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
- Environment variables: `AWS_REGION`, `USERS_TABLE`, `ROOMS_TABLE`, `SECRET_KEY`.

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

GitHub repo: `https://github.com/mini-game-water/web-resource.git`. Deploy via `deploy.sh` on EC2 — clones repo, builds Docker image, runs container with env vars.
