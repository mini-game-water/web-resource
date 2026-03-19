# Game Hub Feature Additions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add omok gameplay enhancements (red dot + 45s timer), 4-state user status system, room/friend filtering, and game-tab-focus forfeit.

**Architecture:** Changes span backend (db.py status field migration, app.py new SocketIO events), and frontend (omok.js timer/dots, index.html filtering/status UI, all game JS files for tab-focus detection). No new files created — all modifications to existing files.

**Tech Stack:** Python/Flask/SocketIO, DynamoDB (boto3), vanilla JS, Canvas API, CSS

**Spec:** `docs/superpowers/specs/2026-03-19-game-features-design.md`

---

### Task 1: User Status System — Backend (`db.py` + `app.py`)

**Files:**
- Modify: `db.py:36-68,91-103`
- Modify: `app.py:47-50,55-91,96-117,120-138,220-349`

- [ ] **Step 1: Update `db.py` — replace `logged_in` with `status` field**

In `create_user()` (line 43), change `'logged_in': False` → `'status': 'offline'`.

In `update_user_login()` (lines 56-61), change to set `status = 'online'` instead of `logged_in = True`:
```python
def update_user_login(user_id, public_ip):
    _users_table.update_item(
        Key={'user_id': user_id},
        UpdateExpression='SET #s = :status, public_ip = :ip',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': 'online', ':ip': public_ip},
    )
```

In `update_user_logout()` (lines 64-69), change to set `status = 'offline'`:
```python
def update_user_logout(user_id):
    _users_table.update_item(
        Key={'user_id': user_id},
        UpdateExpression='SET #s = :status, public_ip = :empty',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': 'offline', ':empty': ''},
    )
```

Add new function after `update_user_logout`:
```python
def update_user_status(user_id, status):
    _users_table.update_item(
        Key={'user_id': user_id},
        UpdateExpression='SET #s = :status',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': status},
    )
```

In `batch_get_users()` (line 103), change ProjectionExpression from `'user_id, score, logged_in, public_ip'` to `'user_id, score, #s, public_ip'` and add `ExpressionAttributeNames={'#s': 'status'}`:
```python
resp = _dynamodb.batch_get_item(
    RequestItems={
        _users_table.name: {
            'Keys': batch,
            'ProjectionExpression': 'user_id, score, #s, public_ip',
            'ExpressionAttributeNames': {'#s': 'status'},
        }
    }
)
```

- [ ] **Step 2: Update `app.py` — broadcast and routes to use `status` string**

Change `broadcast_friend_status()` (lines 47-50):
```python
def broadcast_friend_status(user_id, status):
    socketio.emit('friend_status_changed', {
        'id': user_id, 'status': status
    }, room='lobby')
```

Update all callers:
- Login (line 67): `broadcast_friend_status(uid, 'online')`
- Logout (line 90): `broadcast_friend_status(uid, 'offline')`

Update `index()` route (lines 106-114) — replace `logged_in` with `status`:
```python
    for fid in friend_ids:
        f = friends_data.get(fid)
        if f:
            friends.append({
                'id': fid,
                'score': f.get('score', 0),
                'status': f.get('status', 'offline'),
                'nearby': bool(my_ip and f.get('public_ip') == my_ip)
            })
```

Update `room_page()` route (lines 130-137) — replace `logged_in` with `status`:
```python
            friends.append({
                'id': fid,
                'status': f.get('status', 'offline')
            })
```

- [ ] **Step 3: Add `user_status` SocketIO event handler in `app.py`**

Add after `on_join_lobby` (after line 227):
```python
@socketio.on('user_status')
def on_user_status(data):
    uid = data.get('user_id')
    status = data.get('status')
    if uid and status in ('online', 'chilling', 'ingame'):
        db.update_user_status(uid, status)
        broadcast_friend_status(uid, status)
```

- [ ] **Step 4: Commit**
```bash
git add db.py app.py
git commit -m "feat: replace logged_in bool with 4-state status system (online/chilling/ingame/offline)"
```

---

### Task 2: User Status — Frontend (`index.html` + CSS)

**Files:**
- Modify: `templates/index.html:68-92,146-185`
- Modify: `static/css/style.css:286-299`

- [ ] **Step 1: Update friend items in `index.html` to use `status`**

