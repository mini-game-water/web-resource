(() => {
    const canvas = document.getElementById("omok-board");
    const ctx = canvas.getContext("2d");
    const SIZE = 15;
    const PADDING = 20;
    const CELL = (canvas.width - PADDING * 2) / (SIZE - 1);

    let board, currentPlayer, gameOver;

    function init() {
        board = Array.from({ length: SIZE }, () => new Array(SIZE).fill(0));
        currentPlayer = 1; // 1 = black, 2 = white
        gameOver = false;
        updateStatus();
        draw();
        document.getElementById("win-overlay").classList.remove("active");
    }

    function updateStatus() {
        const text = currentPlayer === 1 ? "Black's Turn (●)" : "White's Turn (○)";
        document.getElementById("status").textContent = text;
    }

    // ===== Drawing =====
    function draw() {
        // Board background
        ctx.fillStyle = "#c8a860";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Grid lines
        ctx.strokeStyle = "#6b5a3e";
        ctx.lineWidth = 1;
        for (let i = 0; i < SIZE; i++) {
            const pos = PADDING + i * CELL;
            ctx.beginPath();
            ctx.moveTo(PADDING, pos);
            ctx.lineTo(canvas.width - PADDING, pos);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(pos, PADDING);
            ctx.lineTo(pos, canvas.height - PADDING);
            ctx.stroke();
        }

        // Star points (dots)
        const stars = [3, 7, 11];
        ctx.fillStyle = "#6b5a3e";
        for (const r of stars) {
            for (const c of stars) {
                ctx.beginPath();
                ctx.arc(PADDING + c * CELL, PADDING + r * CELL, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Stones
        for (let r = 0; r < SIZE; r++) {
            for (let c = 0; c < SIZE; c++) {
                if (board[r][c] === 0) continue;
                const x = PADDING + c * CELL;
                const y = PADDING + r * CELL;
                const radius = CELL * 0.43;

                ctx.beginPath();
                ctx.arc(x, y, radius, 0, Math.PI * 2);
                if (board[r][c] === 1) {
                    // Black stone with gradient
                    const grad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
                    grad.addColorStop(0, "#555");
                    grad.addColorStop(1, "#111");
                    ctx.fillStyle = grad;
                } else {
                    // White stone with gradient
                    const grad = ctx.createRadialGradient(x - 3, y - 3, 2, x, y, radius);
                    grad.addColorStop(0, "#fff");
                    grad.addColorStop(1, "#ccc");
                    ctx.fillStyle = grad;
                }
                ctx.fill();
                ctx.strokeStyle = board[r][c] === 1 ? "#000" : "#999";
                ctx.lineWidth = 1;
                ctx.stroke();
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

    // ===== Input =====
    canvas.addEventListener("click", (e) => {
        if (gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        const col = Math.round((mx - PADDING) / CELL);
        const row = Math.round((my - PADDING) / CELL);

        if (row < 0 || row >= SIZE || col < 0 || col >= SIZE) return;
        if (board[row][col] !== 0) return;

        board[row][col] = currentPlayer;
        draw();

        if (checkWin(row, col, currentPlayer)) {
            gameOver = true;
            const winner = currentPlayer === 1 ? "Black (●)" : "White (○)";
            document.getElementById("status").textContent = winner + " Wins!";
            document.getElementById("win-message").textContent = winner + " Wins!";
            document.getElementById("win-overlay").classList.add("active");
            return;
        }

        currentPlayer = currentPlayer === 1 ? 2 : 1;
        updateStatus();
    });

    document.getElementById("restart-btn").addEventListener("click", init);
    document.getElementById("overlay-restart-btn").addEventListener("click", init);

    init();
})();
