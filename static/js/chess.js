(() => {
    const canvas = document.getElementById("chess-board");
    const ctx = canvas.getContext("2d");
    const SQ = 85;
    const BOARD_SIZE = 8;

    // Multiplayer
    const isMultiplayer = typeof ROOM_ID !== 'undefined' && ROOM_ID;
    const isSpectator = typeof IS_SPECTATOR !== 'undefined' && IS_SPECTATOR;
    const mySide = isMultiplayer && !isSpectator ? (MY_PLAYER === 1 ? "w" : "b") : null;
    const flipBoard = isMultiplayer && !isSpectator && mySide === "b";
    let socket = null;
    let gameReady = !isMultiplayer || isSpectator;

    const PIECE_SYMBOLS = {
        K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙",
        k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟",
    };

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

    // Coaching from spectators
    let coachingArrows = {}; // user_id -> { fr, fc, tr, tc }
    let coachingDots = {};   // user_id -> { row, col } (first-click indicator)
    let coachingClickFirst = null;

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
        board = INITIAL_BOARD.map(r => [...r]);
        selected = null;
        turn = "w";
        moveHistory = [];
        gameOver = false;
        castleRights = { wK: true, wQ: true, bK: true, bQ: true };
        enPassant = null;
        coachingArrows = {};
        coachingDots = {};
        coachingClickFirst = null;
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
            for (const [dr, dc] of dirs)
                for (let i = 1; i < 8; i++)
                    if (!addIf(r + dr * i, c + dc * i)) break;
        };

        switch (type) {
            case "P": {
                const dir = side === "w" ? -1 : 1;
                const startRow = side === "w" ? 6 : 1;
                if (isEmpty(r + dir, c)) {
                    moves.push([r + dir, c]);
                    if (r === startRow && isEmpty(r + dir * 2, c)) moves.push([r + dir * 2, c]);
                }
                for (const dc of [-1, 1]) {
                    const nr = r + dir, nc = c + dc;
                    if (inBounds(nr, nc) && isEnemy(board[nr][nc], side)) moves.push([nr, nc]);
                    if (enPassant && enPassant.row === nr && enPassant.col === nc) moves.push([nr, nc]);
                }
                break;
            }
            case "N":
                for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]])
                    addIf(r + dr, c + dc);
                break;
            case "B": slide([[-1,-1],[-1,1],[1,-1],[1,1]]); break;
            case "R": slide([[-1,0],[1,0],[0,-1],[0,1]]); break;
            case "Q": slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]); break;
            case "K":
                for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]])
                    addIf(r + dr, c + dc);
                if (side === "w" && r === 7 && c === 4) {
                    if (castleRights.wK && board[7][5] === " " && board[7][6] === " " && board[7][7] === "R")
                        if (!isSquareAttacked(7, 4, "b") && !isSquareAttacked(7, 5, "b") && !isSquareAttacked(7, 6, "b"))
                            moves.push([7, 6]);
                    if (castleRights.wQ && board[7][3] === " " && board[7][2] === " " && board[7][1] === " " && board[7][0] === "R")
                        if (!isSquareAttacked(7, 4, "b") && !isSquareAttacked(7, 3, "b") && !isSquareAttacked(7, 2, "b"))
                            moves.push([7, 2]);
                }
                if (side === "b" && r === 0 && c === 4) {
                    if (castleRights.bK && board[0][5] === " " && board[0][6] === " " && board[0][7] === "r")
                        if (!isSquareAttacked(0, 4, "w") && !isSquareAttacked(0, 5, "w") && !isSquareAttacked(0, 6, "w"))
                            moves.push([0, 6]);
                    if (castleRights.bQ && board[0][3] === " " && board[0][2] === " " && board[0][1] === " " && board[0][0] === "r")
                        if (!isSquareAttacked(0, 4, "w") && !isSquareAttacked(0, 3, "w") && !isSquareAttacked(0, 2, "w"))
                            moves.push([0, 2]);
                }
                break;
        }
        return moves;
    }

    function isSquareAttacked(r, c, bySide) {
        for (let row = 0; row < 8; row++)
            for (let col = 0; col < 8; col++) {
                if (!isAlly(board[row][col], bySide)) continue;
                const type = board[row][col].toUpperCase();
                if (type === "K") {
                    if (Math.abs(row - r) <= 1 && Math.abs(col - c) <= 1) return true;
                    continue;
                }
                if (pseudoMoves(row, col).some(([mr, mc]) => mr === r && mc === c)) return true;
            }
        return false;
    }

    function findKing(side) {
        const k = side === "w" ? "K" : "k";
        for (let r = 0; r < 8; r++)
            for (let c = 0; c < 8; c++)
                if (board[r][c] === k) return [r, c];
        return null;
    }

    function isInCheck(side) {
        const king = findKing(side);
        if (!king) return false;
        const [kr, kc] = king;
        return isSquareAttacked(kr, kc, side === "w" ? "b" : "w");
    }

    function legalMoves(r, c) {
        const piece = board[r][c];
        if (piece === " ") return [];
        const side = isWhite(piece) ? "w" : "b";
        const enemy = side === "w" ? "b" : "w";
        const pseudo = pseudoMoves(r, c);
        const legal = [];
        for (const [tr, tc] of pseudo) {
            // Simulate the move
            const captured = board[tr][tc];
            const origFrom = board[r][c];
            board[tr][tc] = piece;
            board[r][c] = " ";
            // Handle en passant capture
            let epCaptured = null;
            let epRow = -1;
            if (piece.toUpperCase() === "P" && enPassant && tr === enPassant.row && tc === enPassant.col) {
                epRow = side === "w" ? tr + 1 : tr - 1;
                epCaptured = board[epRow][tc];
                board[epRow][tc] = " ";
            }
            // Check if own king is safe after this move
            const king = findKing(side);
            const inCheck = king ? isSquareAttacked(king[0], king[1], enemy) : false;
            // Restore
            board[r][c] = origFrom;
            board[tr][tc] = captured;
            if (epCaptured !== null) board[epRow][tc] = epCaptured;
            if (!inCheck) legal.push([tr, tc]);
        }
        return legal;
    }

    // Find king destination squares where king would be captured next turn
    function kingDangerSquares(r, c) {
        const piece = board[r][c];
        if (piece.toUpperCase() !== 'K') return [];
        const side = isWhite(piece) ? 'w' : 'b';
        const enemySide = side === 'w' ? 'b' : 'w';
        const moves = pseudoMoves(r, c);
        const danger = [];
        for (const [nr, nc] of moves) {
            // Simulate move
            const captured = board[nr][nc];
            board[nr][nc] = piece;
            board[r][c] = ' ';
            const attacked = isSquareAttacked(nr, nc, enemySide);
            // Restore
            board[r][c] = piece;
            board[nr][nc] = captured;
            if (attacked) danger.push([nr, nc]);
        }
        return danger;
    }

    // ===== Move Execution =====
    function makeMove(fr, fc, tr, tc) {
        const piece = board[fr][fc];
        const side = isWhite(piece) ? "w" : "b";
        const captured = board[tr][tc];
        const type = piece.toUpperCase();

        if (type === "P" && enPassant && tr === enPassant.row && tc === enPassant.col) {
            board[side === "w" ? tr + 1 : tr - 1][tc] = " ";
        }

        enPassant = (type === "P" && Math.abs(tr - fr) === 2)
            ? { row: (fr + tr) / 2, col: fc } : null;

        if (type === "K" && Math.abs(tc - fc) === 2) {
            if (tc === 6) { board[fr][5] = board[fr][7]; board[fr][7] = " "; }
            else { board[fr][3] = board[fr][0]; board[fr][0] = " "; }
        }

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

        // Check if a king is being captured (game ends immediately)
        const capturedIsKing = captured.toUpperCase() === "K";

        board[tr][tc] = piece;
        board[fr][fc] = " ";

        // Sound effects for moves and captures
        if (captured !== " " || (type === "P" && enPassant && tr === enPassant?.row && tc === enPassant?.col)) {
            if (typeof GameSounds !== 'undefined') GameSounds.play('capture');
        } else {
            if (typeof GameSounds !== 'undefined') GameSounds.play('place');
        }

        if (type === "P" && (tr === 0 || tr === 7))
            board[tr][tc] = side === "w" ? "Q" : "q";

        const colNames = "abcdefgh";
        const from = colNames[fc] + (8 - fr);
        const to = colNames[tc] + (8 - tr);
        const notation = (PIECE_SYMBOLS[piece] || "") + from + (captured !== " " ? "x" : "") + to;
        moveHistory.push({ fr, fc, tr, tc, piece, captured, notation });

        const moveListEl = document.getElementById("move-list");
        const moveNum = Math.ceil(moveHistory.length / 2);
        if (side === "w") {
            moveListEl.innerHTML += `<div>${moveNum}. ${notation}`;
        } else {
            moveListEl.innerHTML = moveListEl.innerHTML.replace(/<\/div>$/, ` &nbsp; ${notation}</div>`);
        }
        moveListEl.scrollTop = moveListEl.scrollHeight;

        if (capturedIsKing) {
            gameOver = true;
            const winner = side === "w" ? "White" : "Black";
            if (isMultiplayer && mySide !== null) {
                if (typeof GameSounds !== 'undefined') GameSounds.play(side === mySide ? 'win' : 'lose');
                if (typeof GameAnimations !== 'undefined') { if (side === mySide) GameAnimations.showConfetti(); else GameAnimations.showShake(document.body); }
            } else if (!isMultiplayer) {
                if (typeof GameSounds !== 'undefined') GameSounds.play('win');
                if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();
            }
            document.getElementById("status").textContent = `${winner} wins! King captured!`;
            document.getElementById("game-over-message").textContent = `${winner} wins!`;
            document.getElementById("game-over-overlay").classList.add("active");
            return;
        }

        turn = turn === "w" ? "b" : "w";
        coachingArrows = {}; // Clear coaching on turn change
        coachingDots = {};
        checkGameState();
    }

    function checkGameState() {
        // If king is already gone (captured), game is already over
        if (!findKing(turn)) return;

        let hasLegalMove = false;
        for (let r = 0; r < 8 && !hasLegalMove; r++)
            for (let c = 0; c < 8 && !hasLegalMove; c++)
                if (isAlly(board[r][c], turn) && legalMoves(r, c).length > 0)
                    hasLegalMove = true;

        const inCheck = isInCheck(turn);
        const turnName = turn === "w" ? "White" : "Black";
        let statusSuffix = "";
        if (isSpectator) {
            statusSuffix = " — 관전 중";
        } else if (isMultiplayer && gameReady) {
            statusSuffix = (turn === mySide) ? " — 내 차례" : " — 상대 차례";
        }

        if (!hasLegalMove) {
            gameOver = true;
            if (inCheck) {
                const winner = turn === "w" ? "Black" : "White";
                const winningSide = turn === "w" ? "b" : "w";
                if (isMultiplayer && mySide !== null) {
                    if (typeof GameSounds !== 'undefined') GameSounds.play(mySide === winningSide ? 'win' : 'lose');
                    if (typeof GameAnimations !== 'undefined') { if (mySide === winningSide) GameAnimations.showConfetti(); else GameAnimations.showShake(document.body); }
                } else if (!isMultiplayer) {
                    if (typeof GameSounds !== 'undefined') GameSounds.play('win');
                    if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();
                }
                document.getElementById("status").textContent = `Checkmate! ${winner} wins!`;
                document.getElementById("game-over-message").textContent = `Checkmate! ${winner} wins!`;
            } else {
                document.getElementById("status").textContent = "Stalemate! Draw!";
                document.getElementById("game-over-message").textContent = "Stalemate! Draw!";
            }
            document.getElementById("game-over-overlay").classList.add("active");
        } else if (inCheck) {
            if (typeof GameSounds !== 'undefined') GameSounds.play('check');
            document.getElementById("status").textContent = `${turnName}'s Turn (Check!)${statusSuffix}`;
        } else {
            document.getElementById("status").textContent = `${turnName}'s Turn${statusSuffix}`;
        }
    }

    // ===== Drawing =====
    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const lightColor = "#e8d5b5";
        const darkColor = "#b58863";
        const selectedColor = "rgba(196, 170, 130, 0.7)";
        const moveColor = "rgba(196, 170, 130, 0.5)";

        const validMoves = selected ? legalMoves(selected[0], selected[1]) : [];
        const dangerSquares = selected ? kingDangerSquares(selected[0], selected[1]) : [];

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const br = flipBoard ? 7 - r : r;
                const bc = flipBoard ? 7 - c : c;

                const isLight = (br + bc) % 2 === 0;
                ctx.fillStyle = isLight ? lightColor : darkColor;

                if (selected && selected[0] === br && selected[1] === bc)
                    ctx.fillStyle = selectedColor;

                ctx.fillRect(c * SQ, r * SQ, SQ, SQ);

                if (validMoves.some(([mr, mc]) => mr === br && mc === bc)) {
                    const isDanger = dangerSquares.some(([dr, dc]) => dr === br && dc === bc);
                    if (isDanger) {
                        // Red X for king danger squares
                        ctx.fillStyle = 'rgba(220, 50, 50, 0.25)';
                        ctx.fillRect(c * SQ, r * SQ, SQ, SQ);
                        ctx.strokeStyle = 'rgba(220, 50, 50, 0.7)';
                        ctx.lineWidth = 3;
                        const pad = SQ * 0.25;
                        ctx.beginPath();
                        ctx.moveTo(c * SQ + pad, r * SQ + pad);
                        ctx.lineTo(c * SQ + SQ - pad, r * SQ + SQ - pad);
                        ctx.moveTo(c * SQ + SQ - pad, r * SQ + pad);
                        ctx.lineTo(c * SQ + pad, r * SQ + SQ - pad);
                        ctx.stroke();
                    } else {
                        ctx.fillStyle = moveColor;
                        if (board[br][bc] !== " ") {
                            ctx.fillRect(c * SQ, r * SQ, SQ, SQ);
                        } else {
                            ctx.beginPath();
                            ctx.arc(c * SQ + SQ / 2, r * SQ + SQ / 2, 10, 0, Math.PI * 2);
                            ctx.fill();
                        }
                    }
                }

                if (board[br][bc] !== " ") {
                    ctx.fillStyle = isWhite(board[br][bc]) ? "#fff" : "#222";
                    ctx.font = `${SQ * 0.7}px serif`;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    ctx.fillText(PIECE_SYMBOLS[board[br][bc]], c * SQ + SQ / 2, r * SQ + SQ / 2 + 2);
                    if (isWhite(board[br][bc])) {
                        ctx.strokeStyle = "#333";
                        ctx.lineWidth = 0.5;
                        ctx.strokeText(PIECE_SYMBOLS[board[br][bc]], c * SQ + SQ / 2, r * SQ + SQ / 2 + 2);
                    }
                }
            }
        }

        // Labels
        ctx.font = "11px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        for (let r = 0; r < 8; r++) {
            const br = flipBoard ? 7 - r : r;
            ctx.fillStyle = r % 2 === 0 ? darkColor : lightColor;
            ctx.fillText(8 - br, 2, r * SQ + 2);
        }
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        for (let c = 0; c < 8; c++) {
            const bc = flipBoard ? 7 - c : c;
            ctx.fillStyle = c % 2 !== 0 ? darkColor : lightColor;
            ctx.fillText("abcdefgh"[bc], c * SQ + SQ - 2, canvas.height - 2);
        }

        // Draw coaching dots (first-click indicators) with per-user colors
        for (const [uid, dot] of Object.entries(coachingDots)) {
            const [cr, cg, cb] = getCoachingColor(uid);
            const dr = flipBoard ? 7 - dot.row : dot.row;
            const dc = flipBoard ? 7 - dot.col : dot.col;
            const dx = dc * SQ + SQ / 2, dy = dr * SQ + SQ / 2;
            ctx.beginPath();
            ctx.arc(dx, dy, SQ * 0.18, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.5)`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.8)`;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = '10px sans-serif';
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.6)`;
            ctx.textAlign = 'center';
            ctx.fillText(uid, dx, dy - SQ * 0.25);
        }

        // Draw coaching arrows with per-user colors and name tags
        for (const [uid, arrow] of Object.entries(coachingArrows)) {
            const [cr, cg, cb] = getCoachingColor(uid);
            const fromR = flipBoard ? 7 - arrow.fr : arrow.fr;
            const fromC = flipBoard ? 7 - arrow.fc : arrow.fc;
            const toR = flipBoard ? 7 - arrow.tr : arrow.tr;
            const toC = flipBoard ? 7 - arrow.tc : arrow.tc;

            const x1 = fromC * SQ + SQ / 2, y1 = fromR * SQ + SQ / 2;
            const x2 = toC * SQ + SQ / 2, y2 = toR * SQ + SQ / 2;

            ctx.strokeStyle = `rgba(${cr}, ${cg}, ${cb}, 0.5)`;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();

            // Arrowhead
            const angle = Math.atan2(y2 - y1, x2 - x1);
            const headLen = 15;
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
            ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
            ctx.closePath();
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.5)`;
            ctx.fill();

            // Name tag at arrow midpoint
            const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
            ctx.font = '11px sans-serif';
            ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, 0.6)`;
            ctx.textAlign = 'center';
            ctx.fillText(uid, mx, my - 8);
        }
    }

    // ===== Input =====
    canvas.addEventListener("click", (e) => {
        if (gameOver) return;
        if (!gameReady) return;

        const rect = canvas.getBoundingClientRect();
        let col = Math.floor((e.clientX - rect.left) / SQ);
        let row = Math.floor((e.clientY - rect.top) / SQ);
        if (flipBoard) { row = 7 - row; col = 7 - col; }
        if (!inBounds(row, col)) return;

        // Spectator coaching: first click = dot, second click = arrow
        if (isSpectator && isMultiplayer && typeof ALLOW_COACHING !== 'undefined' && ALLOW_COACHING) {
            if (!coachingClickFirst) {
                coachingClickFirst = { row, col };
                // Broadcast first-click dot
                socket.emit('coaching_suggest', {
                    room_id: ROOM_ID,
                    user_id: MY_USER,
                    type: 'dot',
                    data: { row, col }
                });
            } else {
                if (coachingClickFirst.row !== row || coachingClickFirst.col !== col) {
                    socket.emit('coaching_suggest', {
                        room_id: ROOM_ID,
                        user_id: MY_USER,
                        type: 'arrow',
                        data: { fr: coachingClickFirst.row, fc: coachingClickFirst.col, tr: row, tc: col }
                    });
                }
                // Clear the dot after arrow is placed (or same-square cancel)
                delete coachingDots[MY_USER];
                coachingClickFirst = null;
                draw();
            }
            return;
        }

        if (isSpectator) return;
        if (isMultiplayer && turn !== mySide) return;

        if (selected) {
            const moves = legalMoves(selected[0], selected[1]);
            const isLegal = moves.some(([mr, mc]) => mr === row && mc === col);

            if (isLegal) {
                const fr = selected[0], fc = selected[1];
                makeMove(fr, fc, row, col);
                selected = null;
                draw();
                if (isMultiplayer && socket) {
                    socket.emit('game_move', { room_id: ROOM_ID, fr, fc, tr: row, tc: col });
                }
                return;
            }

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

    const restartBtn = document.getElementById("restart-btn");
    const overlayRestartBtn = document.getElementById("overlay-restart-btn");
    const undoBtn = document.getElementById("undo-btn");
    if (restartBtn) restartBtn.addEventListener("click", init);
    if (overlayRestartBtn) overlayRestartBtn.addEventListener("click", init);
    if (undoBtn) undoBtn.addEventListener("click", () => {});

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
                        if (m.fr !== undefined && m.fc !== undefined && m.tr !== undefined && m.tc !== undefined) {
                            makeMove(m.fr, m.fc, m.tr, m.tc);
                            draw();
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
                checkGameState();
            });
        }

        // Both player and spectator receive moves
        socket.on('opponent_move', (data) => {
            coachingArrows = {};
            makeMove(data.fr, data.fc, data.tr, data.tc);
            selected = null;
            draw();
        });

        function showVictoryByLeave() {
            if (gameOver || isSpectator) return;
            gameOver = true;
            if (typeof GameSounds !== 'undefined') GameSounds.play('win');
            if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();
            document.getElementById("status").textContent = "승리!";
            document.getElementById("game-over-message").innerHTML = '승리!<br><span class="disconnect-sub">상대방이 나갔습니다!</span>';
            document.getElementById("game-over-overlay").classList.add("active");
        }

        socket.on('opponent_disconnected', showVictoryByLeave);
        socket.on('opponent_game_over', showVictoryByLeave);

        // Coaching updates
        socket.on('coaching_update', (data) => {
            if (data.type === 'arrow' && data.data) {
                coachingArrows[data.user_id] = data.data;
                delete coachingDots[data.user_id]; // Remove dot when arrow placed
                draw();
            } else if (data.type === 'dot' && data.data) {
                coachingDots[data.user_id] = data.data;
                draw();
            }
        });

        socket.on('coaching_cleared', (data) => {
            if (data.user_id) {
                delete coachingArrows[data.user_id];
                delete coachingDots[data.user_id];
            } else {
                coachingArrows = {};
                coachingDots = {};
            }
            draw();
        });

        // Clear coaching button
        const clearBtn = document.getElementById('coaching-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                socket.emit('coaching_clear', { room_id: ROOM_ID, user_id: MY_USER });
                coachingClickFirst = null;
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

    init();
})();
