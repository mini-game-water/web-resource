(() => {
    const canvas = document.getElementById("tetris-board");
    const ctx = canvas.getContext("2d");
    const nextCanvas = document.getElementById("next-piece");
    const nextCtx = nextCanvas.getContext("2d");

    const COLS = 10;
    const ROWS = 20;
    const BLOCK = 30;
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

    // Tetromino shapes (rotation states)
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

    let board, piece, nextPiece, score, level, lines, gameOver, paused, dropInterval, timer;

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
        return {
            type,
            shape,
            x: Math.floor((COLS - shape[0].length) / 2),
            y: 0,
        };
    }

    function rotate(shape) {
        const N = shape.length;
        const rotated = Array.from({ length: N }, () => new Array(N).fill(0));
        for (let r = 0; r < N; r++) {
            for (let c = 0; c < N; c++) {
                rotated[c][N - 1 - r] = shape[r][c];
            }
        }
        return rotated;
    }

    function valid(shape, px, py) {
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (!shape[r][c]) continue;
                const nx = px + c;
                const ny = py + r;
                if (nx < 0 || nx >= COLS || ny >= ROWS) return false;
                if (ny >= 0 && board[ny][nx]) return false;
            }
        }
        return true;
    }

    function lock() {
        for (let r = 0; r < piece.shape.length; r++) {
            for (let c = 0; c < piece.shape[r].length; c++) {
                if (!piece.shape[r][c]) continue;
                const ny = piece.y + r;
                if (ny < 0) { endGame(); return; }
                board[ny][piece.x + c] = piece.type;
            }
        }
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
                r++; // recheck same row
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
        if (!valid(piece.shape, piece.x, piece.y)) {
            endGame();
        }
        drawNext();
    }

    function endGame() {
        gameOver = true;
        clearInterval(timer);
        document.getElementById("final-score").textContent = score;
        document.getElementById("game-over-overlay").classList.add("active");
    }

    function updateUI() {
        document.getElementById("score").textContent = score;
        document.getElementById("level").textContent = level;
        document.getElementById("lines").textContent = lines;
    }

    // ===== Drawing =====
    function drawBlock(context, x, y, color, size = BLOCK) {
        context.fillStyle = color;
        context.fillRect(x * size, y * size, size - 1, size - 1);
        context.fillStyle = "rgba(255,255,255,0.15)";
        context.fillRect(x * size, y * size, size - 1, 3);
        context.fillRect(x * size, y * size, 3, size - 1);
    }

    function draw() {
        // Clear
        ctx.fillStyle = "#1a1a2e";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid lines
        ctx.strokeStyle = "rgba(255,255,255,0.03)";
        for (let r = 0; r <= ROWS; r++) {
            ctx.beginPath(); ctx.moveTo(0, r * BLOCK); ctx.lineTo(canvas.width, r * BLOCK); ctx.stroke();
        }
        for (let c = 0; c <= COLS; c++) {
            ctx.beginPath(); ctx.moveTo(c * BLOCK, 0); ctx.lineTo(c * BLOCK, canvas.height); ctx.stroke();
        }

        // Board
        for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
                if (board[r][c]) drawBlock(ctx, c, r, COLORS[board[r][c]]);
            }
        }

        // Ghost piece
        if (piece && !gameOver) {
            let gy = piece.y;
            while (valid(piece.shape, piece.x, gy + 1)) gy++;
            for (let r = 0; r < piece.shape.length; r++) {
                for (let c = 0; c < piece.shape[r].length; c++) {
                    if (piece.shape[r][c]) {
                        ctx.fillStyle = "rgba(255,255,255,0.08)";
                        ctx.fillRect((piece.x + c) * BLOCK, (gy + r) * BLOCK, BLOCK - 1, BLOCK - 1);
                    }
                }
            }
        }

        // Current piece
        if (piece) {
            for (let r = 0; r < piece.shape.length; r++) {
                for (let c = 0; c < piece.shape[r].length; c++) {
                    if (piece.shape[r][c]) {
                        drawBlock(ctx, piece.x + c, piece.y + r, COLORS[piece.type]);
                    }
                }
            }
        }
    }

    function drawNext() {
        nextCtx.fillStyle = "transparent";
        nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
        const shape = SHAPES[nextPiece];
        const size = 22;
        const offsetX = (nextCanvas.width - shape[0].length * size) / 2;
        const offsetY = (nextCanvas.height - shape.length * size) / 2;
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (shape[r][c]) {
                    nextCtx.fillStyle = COLORS[nextPiece];
                    nextCtx.fillRect(offsetX + c * size, offsetY + r * size, size - 1, size - 1);
                }
            }
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
        gameOver = false; paused = false;
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
    document.addEventListener("keydown", (e) => {
        if (gameOver || paused) return;
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
                // Wall kick: try 0, -1, +1, -2, +2
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

    document.getElementById("start-btn").addEventListener("click", startGame);
    document.getElementById("restart-btn").addEventListener("click", startGame);
    document.getElementById("pause-btn").addEventListener("click", () => {
        if (gameOver) return;
        paused = !paused;
        document.getElementById("pause-btn").textContent = paused ? "Resume" : "Pause";
    });

    // Initial draw
    board = createBoard();
    draw();
})();
