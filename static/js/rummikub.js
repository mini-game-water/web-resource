(() => {
    'use strict';

    // ══════════════════════════════════════════════════
    //  MULTIPLAYER DETECTION
    // ══════════════════════════════════════════════════

    const isMultiplayer = typeof ROOM_ID !== 'undefined' && ROOM_ID;
    const isSpectator = typeof IS_SPECTATOR !== 'undefined' && IS_SPECTATOR;
    const roomPlayers = isMultiplayer ? (typeof ROOM_PLAYERS !== 'undefined' ? ROOM_PLAYERS : []) : [];
    const myUser = isMultiplayer ? MY_USER : null;
    let socket = null;
    let gameReady = !isMultiplayer || isSpectator;
    let gameOver = false;

    // ══════════════════════════════════════════════════
    //  CONSTANTS
    // ══════════════════════════════════════════════════

    const COLORS = ['red', 'blue', 'yellow', 'black'];
    const COLOR_LABELS = { red: '빨강', blue: '파랑', yellow: '노랑', black: '검정' };
    const COLOR_ORDER = { red: 0, blue: 1, yellow: 2, black: 3 };
    const TILES_PER_PLAYER = 14;
    const INITIAL_MELD_MIN = 30;
    const AI_NAMES = ['AI-1', 'AI-2', 'AI-3'];
    const AI_DELAY_MIN = 600;
    const AI_DELAY_MAX = 1400;

    // ══════════════════════════════════════════════════
    //  PLAYER SETUP
    // ══════════════════════════════════════════════════

    let PLAYER_NAMES;
    let NUM_PLAYERS;
    let myIndex = 0;
    let isHost = false;

    if (isMultiplayer) {
        PLAYER_NAMES = roomPlayers.slice();
        NUM_PLAYERS = PLAYER_NAMES.length;
        myIndex = PLAYER_NAMES.indexOf(myUser);
        if (myIndex === -1) myIndex = 0;
        isHost = (myIndex === 0);
    } else {
        // Solo mode: player vs 1 AI opponent
        PLAYER_NAMES = ['나', AI_NAMES[0]];
        NUM_PLAYERS = 2;
        myIndex = 0;
        isHost = true;
    }

    function isAIPlayer(idx) {
        return AI_NAMES.includes(PLAYER_NAMES[idx]);
    }

    // ══════════════════════════════════════════════════
    //  GAME STATE
    // ══════════════════════════════════════════════════

    let tilePool = [];
    let playerRacks = [];          // playerRacks[i] = array of tile objects
    let tableSets = [];            // tableSets[i] = array of tile objects (valid group/run)
    let currentPlayer = 0;
    let gameRunning = false;
    let initialMeldDone = [];      // per-player flag: completed first 30-pt meld
    let turnStartRack = [];        // deep copy of rack at turn start (for undo)
    let turnStartTable = [];       // deep copy of table at turn start (for undo)
    let selectedTiles = [];        // array of tile IDs currently selected in rack
    let tileIdCounter = 0;
    let dragTile = null;
    let dragSource = null;         // { type:'rack' } | { type:'table', setIndex, tileIndex }

    // ══════════════════════════════════════════════════
    //  DOM REFERENCES
    // ══════════════════════════════════════════════════

    const tableEl = document.getElementById('rummikub-table');
    const tableEmptyMsg = document.getElementById('table-empty-msg');
    const rackTilesEl = document.getElementById('rack-tiles');
    const opponentsArea = document.getElementById('opponents-area');
    const turnInfo = document.getElementById('turn-info');
    const poolInfo = document.getElementById('pool-info');
    const initialMeldInfo = document.getElementById('initial-meld-info');
    const btnPlay = document.getElementById('btn-play');
    const btnDraw = document.getElementById('btn-draw');
    const btnUndo = document.getElementById('btn-undo');
    const btnSortNum = document.getElementById('btn-sort-num');
    const btnSortColor = document.getElementById('btn-sort-color');
    const startBtn = document.getElementById('start-btn');
    const overlay = document.getElementById('game-over-overlay');
    const gameOverTitle = document.getElementById('game-over-title');
    const gameOverMsg = document.getElementById('game-over-msg');
    const restartBtn = document.getElementById('restart-btn');

    // ══════════════════════════════════════════════════
    //  TILE CREATION & POOL
    // ══════════════════════════════════════════════════

    function createTileId() {
        return ++tileIdCounter;
    }

    function createTile(number, color, isJoker) {
        return {
            id: createTileId(),
            number: isJoker ? 0 : number,
            color: isJoker ? 'joker' : color,
            isJoker: !!isJoker
        };
    }

    function createTilePool() {
        const pool = [];
        // 2 complete sets of numbered tiles (1-13 in 4 colors)
        for (let set = 0; set < 2; set++) {
            for (const color of COLORS) {
                for (let num = 1; num <= 13; num++) {
                    pool.push(createTile(num, color, false));
                }
            }
        }
        // 2 jokers
        pool.push(createTile(0, 'joker', true));
        pool.push(createTile(0, 'joker', true));
        return pool; // 106 tiles total
    }

    function shuffleArray(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ══════════════════════════════════════════════════
    //  TILE DOM ELEMENT
    // ══════════════════════════════════════════════════

    function createTileElement(tile, clickable) {
        const el = document.createElement('div');
        el.className = 'rk-tile';

        if (tile.isJoker) {
            el.classList.add('joker');
        } else {
            el.classList.add('color-' + tile.color);
        }

        el.dataset.tileId = tile.id;

        const numSpan = document.createElement('span');
        numSpan.className = 'tile-number';
        numSpan.textContent = tile.isJoker ? 'JK' : tile.number;
        el.appendChild(numSpan);

        if (!tile.isJoker) {
            const dot = document.createElement('span');
            dot.className = 'tile-color-dot';
            el.appendChild(dot);
        }

        // ── Drag support ──
        el.draggable = true;
        el.addEventListener('dragstart', (e) => {
            if (currentPlayer !== myIndex || !gameRunning || isSpectator) {
                e.preventDefault();
                return;
            }
            dragTile = tile;
            el.classList.add('dragging');
            e.dataTransfer.setData('text/plain', String(tile.id));

            // Determine source location
            const rackIdx = playerRacks[myIndex].findIndex(t => t.id === tile.id);
            if (rackIdx >= 0) {
                dragSource = { type: 'rack' };
            } else {
                for (let si = 0; si < tableSets.length; si++) {
                    const ti = tableSets[si].findIndex(t => t.id === tile.id);
                    if (ti >= 0) {
                        dragSource = { type: 'table', setIndex: si, tileIndex: ti };
                        break;
                    }
                }
            }
        });
        el.addEventListener('dragend', () => {
            el.classList.remove('dragging');
            dragTile = null;
            dragSource = null;
        });

        // ── Click to select / deselect (rack tiles only) ──
        if (clickable) {
            el.addEventListener('click', () => {
                if (currentPlayer !== myIndex || !gameRunning || isSpectator) return;
                const idx = selectedTiles.indexOf(tile.id);
                if (idx >= 0) {
                    selectedTiles.splice(idx, 1);
                    el.classList.remove('selected');
                } else {
                    selectedTiles.push(tile.id);
                    el.classList.add('selected');
                }
            });
        }

        return el;
    }

    // ══════════════════════════════════════════════════
    //  RENDERING — RACK
    // ══════════════════════════════════════════════════

    function renderRack() {
        rackTilesEl.innerHTML = '';
        if (!playerRacks[myIndex]) return;
        playerRacks[myIndex].forEach(tile => {
            const el = createTileElement(tile, true);
            if (selectedTiles.includes(tile.id)) el.classList.add('selected');
            rackTilesEl.appendChild(el);
        });
    }

    // ══════════════════════════════════════════════════
    //  RENDERING — TABLE
    // ══════════════════════════════════════════════════

    function renderTable() {
        // Remove all dynamic children (sets and new-set-zone) but keep the empty message
        tableEl.querySelectorAll('.table-set, .new-set-zone').forEach(el => el.remove());

        tableEmptyMsg.style.display = tableSets.length === 0 ? '' : 'none';

        tableSets.forEach((setTiles, setIdx) => {
            const setEl = document.createElement('div');
            setEl.className = 'table-set';
            if (!validateSet(setTiles)) {
                setEl.classList.add('invalid');
            }
            setEl.dataset.setIndex = setIdx;

            setTiles.forEach(tile => {
                setEl.appendChild(createTileElement(tile, false));
            });

            // Drop target — add tile to existing set
            setEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                setEl.classList.add('drop-hover');
            });
            setEl.addEventListener('dragleave', () => {
                setEl.classList.remove('drop-hover');
            });
            setEl.addEventListener('drop', (e) => {
                e.preventDefault();
                setEl.classList.remove('drop-hover');
                if (!dragTile || currentPlayer !== myIndex || isSpectator) return;
                handleTileDrop(dragTile, dragSource, { type: 'table-set', setIndex: setIdx });
            });

            tableEl.appendChild(setEl);
        });

        // New-set drop zone (always at the end)
        const newZone = document.createElement('div');
        newZone.className = 'new-set-zone';
        newZone.textContent = '+ 새 조합';

        newZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            newZone.classList.add('drop-hover');
        });
        newZone.addEventListener('dragleave', () => {
            newZone.classList.remove('drop-hover');
        });
        newZone.addEventListener('drop', (e) => {
            e.preventDefault();
            newZone.classList.remove('drop-hover');
            if (!dragTile || currentPlayer !== myIndex || isSpectator) return;
            handleTileDrop(dragTile, dragSource, { type: 'new-set' });
        });

        // Click on new-set-zone to play all selected rack tiles as a new set
        newZone.addEventListener('click', () => {
            if (currentPlayer !== myIndex || !gameRunning || isSpectator) return;
            if (selectedTiles.length === 0) return;
            playSelectedTilesToNewSet();
        });

        tableEl.appendChild(newZone);
    }

    // ══════════════════════════════════════════════════
    //  RENDERING — OPPONENTS
    // ══════════════════════════════════════════════════

    function renderOpponents() {
        opponentsArea.innerHTML = '';
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (i === myIndex && !isSpectator) continue;
            const rack = playerRacks[i] || [];

            const div = document.createElement('div');
            div.className = 'opponent-rack';
            if (i === currentPlayer && gameRunning) div.classList.add('active-turn');

            const nameEl = document.createElement('div');
            nameEl.className = 'opponent-name';
            nameEl.textContent = PLAYER_NAMES[i];
            div.appendChild(nameEl);

            const countEl = document.createElement('div');
            countEl.className = 'opponent-tile-count';
            countEl.textContent = rack.length + '개 타일';
            div.appendChild(countEl);

            const backsEl = document.createElement('div');
            backsEl.className = 'opponent-tile-backs';
            const showCount = Math.min(rack.length, 20);
            for (let j = 0; j < showCount; j++) {
                const back = document.createElement('div');
                back.className = 'tile-back-mini';
                backsEl.appendChild(back);
            }
            if (rack.length > 20) {
                const more = document.createElement('span');
                more.textContent = '+' + (rack.length - 20);
                more.style.fontSize = '0.7rem';
                more.style.color = '#999';
                backsEl.appendChild(more);
            }
            div.appendChild(backsEl);

            opponentsArea.appendChild(div);
        }
    }

    // ══════════════════════════════════════════════════
    //  RENDERING — INFO DISPLAYS
    // ══════════════════════════════════════════════════

    function updatePoolInfo() {
        poolInfo.textContent = '남은 타일: ' + tilePool.length + '개';
    }

    function updateTurnInfo() {
        if (!gameRunning) {
            turnInfo.textContent = '게임을 시작하세요';
            turnInfo.style.color = '#9a8b78';
            return;
        }
        if (currentPlayer === myIndex && !isSpectator) {
            turnInfo.textContent = '내 턴입니다';
            turnInfo.style.color = '#27ae60';
        } else {
            turnInfo.textContent = PLAYER_NAMES[currentPlayer] + '의 턴';
            turnInfo.style.color = '#9a8b78';
        }
    }

    function updateInitialMeldInfo() {
        if (!gameRunning) {
            initialMeldInfo.textContent = '';
            return;
        }
        if (currentPlayer === myIndex && !isSpectator && !initialMeldDone[myIndex]) {
            initialMeldInfo.textContent = '첫 등록: 합계 30점 이상 필요';
        } else {
            initialMeldInfo.textContent = '';
        }
    }

    function updateControls() {
        const myTurn = currentPlayer === myIndex && gameRunning && !isSpectator;
        btnPlay.disabled = !myTurn;
        btnDraw.disabled = !myTurn;
        btnUndo.disabled = !myTurn;
    }

    function renderAll() {
        renderRack();
        renderTable();
        renderOpponents();
        updatePoolInfo();
        updateTurnInfo();
        updateInitialMeldInfo();
        updateControls();
    }

    // ══════════════════════════════════════════════════
    //  RACK DROP ZONE
    // ══════════════════════════════════════════════════

    rackTilesEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        rackTilesEl.classList.add('drop-hover');
    });
    rackTilesEl.addEventListener('dragleave', () => {
        rackTilesEl.classList.remove('drop-hover');
    });
    rackTilesEl.addEventListener('drop', (e) => {
        e.preventDefault();
        rackTilesEl.classList.remove('drop-hover');
        if (!dragTile || currentPlayer !== myIndex || isSpectator) return;
        handleTileDrop(dragTile, dragSource, { type: 'rack' });
    });

    // ══════════════════════════════════════════════════
    //  DRAG & DROP / CLICK PLACEMENT LOGIC
    // ══════════════════════════════════════════════════

    function handleTileDrop(tile, source, target) {
        if (!source || !target) return;

        // Remove tile from source
        if (source.type === 'rack') {
            const idx = playerRacks[myIndex].findIndex(t => t.id === tile.id);
            if (idx >= 0) playerRacks[myIndex].splice(idx, 1);
        } else if (source.type === 'table') {
            const set = tableSets[source.setIndex];
            if (set) {
                const idx = set.findIndex(t => t.id === tile.id);
                if (idx >= 0) set.splice(idx, 1);
                if (set.length === 0) {
                    tableSets.splice(source.setIndex, 1);
                }
            }
        }

        // Place tile at target
        if (target.type === 'rack') {
            playerRacks[myIndex].push(tile);
        } else if (target.type === 'table-set') {
            if (tableSets[target.setIndex]) {
                tableSets[target.setIndex].push(tile);
            }
        } else if (target.type === 'new-set') {
            tableSets.push([tile]);
        }

        selectedTiles = selectedTiles.filter(id => id !== tile.id);
        renderAll();
    }

    function playSelectedTilesToNewSet() {
        const tiles = [];
        selectedTiles.forEach(id => {
            const idx = playerRacks[myIndex].findIndex(t => t.id === id);
            if (idx >= 0) tiles.push(playerRacks[myIndex][idx]);
        });
        if (tiles.length === 0) return;

        // Remove selected tiles from rack
        tiles.forEach(tile => {
            const idx = playerRacks[myIndex].findIndex(t => t.id === tile.id);
            if (idx >= 0) playerRacks[myIndex].splice(idx, 1);
        });

        tableSets.push(tiles);
        selectedTiles = [];
        renderAll();
    }

    // Click on existing table set to add all selected rack tiles to it
    tableEl.addEventListener('click', (e) => {
        if (currentPlayer !== myIndex || !gameRunning || isSpectator) return;
        if (selectedTiles.length === 0) return;
        const setEl = e.target.closest('.table-set');
        if (!setEl) return;
        const setIdx = parseInt(setEl.dataset.setIndex);
        if (isNaN(setIdx) || !tableSets[setIdx]) return;

        const tiles = [];
        selectedTiles.forEach(id => {
            const idx = playerRacks[myIndex].findIndex(t => t.id === id);
            if (idx >= 0) tiles.push(playerRacks[myIndex][idx]);
        });
        tiles.forEach(tile => {
            const idx = playerRacks[myIndex].findIndex(t => t.id === tile.id);
            if (idx >= 0) playerRacks[myIndex].splice(idx, 1);
            tableSets[setIdx].push(tile);
        });
        selectedTiles = [];
        renderAll();
    });

    // ══════════════════════════════════════════════════
    //  SET VALIDATION
    // ══════════════════════════════════════════════════

    function validateSet(tiles) {
        if (!tiles || tiles.length < 3) return false;

        const nonJokers = tiles.filter(t => !t.isJoker);
        if (nonJokers.length === 0) return tiles.length >= 3; // all jokers: valid if 3+

        // Try as group first, then as run
        if (isValidGroup(tiles)) return true;
        if (isValidRun(tiles)) return true;
        return false;
    }

    function isValidGroup(tiles) {
        // Group: 3-4 tiles of same number, all different colors
        if (tiles.length < 3 || tiles.length > 4) return false;

        const nonJokers = tiles.filter(t => !t.isJoker);
        const jokerCount = tiles.filter(t => t.isJoker).length;

        if (nonJokers.length === 0) return true;

        // All non-jokers must share the same number
        const num = nonJokers[0].number;
        if (!nonJokers.every(t => t.number === num)) return false;

        // All non-jokers must have unique colors
        const colors = nonJokers.map(t => t.color);
        if (new Set(colors).size !== colors.length) return false;

        return true;
    }

    function isValidRun(tiles) {
        // Run: 3+ consecutive numbers of the same color
        if (tiles.length < 3) return false;

        const nonJokers = tiles.filter(t => !t.isJoker);
        const jokerCount = tiles.filter(t => t.isJoker).length;

        if (nonJokers.length === 0) return true;

        // All non-jokers must share the same color
        const color = nonJokers[0].color;
        if (!nonJokers.every(t => t.color === color)) return false;

        // Sort non-jokers by number
        const sorted = nonJokers.slice().sort((a, b) => a.number - b.number);

        // No duplicate numbers among non-jokers
        for (let i = 1; i < sorted.length; i++) {
            if (sorted[i].number === sorted[i - 1].number) return false;
        }

        const minNum = sorted[0].number;
        const maxNum = sorted[sorted.length - 1].number;
        const span = maxNum - minNum + 1;

        if (span > tiles.length) return false;

        if (span < tiles.length) {
            // Extra jokers extend the run beyond the non-joker range
            const jokersNeeded = span - nonJokers.length;
            const extraJokers = jokerCount - jokersNeeded;
            if (extraJokers < 0) return false;
            // Verify the extended run stays within 1-13
            const possibleStart = Math.max(1, minNum - extraJokers);
            const possibleEnd = Math.min(13, maxNum + extraJokers);
            if (possibleEnd - possibleStart + 1 < tiles.length) return false;
        } else {
            // span === tiles.length: gaps filled exactly by jokers
            const gaps = span - nonJokers.length;
            if (gaps > jokerCount) return false;
        }

        // Bounds check
        if (minNum < 1 || maxNum > 13) return false;

        return true;
    }

    function validateTable() {
        return tableSets.every(set => validateSet(set));
    }

    function calcSetPoints(tiles) {
        // For initial meld calculation, jokers do not count toward the 30-point minimum
        let sum = 0;
        tiles.forEach(t => {
            if (!t.isJoker) sum += t.number;
        });
        return sum;
    }

    // ══════════════════════════════════════════════════
    //  DEEP COPY HELPERS
    // ══════════════════════════════════════════════════

    function deepCopyTiles(tiles) {
        return tiles.map(t => ({ ...t }));
    }

    function deepCopyTable(table) {
        return table.map(s => deepCopyTiles(s));
    }

    // ══════════════════════════════════════════════════
    //  GAME INITIALIZATION
    // ══════════════════════════════════════════════════

    function initGame() {
        tileIdCounter = 0;
        tilePool = shuffleArray(createTilePool());
        playerRacks = [];
        tableSets = [];
        initialMeldDone = [];
        currentPlayer = 0;
        gameRunning = true;
        gameOver = false;
        selectedTiles = [];

        for (let i = 0; i < NUM_PLAYERS; i++) {
            playerRacks[i] = [];
            initialMeldDone[i] = false;
        }

        dealTiles();
        saveTurnState();
        renderAll();

        // If AI goes first, kick off AI turn
        if (isHost && isAIPlayer(currentPlayer)) {
            setTimeout(() => aiTurn(), aiDelay());
        }
    }

    function dealTiles() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            for (let j = 0; j < TILES_PER_PLAYER; j++) {
                if (tilePool.length > 0) {
                    playerRacks[i].push(tilePool.pop());
                }
            }
        }
    }

    function saveTurnState() {
        turnStartRack = deepCopyTiles(playerRacks[myIndex] || []);
        turnStartTable = deepCopyTable(tableSets);
    }

    function aiDelay() {
        return AI_DELAY_MIN + Math.random() * (AI_DELAY_MAX - AI_DELAY_MIN);
    }

    // ══════════════════════════════════════════════════
    //  TURN ACTIONS — UNDO
    // ══════════════════════════════════════════════════

    function undoTurn() {
        if (currentPlayer !== myIndex || !gameRunning) return;
        playerRacks[myIndex] = deepCopyTiles(turnStartRack);
        tableSets = deepCopyTable(turnStartTable);
        selectedTiles = [];
        renderAll();
    }

    // ══════════════════════════════════════════════════
    //  TURN ACTIONS — DRAW TILE
    // ══════════════════════════════════════════════════

    function drawTile() {
        if (currentPlayer !== myIndex || !gameRunning || isSpectator) return;

        // Undo any partial table/rack changes this turn
        playerRacks[myIndex] = deepCopyTiles(turnStartRack);
        tableSets = deepCopyTable(turnStartTable);

        if (tilePool.length > 0) {
            playerRacks[myIndex].push(tilePool.pop());
        }

        selectedTiles = [];
        endTurn();
    }

    // ══════════════════════════════════════════════════
    //  TURN ACTIONS — PLAY (END TURN)
    // ══════════════════════════════════════════════════

    function playTurn() {
        if (currentPlayer !== myIndex || !gameRunning || isSpectator) return;

        const rackChanged = !tilesEqual(playerRacks[myIndex], turnStartRack);
        const tableChanged = !tableEqual(tableSets, turnStartTable);

        if (!rackChanged && !tableChanged) {
            alert('타일을 놓거나 뽑아야 합니다.');
            return;
        }

        // All table sets must be valid
        if (!validateTable()) {
            alert('테이블의 모든 조합이 유효해야 합니다.');
            return;
        }

        // Player must have played at least one tile from rack to table
        if (playerRacks[myIndex].length >= turnStartRack.length) {
            alert('최소 1개의 타일을 랙에서 테이블로 놓아야 합니다.');
            return;
        }

        // Initial meld check: tiles played from rack this turn must total >= 30
        if (!initialMeldDone[myIndex]) {
            const newPts = calcNewSetsPoints();
            if (newPts < INITIAL_MELD_MIN) {
                alert('첫 등록은 합계 ' + INITIAL_MELD_MIN + '점 이상이어야 합니다. (현재: ' + newPts + '점)');
                return;
            }
            initialMeldDone[myIndex] = true;
        }

        // Win check
        if (playerRacks[myIndex].length === 0) {
            endTurn();
            showGameOver(myIndex);
            return;
        }

        endTurn();
    }

    function calcNewSetsPoints() {
        // Sum of tile numbers that moved from rack to table this turn
        const prevRackIds = new Set(turnStartRack.map(t => t.id));
        const currRackIds = new Set(playerRacks[myIndex].map(t => t.id));
        let points = 0;
        for (const set of tableSets) {
            for (const tile of set) {
                if (prevRackIds.has(tile.id) && !currRackIds.has(tile.id)) {
                    if (!tile.isJoker) points += tile.number;
                }
            }
        }
        return points;
    }

    // ══════════════════════════════════════════════════
    //  COMPARISON HELPERS
    // ══════════════════════════════════════════════════

    function tilesEqual(a, b) {
        if (a.length !== b.length) return false;
        const aIds = a.map(t => t.id).sort((x, y) => x - y);
        const bIds = b.map(t => t.id).sort((x, y) => x - y);
        return aIds.every((id, i) => id === bIds[i]);
    }

    function tableEqual(a, b) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) {
            if (!tilesEqual(a[i], b[i])) return false;
        }
        return true;
    }

    // ══════════════════════════════════════════════════
    //  TURN TRANSITION
    // ══════════════════════════════════════════════════

    function endTurn() {
        selectedTiles = [];

        // Broadcast state to other players (host only)
        if (isMultiplayer && isHost && socket) {
            broadcastState();
        }

        // Win check
        if (playerRacks[currentPlayer] && playerRacks[currentPlayer].length === 0) {
            showGameOver(currentPlayer);
            return;
        }

        // Check for stalemate: pool empty and no one can play
        if (tilePool.length === 0) {
            let anyoneCanPlay = false;
            for (let i = 0; i < NUM_PLAYERS; i++) {
                if (playerCanMakeMove(i)) {
                    anyoneCanPlay = true;
                    break;
                }
            }
            if (!anyoneCanPlay) {
                showGameOverStalemate();
                return;
            }
        }

        // Advance to next player
        currentPlayer = (currentPlayer + 1) % NUM_PLAYERS;
        saveTurnState();
        renderAll();

        // Trigger AI turn if needed
        if (isHost && isAIPlayer(currentPlayer) && gameRunning) {
            setTimeout(() => aiTurn(), aiDelay());
        }
    }

    function playerCanMakeMove(playerIdx) {
        const rack = playerRacks[playerIdx];
        if (!rack || rack.length === 0) return false;
        // Quick heuristic: can the player form any valid set from hand?
        const groups = findPossibleGroups(rack);
        const runs = findPossibleRuns(rack);
        if (groups.length > 0 || runs.length > 0) return true;
        // Can extend any existing table set?
        for (let si = 0; si < tableSets.length; si++) {
            for (const tile of rack) {
                const test = [...tableSets[si], tile];
                if (validateSet(test)) return true;
            }
        }
        return false;
    }

    // ══════════════════════════════════════════════════
    //  GAME OVER
    // ══════════════════════════════════════════════════

    function showGameOver(winnerIdx) {
        gameRunning = false;
        gameOver = true;

        // Calculate penalty scores (remaining tiles in rack)
        const scores = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            let penalty = 0;
            (playerRacks[i] || []).forEach(t => {
                if (t.isJoker) penalty += 30;
                else penalty += t.number;
            });
            scores.push({ name: PLAYER_NAMES[i], penalty });
        }

        const winnerName = PLAYER_NAMES[winnerIdx];
        gameOverTitle.textContent = winnerName + ' 승리!';

        let msg = '';
        scores.forEach(s => {
            msg += s.penalty === 0
                ? s.name + ': 승리!\n'
                : s.name + ': -' + s.penalty + '점\n';
        });
        gameOverMsg.textContent = msg;
        overlay.classList.add('active');

        if (isMultiplayer && isHost && socket) {
            broadcastState();
        }
    }

    function showGameOverStalemate() {
        gameRunning = false;
        gameOver = true;

        // Lowest remaining tile total wins
        let minPenalty = Infinity;
        let winnerIdx = 0;
        const scores = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            let penalty = 0;
            (playerRacks[i] || []).forEach(t => {
                if (t.isJoker) penalty += 30;
                else penalty += t.number;
            });
            scores.push({ name: PLAYER_NAMES[i], penalty });
            if (penalty < minPenalty) {
                minPenalty = penalty;
                winnerIdx = i;
            }
        }

        gameOverTitle.textContent = '무승부 — ' + PLAYER_NAMES[winnerIdx] + ' 최소 벌점';

        let msg = '';
        scores.forEach(s => {
            msg += s.name + ': -' + s.penalty + '점\n';
        });
        gameOverMsg.textContent = msg;
        overlay.classList.add('active');

        if (isMultiplayer && isHost && socket) {
            broadcastState();
        }
    }

    // ══════════════════════════════════════════════════
    //  SORTING
    // ══════════════════════════════════════════════════

    function sortRackByNumber() {
        if (!playerRacks[myIndex]) return;
        playerRacks[myIndex].sort((a, b) => {
            if (a.isJoker && b.isJoker) return 0;
            if (a.isJoker) return 1;
            if (b.isJoker) return -1;
            if (a.number !== b.number) return a.number - b.number;
            return (COLOR_ORDER[a.color] || 0) - (COLOR_ORDER[b.color] || 0);
        });
        selectedTiles = [];
        renderRack();
    }

    function sortRackByColor() {
        if (!playerRacks[myIndex]) return;
        playerRacks[myIndex].sort((a, b) => {
            if (a.isJoker && b.isJoker) return 0;
            if (a.isJoker) return 1;
            if (b.isJoker) return -1;
            const ci = (COLOR_ORDER[a.color] || 0) - (COLOR_ORDER[b.color] || 0);
            if (ci !== 0) return ci;
            return a.number - b.number;
        });
        selectedTiles = [];
        renderRack();
    }

    // ══════════════════════════════════════════════════
    //  AI LOGIC
    // ══════════════════════════════════════════════════

    function aiTurn() {
        if (!gameRunning || currentPlayer === myIndex) return;
        if (!isAIPlayer(currentPlayer)) return;

        const rack = playerRacks[currentPlayer];
        if (!rack) { endTurn(); return; }

        // Attempt to play valid sets/runs from hand
        const played = aiTryPlay(currentPlayer);

        if (!played) {
            // No valid play — draw a tile
            if (tilePool.length > 0) {
                rack.push(tilePool.pop());
            }
        }

        endTurn();
    }

    function aiTryPlay(playerIdx) {
        const rack = playerRacks[playerIdx];
        if (!rack || rack.length === 0) return false;

        // Enumerate candidate groups and runs
        const groups = findPossibleGroups(rack);
        const runs = findPossibleRuns(rack);
        const allCombos = [...groups, ...runs];
        if (allCombos.length === 0) return false;

        // ── Before initial meld: must meet 30-point threshold ──
        if (!initialMeldDone[playerIdx]) {
            // Single combos meeting the threshold
            const singleValid = allCombos.filter(combo => {
                const pts = combo.reduce((s, t) => s + (t.isJoker ? 0 : t.number), 0);
                return pts >= INITIAL_MELD_MIN;
            });

            if (singleValid.length > 0) {
                const combo = singleValid[0];
                removeComboFromRack(rack, combo);
                tableSets.push(combo);
                initialMeldDone[playerIdx] = true;
                return true;
            }

            // Try combining two non-overlapping combos
            const multiResult = aiCombineForInitialMeld(allCombos, playerIdx);
            return multiResult;
        }

        // ── After initial meld: play the largest combo ──
        allCombos.sort((a, b) => b.length - a.length);

        let played = false;
        for (const combo of allCombos) {
            if (combo.every(t => rack.some(r => r.id === t.id))) {
                removeComboFromRack(rack, combo);
                tableSets.push(combo);
                played = true;
                break; // one set per turn for simplicity
            }
        }

        // Also try extending existing table sets with single tiles
        if (!played) {
            played = aiTryExtendTableSets(playerIdx);
        }

        return played;
    }

    function removeComboFromRack(rack, combo) {
        combo.forEach(tile => {
            const idx = rack.findIndex(t => t.id === tile.id);
            if (idx >= 0) rack.splice(idx, 1);
        });
    }

    function aiCombineForInitialMeld(combos, playerIdx) {
        const rack = playerRacks[playerIdx];
        for (let i = 0; i < combos.length; i++) {
            for (let j = i + 1; j < combos.length; j++) {
                const idsI = new Set(combos[i].map(t => t.id));
                if (combos[j].some(t => idsI.has(t.id))) continue; // overlap

                const totalPts = [...combos[i], ...combos[j]]
                    .reduce((s, t) => s + (t.isJoker ? 0 : t.number), 0);

                if (totalPts >= INITIAL_MELD_MIN) {
                    [combos[i], combos[j]].forEach(combo => {
                        removeComboFromRack(rack, combo);
                        tableSets.push(combo);
                    });
                    initialMeldDone[playerIdx] = true;
                    return true;
                }
            }
        }
        return false;
    }

    function aiTryExtendTableSets(playerIdx) {
        const rack = playerRacks[playerIdx];
        let played = false;

        for (let si = 0; si < tableSets.length && !played; si++) {
            const set = tableSets[si];
            for (let ri = rack.length - 1; ri >= 0 && !played; ri--) {
                const tile = rack[ri];
                const testSet = [...set, tile];
                if (validateSet(testSet)) {
                    set.push(tile);
                    rack.splice(ri, 1);
                    played = true;
                }
            }
        }

        return played;
    }

    // ── Find possible groups from a rack ──
    function findPossibleGroups(rack) {
        const groups = [];
        const byNumber = {};
        rack.forEach(tile => {
            if (tile.isJoker) return;
            if (!byNumber[tile.number]) byNumber[tile.number] = [];
            byNumber[tile.number].push(tile);
        });

        const jokers = rack.filter(t => t.isJoker);

        for (const num in byNumber) {
            const tiles = byNumber[num];
            // Ensure unique colors
            const uniqueColors = [];
            const seen = new Set();
            tiles.forEach(t => {
                if (!seen.has(t.color)) {
                    seen.add(t.color);
                    uniqueColors.push(t);
                }
            });

            if (uniqueColors.length >= 3) {
                groups.push(uniqueColors.slice(0, Math.min(4, uniqueColors.length)));
            } else if (uniqueColors.length === 2 && jokers.length >= 1) {
                groups.push([...uniqueColors, jokers[0]]);
            }
        }

        return groups;
    }

    // ── Find possible runs from a rack ──
    function findPossibleRuns(rack) {
        const runs = [];
        const jokers = rack.filter(t => t.isJoker);

        for (const color of COLORS) {
            const colorTiles = rack.filter(t => !t.isJoker && t.color === color)
                .sort((a, b) => a.number - b.number);

            // Deduplicate by number
            const unique = [];
            const seenNums = new Set();
            colorTiles.forEach(t => {
                if (!seenNums.has(t.number)) {
                    seenNums.add(t.number);
                    unique.push(t);
                }
            });

            // Find consecutive sequences of length >= 3
            for (let start = 0; start < unique.length; start++) {
                let run = [unique[start]];
                for (let next = start + 1; next < unique.length; next++) {
                    if (unique[next].number === run[run.length - 1].number + 1) {
                        run.push(unique[next]);
                    } else {
                        break;
                    }
                }
                if (run.length >= 3) {
                    runs.push(run.slice());
                }
            }

            // Try joker-filled gap runs (gap of 1 between two tiles)
            if (jokers.length > 0 && unique.length >= 2) {
                for (let i = 0; i < unique.length - 1; i++) {
                    const gap = unique[i + 1].number - unique[i].number;
                    if (gap === 2 && jokers.length >= 1) {
                        if (i + 2 < unique.length && unique[i + 2].number === unique[i + 1].number + 1) {
                            runs.push([unique[i], jokers[0], unique[i + 1], unique[i + 2]]);
                        } else {
                            runs.push([unique[i], jokers[0], unique[i + 1]]);
                        }
                    }
                }
            }
        }

        return runs;
    }

    // ══════════════════════════════════════════════════
    //  STATE SNAPSHOT (Multiplayer Sync)
    // ══════════════════════════════════════════════════

    function buildStateSnapshot() {
        return {
            tilePool: tilePool.map(t => ({ ...t })),
            playerRacks: playerRacks.map(r => r.map(t => ({ ...t }))),
            tableSets: tableSets.map(s => s.map(t => ({ ...t }))),
            currentPlayer,
            initialMeldDone: initialMeldDone.slice(),
            gameRunning,
            gameOver,
            tileIdCounter,
            numPlayers: NUM_PLAYERS,
            playerNames: PLAYER_NAMES.slice()
        };
    }

    function applyState(state) {
        if (!state) return;

        tilePool = (state.tilePool || []).map(t => ({ ...t }));
        playerRacks = (state.playerRacks || []).map(r => r.map(t => ({ ...t })));
        tableSets = (state.tableSets || []).map(s => s.map(t => ({ ...t })));
        currentPlayer = state.currentPlayer || 0;
        initialMeldDone = state.initialMeldDone || [];
        gameRunning = state.gameRunning !== undefined ? state.gameRunning : false;
        gameOver = state.gameOver !== undefined ? state.gameOver : false;
        tileIdCounter = state.tileIdCounter || 0;

        if (state.playerNames) {
            PLAYER_NAMES = state.playerNames;
            NUM_PLAYERS = PLAYER_NAMES.length;
        }

        if (gameRunning) {
            saveTurnState();
        }

        renderAll();

        if (gameOver) {
            // Determine winner (player with 0 tiles, or stalemate)
            let winnerIdx = -1;
            for (let i = 0; i < playerRacks.length; i++) {
                if (playerRacks[i].length === 0) { winnerIdx = i; break; }
            }
            if (winnerIdx >= 0) {
                showGameOver(winnerIdx);
            } else {
                showGameOverStalemate();
            }
        }
    }

    function broadcastState() {
        if (!isMultiplayer || !socket) return;
        const state = buildStateSnapshot();
        socket.emit('game_move', { room_id: ROOM_ID, type: 'state', data: state });
    }

    // ══════════════════════════════════════════════════
    //  BUTTON EVENT HANDLERS
    // ══════════════════════════════════════════════════

    if (btnPlay) btnPlay.addEventListener('click', () => playTurn());
    if (btnDraw) btnDraw.addEventListener('click', () => drawTile());
    if (btnUndo) btnUndo.addEventListener('click', () => undoTurn());
    if (btnSortNum) btnSortNum.addEventListener('click', () => sortRackByNumber());
    if (btnSortColor) btnSortColor.addEventListener('click', () => sortRackByColor());

    if (startBtn) startBtn.addEventListener('click', () => {
        if (!isHost && isMultiplayer) return;
        overlay.classList.remove('active');
        initGame();
        if (isMultiplayer && socket) {
            broadcastState();
        }
    });

    if (restartBtn) restartBtn.addEventListener('click', () => {
        overlay.classList.remove('active');
        if (!isHost && isMultiplayer) return;
        initGame();
        if (isMultiplayer && socket) {
            broadcastState();
        }
    });

    // ══════════════════════════════════════════════════
    //  MULTIPLAYER SOCKET SETUP
    // ══════════════════════════════════════════════════

    if (isMultiplayer) {
        socket = io();

        socket.on('room_destroyed', () => {
            if (!gameOver) window.location.href = '/';
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
            // ── Spectator path ──
            socket.emit('join_spectate', { room_id: ROOM_ID, user_id: MY_USER });
            socket.emit('user_status', { user_id: MY_USER, status: 'spectating' });

            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    applyState(data.data);
                }
            });

            // Spectator invite handling
            let currentInviteRoomId = null;
            let inviteTimerId = null;
            socket.on('invite_received', (data) => {
                currentInviteRoomId = data.room_id;
                const inviterEl = document.getElementById('invite-inviter');
                const roomNameEl = document.getElementById('invite-room-name');
                const gameEl = document.getElementById('invite-game');
                const overlayEl = document.getElementById('invite-overlay');
                if (inviterEl) inviterEl.textContent = data.inviter;
                if (roomNameEl) roomNameEl.textContent = data.room_name;
                if (gameEl) gameEl.textContent = data.game.toUpperCase();
                if (overlayEl) overlayEl.classList.add('active');
                const wrap = document.querySelector('.invite-popup-wrap');
                const timerText = document.getElementById('invite-timer-text');
                if (wrap && timerText) {
                    const start = Date.now();
                    const duration = 10000;
                    function tick() {
                        const remaining = Math.max(0, duration - (Date.now() - start));
                        wrap.style.setProperty('--progress', (remaining / duration) * 360);
                        timerText.textContent = Math.ceil(remaining / 1000);
                        if (remaining > 0) inviteTimerId = requestAnimationFrame(tick);
                        else if (window.declineInvite) window.declineInvite();
                    }
                    tick();
                }
            });
            window.acceptInvite = () => {
                cancelAnimationFrame(inviteTimerId);
                const overlayEl = document.getElementById('invite-overlay');
                if (overlayEl) overlayEl.classList.remove('active');
                socket.emit('invite_response', { room_id: currentInviteRoomId, user_id: MY_USER, accepted: true });
            };
            window.declineInvite = () => {
                cancelAnimationFrame(inviteTimerId);
                const overlayEl = document.getElementById('invite-overlay');
                if (overlayEl) overlayEl.classList.remove('active');
                socket.emit('invite_response', { room_id: currentInviteRoomId, user_id: MY_USER, accepted: false });
            };
            socket.on('invite_accepted', (data) => {
                if (data && data.room_id) window.location.href = '/room/' + data.room_id;
                else if (data && data.error) alert(data.error);
            });

            startBtn.style.display = 'none';

        } else {
            // ── Player path ──
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

                if (!gameRunning) {
                    startBtn.click();
                }
            });

            // Receive state from host
            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    if (!isHost) {
                        applyState(data.data);
                    }
                }
            });

            socket.on('opponent_disconnected', () => {
                if (gameOver || isSpectator) return;
                // Skip disconnected player's turn if it's their turn
                if (isHost && gameRunning) {
                    // Find disconnected players and auto-draw for them
                }
            });

            socket.on('opponent_game_over', () => {
                if (gameOver || isSpectator) return;
            });

            socket.on('room_force_closed', (data) => {
                alert(data.message || '관리자에 의해 방이 강제 종료되었습니다.');
                window.location.href = '/';
            });
        }
    }

    // ══════════════════════════════════════════════════
    //  GAME CHAT (multiplayer only)
    // ══════════════════════════════════════════════════

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
            // include_self=False pattern: append locally before emitting
            appendChat({ user_id: MY_USER, role: 'Player', message: text });
            socket.emit('game_chat', { room_id: ROOM_ID, user_id: MY_USER, message: text });
            chatInput.value = '';
        }

        if (chatSend) chatSend.addEventListener('click', sendChat);
        if (chatInput) chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); sendChat(); }
        });

        socket.on('chat_message', appendChat);

        // Opacity slider
        if (chatOpacity) chatOpacity.addEventListener('input', () => {
            chatBox.style.opacity = chatOpacity.value / 100;
        });

        // Minimize / Restore toggle
        if (chatToggle) chatToggle.addEventListener('click', () => {
            chatBox.classList.toggle('minimized');
            chatToggle.textContent = chatBox.classList.contains('minimized') ? '+' : '\u2212';
        });

        // Drag chat window
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

        // Resize handle (top-left)
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

    // ══════════════════════════════════════════════════
    //  INITIALIZATION
    // ══════════════════════════════════════════════════

    renderAll();

    // In multiplayer, hide start button until game_ready
    if (isMultiplayer && !isSpectator && !gameReady) {
        startBtn.style.display = 'none';
    }
})();