Replace lines 74-91 (friend list HTML):
```html
            <div class="friend-list" id="friend-list">
                {% for f in friends %}
                <div class="friend-item status-{{ f.status }}" data-uid="{{ f.id }}" data-status="{{ f.status }}" data-nearby="{{ 'true' if f.nearby else 'false' }}">
                    <div class="friend-status-dot"></div>
                    <div class="friend-info">
                        <span class="friend-name">{{ f.id }}</span>
                        <span class="friend-score">점수: {{ f.score }}</span>
                        {% if f.nearby %}
                        <span class="friend-nearby">바로 옆에 있는 친구</span>
                        {% endif %}
                    </div>
                    <span class="friend-status-text">
                        {% if f.status == 'online' %}온라인{% elif f.status == 'chilling' %}쉬는 중{% elif f.status == 'ingame' %}게임중{% else %}오프라인{% endif %}
                    </span>
                </div>
                {% endfor %}
                {% if not friends %}
                <p class="empty-msg">친구가 없습니다.</p>
                {% endif %}
            </div>
```

- [ ] **Step 2: Update real-time `friend_status_changed` handler in `index.html`**

Replace lines 180-185:
```javascript
        socket.on('friend_status_changed', (data) => {
            const el = document.querySelector(`.friend-item[data-uid="${data.id}"]`);
            if (!el) return;
            el.className = 'friend-item status-' + data.status;
            el.dataset.status = data.status;
            const labels = {online: '온라인', chilling: '쉬는 중', ingame: '게임중', offline: '오프라인'};
            el.querySelector('.friend-status-text').textContent = labels[data.status] || '오프라인';
            applyFriendFilter();
        });
```

- [ ] **Step 3: Add visibility detection JS in `index.html`**

Add after `socket.emit('join_lobby', ...)` (after line 150):
```javascript
        // ── Visibility / focus detection ──
        function emitStatus(status) {
            socket.emit('user_status', { user_id: MY_USER, status: status });
        }
        document.addEventListener('visibilitychange', () => {
            emitStatus(document.hidden ? 'chilling' : 'online');
        });
        window.addEventListener('focus', () => emitStatus('online'));
        window.addEventListener('blur', () => emitStatus('chilling'));
```

- [ ] **Step 4: Update CSS status dot colors**

In `style.css`, replace the `.friend-item.online .friend-status-dot` and `.friend-item.offline .friend-status-dot` rules (around lines 286-299) with:
```css
.friend-item.status-online .friend-status-dot { background: #5cb85c; }
.friend-item.status-chilling .friend-status-dot { background: #f0ad4e; }
.friend-item.status-ingame .friend-status-dot { background: #d9534f; }
.friend-item.status-offline .friend-status-dot { background: #ccc; }
```

Also update any other CSS rules that reference `.friend-item.online` or `.friend-item.offline` to use the `status-` prefix.

- [ ] **Step 5: Commit**
```bash
git add templates/index.html static/css/style.css
git commit -m "feat: 4-state status UI with visibility detection on index page"
```

---

### Task 3: Game Tab Focus Forfeit (all 3 games)

**Files:**
- Modify: `static/js/omok.js:148-173`
- Modify: `static/js/tetris.js` (multiplayer section at end)
- Modify: `static/js/chess.js` (multiplayer section at end)

- [ ] **Step 1: Add tab-focus forfeit to `omok.js`**

Add inside the `if (isMultiplayer)` block (after line 151), before `socket.on('game_ready', ...)`:
```javascript
        // Tab focus forfeit
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && !gameOver && gameReady) {
                gameOver = true;
                socket.emit('game_over_event', { room_id: ROOM_ID, loser: MY_USER });
                window.location.href = '/';
            }
        });
```

- [ ] **Step 2: Add tab-focus forfeit to `tetris.js`**

Add the same pattern inside the multiplayer SocketIO block. Find the `if (isMultiplayer)` section and add before `socket.on('game_ready', ...)`:
```javascript
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && !gameOver && gameReady) {
                gameOver = true;
                socket.emit('game_over_event', { room_id: ROOM_ID, loser: MY_USER });
                window.location.href = '/';
            }
        });
```

- [ ] **Step 3: Add tab-focus forfeit to `chess.js`**

Same pattern inside the multiplayer block:
```javascript
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && !gameOver && gameReady) {
                gameOver = true;
                socket.emit('game_over_event', { room_id: ROOM_ID, loser: MY_USER });
                window.location.href = '/';
            }
        });
```

