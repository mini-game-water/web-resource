(() => {
    const canvas = document.getElementById("omok-board");
    const ctx = canvas.getContext("2d");
    const SIZE = 15;
    const PADDING = 20;
    const CELL = (canvas.width - PADDING * 2) / (SIZE - 1);

    // Multiplayer
    const isMultiplayer = typeof ROOM_ID !== 'undefined' && ROOM_ID;
    const myPlayer = isMultiplayer ? MY_PLAYER : null; // 1=black, 2=white
    let socket = null;
    let gameReady = !isMultiplayer;

    let board, currentPlayer, gameOver;
    let lastMoves = { 1: null, 2: null };

    const TURN_TIME = 45;
    let turnTimeLeft = TURN_TIME;
    let turnTimerInterval = null;

    function init() {
        board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
        currentPlayer = 1;
        gameOver = false;
        lastMoves = { 1: null, 2: null };
        stopTurnTimer();
        updateStatus();
        draw();
        document.getElementById("win-overlay").classList.remove("active");
        if (!isMultiplayer || gameReady) startTurnTimer();
    }

    function updateStatus() {
        let text = currentPlayer === 1 ? "Black's Turn (●)" : "White's Turn (○)";
        if (isMultiplayer && gameReady) {
            const isMyTurn = currentPlayer === myPlayer;
            text += isMyTurn ? " — 내 차례" : " — 상대 차례";
        }
        text += ` — ${turnTimeLeft}초`;
        document.getElementById("status").textContent = text;
    }

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

    // ===== Input =====
    canvas.addEventListener("click", (e) => {
        if (gameOver) return;
        if (!gameReady) return;
        if (isMultiplayer && currentPlayer !== myPlayer) return;

        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const col = Math.round((mx - PADDING) / CELL);
        const row = Math.round((my - PADDING) / CELL);

        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
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
        socket.emit('join_game', { room_id: ROOM_ID, user_id: MY_USER });

        // Tab focus forfeit
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
            updateStatus();
            startTurnTimer();
        });

        socket.on('opponent_move', (data) => {
            placeStone(data.row, data.col, currentPlayer);
        });

        socket.on('opponent_disconnected', () => {
            if (!gameOver) {
                gameOver = true;
                stopTurnTimer();
                document.getElementById("status").textContent = "승리!";
                document.getElementById("win-message").innerHTML = '승리!<br><span class="disconnect-sub">상대방이 나갔습니다!</span>';
                document.getElementById("win-overlay").classList.add("active");
            }
        });
    }

    init();
})();
