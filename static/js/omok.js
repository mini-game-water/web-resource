(() => {
    const canvas = document.getElementById("omok-board");
    const ctx = canvas.getContext("2d");
    const SIZE = 15;
    const PADDING = 20;
    const CELL = (canvas.width - PADDING * 2) / (SIZE - 1);

    // Multiplayer
    const isMultiplayer = typeof ROOM_ID !== 'undefined' && ROOM_ID;
    const isSpectator = typeof IS_SPECTATOR !== 'undefined' && IS_SPECTATOR;
    const myPlayer = isMultiplayer && !isSpectator ? MY_PLAYER : null; // 1=black, 2=white
    let socket = null;
    let gameReady = !isMultiplayer || isSpectator;

    let board, currentPlayer, gameOver;
    let lastMoves = { 1: null, 2: null };

    const TURN_TIME = 45;
    let turnTimeLeft = TURN_TIME;
    let turnTimerInterval = null;

    // Coaching dots from spectators
    let coachingDots = {}; // user_id -> { row, col }

    // Assign distinct colors to spectators
    const COACHING_COLORS = [
        [0, 150, 255], [255, 100, 50], [50, 200, 100], [200, 50, 200],
        [255, 180, 0], [0, 200, 200], [255, 80, 120], [100, 120, 255],
    ];
    const coachingColorMap = {};
    let nextColorIdx = 0;
    function getCoachingColor(uid) {
        if (!(uid in coachingColorMap)) {
            coachingColorMap[uid] = COACHING_COLORS[nextColorIdx % COACHING_COLORS.length];
            nextColorIdx++;
        }
        return coachingColorMap[uid];
    }

    function init() {
        board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
        currentPlayer = 1;
        gameOver = false;
        lastMoves = { 1: null, 2: null };
        coachingDots = {};
        stopTurnTimer();
        updateStatus();
        draw();
        document.getElementById("win-overlay").classList.remove("active");
        if (!isMultiplayer || gameReady) startTurnTimer();
    }

    function updateStatus() {
        let text = currentPlayer === 1 ? "Black's Turn (●)" : "White's Turn (○)";
        if (isSpectator) {
            text += " — 관전 중";
        } else if (isMultiplayer && gameReady) {
            const isMyTurn = currentPlayer === myPlayer;
            text += isMyTurn ? " — 내 차례" : " — 상대 차례";
        }
        if (!isSpectator) text += ` — ${turnTimeLeft}초`;
        document.getElementById("status").textContent = text;
    }

    function startTurnTimer() {
        if (isSpectator) return;
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
        if (gameOver) return;
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

    // ===== Drawing =====
    function draw() {
        ctx.fillStyle = "#c8a860";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = "#6b5a3e";
        ctx.lineWidth = 1;
        for (let i = 0; i < SIZE; i++) {
            const pos = PADDING + i * CELL;
            ctx.beginPath(); ctx.moveTo(PADDING, pos); ctx.lineTo(canvas.width - PADDING, pos); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(pos, PADDING); ctx.lineTo(pos, canvas.height - PADDING); ctx.stroke();
        }

        const stars = [3, 7, 11];
        ctx.fillStyle = "#6b5a3e";
        for (const r of stars)
            for (const c of stars) {
                ctx.beginPath();
                ctx.arc(PADDING + c * CELL, PADDING + r * CELL, 4, 0, Math.PI * 2);
                ctx.fill();
            }

        for (let r = 0; r < SIZE; r++)
            for (let c = 0; c < SIZE; c++) {
                if (board[r][c] === 0) continue;
                const x = PADDING + c * CELL;
                const y = PADDING + r * CELL;
                const radius = CELL * 0.43;
                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                if (board[r][c] === 1) {
                    const grad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
                    grad.addColorStop(0, "#555"); grad.addColorStop(1, "#111");
                    ctx.fillStyle = grad;
                } else {
                    const grad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
                    grad.addColorStop(0, "#fff"); grad.addColorStop(1, "#ccc");
                    ctx.fillStyle = grad;
                }
                ctx.fill();
                ctx.strokeStyle = board[r][c] === 1 ? "#000" : "#999";
                ctx.lineWidth = 1;
                ctx.stroke();
            }

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

        // Draw coaching dots with per-user colors and name tags
        for (const [uid, dot] of Object.entries(coachingDots)) {
            const [cr, cg, cb] = getCoachingColor(uid);
            const x = PADDING + dot.col * CELL;
            const y = PADDING + dot.row * CELL;
            ctx.beginPath();
            ctx.arc(x, y, CELL * 0.2, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.45)`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.7)`;
            ctx.lineWidth = 2;
            ctx.stroke();
            // Name tag
            ctx.font = '10px sans-serif';
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.6)`;
            ctx.textAlign = 'center';
            ctx.fillText(uid, x, y - CELL * 0.3);
        }
    }

    // ===== Win Check =====
    function checkWin(row, col, player) {
        const directions = [[0,1],[1,0],[1,1],[1,-1]];
        for (const [dr, dc] of directions) {
            let count = 1;
            for (let d = 1; d < 5; d++) {
                const nr = row + dr * d, nc = col + dc * d;
                if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== player) break;
                count++;
            }
            for (let d = 1; d < 5; d++) {
                const nr = row - dr * d, nc = col - dc * d;
                if (nr < 0 || nr >= SIZE || nc < 0 || nc >= SIZE || board[nr][nc] !== player) break;
                count++;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    function handleWin(player) {
        gameOver = true;
        const winner = player === 1 ? "Black (●)" : "White (○)";
        document.getElementById("status").textContent = winner + " Wins!";
        document.getElementById("win-message").textContent = winner + " Wins!";
        document.getElementById("win-overlay").classList.add("active");
    }

    // ===== Place Stone =====
    function placeStone(row, col, player) {
        board[row][col] = player;
        lastMoves[player] = { row, col };
        coachingDots = {}; // Clear coaching on turn change
        draw();
        if (checkWin(row, col, player)) {
            handleWin(player);
            stopTurnTimer();
            return;
        }
        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
        if (!isSpectator) startTurnTimer();
    }

    // ===== Input =====
    canvas.addEventListener("click", (e) => {
        if (gameOver) return;
        if (!gameReady) return;

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const col = Math.round((mx - PADDING) / CELL);
        const row = Math.round((my - PADDING) / CELL);
        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;

        // Spectator coaching
        if (isSpectator && isMultiplayer && typeof ALLOW_COACHING !== 'undefined' && ALLOW_COACHING) {
            if (board[row][col] !== 0) return;
            socket.emit('coaching_suggest', {
                room_id: ROOM_ID,
                user_id: MY_USER,
                type: 'dot',
                data: { row, col }
            });
            return;
        }

        // Player move
        if (isSpectator) return;
        if (isMultiplayer && currentPlayer !== myPlayer) return;
        if (board[row][col] !== 0) return;

        const placedPlayer = currentPlayer;
        placeStone(row, col, placedPlayer);

        if (isMultiplayer && socket) {
            socket.emit('game_move', { room_id: ROOM_ID, row, col, player: placedPlayer });
        }
    });

    const restartBtn = document.getElementById("restart-btn");
    const overlayRestartBtn = document.getElementById("overlay-restart-btn");
    if (restartBtn) restartBtn.addEventListener("click", init);
    if (overlayRestartBtn) overlayRestartBtn.addEventListener("click", init);

    // ===== Multiplayer =====
    if (isMultiplayer) {
        socket = io();

        socket.on('room_destroyed', () => {
            if (!gameOver) window.location.href = '/';
        });
        socket.on('room_force_closed', (data) => {
            alert(data.message || '관리자에 의해 방이 강제 종료되었습니다.');
            window.location.href = '/';
        });

        socket.on('participants_update', (data) => {
            const list = document.getElementById('participants-list');
            if (!list) return;
            let html = '';
            (data.players || []).forEach(p => {
                html += '<div class="participant-item"><span class="participant-dot player-dot"></span>' + p + ' <span class="participant-role">(Player)</span></div>';
            });
            (data.spectators || []).forEach(s => {
                html += '<div class="participant-item"><span class="participant-dot spectator-dot"></span>' + s + ' <span class="participant-role">(Spectator)</span></div>';
            });
            list.innerHTML = html;
        });

        if (isSpectator) {
            socket.emit('join_spectate', { room_id: ROOM_ID, user_id: MY_USER });
            socket.emit('user_status', { user_id: MY_USER, status: 'spectating' });

            socket.on('game_state_sync', (data) => {
                if (data.moves) {
                    data.moves.forEach(m => {
                        if (m.row !== undefined && m.col !== undefined && m.player !== undefined) {
                            placeStone(m.row, m.col, m.player);
                        }
                    });
                }
            });

            // Spectator invite handling
            let currentInviteRoomId = null;
            let inviteTimerId = null;
            socket.on('invite_received', (data) => {
                currentInviteRoomId = data.room_id;
                document.getElementById('invite-inviter').textContent = data.inviter;
                document.getElementById('invite-room-name').textContent = data.room_name;
                document.getElementById('invite-game').textContent = data.game.toUpperCase();
                document.getElementById('invite-overlay').classList.add('active');
                const wrap = document.querySelector('.invite-popup-wrap');
                const timerText = document.getElementById('invite-timer-text');
                const start = Date.now();
                const duration = 10000;
                function tick() {
                    const remaining = Math.max(0, duration - (Date.now() - start));
                    wrap.style.setProperty('--progress', (remaining / duration) * 360);
                    timerText.textContent = Math.ceil(remaining / 1000);
                    if (remaining > 0) inviteTimerId = requestAnimationFrame(tick);
                    else window.declineInvite();
                }
                tick();
            });
            window.acceptInvite = () => {
                cancelAnimationFrame(inviteTimerId);
                document.getElementById('invite-overlay').classList.remove('active');
                socket.emit('invite_response', { room_id: currentInviteRoomId, user_id: MY_USER, accepted: true });
            };
            window.declineInvite = () => {
                cancelAnimationFrame(inviteTimerId);
                document.getElementById('invite-overlay').classList.remove('active');
                socket.emit('invite_response', { room_id: currentInviteRoomId, user_id: MY_USER, accepted: false });
            };
            socket.on('invite_accepted', (data) => {
                if (data && data.room_id) window.location.href = '/room/' + data.room_id;
                else if (data && data.error) alert(data.error);
            });

        } else {
            socket.emit('join_game', { room_id: ROOM_ID, user_id: MY_USER });

            window.addEventListener('beforeunload', () => {
                if (!gameOver && gameReady) {
                    socket.emit('game_over_event', { room_id: ROOM_ID, loser: MY_USER });
                }
            });

            socket.on('game_ready', () => {
                gameReady = true;
                const el = document.getElementById('mp-status');
                if (el) el.textContent = '게임 시작!';
                setTimeout(() => { if (el) el.style.display = 'none'; }, 1000);
                updateStatus();
                startTurnTimer();
            });
        }

        // Both player and spectator receive moves
        socket.on('opponent_move', (data) => {
            coachingDots = {};
            placeStone(data.row, data.col, data.player !== undefined ? data.player : currentPlayer);
        });

        function showVictoryByLeave() {
            if (gameOver || isSpectator) return;
            gameOver = true;
            stopTurnTimer();
            document.getElementById("status").textContent = "승리!";
            document.getElementById("win-message").innerHTML = '승리!<br><span class="disconnect-sub">상대방이 나갔습니다!</span>';
            document.getElementById("win-overlay").classList.add("active");
        }

        socket.on('opponent_disconnected', showVictoryByLeave);
        socket.on('opponent_game_over', showVictoryByLeave);

        // Coaching updates
        socket.on('coaching_update', (data) => {
            if (data.type === 'dot' && data.data) {
                coachingDots[data.user_id] = data.data;
                draw();
            }
        });

        socket.on('coaching_cleared', (data) => {
            if (data.user_id) {
                delete coachingDots[data.user_id];
            } else {
                coachingDots = {};
            }
            draw();
        });

        // Clear coaching button
        const clearBtn = document.getElementById('coaching-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                socket.emit('coaching_clear', { room_id: ROOM_ID, user_id: MY_USER });
            });
        }
    }

    // ===== Game Chat =====
    if (isMultiplayer && socket) {
        const chatBox = document.getElementById('game-chat');
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const chatSend = document.getElementById('chat-send');
        const chatHeader = document.getElementById('chat-header');
        const chatOpacity = document.getElementById('chat-opacity');
        const chatToggle = document.getElementById('chat-toggle-btn');
        const chatResize = document.getElementById('chat-resize');

        function escapeHtml(str) {
            if (typeof str !== 'string') return str;
            return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
        }

        function appendChat(msg) {
            if (!chatMessages) return;
            const div = document.createElement('div');
            div.className = 'chat-msg' + (msg.user_id === MY_USER ? ' chat-mine' : '');
            const roleTag = msg.role ? ' <span class="chat-role">(' + escapeHtml(msg.role) + ')</span>' : '';
            div.innerHTML = '<strong>' + escapeHtml(msg.user_id) + '</strong>' + roleTag + ' ' + escapeHtml(msg.message);
            chatMessages.appendChild(div);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }

        function sendChat() {
            const text = (chatInput.value || '').trim();
            if (!text) return;
            appendChat({ user_id: MY_USER, role: 'Player', message: text });
            socket.emit('game_chat', { room_id: ROOM_ID, user_id: MY_USER, message: text });
            chatInput.value = '';
        }

        if (chatSend) chatSend.addEventListener('click', sendChat);
        if (chatInput) chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
        });

        socket.on('chat_message', appendChat);

        // Opacity
        if (chatOpacity) chatOpacity.addEventListener('input', () => {
            chatBox.style.opacity = chatOpacity.value / 100;
        });

        // Minimize / Restore
        if (chatToggle) chatToggle.addEventListener('click', () => {
            chatBox.classList.toggle('minimized');
            chatToggle.textContent = chatBox.classList.contains('minimized') ? '+' : '−';
        });

        // Drag
        if (chatHeader) {
            let dragging = false, dx = 0, dy = 0;
            chatHeader.addEventListener('mousedown', (e) => {
                if (e.target.closest('.chat-controls')) return;
                dragging = true;
                const rect = chatBox.getBoundingClientRect();
                dx = e.clientX - rect.left;
                dy = e.clientY - rect.top;
                chatBox.style.transition = 'none';
            });
            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                let x = e.clientX - dx;
                let y = e.clientY - dy;
                x = Math.max(0, Math.min(x, window.innerWidth - chatBox.offsetWidth));
                y = Math.max(0, Math.min(y, window.innerHeight - chatBox.offsetHeight));
                chatBox.style.left = x + 'px';
                chatBox.style.top = y + 'px';
                chatBox.style.right = 'auto';
                chatBox.style.bottom = 'auto';
            });
            document.addEventListener('mouseup', () => { dragging = false; });
        }

        // Resize (top-left handle)
        if (chatResize) {
            let resizing = false, startX, startY, startW, startH, startLeft, startTop;
            chatResize.addEventListener('mousedown', (e) => {
                e.preventDefault();
                resizing = true;
                const rect = chatBox.getBoundingClientRect();
                startX = e.clientX; startY = e.clientY;
                startW = rect.width; startH = rect.height;
                startLeft = rect.left; startTop = rect.top;
                chatBox.style.transition = 'none';
            });
            document.addEventListener('mousemove', (e) => {
                if (!resizing) return;
                const dxR = startX - e.clientX;
                const dyR = startY - e.clientY;
                const newW = Math.max(220, startW + dxR);
                const newH = Math.max(120, startH + dyR);
                chatBox.style.width = newW + 'px';
                chatBox.style.height = newH + 'px';
                chatBox.style.left = (startLeft - (newW - startW)) + 'px';
                chatBox.style.top = (startTop - (newH - startH)) + 'px';
                chatBox.style.right = 'auto';
                chatBox.style.bottom = 'auto';
            });
            document.addEventListener('mouseup', () => { resizing = false; });
        }
    }

    init();
})();