- [ ] **Step 4: Update `app.py` `on_game_over` to handle the `loser` field**

The existing handler (line 269-271) already relays `game_over_event` to the opponent via `opponent_game_over`. The game JS files already handle `opponent_game_over` to show a win message. This should work as-is since `opponent_disconnected` is also already handled. No changes needed here.

- [ ] **Step 5: Commit**
```bash
git add static/js/omok.js static/js/tetris.js static/js/chess.js
git commit -m "feat: game forfeit on tab focus loss in multiplayer"
```

---

### Task 4: Omok — Last Move Red Dot

**Files:**
- Modify: `static/js/omok.js:14,35-77,109-118,161-163`

- [ ] **Step 1: Add `lastMoves` tracking variable**

At line 14, add after variable declarations:
```javascript
    let board, currentPlayer, gameOver;
    let lastMoves = { 1: null, 2: null };
```

In `init()` (line 17-23), add reset:
```javascript
    function init() {
        board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
        currentPlayer = 1;
        gameOver = false;
        lastMoves = { 1: null, 2: null };
        updateStatus();
        draw();
        document.getElementById("win-overlay").classList.remove("active");
    }
```

- [ ] **Step 2: Update `placeStone` to track last move**

In `placeStone()` (line 109-118), add `lastMoves` update:
```javascript
    function placeStone(row, col, player) {
        board[row][col] = player;
        lastMoves[player] = { row, col };
        draw();
        if (checkWin(row, col, player)) {
            handleWin(player);
            return;
        }
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
    }
```

- [ ] **Step 3: Add red dot drawing in `draw()`**

At the end of `draw()`, after the stone-drawing loops (after line 77, before the closing `}`), add:
```javascript
        // Draw red dots on last moves
        for (const p of [1, 2]) {
            if (lastMoves[p]) {
                const lx = PADDING + lastMoves[p].col * CELL;
                const ly = PADDING + lastMoves[p].row * CELL;
                ctx.beginPath();
                ctx.arc(lx, ly, CELL * 0.12, 0, Math.PI * 2);
                ctx.fillStyle = "#ff0000";
                ctx.fill();
            }
        }
```

- [ ] **Step 4: Commit**
```bash
git add static/js/omok.js
git commit -m "feat: red dot indicator on last moves in omok"
```

---

### Task 5: Omok — 45-Second Timer with Random Placement

**Files:**
- Modify: `static/js/omok.js:14-32,109-141`

- [ ] **Step 1: Add timer variables and logic**

Add after the `lastMoves` declaration (around line 15):
```javascript
    const TURN_TIME = 45;
    let turnTimeLeft = TURN_TIME;
    let turnTimerInterval = null;
```

- [ ] **Step 2: Add timer display in `updateStatus()`**

Replace `updateStatus()` (lines 25-32):
```javascript
    function updateStatus() {
        let text = currentPlayer === 1 ? "Black's Turn (●)" : "White's Turn (○)";
        if (isMultiplayer && gameReady) {
            const isMyTurn = currentPlayer === myPlayer;
            text += isMyTurn ? " — 내 차례" : " — 상대 차례";
        }
        text += ` — ${turnTimeLeft}초`;
        document.getElementById("status").textContent = text;
    }
```

- [ ] **Step 3: Add timer start/stop/timeout functions**

Add after `updateStatus()`:
```javascript
    function startTurnTimer() {
        stopTurnTimer();
        turnTimeLeft = TURN_TIME;
        updateStatus();
        turnTimerInterval = setInterval(() => {
            turnTimeLeft--;
            updateStatus();
            if (turnTimeLeft <= 0) {
                stopTurnTimer();
                placeRandomStone();
            }
        }, 1000);
    }

    function stopTurnTimer() {
        if (turnTimerInterval) {
            clearInterval(turnTimerInterval);
            turnTimerInterval = null;
        }
    }

    function placeRandomStone() {
        const emptyCells = [];
        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++)
                if (board[r][c] === 0) emptyCells.push({ r, c });
        if (emptyCells.length === 0) return;
        const pick = emptyCells[Math.floor(Math.random() * emptyCells.length)];
        const placedPlayer = currentPlayer;
        placeStone(pick.r, pick.c, placedPlayer);
        if (isMultiplayer && socket) {
            socket.emit('game_move', { room_id: ROOM_ID, row: pick.r, col: pick.c, player: placedPlayer });
        }
    }
```

- [ ] **Step 4: Integrate timer into game flow**

