(() => {
    const COLS = 10;
    const ROWS = 20;
    const BLOCK = 30;
    const BG_COLOR = "#f5ede3";
    const COLORS = [
        null,
        "#00f0f0", // I - cyan
        "#f0f000", // O - yellow
        "#a000f0", // T - purple
        "#00f000", // S - green
        "#f00000", // Z - red
        "#0000f0", // J - blue
        "#f0a000", // L - orange
    ];

    const SHAPES = [
        null,
        [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
        [[2,2],[2,2]],                                 // O
        [[0,3,0],[3,3,3],[0,0,0]],                     // T
        [[0,4,4],[4,4,0],[0,0,0]],                     // S
        [[5,5,0],[0,5,5],[0,0,0]],                     // Z
        [[6,0,0],[6,6,6],[0,0,0]],                     // J
        [[0,0,7],[7,7,7],[0,0,0]],                     // L
    ];

    // Multiplayer
    const isMultiplayer = typeof ROOM_ID !== 'undefined' && ROOM_ID;
    const isSpectator = typeof IS_SPECTATOR !== 'undefined' && IS_SPECTATOR;
    let socket = null;
    let gameReady = false;

    // Opponent tracking (multi-player)
    let opponents = {}; // user_id -> { board, score, level, lines, eliminated }
    let eliminated = false;

    let canvas, ctx, nextCanvas, nextCtx;
    let board, piece, nextPiece, score, level, lines, gameOver, paused, dropInterval, timer;

    if (!isSpectator) {
        canvas = document.getElementById("tetris-board");
        ctx = canvas.getContext("2d");
        nextCanvas = document.getElementById("next-piece");
        nextCtx = nextCanvas.getContext("2d");
    }

    function createBoard() {
        return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    }

    function randomType() {
        return Math.floor(Math.random() * 7) + 1;
    }

    function cloneShape(type) {
        return SHAPES[type].map(row => [...row]);
    }

    function newPiece(type) {
        const shape = cloneShape(type);
        return { type, shape, x: Math.floor((COLS - shape[0].length) / 2), y: 0 };
    }

    function rotate(shape) {
        const N = shape.length;
        const rotated = Array.from({ length: N }, () => new Array(N).fill(0));
        for (let r = 0; r < N; r++)
            for (let c = 0; c < N; c++)
                rotated[c][N - 1 - r] = shape[r][c];
        return rotated;
    }

    function valid(shape, px, py) {
        for (let r = 0; r < shape.length; r++)
            for (let c = 0; c < shape[r].length; c++) {
                if (!shape[r][c]) continue;
                const nx = px + c, ny = py + r;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
                if (ny >= 0 && board[ny][nx]) return false;
            }
        return true;
    }

    function lock() {
        for (let r = 0; r < piece.shape.length; r++)
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (!piece.shape[r][c]) continue;
                const ny = piece.y + r;
                if (ny < 0) { endGame(); return; }
                board[ny][piece.x + c] = piece.type;
            }
        clearLines();
        spawn();
        if (isMultiplayer && socket) {
            socket.emit('tetris_state', {
                room_id: ROOM_ID,
                user_id: MY_USER,
                board: board,
                score: score,
                level: level,
                lines: lines
            });
        }
    }

    function clearLines() {
        let cleared = 0;
        for (let r = ROWS - 1; r >= 0; r--) {
            if (board[r].every(v => v !== 0)) {
                board.splice(r, 1);
                board.unshift(new Array(COLS).fill(0));
                cleared++;
                r++;
            }
        }
        if (cleared > 0) {
            const pts = [0, 100, 300, 500, 800];
            score += pts[cleared] * level;
            lines += cleared;
            level = Math.floor(lines / 10) + 1;
            dropInterval = Math.max(100, 1000 - (level - 1) * 80);
            updateUI();
        }
    }

    function spawn() {
        piece = newPiece(nextPiece);
        nextPiece = randomType();
        if (!valid(piece.shape, piece.x, piece.y)) endGame();
        drawNext();
    }

    function endGame() {
        gameOver = true;
        eliminated = true;
        clearInterval(timer);
        const scoreEl = document.getElementById("final-score");
        if (scoreEl) scoreEl.textContent = score;
        if (isMultiplayer && socket) {
            socket.emit('game_over_event', { room_id: ROOM_ID, user_id: MY_USER, loser: MY_USER });
            // For 2-player: show lose immediately. For multi-player: wait for game_winner.
            if (typeof ROOM_PLAYERS !== 'undefined' && ROOM_PLAYERS.length <= 2) {
                document.getElementById("game-over-title").textContent = "패배!";
                document.getElementById("game-over-overlay").classList.add("active");
            }
        } else {
            document.getElementById("game-over-overlay").classList.add("active");
        }
    }

    function updateUI() {
        const s = document.getElementById("score");
        const l = document.getElementById("level");
        const li = document.getElementById("lines");
        if (s) s.textContent = score;
        if (l) l.textContent = level;
        if (li) li.textContent = lines;
    }

    // ===== Drawing =====
    function drawBlock(context, x, y, color, size) {
        size = size || BLOCK;
        context.fillStyle = color;
        context.fillRect(x * size, y * size, size - 1, size - 1);
        context.fillStyle = "rgba(255,255,255,0.25)";
        context.fillRect(x * size, y * size, size - 1, 3);
        context.fillRect(x * size, y * size, 3, size - 1);
    }

    function draw() {
        if (!ctx) return;
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.strokeStyle = "rgba(0,0,0,0.06)";
        for (let r = 0; r <= ROWS; r++) {
            ctx.beginPath(); ctx.moveTo(0, r * BLOCK); ctx.lineTo(canvas.width, r * BLOCK); ctx.stroke();
        }
        for (let c = 0; c <= COLS; c++) {
            ctx.beginPath(); ctx.moveTo(c * BLOCK, 0); ctx.lineTo(c * BLOCK, canvas.height); ctx.stroke();
        }

        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
                if (board[r][c]) drawBlock(ctx, c, r, COLORS[board[r][c]]);

        if (piece && !gameOver) {
            let gy = piece.y;
            while (valid(piece.shape, piece.x, gy + 1)) gy++;
            for (let r = 0; r < piece.shape.length; r++)
                for (let c = 0; c < piece.shape[r].length; c++)
                    if (piece.shape[r][c]) {
                        ctx.fillStyle = "rgba(0,0,0,0.08)";
                        ctx.fillRect((piece.x + c) * BLOCK, (gy + r) * BLOCK, BLOCK - 1, BLOCK - 1);
                    }
        }

        if (piece)
            for (let r = 0; r < piece.shape.length; r++)
                for (let c = 0; c < piece.shape[r].length; c++)
                    if (piece.shape[r][c])
                        drawBlock(ctx, piece.x + c, piece.y + r, COLORS[piece.type]);
    }

    function drawNext() {
        if (!nextCtx) return;
        nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
        const shape = SHAPES[nextPiece];
        const size = 22;
        const offsetX = (nextCanvas.width - shape[0].length * size) / 2;
        const offsetY = (nextCanvas.height - shape.length * size) / 2;
        for (let r = 0; r < shape.length; r++)
            for (let c = 0; c < shape[r].length; c++)
                if (shape[r][c]) {
                    nextCtx.fillStyle = COLORS[nextPiece];
                    nextCtx.fillRect(offsetX + c * size, offsetY + r * size, size - 1, size - 1);
                }
    }

    // ===== Opponent / Spectator Board Drawing =====
    function drawMiniBoard(canvasEl, boardData, isEliminated) {
        const miniCtx = canvasEl.getContext('2d');
        const OB = canvasEl.width / COLS;
        miniCtx.fillStyle = isEliminated ? '#ddd' : BG_COLOR;
        miniCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
        if (!boardData) return;
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
                if (boardData[r] && boardData[r][c]) {
                    miniCtx.fillStyle = isEliminated ? '#bbb' : (COLORS[boardData[r][c]] || '#999');
                    miniCtx.fillRect(c * OB, r * OB, OB - 1, OB - 1);
                }
        if (isEliminated) {
            miniCtx.fillStyle = 'rgba(0,0,0,0.4)';
            miniCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
            miniCtx.fillStyle = '#fff';
            miniCtx.font = 'bold 14px sans-serif';
            miniCtx.textAlign = 'center';
            miniCtx.textBaseline = 'middle';
            miniCtx.fillText('탈락', canvasEl.width / 2, canvasEl.height / 2);
        }
    }

    function createOpponentPanels() {
        const panel = document.getElementById('opponents-panel');
        if (!panel) return;
        const players = isSpectator ? ROOM_PLAYERS : ROOM_PLAYERS.filter(p => p !== MY_USER);
        players.forEach(p => {
            const div = document.createElement('div');
            div.className = 'opponent-panel';
            div.id = 'opp-' + p;
            div.innerHTML = `
                <h4>${p}</h4>
                <canvas class="opponent-canvas" width="150" height="300"></canvas>
                <div class="opponent-score-label">점수: <span class="opponent-score">0</span></div>
            `;
            panel.appendChild(div);
            opponents[p] = { board: null, score: 0, level: 1, lines: 0, eliminated: false };
        });
    }

    function updateOpponent(userId, data) {
        if (!opponents[userId]) return;
        opponents[userId].board = data.board;
        opponents[userId].score = data.score;
        opponents[userId].level = data.level || 1;
        opponents[userId].lines = data.lines || 0;
        const panel = document.getElementById('opp-' + userId);
        if (panel) {
            drawMiniBoard(panel.querySelector('.opponent-canvas'), data.board, opponents[userId].eliminated);
            const scoreEl = panel.querySelector('.opponent-score');
            if (scoreEl) scoreEl.textContent = data.score;
        }
    }

    // ===== Game Loop =====
    function drop() {
        if (gameOver || paused) return;
        if (valid(piece.shape, piece.x, piece.y + 1)) {
            piece.y++;
        } else {
            lock();
        }
        draw();
    }

    function hardDrop() {
        while (valid(piece.shape, piece.x, piece.y + 1)) {
            piece.y++;
            score += 2;
        }
        lock();
        updateUI();
        draw();
    }

    function startGame() {
        board = createBoard();
        score = 0; level = 1; lines = 0;
        gameOver = false; paused = false; eliminated = false;
        dropInterval = 1000;
        nextPiece = randomType();
        spawn();
        updateUI();
        draw();
        clearInterval(timer);
        timer = setInterval(drop, dropInterval);
        document.getElementById("game-over-overlay").classList.remove("active");
    }

    // ===== Input =====
    if (!isSpectator) {
        document.addEventListener("keydown", (e) => {
            if (gameOver || paused) return;
            if (isMultiplayer && !gameReady) return;
            switch (e.key) {
                case "ArrowLeft":
                    if (valid(piece.shape, piece.x - 1, piece.y)) piece.x--;
                    break;
                case "ArrowRight":
                    if (valid(piece.shape, piece.x + 1, piece.y)) piece.x++;
                    break;
                case "ArrowDown":
                    if (valid(piece.shape, piece.x, piece.y + 1)) { piece.y++; score += 1; updateUI(); }
                    break;
                case "ArrowUp": {
                    const rotated = rotate(piece.shape);
                    for (const dx of [0, -1, 1, -2, 2]) {
                        if (valid(rotated, piece.x + dx, piece.y)) {
                            piece.shape = rotated;
                            piece.x += dx;
                            break;
                        }
                    }
                    break;
                }
                case " ":
                    e.preventDefault();
                    hardDrop();
                    break;
            }
            draw();
        });
    }

    // Solo mode buttons
    const startBtn = document.getElementById("start-btn");
    const restartBtn = document.getElementById("restart-btn");
    const pauseBtn = document.getElementById("pause-btn");
    if (startBtn) startBtn.addEventListener("click", startGame);
    if (restartBtn) restartBtn.addEventListener("click", startGame);
    if (pauseBtn) pauseBtn.addEventListener("click", () => {
        if (gameOver) return;
        paused = !paused;
        pauseBtn.textContent = paused ? "Resume" : "Pause";
    });

    // ===== Multiplayer =====
    if (isMultiplayer) {
        socket = io();
        createOpponentPanels();

        if (isSpectator) {
            socket.emit('join_spectate', { room_id: ROOM_ID, user_id: MY_USER });
            socket.emit('user_status', { user_id: MY_USER, status: 'spectating' });

            // Spectator: receive all players' state
            socket.on('opponent_state', (data) => {
                updateOpponent(data.user_id, data);
            });

            socket.on('game_state_sync', (data) => {
                if (data.players) {
                    for (const [uid, state] of Object.entries(data.players)) {
                        updateOpponent(uid, state);
                    }
                }
                if (data.eliminated) {
                    for (const uid of data.eliminated) {
                        if (opponents[uid]) {
                            opponents[uid].eliminated = true;
                            const panel = document.getElementById('opp-' + uid);
                            if (panel) drawMiniBoard(panel.querySelector('.opponent-canvas'), opponents[uid].board, true);
                        }
                    }
                }
            });

            socket.on('player_eliminated', (data) => {
                if (opponents[data.user_id]) {
                    opponents[data.user_id].eliminated = true;
                    const panel = document.getElementById('opp-' + data.user_id);
                    if (panel) drawMiniBoard(panel.querySelector('.opponent-canvas'), opponents[data.user_id].board, true);
                }
            });

            socket.on('game_winner', (data) => {
                const el = document.getElementById('mp-status');
                if (el) {
                    el.textContent = data.winner + ' 승리!';
                    el.style.display = '';
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
            // Player mode
            socket.emit('join_game', { room_id: ROOM_ID, user_id: MY_USER });

            document.addEventListener('visibilitychange', () => {
                if (document.hidden && !gameOver && gameReady) {
                    gameOver = true;
                    socket.emit('game_over_event', { room_id: ROOM_ID, loser: MY_USER });
                    window.location.href = '/';
                }
            });

            socket.on('game_ready', () => {
                gameReady = true;
                const el = document.getElementById('mp-status');
                if (el) el.textContent = '게임 시작!';
                setTimeout(() => { if (el) el.style.display = 'none'; }, 1000);
                startGame();
            });

            socket.on('opponent_state', (data) => {
                updateOpponent(data.user_id, data);
            });

            socket.on('player_eliminated', (data) => {
                if (opponents[data.user_id]) {
                    opponents[data.user_id].eliminated = true;
                    const panel = document.getElementById('opp-' + data.user_id);
                    if (panel) drawMiniBoard(panel.querySelector('.opponent-canvas'), opponents[data.user_id].board, true);
                }
            });

            socket.on('game_winner', (data) => {
                if (gameOver && !eliminated) return; // already showing win
                gameOver = true;
                clearInterval(timer);
                const scoreEl = document.getElementById("final-score");
                if (scoreEl) scoreEl.textContent = score;
                const titleEl = document.getElementById("game-over-title");
                if (data.winner === MY_USER) {
                    titleEl.textContent = '승리!';
                } else {
                    titleEl.textContent = '패배!';
                }
                document.getElementById("game-over-overlay").classList.add("active");
            });

            // For 2-player mode: opponent_game_over
            socket.on('opponent_game_over', () => {
                if (gameOver) return;
                gameOver = true;
                clearInterval(timer);
                document.getElementById("final-score").textContent = score;
                document.getElementById("game-over-title").innerHTML = '승리!';
                document.getElementById("game-over-overlay").classList.add("active");
            });

            socket.on('opponent_disconnected', (data) => {
                const uid = data.user_id;
                if (opponents[uid]) {
                    opponents[uid].eliminated = true;
                    const panel = document.getElementById('opp-' + uid);
                    if (panel) drawMiniBoard(panel.querySelector('.opponent-canvas'), opponents[uid].board, true);
                }
                // For 2-player
                if (typeof ROOM_PLAYERS !== 'undefined' && ROOM_PLAYERS.length <= 2) {
                    if (gameOver) return;
                    gameOver = true;
                    clearInterval(timer);
                    document.getElementById("final-score").textContent = score;
                    document.getElementById("game-over-title").innerHTML = '승리!<br><span class="disconnect-sub">상대방이 나갔습니다!</span>';
                    document.getElementById("game-over-overlay").classList.add("active");
                }
            });
        }
    }

    // Initial draw (solo mode)
    if (!isSpectator) {
        board = createBoard();
        draw();
    }
})();
