# Game Hub Feature Additions — Design Spec

## Context
Game Hub needs UX improvements: omok gameplay enhancements, a richer user status system, and filtering for rooms/friends lists.

## 1. Omok — Last Move Red Dot Indicator
- Track each player's last move in `lastMoves = {1: null, 2: null}`
- After placing a stone, update `lastMoves[player] = {row, col}`
- In `drawBoard()`, after drawing all stones, overlay a red circle (`#ff0000`, radius `CELL * 0.12`) on each non-null `lastMoves` entry
- Multiplayer: update `lastMoves` on both local placement and `opponent_move` receipt

## 2. Omok — 45-Second Turn Timer with Random Placement on Timeout
- Display remaining seconds in the status text area (e.g., "Black's Turn (●) — 32초")
- On each turn start: `turnTimer = 45`, decrement via `setInterval(1000ms)`
- On stone placement: clear interval, reset timer for next turn
- On timeout (0초): select a random empty cell, place stone there, emit `game_move` if multiplayer
- Timer resets on turn change (including after random placement)
- Solo mode: timer runs for both players locally
- Multiplayer: each client runs its own timer for the current player's turn

## 3. User Status System (4 States)

### States
| Status | Condition | Dot Color | Korean |
|--------|-----------|-----------|--------|
| `online` | Logged in, browser focused | Green `#5cb85c` | 온라인 |
| `chilling` | Logged in, browser unfocused/tab hidden | Orange `#f0ad4e` | 쉬는 중 |
| `ingame` | In a game page | Red `#d9534f` | 게임중 |
| `offline` | Logged out | Gray `#ccc` | 오프라인 |

### Data Changes
- **`db.py`**: Replace `logged_in` (bool) field with `status` (string) field
  - `update_user_login()` → sets `status = 'online'`
  - `update_user_logout()` → sets `status = 'offline'`
  - New: `update_user_status(user_id, status)` — sets status to any valid value
  - `batch_get_users()` ProjectionExpression: replace `logged_in` with `status`

### Frontend Detection
- **Index page (`index.html`)**: Listen to `visibilitychange` and `focus`/`blur` events
  - Tab visible + focused → emit `user_status {status: 'online'}`
  - Tab hidden or blurred → emit `user_status {status: 'chilling'}`
- **Game pages (tetris/omok/chess)**: On page load → emit `user_status {status: 'ingame'}`
  - On `visibilitychange` hidden → emit `opponent_disconnected` to end game, then `user_status {status: 'chilling'}`

### Server-Side
- New SocketIO event handler `on_user_status`: calls `db.update_user_status()`, broadcasts `friend_status_changed` with full status string
- `broadcast_friend_status()` changes: send `status` string instead of `logged_in` bool

## 4. Invite Availability
- Invite button enabled when friend status is `online` or `chilling`
- Disabled (grayed out) when `ingame` or `offline`
- Server-side: `on_invite_friend` checks `lobby_sids` (unchanged — chilling users stay in lobby)

## 5. Game Tab Focus = Disconnect
- When a game page detects `visibilitychange` to hidden:
  - Emit `game_over_event` with `{room_id, loser: MY_USER}` to notify opponent of win
  - Redirect to index page (user stays logged in as `chilling`)
- Opponent sees "상대방이 나갔습니다" overlay → wins

## 6. Room List Filtering (Tab Buttons)
- Add horizontal tabs above room list: `[전체] [Tetris] [Omok] [Chess]`
- Store full room list in JS variable `allRooms`
- On tab click: filter `allRooms` by `game` field, re-render list
- On `rooms_updated` SocketIO event: update `allRooms`, re-apply active filter
- CSS: active tab gets `background: #a38b6d; color: white`, others `background: #e6ddd3`

## 7. Friend List Filtering (Dropdown Select)
- Add `<select>` above friend list: 전체 / 온라인 / 쉬는 중 / 게임중 / 오프라인 / 근처
- On change: toggle `.friend-item` visibility via `display: none/flex`
- Filter by `data-status` attribute on each `.friend-item`
- "근처" filters by `data-nearby="true"` attribute

## Files to Modify
- `db.py` — status field changes, new `update_user_status()`
- `app.py` — new SocketIO handler, updated broadcast, status in routes
- `static/js/omok.js` — red dot, timer, random placement, tab focus detection
- `static/js/tetris.js` — tab focus detection (game forfeit)
- `static/js/chess.js` — tab focus detection (game forfeit)
- `templates/index.html` — status UI, room filter tabs, friend filter dropdown, visibility detection
- `templates/room.html` — invite button logic update
- `static/css/style.css` — new status colors, filter tab styles, dropdown styles
