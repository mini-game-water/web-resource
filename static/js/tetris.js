(() => {
    const COLS = 10;
    const ROWS = 20;
    const BLOCK = 40;
    const BG_COLOR = "#0e1033";
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
    const GARBAGE_COLOR = "#888888";

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
    let opponents = {}; // user_id -> { board, score, level, lines, eliminated, piece }
    let eliminated = false;
    let lastBroadcast = 0;
    const BROADCAST_INTERVAL = 50; // ms throttle

    let canvas, ctx, nextCanvas, nextCtx, holdCanvas, holdCtx;
    let board, piece, nextPiece, score, level, lines, gameOver, paused, dropInterval, timer;

    // Hold piece
    let holdType = null;
    let holdUsed = false;

    // Lock delay: allow movement/rotation for LOCK_DELAY_MAX ticks after landing
    const LOCK_DELAY_MAX = 5;
    let lockDelayCounter = 0;
    let isLanding = false;

    // Seeded RNG for synchronized piece queue
    let rngSeed = 0;
    function seededRandom() {
        rngSeed = (rngSeed * 1664525 + 1013904223) & 0xFFFFFFFF;
        return (rngSeed >>> 0) / 0x100000000;
    }

    if (!isSpectator) {
        canvas = document.getElementById("tetris-board");
        ctx = canvas.getContext("2d");
        nextCanvas = document.getElementById("next-piece");
        nextCtx = nextCanvas.getContext("2d");
        holdCanvas = document.getElementById("hold-piece");
        holdCtx = holdCanvas ? holdCanvas.getContext("2d") : null;
    }

    function createBoard() {
        return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    }

    // 7-Bag System using seeded RNG for multiplayer sync
    let pieceBag = [];

    function fillBag() {
        pieceBag = [1, 2, 3, 4, 5, 6, 7];
        for (let i = pieceBag.length - 1; i > 0; i--) {
            const j = Math.floor(seededRandom() * (i + 1));
            [pieceBag[i], pieceBag[j]] = [pieceBag[j], pieceBag[i]];
        }
    }

    function randomType() {
        if (pieceBag.length === 0) fillBag();
        return pieceBag.pop();
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
        if (typeof GameSounds !== 'undefined') GameSounds.play('place');
        lockDelayCounter = 0;
        isLanding = false;
        holdUsed = false; // Allow hold again after locking
        clearLines();
        spawn();
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
            if (typeof GameSounds !== 'undefined') GameSounds.play('flip');
            if (typeof GameAnimations !== 'undefined') {
                const gameContainer = canvas ? canvas.parentElement : document.body;
                GameAnimations.showFlash(gameContainer);
            }
            const pts = [0, 100, 300, 500, 800];
            score += pts[cleared] * level;
            lines += cleared;
            level = Math.floor(lines / 10) + 1;
            dropInterval = Math.max(100, 1000 - (level - 1) * 80);
            updateUI();
            // Attack: send garbage lines to random opponent
            if (isMultiplayer && socket && cleared >= 1) {
                socket.emit('tetris_attack', {
                    room_id: ROOM_ID,
                    user_id: MY_USER,
                    lines: cleared
                });
            }
        }
    }

    // Receive garbage lines from opponent
    function receiveGarbage(garbageLines, hole) {
        if (gameOver || eliminated) return;
        for (let i = 0; i < garbageLines; i++) {
            // Remove top row
            board.shift();
            // Add garbage row at bottom: all filled except the hole
            const row = new Array(COLS).fill(8); // 8 = garbage block type
            row[hole] = 0;
            board.push(row);
        }
        // Check if current piece is now overlapping
        if (piece && !valid(piece.shape, piece.x, piece.y)) {
            // Try to push piece up
            while (piece.y > 0 && !valid(piece.shape, piece.x, piece.y)) {
                piece.y--;
            }
            if (!valid(piece.shape, piece.x, piece.y)) {
                endGame();
            }
        }
        if (typeof GameSounds !== 'undefined') GameSounds.play('buzz');
        if (typeof GameAnimations !== 'undefined') GameAnimations.showShake(canvas);
        draw();
    }

    function spawn() {
        piece = newPiece(nextPiece);
        nextPiece = randomType();
        lockDelayCounter = 0;
        isLanding = false;
        if (!valid(piece.shape, piece.x, piece.y)) endGame();
        drawNext();
    }

    // Hold piece functionality
    function holdPiece() {
        if (holdUsed || gameOver || paused) return;
        holdUsed = true;
        if (holdType === null) {
            holdType = piece.type;
            spawn();
        } else {
            const tmp = holdType;
            holdType = piece.type;
            piece = newPiece(tmp);
            lockDelayCounter = 0;
            isLanding = false;
        }
        drawHold();
        draw();
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
                if (typeof GameSounds !== 'undefined') GameSounds.play('lose');
                if (typeof GameAnimations !== 'undefined') GameAnimations.showShake(document.body);
                document.getElementById("game-over-title").textContent = "패배!";
                document.getElementById("game-over-overlay").classList.add("active");
            }
        } else {
            if (typeof GameSounds !== 'undefined') GameSounds.play('lose');
            if (typeof GameAnimations !== 'undefined') GameAnimations.showShake(document.body);
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

        ctx.strokeStyle = "rgba(167,139,250,0.08)";
        for (let r = 0; r <= ROWS; r++) {
            ctx.beginPath(); ctx.moveTo(0, r * BLOCK); ctx.lineTo(canvas.width, r * BLOCK); ctx.stroke();
        }
        for (let c = 0; c <= COLS; c++) {
            ctx.beginPath(); ctx.moveTo(c * BLOCK, 0); ctx.lineTo(c * BLOCK, canvas.height); ctx.stroke();
        }

        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
                if (board[r][c]) {
                    const color = board[r][c] === 8 ? GARBAGE_COLOR : COLORS[board[r][c]];
                    drawBlock(ctx, c, r, color);
                }

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

        broadcastState();
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

    function drawHold() {
        if (!holdCtx) return;
        holdCtx.clearRect(0, 0, holdCanvas.width, holdCanvas.height);
        if (holdType === null) return;
        const shape = SHAPES[holdType];
        const size = 22;
        const offsetX = (holdCanvas.width - shape[0].length * size) / 2;
        const offsetY = (holdCanvas.height - shape.length * size) / 2;
        for (let r = 0; r < shape.length; r++)
            for (let c = 0; c < shape[r].length; c++)
                if (shape[r][c]) {
                    holdCtx.fillStyle = holdUsed ? 'rgba(128,128,128,0.5)' : COLORS[holdType];
                    holdCtx.fillRect(offsetX + c * size, offsetY + r * size, size - 1, size - 1);
                }
    }

    // ===== Broadcast State (with throttle) =====
    function broadcastState() {
        if (!isMultiplayer || !socket || isSpectator || gameOver) return;
        const now = Date.now();
        if (now - lastBroadcast < BROADCAST_INTERVAL) return;
        lastBroadcast = now;
        const payload = {
            room_id: ROOM_ID,
            user_id: MY_USER,
            board: board,
            score: score,
            level: level,
            lines: lines
        };
        if (piece) {
            payload.piece = { type: piece.type, shape: piece.shape, x: piece.x, y: piece.y };
        }
        socket.emit('tetris_state', payload);
    }

    // ===== Opponent / Spectator Board Drawing =====
    function drawMiniBoard(canvasEl, boardData, isEliminated, pieceData) {
        const miniCtx = canvasEl.getContext('2d');
        const OB = canvasEl.width / COLS;
        miniCtx.fillStyle = isEliminated ? '#1a1a3e' : BG_COLOR;
        miniCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
        if (!boardData) return;

        // Grid lines
        miniCtx.strokeStyle = 'rgba(0,0,0,0.04)';
        for (let r = 0; r <= ROWS; r++) {
            miniCtx.beginPath(); miniCtx.moveTo(0, r * OB); miniCtx.lineTo(canvasEl.width, r * OB); miniCtx.stroke();
        }
        for (let c = 0; c <= COLS; c++) {
            miniCtx.beginPath(); miniCtx.moveTo(c * OB, 0); miniCtx.lineTo(c * OB, canvasEl.height); miniCtx.stroke();
        }

        // Locked blocks
        for (let r = 0; r < ROWS; r++)
            for (let c = 0; c < COLS; c++)
                if (boardData[r] && boardData[r][c]) {
                    const clr = boardData[r][c] === 8 ? GARBAGE_COLOR : (COLORS[boardData[r][c]] || '#999');
                    miniCtx.fillStyle = isEliminated ? '#bbb' : clr;
                    miniCtx.fillRect(c * OB, r * OB, OB - 1, OB - 1);
                    // Highlight
                    if (!isEliminated) {
                        miniCtx.fillStyle = 'rgba(255,255,255,0.2)';
                        miniCtx.fillRect(c * OB, r * OB, OB - 1, 1);
                        miniCtx.fillRect(c * OB, r * OB, 1, OB - 1);
                    }
                }

        // Active falling piece
        if (pieceData && !isEliminated) {
            const shape = pieceData.shape;
            const px = pieceData.x;
            const py = pieceData.y;
            const color = COLORS[pieceData.type] || '#999';

            // Ghost piece (drop shadow)
            let gy = py;
            const validMini = (s, sx, sy) => {
                for (let r = 0; r < s.length; r++)
                    for (let c = 0; c < s[r].length; c++) {
                        if (!s[r][c]) continue;
                        const nx = sx + c, ny = sy + r;
                        if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
                        if (ny >= 0 && boardData[ny] && boardData[ny][nx]) return false;
                    }
                return true;
            };
            while (validMini(shape, px, gy + 1)) gy++;
            if (gy !== py) {
                for (let r = 0; r < shape.length; r++)
                    for (let c = 0; c < shape[r].length; c++)
                        if (shape[r][c]) {
                            miniCtx.fillStyle = 'rgba(0,0,0,0.06)';
                            miniCtx.fillRect((px + c) * OB, (gy + r) * OB, OB - 1, OB - 1);
                        }
            }

            // Active piece
            for (let r = 0; r < shape.length; r++)
                for (let c = 0; c < shape[r].length; c++)
                    if (shape[r][c]) {
                        miniCtx.fillStyle = color;
                        miniCtx.fillRect((px + c) * OB, (py + r) * OB, OB - 1, OB - 1);
                        miniCtx.fillStyle = 'rgba(255,255,255,0.2)';
                        miniCtx.fillRect((px + c) * OB, (py + r) * OB, OB - 1, 1);
                        miniCtx.fillRect((px + c) * OB, (py + r) * OB, 1, OB - 1);
                    }
        }

        if (isEliminated) {
            miniCtx.fillStyle = 'rgba(0,0,0,0.4)';
            miniCtx.fillRect(0, 0, canvasEl.width, canvasEl.height);
            miniCtx.fillStyle = '#fff';
            miniCtx.font = `bold ${Math.max(10, Math.floor(OB * 2))}px sans-serif`;
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
            createSinglePanel(panel, p);
            opponents[p] = { board: null, score: 0, level: 1, lines: 0, eliminated: false, piece: null };
        });
        sortOpponentPanels();
    }

    function createSinglePanel(container, userId) {
        const div = document.createElement('div');
        div.className = 'opponent-panel';
        div.id = 'opp-' + userId;
        div.setAttribute('data-user', userId);
        div.innerHTML = `
            <div class="opponent-rank-badge"></div>
            <h4>${userId}</h4>
            <canvas class="opponent-canvas" width="150" height="300"></canvas>
            <div class="opponent-score-label">점수: <span class="opponent-score">0</span></div>
        `;
        container.appendChild(div);
    }

    function sortOpponentPanels() {
        const panel = document.getElementById('opponents-panel');
        if (!panel) return;
        const sorted = Object.entries(opponents).sort((a, b) => {
            if (a[1].eliminated !== b[1].eliminated) return a[1].eliminated ? 1 : -1;
            return b[1].score - a[1].score;
        });
        sorted.forEach(([uid, data], idx) => {
            const el = document.getElementById('opp-' + uid);
            if (!el) return;
            panel.appendChild(el);
            const rank = idx + 1;
            el.classList.remove('rank-top', 'rank-lower');
            if (rank <= 3) {
                el.classList.add('rank-top');
            } else {
                el.classList.add('rank-lower');
            }
            const canvas = el.querySelector('.opponent-canvas');
            if (canvas) {
                if (rank <= 3) {
                    canvas.width = 150; canvas.height = 300;
                } else {
                    canvas.width = 80; canvas.height = 160;
                }
            }
            const badge = el.querySelector('.opponent-rank-badge');
            if (badge) {
                badge.textContent = data.eliminated ? '탈락' : '#' + rank;
                badge.className = 'opponent-rank-badge' + (data.eliminated ? ' badge-eliminated' : rank <= 3 ? ' badge-top' : '');
            }
            if (canvas) drawMiniBoard(canvas, data.board, data.eliminated, data.piece);
        });
    }

    let lastSortOrder = '';
    function sortIfChanged() {
        const sorted = Object.entries(opponents).sort((a, b) => {
            if (a[1].eliminated !== b[1].eliminated) return a[1].eliminated ? 1 : -1;
            return b[1].score - a[1].score;
        });
        const key = sorted.map(([uid, d]) => uid + ':' + d.score + ':' + d.eliminated).join(',');
        if (key !== lastSortOrder) {
            lastSortOrder = key;
            sortOpponentPanels();
        }
    }

    function updateOpponent(userId, data) {
        if (!opponents[userId]) return;
        opponents[userId].board = data.board;
        opponents[userId].score = data.score;
        opponents[userId].level = data.level || 1;
        opponents[userId].lines = data.lines || 0;
        if (data.piece) opponents[userId].piece = data.piece;
        else opponents[userId].piece = null;

        const panel = document.getElementById('opp-' + userId);
        if (panel) {
            drawMiniBoard(panel.querySelector('.opponent-canvas'), data.board, opponents[userId].eliminated, opponents[userId].piece);
            const scoreEl = panel.querySelector('.opponent-score');
            if (scoreEl) scoreEl.textContent = data.score;
        }
        sortIfChanged();
    }

    // ===== Game Loop =====
    function drop() {
        if (gameOver || paused) return;
        if (valid(piece.shape, piece.x, piece.y + 1)) {
            piece.y++;
            isLanding = false;
            lockDelayCounter = 0;
        } else {
            // Lock delay: piece is on ground, count ticks before locking
            if (!isLanding) {
                isLanding = true;
                lockDelayCounter = 0;
            }
            lockDelayCounter++;
            if (lockDelayCounter >= LOCK_DELAY_MAX) {
                lock();
            }
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
        holdType = null;
        holdUsed = false;
        lockDelayCounter = 0;
        isLanding = false;
        pieceBag = []; // Reset bag for new game
        // Solo mode: use random seed
        if (!isMultiplayer) {
            rngSeed = Math.floor(Math.random() * 0xFFFFFFFF);
        }
        nextPiece = randomType();
        spawn();
        updateUI();
        drawHold();
        draw();
        clearInterval(timer);
        timer = setInterval(drop, dropInterval);
        document.getElementById("game-over-overlay").classList.remove("active");
    }

    // ===== Input =====
    if (!isSpectator) {
        document.addEventListener("keydown", (e) => {
            if (["ArrowLeft","ArrowRight","ArrowDown","ArrowUp"," ","Shift"].includes(e.key)) {
                e.preventDefault();
            }
            if (gameOver || paused) return;
            if (isMultiplayer && !gameReady) return;
            switch (e.key) {
                case "ArrowLeft":
                    if (valid(piece.shape, piece.x - 1, piece.y)) {
                        piece.x--;
                        // Reset lock delay on successful move while landing
                        if (isLanding) lockDelayCounter = 0;
                    }
                    break;
                case "ArrowRight":
                    if (valid(piece.shape, piece.x + 1, piece.y)) {
                        piece.x++;
                        if (isLanding) lockDelayCounter = 0;
                    }
                    break;
                case "ArrowDown":
                    if (valid(piece.shape, piece.x, piece.y + 1)) {
                        piece.y++;
                        if (isLanding) { isLanding = false; lockDelayCounter = 0; }
                        score += 1;
                        updateUI();
                    }
                    break;
                case "ArrowUp": {
                    const rotated = rotate(piece.shape);
                    let kicked = false;
                    for (const dx of [0, -1, 1, -2, 2]) {
                        if (valid(rotated, piece.x + dx, piece.y)) {
                            piece.shape = rotated;
                            piece.x += dx;
                            kicked = true;
                            break;
                        }
                    }
                    // Reset lock delay on successful rotation while landing
                    if (kicked && isLanding) lockDelayCounter = 0;
                    break;
                }
                case " ":
                    hardDrop();
                    break;
                case "Shift":
                    holdPiece();
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

        socket.on('room_destroyed', () => {
            if (!gameOver) window.location.href = '/';
        });
        socket.on('room_force_closed', (data) => {
            alert(data.message || '관리자에 의해 방이 강제 종료되었습니다.');
            window.location.replace('/');
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
                        }
                    }
                }
                sortIfChanged();
            });

            socket.on('player_eliminated', (data) => {
                if (opponents[data.user_id]) {
                    opponents[data.user_id].eliminated = true;
                    sortIfChanged();
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

            window.addEventListener('beforeunload', () => {
                if (!gameOver && gameReady) {
                    socket.emit('game_over_event', { room_id: ROOM_ID, loser: MY_USER });
                }
            });

            socket.on('game_ready', (data) => {
                // Set synchronized seed for piece queue
                if (data && data.seed !== undefined) {
                    rngSeed = data.seed;
                }
                const el = document.getElementById('mp-status');
                let countdown = 7;
                if (el) {
                    el.style.display = '';
                    el.innerHTML = '<span class="countdown-num">' + countdown + '</span>';
                }
                const cdInterval = setInterval(() => {
                    countdown--;
                    if (countdown > 0) {
                        if (el) el.innerHTML = '<span class="countdown-num">' + countdown + '</span>';
                    } else {
                        clearInterval(cdInterval);
                        gameReady = true;
                        if (el) el.textContent = '게임 시작!';
                        setTimeout(() => { if (el) el.style.display = 'none'; }, 800);
                        startGame();
                    }
                }, 1000);
            });

            socket.on('opponent_state', (data) => {
                updateOpponent(data.user_id, data);
            });

            socket.on('player_eliminated', (data) => {
                if (opponents[data.user_id]) {
                    opponents[data.user_id].eliminated = true;
                    opponents[data.user_id].piece = null;
                    sortIfChanged();
                }
            });

            // Receive garbage lines from attacker
            socket.on('tetris_garbage', (data) => {
                receiveGarbage(data.lines, data.hole);
            });

            socket.on('game_winner', (data) => {
                if (gameOver && !eliminated) return;
                gameOver = true;
                clearInterval(timer);
                const scoreEl = document.getElementById("final-score");
                if (scoreEl) scoreEl.textContent = score;
                const titleEl = document.getElementById("game-over-title");
                if (data.winner === MY_USER) {
                    if (typeof GameSounds !== 'undefined') GameSounds.play('win');
                    if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();
                    titleEl.textContent = '승리!';
                } else {
                    if (typeof GameSounds !== 'undefined') GameSounds.play('lose');
                    if (typeof GameAnimations !== 'undefined') GameAnimations.showShake(document.body);
                    titleEl.textContent = '패배!';
                }
                document.getElementById("game-over-overlay").classList.add("active");
            });

            // For 2-player mode: opponent_game_over
            socket.on('opponent_game_over', () => {
                if (gameOver) return;
                gameOver = true;
                clearInterval(timer);
                if (typeof GameSounds !== 'undefined') GameSounds.play('win');
                if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();
                document.getElementById("final-score").textContent = score;
                document.getElementById("game-over-title").innerHTML = '승리!';
                document.getElementById("game-over-overlay").classList.add("active");
            });

            socket.on('opponent_disconnected', (data) => {
                const uid = data.user_id;
                if (opponents[uid]) {
                    opponents[uid].eliminated = true;
                    opponents[uid].piece = null;
                    sortIfChanged();
                }
                // For 2-player
                if (typeof ROOM_PLAYERS !== 'undefined' && ROOM_PLAYERS.length <= 2) {
                    if (gameOver) return;
                    gameOver = true;
                    clearInterval(timer);
                    if (typeof GameSounds !== 'undefined') GameSounds.play('win');
                    if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();
                    document.getElementById("final-score").textContent = score;
                    document.getElementById("game-over-title").innerHTML = '승리!<br><span class="disconnect-sub">상대방이 나갔습니다!</span>';
                    document.getElementById("game-over-overlay").classList.add("active");
                }
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
            if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); sendChat(); }
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

    // Initial draw (solo mode)
    if (!isSpectator) {
        board = createBoard();
        draw();
    }
})();
