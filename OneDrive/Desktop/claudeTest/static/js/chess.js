(() => {
    const canvas = document.getElementById("chess-board");
    const ctx = canvas.getContext("2d");
    const SQ = 70; // square size
    const BOARD_SIZE = 8;

    // Piece symbols (Unicode chess pieces)
    const PIECE_SYMBOLS = {
        K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
        k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
    };

    // Initial board layout (uppercase = white, lowercase = black)
    const INITIAL_BOARD = [
        ["r","n","b","q","k","b","n","r"],
        ["p","p","p","p","p","p","p","p"],
        [" "," "," "," "," "," "," "," "],
        [" "," "," "," "," "," "," "," "],
        [" "," "," "," "," "," "," "," "],
        [" "," "," "," "," "," "," "," "],
        ["P","P","P","P","P","P","P","P"],
        ["R","N","B","Q","K","B","N","R"],
    ];

    let board, selected, turn, moveHistory, gameOver;
    let castleRights, enPassant;

    function init() {
        board = INITIAL_BOARD.map(r => [...r]);
        selected = null;
        turn = "w"; // w=white, b=black
        moveHistory = [];
        gameOver = false;
        castleRights = { wK: true, wQ: true, bK: true, bQ: true };
        enPassant = null; // { row, col } target square
        document.getElementById("move-list").innerHTML = "";
        document.getElementById("status").textContent = "White's Turn";
        document.getElementById("game-over-overlay").classList.remove("active");
        draw();
    }

    function isWhite(p) { return p !== " " && p === p.toUpperCase(); }
    function isBlack(p) { return p !== " " && p === p.toLowerCase(); }
    function isAlly(p, side) { return side === "w" ? isWhite(p) : isBlack(p); }
    function isEnemy(p, side) { return side === "w" ? isBlack(p) : isWhite(p); }
    function isEmpty(r, c) { return inBounds(r, c) && board[r][c] === " "; }
    function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

    // ===== Move Generation =====
    function pseudoMoves(r, c) {
        const piece = board[r][c];
        if (piece === " ") return [];
        const side = isWhite(piece) ? "w" : "b";
        const type = piece.toUpperCase();
        const moves = [];

        const addIf = (nr, nc) => {
            if (!inBounds(nr, nc)) return false;
            if (isAlly(board[nr][nc], side)) return false;
            moves.push([nr, nc]);
            return board[nr][nc] === " ";
        };

        const slide = (dirs) => {
            for (const [dr, dc] of dirs) {
                for (let i = 1; i < 8; i++) {
                    if (!addIf(r + dr * i, c + dc * i)) break;
                }
            }
        };

        switch (type) {
            case "P": {
                const dir = side === "w" ? -1 : 1;
                const startRow = side === "w" ? 6 : 1;
                // Forward
                if (isEmpty(r + dir, c)) {
                    moves.push([r + dir, c]);
                    if (r === startRow && isEmpty(r + dir * 2, c)) {
                        moves.push([r + dir * 2, c]);
                    }
                }
                // Captures
                for (const dc of [-1, 1]) {
                    const nr = r + dir, nc = c + dc;
                    if (inBounds(nr, nc) && isEnemy(board[nr][nc], side)) {
                        moves.push([nr, nc]);
                    }
                    // En passant
                    if (enPassant && enPassant.row === nr && enPassant.col === nc) {
                        moves.push([nr, nc]);
                    }
                }
                break;
            }
            case "N":
                for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
                    addIf(r + dr, c + dc);
                }
                break;
            case "B": slide([[-1,-1],[-1,1],[1,-1],[1,1]]); break;
            case "R": slide([[-1,0],[1,0],[0,-1],[0,1]]); break;
            case "Q": slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]); break;
            case "K":
                for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
                    addIf(r + dr, c + dc);
                }
                // Castling
                if (side === "w" && r === 7 && c === 4) {
                    if (castleRights.wK && board[7][5] === " " && board[7][6] === " " && board[7][7] === "R") {
                        if (!isSquareAttacked(7, 4, "b") && !isSquareAttacked(7, 5, "b") && !isSquareAttacked(7, 6, "b")) {
                            moves.push([7, 6]);
                        }
                    }
                    if (castleRights.wQ && board[7][3] === " " && board[7][2] === " " && board[7][1] === " " && board[7][0] === "R") {
                        if (!isSquareAttacked(7, 4, "b") && !isSquareAttacked(7, 3, "b") && !isSquareAttacked(7, 2, "b")) {
                            moves.push([7, 2]);
                        }
                    }
                }
                if (side === "b" && r === 0 && c === 4) {
                    if (castleRights.bK && board[0][5] === " " && board[0][6] === " " && board[0][7] === "r") {
                        if (!isSquareAttacked(0, 4, "w") && !isSquareAttacked(0, 5, "w") && !isSquareAttacked(0, 6, "w")) {
                            moves.push([0, 6]);
                        }
                    }
                    if (castleRights.bQ && board[0][3] === " " && board[0][2] === " " && board[0][1] === " " && board[0][0] === "r") {
                        if (!isSquareAttacked(0, 4, "w") && !isSquareAttacked(0, 3, "w") && !isSquareAttacked(0, 2, "w")) {
                            moves.push([0, 2]);
                        }
                    }
                }
                break;
        }
        return moves;
    }

    function isSquareAttacked(r, c, bySide) {
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (!isAlly(board[row][col], bySide)) continue;
                // Use pseudoMoves but avoid recursion for king (castling check)
                const piece = board[row][col];
                const type = piece.toUpperCase();
                if (type === "K") {
                    if (Math.abs(row - r) <= 1 && Math.abs(col - c) <= 1) return true;
                    continue;
                }
                const moves = pseudoMoves(row, col);
                if (moves.some(([mr, mc]) => mr === r && mc === c)) return true;
            }
        }
        return false;
    }

    function findKing(side) {
        const k = side === "w" ? "K" : "k";
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (board[r][c] === k) return [r, c];
            }
        }
        return null;
    }

    function isInCheck(side) {
        const [kr, kc] = findKing(side);
        const enemy = side === "w" ? "b" : "w";
        return isSquareAttacked(kr, kc, enemy);
    }

    function legalMoves(r, c) {
        const piece = board[r][c];
        const side = isWhite(piece) ? "w" : "b";
        const moves = pseudoMoves(r, c);
        return moves.filter(([nr, nc]) => {
            // Simulate move
            const captured = board[nr][nc];
            const oldEP = enPassant;
            let epCaptured = " ";

            // En passant capture
            if (piece.toUpperCase() === "P" && enPassant && nr === enPassant.row && nc === enPassant.col) {
                const epRow = side === "w" ? nr + 1 : nr - 1;
                epCaptured = board[epRow][nc];
                board[epRow][nc] = " ";
            }

            board[nr][nc] = piece;
            board[r][c] = " ";

            const legal = !isInCheck(side);

            // Undo
            board[r][c] = piece;
            board[nr][nc] = captured;
            if (epCaptured !== " ") {
                const epRow = side === "w" ? nr + 1 : nr - 1;
                board[epRow][nc] = epCaptured;
            }

            return legal;
        });
    }

    // ===== Move Execution =====
    function makeMove(fr, fc, tr, tc) {
        const piece = board[fr][fc];
        const side = isWhite(piece) ? "w" : "b";
        const captured = board[tr][tc];
        const type = piece.toUpperCase();

        // En passant capture
        if (type === "P" && enPassant && tr === enPassant.row && tc === enPassant.col) {
            const epRow = side === "w" ? tr + 1 : tr - 1;
            board[epRow][tc] = " ";
        }

        // Set en passant target
        if (type === "P" && Math.abs(tr - fr) === 2) {
            enPassant = { row: (fr + tr) / 2, col: fc };
        } else {
            enPassant = null;
        }

        // Castling
        if (type === "K" && Math.abs(tc - fc) === 2) {
            if (tc === 6) { // Kingside
                board[fr][5] = board[fr][7];
                board[fr][7] = " ";
            } else { // Queenside
                board[fr][3] = board[fr][0];
                board[fr][0] = " ";
            }
        }

        // Update castle rights
        if (type === "K") {
            if (side === "w") { castleRights.wK = false; castleRights.wQ = false; }
            else { castleRights.bK = false; castleRights.bQ = false; }
        }
        if (type === "R") {
            if (fr === 7 && fc === 0) castleRights.wQ = false;
            if (fr === 7 && fc === 7) castleRights.wK = false;
            if (fr === 0 && fc === 0) castleRights.bQ = false;
            if (fr === 0 && fc === 7) castleRights.bK = false;
        }

        board[tr][tc] = piece;
        board[fr][fc] = " ";

        // Pawn promotion (auto-queen)
        if (type === "P" && (tr === 0 || tr === 7)) {
            board[tr][tc] = side === "w" ? "Q" : "q";
        }

        // Record move
        const colNames = "abcdefgh";
        const from = colNames[fc] + (8 - fr);
        const to = colNames[tc] + (8 - tr);
        const notation = (PIECE_SYMBOLS[piece] || "") + from + (captured !== " " ? "x" : "") + to;
        moveHistory.push({ fr, fc, tr, tc, piece, captured, notation });

        // Update move list
        const moveListEl = document.getElementById("move-list");
        const moveNum = Math.ceil(moveHistory.length / 2);
        if (side === "w") {
            moveListEl.innerHTML += `<div>${moveNum}. ${notation}`;
        } else {
            moveListEl.innerHTML = moveListEl.innerHTML.replace(/<\/div>$/, ` &nbsp; ${notation}</div>`);
        }
        moveListEl.scrollTop = moveListEl.scrollHeight;

        // Switch turn
        turn = turn === "w" ? "b" : "w";

        // Check game state
        checkGameState();
    }

    function checkGameState() {
        const hasLegalMove = (() => {
            for (let r = 0; r < 8; r++) {
                for (let c = 0; c < 8; c++) {
                    if (!isAlly(board[r][c], turn)) continue;
                    if (legalMoves(r, c).length > 0) return true;
                }
            }
            return false;
        })();

        const inCheck = isInCheck(turn);
        const turnName = turn === "w" ? "White" : "Black";

        if (!hasLegalMove) {
            gameOver = true;
            if (inCheck) {
                const winner = turn === "w" ? "Black" : "White";
                document.getElementById("status").textContent = `Checkmate! ${winner} wins!`;
                document.getElementById("game-over-message").textContent = `Checkmate! ${winner} wins!`;
            } else {
                document.getElementById("status").textContent = "Stalemate! Draw!";
                document.getElementById("game-over-message").textContent = "Stalemate! Draw!";
            }
            document.getElementById("game-over-overlay").classList.add("active");
        } else if (inCheck) {
            document.getElementById("status").textContent = `${turnName}'s Turn (Check!)`;
        } else {
            document.getElementById("status").textContent = `${turnName}'s Turn`;
        }
    }

    // ===== Drawing =====
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const lightColor = "#e8d5b5";
        const darkColor = "#b58863";
        const selectedColor = "rgba(102, 126, 234, 0.5)";
        const moveColor = "rgba(102, 126, 234, 0.3)";

        const validMoves = selected ? legalMoves(selected[0], selected[1]) : [];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const isLight = (r + c) % 2 === 0;
                ctx.fillStyle = isLight ? lightColor : darkColor;

                if (selected && selected[0] === r && selected[1] === c) {
                    ctx.fillStyle = selectedColor;
                }

                ctx.fillRect(c * SQ, r * SQ, SQ, SQ);

                // Legal move indicators
                if (validMoves.some(([mr, mc]) => mr === r && mc === c)) {
                    ctx.fillStyle = moveColor;
                    if (board[r][c] !== " ") {
                        // Capture: ring
                        ctx.fillRect(c * SQ, r * SQ, SQ, SQ);
                    } else {
                        // Move: dot
                        ctx.beginPath();
                        ctx.arc(c * SQ + SQ / 2, r * SQ + SQ / 2, 10, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }

                // Draw piece
                if (board[r][c] !== " ") {
                    ctx.fillStyle = isWhite(board[r][c]) ? "#fff" : "#222";
                    ctx.font = `${SQ * 0.7}px serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(PIECE_SYMBOLS[board[r][c]], c * SQ + SQ / 2, r * SQ + SQ / 2 + 2);

                    // Outline for white pieces
                    if (isWhite(board[r][c])) {
                        ctx.strokeStyle = "#333";
                        ctx.lineWidth = 0.5;
                        ctx.strokeText(PIECE_SYMBOLS[board[r][c]], c * SQ + SQ / 2, r * SQ + SQ / 2 + 2);
                    }
                }
            }
        }

        // Rank/file labels
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        for (let r = 0; r < 8; r++) {
            ctx.fillStyle = r % 2 === 0 ? darkColor : lightColor;
            ctx.fillText(8 - r, 2, r * SQ + 2);
        }
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        for (let c = 0; c < 8; c++) {
            ctx.fillStyle = c % 2 !== 0 ? darkColor : lightColor;
            ctx.fillText("abcdefgh"[c], c * SQ + SQ - 2, canvas.height - 2);
        }
    }

    // ===== Input =====
    canvas.addEventListener("click", (e) => {
        if (gameOver) return;
        const rect = canvas.getBoundingClientRect();
        const col = Math.floor((e.clientX - rect.left) / SQ);
        const row = Math.floor((e.clientY - rect.top) / SQ);
        if (!inBounds(row, col)) return;

        if (selected) {
            const moves = legalMoves(selected[0], selected[1]);
            const isLegal = moves.some(([mr, mc]) => mr === row && mc === col);

            if (isLegal) {
                makeMove(selected[0], selected[1], row, col);
                selected = null;
                draw();
                return;
            }

            // Clicked another own piece? Re-select
            if (isAlly(board[row][col], turn)) {
                selected = [row, col];
                draw();
                return;
            }

            selected = null;
            draw();
            return;
        }

        if (isAlly(board[row][col], turn)) {
            selected = [row, col];
            draw();
        }
    });

    document.getElementById("restart-btn").addEventListener("click", init);
    document.getElementById("overlay-restart-btn").addEventListener("click", init);
    document.getElementById("undo-btn").addEventListener("click", () => {
        // Simple undo: reload - full undo would require saving state history
        // For now, this is a no-op placeholder
    });

    init();
})();