In `placeStone()`, after switching `currentPlayer`, call `startTurnTimer()`:
```javascript
    function placeStone(row, col, player) {
        board[row][col] = player;
        lastMoves[player] = { row, col };
        draw();
        if (checkWin(row, col, player)) {
            handleWin(player);
            stopTurnTimer();
            return;
        }
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
        startTurnTimer();
    }
```

In `init()`, add `startTurnTimer()` call:
```javascript
    function init() {
        board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
        currentPlayer = 1;
        gameOver = false;
        lastMoves = { 1: null, 2: null };
        updateStatus();
        draw();
        document.getElementById("win-overlay").classList.remove("active");
        if (!isMultiplayer || gameReady) startTurnTimer();
    }
```

In the multiplayer `game_ready` handler, start the timer:
```javascript
        socket.on('game_ready', () => {
            gameReady = true;
            const el = document.getElementById('mp-status');
            if (el) el.textContent = '게임 시작!';
            setTimeout(() => { if (el) el.style.display = 'none'; }, 1000);
            updateStatus();
            startTurnTimer();
        });
```

- [ ] **Step 5: Commit**
```bash
git add static/js/omok.js
git commit -m "feat: 45-second turn timer with random placement on timeout"
```

---

### Task 6: Room List Filtering (Tab Buttons)

**Files:**
- Modify: `templates/index.html:40-65,147-177`
- Modify: `static/css/style.css` (add filter tab styles)

- [ ] **Step 1: Add filter tabs HTML in `index.html`**

Replace lines 40-44 (room section header):
```html
            <section class="room-section">
                <div class="room-header">
                    <h2>대전 방 목록</h2>
                    <button class="btn btn-primary" id="create-room-btn">방 만들기</button>
                </div>
                <div class="room-filter-tabs">
                    <button class="filter-tab active" data-game="all">전체</button>
                    <button class="filter-tab" data-game="tetris">Tetris</button>
                    <button class="filter-tab" data-game="omok">Omok</button>
                    <button class="filter-tab" data-game="chess">Chess</button>
                </div>
```

- [ ] **Step 2: Add room filtering JS logic in `index.html`**

Add after the socket variable declarations (around line 154):
```javascript
        let allRooms = [];
        let activeGameFilter = 'all';

        // ── Room filter tabs ──
        document.querySelectorAll('.filter-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.filter-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                activeGameFilter = btn.dataset.game;
                renderRooms();
            });
        });

        function renderRooms() {
            const filtered = activeGameFilter === 'all'
                ? allRooms
                : allRooms.filter(r => r.game === activeGameFilter);
            const list = document.getElementById('room-list');
            if (filtered.length === 0) {
                list.innerHTML = '<p class="empty-msg">생성된 방이 없습니다.</p>';
                return;
            }
            list.innerHTML = filtered.map(r => `
                <div class="room-item">
                    <div class="room-info-row">
                        <span class="room-game-badge">${r.game.toUpperCase()}</span>
                        <span class="room-name">${r.name}</span>
                        ${r.password ? '<span class="room-lock">🔒</span>' : ''}
                    </div>
                    <div class="room-meta">
                        <span>호스트: ${r.host}</span>
                        <span>${r.player_count}/${r.max_players}명</span>
                    </div>
                    <button class="btn btn-join" onclick="joinRoom('${r.id}', ${r.password})">참가</button>
                </div>
            `).join('');
        }
```

Update the `rooms_updated` handler to store and re-render:
```javascript
        socket.on('rooms_updated', (data) => {
            allRooms = data.rooms;
            renderRooms();
        });
```

- [ ] **Step 3: Add filter tab CSS in `style.css`**

Add after the `.room-header` styles:
```css
.room-filter-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
}

.filter-tab {
    padding: 0.4rem 1rem;
    border: 1px solid #c4aa82;
    background: #e6ddd3;
    color: #5a4e42;
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    transition: background 0.2s, color 0.2s;
}

.filter-tab:hover {
    background: #c4aa82;
    color: white;
}

.filter-tab.active {
    background: #a38b6d;
    color: white;
    border-color: #a38b6d;
}
```

- [ ] **Step 4: Commit**
```bash
git add templates/index.html static/css/style.css
git commit -m "feat: room list filter tabs (All/Tetris/Omok/Chess)"
```

---

### Task 7: Friend List Filtering (Dropdown)

**Files:**
- Modify: `templates/index.html:68-92`
- Modify: `static/css/style.css` (dropdown styles)

- [ ] **Step 1: Add dropdown HTML in `index.html`**

Replace lines 68-73 (friends sidebar header):
```html
        <aside class="friends-sidebar">
            <h3>친구 목록</h3>
            <div class="friend-controls">
                <select id="friend-filter" class="friend-filter-select">
                    <option value="all">전체</option>
                    <option value="online">온라인</option>
                    <option value="chilling">쉬는 중</option>
                    <option value="ingame">게임중</option>
                    <option value="offline">오프라인</option>
                    <option value="nearby">근처</option>
                </select>
                <div class="friend-add">
                    <input type="text" id="friend-id-input" placeholder="친구 ID">
                    <button class="btn" onclick="addFriend()">추가</button>
                </div>
            </div>
```

- [ ] **Step 2: Add filtering JS in `index.html`**

Add in the script section:
```javascript
        // ── Friend filter ──
        document.getElementById('friend-filter').addEventListener('change', applyFriendFilter);

        function applyFriendFilter() {
            const filter = document.getElementById('friend-filter').value;
            document.querySelectorAll('.friend-item').forEach(el => {
                const status = el.dataset.status;
                const nearby = el.dataset.nearby === 'true';
                let show = false;
                if (filter === 'all') show = true;
                else if (filter === 'nearby') show = nearby;
                else show = (status === filter);
                el.style.display = show ? '' : 'none';
            });
        }
```

- [ ] **Step 3: Add dropdown CSS in `style.css`**

```css
.friend-controls {
    margin-bottom: 0.8rem;
}

.friend-filter-select {
    width: 100%;
    padding: 0.4rem 0.6rem;
    border: 1px solid #c4aa82;
    border-radius: 6px;
    background: white;
    color: #5a4e42;
    font-size: 0.85rem;
    margin-bottom: 0.5rem;
}
```

- [ ] **Step 4: Commit**
```bash
git add templates/index.html static/css/style.css
git commit -m "feat: friend list dropdown filter (status + nearby)"
```

---

### Task 8: Room Invite — Status-Based Enable/Disable

**Files:**
- Modify: `templates/room.html:42-51`

- [ ] **Step 1: Update invite button logic in `room.html`**

Replace lines 42-51:
```html
            <div class="friend-list">
                {% for f in friends %}
                <div class="friend-invite-item status-{{ f.status }}" id="invite-{{ f.id }}">
                    <div class="friend-status-dot"></div>
                    <span class="friend-name">{{ f.id }}</span>
                    <button class="btn btn-invite"
                            {% if f.status not in ['online', 'chilling'] %}disabled{% endif %}
                            onclick="inviteFriend('{{ f.id }}')">
                        초대
                    </button>
                </div>
                {% endfor %}
```

- [ ] **Step 2: Commit**
```bash
git add templates/room.html
git commit -m "feat: invite button enabled only for online/chilling friends"
```

---

### Task 9: Update `migrate_users.py` for Status Field

**Files:**
- Modify: `migrate_users.py`

- [ ] **Step 1: Update migration script**

In `migrate_users.py`, the migration sets `logged_in = False`. Change to set `status = 'offline'` and remove `logged_in`:
```python
    with table.batch_writer() as batch:
        for uid, data in users.items():
            item = {'user_id': uid, **data}
            # Replace logged_in with status field
            item.pop('logged_in', None)
            item['status'] = 'offline'
            item['public_ip'] = ''
            batch.put_item(Item=item)
```

- [ ] **Step 2: Commit**
```bash
git add migrate_users.py
git commit -m "feat: migration script uses status field instead of logged_in"
```

---

## Verification

1. **Local test:** Run `python app.py`, log in, verify friend sidebar shows 4-state status
2. **Omok test:** Start solo omok game, verify:
   - Red dots appear on last moves for both players
   - 45-second countdown shows in status text
   - Wait 45 seconds — random stone is placed
3. **Tab focus test:** Open multiplayer game, switch tabs — verify game ends with forfeit
4. **Room filter test:** Create rooms for different games, click filter tabs — only matching rooms shown
5. **Friend filter test:** Use dropdown to filter by status — friends list filters correctly
6. **Invite test:** In waiting room, verify invite button is disabled for offline/ingame friends
7. **Status transitions:** Login → online, blur tab → chilling, enter game → ingame, logout → offline
