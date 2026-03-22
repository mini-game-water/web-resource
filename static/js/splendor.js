(() => {
    'use strict';

    // ── Multiplayer Detection ──
    const isMultiplayer = typeof ROOM_ID !== 'undefined' && ROOM_ID;
    const isSpectator = typeof IS_SPECTATOR !== 'undefined' && IS_SPECTATOR;
    const roomPlayers = isMultiplayer ? (typeof ROOM_PLAYERS !== 'undefined' ? ROOM_PLAYERS : []) : [];
    const myUser = isMultiplayer ? MY_USER : null;
    let socket = null;
    let gameReady = !isMultiplayer || isSpectator;
    let gameOver = false;

    // ── Constants ──
    const GEM_COLORS = ['white', 'blue', 'green', 'red', 'black'];
    const GEM_NAMES = ['다이아몬드', '사파이어', '에메랄드', '루비', '오닉스'];
    const GEM_DISPLAY = { white: '흰', blue: '파', green: '녹', red: '빨', black: '흑', gold: '금' };
    const GEM_CSS = {
        white:  'gem-white',
        blue:   'gem-blue',
        green:  'gem-green',
        red:    'gem-red',
        black:  'gem-black',
        gold:   'gem-gold'
    };
    const GEM_HEX = {
        white:  '#bbb',
        blue:   '#2196F3',
        green:  '#4CAF50',
        red:    '#F44336',
        black:  '#424242',
        gold:   '#FFD700'
    };
    const TIER_COLORS = ['#4CAF50', '#FFC107', '#2196F3'];
    const WIN_POINTS = 15;

    // ── Player Setup ──
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
        // Solo: player + AI opponents
        PLAYER_NAMES = ['나', 'AI 1', 'AI 2', 'AI 3'];
        NUM_PLAYERS = 4;
        myIndex = 0;
        isHost = true;
    }

    function isAI(idx) {
        if (isMultiplayer) return false;
        return idx !== 0;
    }

    // ── Game State ──
    let gems = {};          // bank gems: { white: 7, ... gold: 5 }
    let nobles = [];        // noble tiles on table
    let tiers = [[], [], []]; // tier decks (face-down)
    let tableCards = [[], [], []]; // 4 face-up cards per tier
    let players = [];       // player objects
    let currentPlayer = 0;
    let gameRunning = false;
    let finalRoundTriggered = false;
    let finalRoundStartPlayer = -1;
    let selectedGems = [];  // gems selected for taking
    let actionMode = null;  // null, 'take_gems', 'return_tokens'

    // ── DOM Elements ──
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');
    const overlay = document.getElementById('game-over-overlay');
    const gameOverTitle = document.getElementById('game-over-title');
    const gameOverMsg = document.getElementById('game-over-msg');
    const turnInfo = document.getElementById('turn-info');
    const noblesRow = document.getElementById('nobles-row');
    const cardRowsEl = document.getElementById('card-rows');
    const gemsArea = document.getElementById('gems-area');
    const gemSelectionInfo = document.getElementById('gem-selection-info');
    const actionBar = document.getElementById('action-bar');
    const btnTakeGems = document.getElementById('btn-take-gems');
    const btnCancel = document.getElementById('btn-cancel');
    const reservedArea = document.getElementById('reserved-area');
    const playersArea = document.getElementById('players-area');
    const tokenReturnOverlay = document.getElementById('token-return-overlay');
    const tokenReturnGems = document.getElementById('token-return-gems');
    const tokenReturnInfo = document.getElementById('token-return-info');
    const btnConfirmReturn = document.getElementById('btn-confirm-return');
    const nobleChoiceOverlay = document.getElementById('noble-choice-overlay');
    const nobleChoiceTiles = document.getElementById('noble-choice-tiles');

    // ── Card Generation ──
    function generateCards() {
        const cards = { 1: [], 2: [], 3: [] };

        // Tier 1 (40 cards): mostly 0-1 points, cheap costs
        const t1Defs = [
            // 0-point cards (many)
            { pts: 0, bonus: 'white', cost: { blue: 1, green: 1, red: 1, black: 1 } },
            { pts: 0, bonus: 'white', cost: { blue: 2, black: 1 } },
            { pts: 0, bonus: 'white', cost: { blue: 2, green: 2 } },
            { pts: 0, bonus: 'white', cost: { red: 2, black: 1 } },
            { pts: 0, bonus: 'white', cost: { green: 3 } },
            { pts: 0, bonus: 'white', cost: { blue: 1, red: 1, black: 2 } },
            { pts: 0, bonus: 'white', cost: { green: 1, red: 2 } },
            { pts: 1, bonus: 'white', cost: { green: 4 } },

            { pts: 0, bonus: 'blue', cost: { white: 1, green: 1, red: 1, black: 1 } },
            { pts: 0, bonus: 'blue', cost: { black: 2, white: 1 } },
            { pts: 0, bonus: 'blue', cost: { green: 2, black: 2 } },
            { pts: 0, bonus: 'blue', cost: { white: 2, red: 1 } },
            { pts: 0, bonus: 'blue', cost: { black: 3 } },
            { pts: 0, bonus: 'blue', cost: { white: 1, green: 2, red: 1 } },
            { pts: 0, bonus: 'blue', cost: { white: 1, black: 2 } },
            { pts: 1, bonus: 'blue', cost: { red: 4 } },

            { pts: 0, bonus: 'green', cost: { white: 1, blue: 1, red: 1, black: 1 } },
            { pts: 0, bonus: 'green', cost: { white: 2, blue: 1 } },
            { pts: 0, bonus: 'green', cost: { blue: 2, red: 2 } },
            { pts: 0, bonus: 'green', cost: { red: 2, white: 1 } },
            { pts: 0, bonus: 'green', cost: { red: 3 } },
            { pts: 0, bonus: 'green', cost: { white: 2, blue: 1, black: 1 } },
            { pts: 0, bonus: 'green', cost: { blue: 1, red: 1, black: 1 } },
            { pts: 1, bonus: 'green', cost: { black: 4 } },

            { pts: 0, bonus: 'red', cost: { white: 1, blue: 1, green: 1, black: 1 } },
            { pts: 0, bonus: 'red', cost: { green: 2, black: 1 } },
            { pts: 0, bonus: 'red', cost: { white: 2, red: 2 } },
            { pts: 0, bonus: 'red', cost: { blue: 2, green: 1 } },
            { pts: 0, bonus: 'red', cost: { white: 3 } },
            { pts: 0, bonus: 'red', cost: { white: 1, blue: 1, black: 1 } },
            { pts: 0, bonus: 'red', cost: { white: 2, green: 1, black: 1 } },
            { pts: 1, bonus: 'red', cost: { white: 4 } },

            { pts: 0, bonus: 'black', cost: { white: 1, blue: 1, green: 1, red: 1 } },
            { pts: 0, bonus: 'black', cost: { green: 2, red: 1 } },
            { pts: 0, bonus: 'black', cost: { white: 2, blue: 2 } },
            { pts: 0, bonus: 'black', cost: { green: 2, white: 1 } },
            { pts: 0, bonus: 'black', cost: { blue: 3 } },
            { pts: 0, bonus: 'black', cost: { green: 1, red: 1, blue: 1 } },
            { pts: 0, bonus: 'black', cost: { red: 1, green: 2, blue: 1 } },
            { pts: 1, bonus: 'black', cost: { blue: 4 } },
        ];

        // Tier 2 (30 cards): 1-3 points, medium costs
        const t2Defs = [
            { pts: 1, bonus: 'white', cost: { green: 3, red: 2, black: 2 } },
            { pts: 1, bonus: 'white', cost: { green: 2, red: 3, black: 3 } },
            { pts: 2, bonus: 'white', cost: { red: 5 } },
            { pts: 2, bonus: 'white', cost: { red: 1, green: 4, black: 2 } },
            { pts: 2, bonus: 'white', cost: { red: 3, black: 3, white: 1 } },
            { pts: 3, bonus: 'white', cost: { white: 6 } },

            { pts: 1, bonus: 'blue', cost: { white: 2, red: 2, black: 3 } },
            { pts: 1, bonus: 'blue', cost: { blue: 2, green: 3, red: 3 } },
            { pts: 2, bonus: 'blue', cost: { blue: 5 } },
            { pts: 2, bonus: 'blue', cost: { white: 2, red: 3, black: 3 } },
            { pts: 2, bonus: 'blue', cost: { green: 2, black: 4, white: 1 } },
            { pts: 3, bonus: 'blue', cost: { blue: 6 } },

            { pts: 1, bonus: 'green', cost: { white: 3, blue: 2, red: 2 } },
            { pts: 1, bonus: 'green', cost: { white: 2, blue: 3, black: 2 } },
            { pts: 2, bonus: 'green', cost: { green: 5 } },
            { pts: 2, bonus: 'green', cost: { white: 4, blue: 2, black: 1 } },
            { pts: 2, bonus: 'green', cost: { blue: 3, red: 2, green: 3 } },
            { pts: 3, bonus: 'green', cost: { green: 6 } },

            { pts: 1, bonus: 'red', cost: { white: 2, blue: 3, green: 3 } },
            { pts: 1, bonus: 'red', cost: { blue: 2, green: 2, black: 3 } },
            { pts: 2, bonus: 'red', cost: { black: 5 } },
            { pts: 2, bonus: 'red', cost: { white: 3, blue: 2, green: 2 } },
            { pts: 2, bonus: 'red', cost: { white: 1, blue: 4, green: 2 } },
            { pts: 3, bonus: 'red', cost: { red: 6 } },

            { pts: 1, bonus: 'black', cost: { white: 3, blue: 2, green: 2 } },
            { pts: 1, bonus: 'black', cost: { white: 3, green: 3, red: 2 } },
            { pts: 2, bonus: 'black', cost: { white: 5 } },
            { pts: 2, bonus: 'black', cost: { green: 3, red: 3, blue: 1 } },
            { pts: 2, bonus: 'black', cost: { white: 2, green: 1, red: 4 } },
            { pts: 3, bonus: 'black', cost: { black: 6 } },
        ];

        // Tier 3 (20 cards): 3-5 points, expensive costs
        const t3Defs = [
            { pts: 3, bonus: 'white', cost: { blue: 3, green: 3, red: 5, black: 3 } },
            { pts: 4, bonus: 'white', cost: { white: 3, red: 3, black: 6 } },
            { pts: 4, bonus: 'white', cost: { black: 7 } },
            { pts: 5, bonus: 'white', cost: { white: 3, black: 7 } },

            { pts: 3, bonus: 'blue', cost: { white: 3, green: 3, red: 3, black: 5 } },
            { pts: 4, bonus: 'blue', cost: { white: 6, blue: 3, black: 3 } },
            { pts: 4, bonus: 'blue', cost: { white: 7 } },
            { pts: 5, bonus: 'blue', cost: { white: 7, blue: 3 } },

            { pts: 3, bonus: 'green', cost: { white: 5, blue: 3, red: 3, black: 3 } },
            { pts: 4, bonus: 'green', cost: { white: 3, blue: 6, green: 3 } },
            { pts: 4, bonus: 'green', cost: { blue: 7 } },
            { pts: 5, bonus: 'green', cost: { blue: 7, green: 3 } },

            { pts: 3, bonus: 'red', cost: { white: 3, blue: 5, green: 3, black: 3 } },
            { pts: 4, bonus: 'red', cost: { blue: 3, green: 6, red: 3 } },
            { pts: 4, bonus: 'red', cost: { green: 7 } },
            { pts: 5, bonus: 'red', cost: { green: 7, red: 3 } },

            { pts: 3, bonus: 'black', cost: { white: 3, blue: 3, green: 5, red: 3 } },
            { pts: 4, bonus: 'black', cost: { green: 3, red: 6, black: 3 } },
            { pts: 4, bonus: 'black', cost: { red: 7 } },
            { pts: 5, bonus: 'black', cost: { red: 7, black: 3 } },
        ];

        t1Defs.forEach((d, i) => cards[1].push({ id: 't1_' + i, tier: 1, ...d }));
        t2Defs.forEach((d, i) => cards[2].push({ id: 't2_' + i, tier: 2, ...d }));
        t3Defs.forEach((d, i) => cards[3].push({ id: 't3_' + i, tier: 3, ...d }));

        return cards;
    }

    function generateNobles() {
        const nobleDefs = [
            { id: 'n0', pts: 3, requires: { white: 3, blue: 3, black: 3 } },
            { id: 'n1', pts: 3, requires: { white: 3, red: 3, black: 3 } },
            { id: 'n2', pts: 3, requires: { blue: 3, green: 3, red: 3 } },
            { id: 'n3', pts: 3, requires: { white: 3, blue: 3, green: 3 } },
            { id: 'n4', pts: 3, requires: { green: 3, red: 3, black: 3 } },
            { id: 'n5', pts: 3, requires: { red: 4, green: 4 } },
            { id: 'n6', pts: 3, requires: { blue: 4, green: 4 } },
            { id: 'n7', pts: 3, requires: { black: 4, white: 4 } },
            { id: 'n8', pts: 3, requires: { black: 4, red: 4 } },
            { id: 'n9', pts: 3, requires: { blue: 4, white: 4 } },
        ];
        return nobleDefs;
    }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    // ── Initialize Game ──
    function initGame() {
        gameRunning = true;
        gameOver = false;
        finalRoundTriggered = false;
        finalRoundStartPlayer = -1;
        currentPlayer = 0;
        selectedGems = [];
        actionMode = null;
        overlay.classList.remove('active');

        // Set gem counts based on player count
        const gemCount = NUM_PLAYERS === 2 ? 4 : (NUM_PLAYERS === 3 ? 5 : 7);
        gems = {};
        GEM_COLORS.forEach(c => gems[c] = gemCount);
        gems.gold = 5;

        // Create and shuffle card decks
        const allCards = generateCards();
        tiers = [shuffle(allCards[1]), shuffle(allCards[2]), shuffle(allCards[3])];

        // Deal 4 face-up cards per tier
        tableCards = [[], [], []];
        for (let t = 0; t < 3; t++) {
            for (let i = 0; i < 4; i++) {
                if (tiers[t].length > 0) {
                    tableCards[t].push(tiers[t].pop());
                }
            }
        }

        // Select nobles
        const allNobles = shuffle(generateNobles());
        const nobleCount = NUM_PLAYERS + 1;
        nobles = allNobles.slice(0, nobleCount);

        // Initialize players
        players = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            players.push({
                name: PLAYER_NAMES[i],
                gems: { white: 0, blue: 0, green: 0, red: 0, black: 0, gold: 0 },
                bonuses: { white: 0, blue: 0, green: 0, red: 0, black: 0 },
                reserved: [],
                nobles: [],
                cards: [],
                points: 0
            });
        }

        renderAll();
        updateTurnInfo();

        if (isHost && isAI(currentPlayer)) {
            setTimeout(() => aiTurn(), 800);
        }
    }

    // ── Rendering ──
    function renderAll() {
        renderNobles();
        renderCardRows();
        renderGems();
        renderPlayers();
        renderReserved();
        updateActionBar();
    }

    function renderNobles() {
        noblesRow.innerHTML = '';
        nobles.forEach(noble => {
            const tile = document.createElement('div');
            tile.className = 'noble-tile';
            tile.innerHTML = '<span class="noble-crown">&#128081;</span>';

            const pts = document.createElement('div');
            pts.className = 'noble-points';
            pts.textContent = noble.pts;
            tile.appendChild(pts);

            const reqs = document.createElement('div');
            reqs.className = 'noble-reqs';
            for (const [color, count] of Object.entries(noble.requires)) {
                const req = document.createElement('div');
                req.className = 'noble-req ' + GEM_CSS[color];
                req.textContent = count;
                reqs.appendChild(req);
            }
            tile.appendChild(reqs);
            noblesRow.appendChild(tile);
        });
    }

    function renderCardRows() {
        cardRowsEl.innerHTML = '';
        for (let t = 2; t >= 0; t--) {
            const row = document.createElement('div');
            row.className = 'card-row';

            // Deck indicator
            const deck = document.createElement('div');
            deck.className = 'tier-deck tier-' + (t + 1);
            deck.innerHTML = '<span>Tier ' + (t + 1) + '</span><span class="deck-count">' + tiers[t].length + '장</span>';
            deck.addEventListener('click', () => handleReserveFromDeck(t));
            row.appendChild(deck);

            // 4 face-up cards
            for (let c = 0; c < 4; c++) {
                const card = tableCards[t][c];
                if (card) {
                    const el = createCardElement(card);
                    row.appendChild(el);
                } else {
                    const empty = document.createElement('div');
                    empty.className = 'dev-card empty-slot';
                    row.appendChild(empty);
                }
            }

            cardRowsEl.appendChild(row);
        }
    }

    function createCardElement(card) {
        const el = document.createElement('div');
        el.className = 'dev-card';

        const me = players[isSpectator ? 0 : myIndex];
        if (me && canAfford(card, me)) {
            el.classList.add('affordable');
        }

        // Tier color stripe at top
        const stripe = document.createElement('div');
        stripe.className = 'card-tier-stripe';
        stripe.style.background = TIER_COLORS[card.tier - 1];
        el.appendChild(stripe);

        // Header: points + bonus gem
        const header = document.createElement('div');
        header.className = 'card-header';
        const pts = document.createElement('div');
        pts.className = 'card-points';
        pts.textContent = card.pts > 0 ? card.pts : '';
        header.appendChild(pts);
        const bonus = document.createElement('div');
        bonus.className = 'card-bonus';
        bonus.style.background = GEM_HEX[card.bonus];
        if (card.bonus === 'white') bonus.style.border = '2px solid #999';
        header.appendChild(bonus);
        el.appendChild(header);

        // Empty body area
        const body = document.createElement('div');
        body.className = 'card-empty-body';
        el.appendChild(body);

        // Cost at bottom
        const costDiv = document.createElement('div');
        costDiv.className = 'card-cost';
        for (const [color, count] of Object.entries(card.cost)) {
            if (count > 0) {
                const item = document.createElement('div');
                item.className = 'cost-item';
                const gemDot = document.createElement('div');
                gemDot.className = 'cost-gem ' + GEM_CSS[color];
                gemDot.textContent = count;
                item.appendChild(gemDot);
                costDiv.appendChild(item);
            }
        }
        el.appendChild(costDiv);

        // Click handlers
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            handleCardClick(card);
        });

        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            handleReserveCard(card);
        });

        return el;
    }

    function renderGems() {
        gemsArea.innerHTML = '';
        const allColors = [...GEM_COLORS, 'gold'];
        allColors.forEach(color => {
            const stack = document.createElement('div');
            stack.className = 'gem-stack';
            if (color === 'gold') stack.classList.add('disabled');

            const isSelected = selectedGems.includes(color);
            if (isSelected) stack.classList.add('selected');

            const count = gems[color];
            if (count <= 0 && color !== 'gold') stack.classList.add('disabled');

            const token = document.createElement('div');
            token.className = 'gem-token ' + GEM_CSS[color];
            token.textContent = count;
            stack.appendChild(token);

            const label = document.createElement('div');
            label.className = 'gem-label';
            label.textContent = GEM_DISPLAY[color];
            stack.appendChild(label);

            if (color !== 'gold') {
                stack.addEventListener('click', () => handleGemClick(color));
            }

            gemsArea.appendChild(stack);
        });
    }

    function renderPlayers() {
        playersArea.innerHTML = '';
        players.forEach((p, i) => {
            const panel = document.createElement('div');
            panel.className = 'player-panel';
            if (i === currentPlayer && gameRunning) panel.classList.add('active-turn');
            if (i === myIndex && !isSpectator) panel.classList.add('is-me');

            // Name + prestige
            const name = document.createElement('div');
            name.className = 'panel-name';
            name.textContent = p.name;
            const badge = document.createElement('span');
            badge.className = 'prestige-badge';
            badge.textContent = p.points + '점';
            name.appendChild(badge);
            panel.appendChild(name);

            // Gems
            const gemsDiv = document.createElement('div');
            gemsDiv.className = 'panel-gems';
            const gLabel = document.createElement('span');
            gLabel.textContent = '보석: ';
            gLabel.style.fontSize = '0.75rem';
            gLabel.style.color = '#9a8b78';
            gemsDiv.appendChild(gLabel);
            [...GEM_COLORS, 'gold'].forEach(color => {
                if (p.gems[color] > 0) {
                    const g = document.createElement('div');
                    g.className = 'panel-gem ' + GEM_CSS[color];
                    g.textContent = p.gems[color];
                    gemsDiv.appendChild(g);
                }
            });
            panel.appendChild(gemsDiv);

            // Bonuses
            const bonusDiv = document.createElement('div');
            bonusDiv.className = 'panel-bonuses';
            const bLabel = document.createElement('span');
            bLabel.textContent = '보너스: ';
            bLabel.style.fontSize = '0.75rem';
            bLabel.style.color = '#9a8b78';
            bonusDiv.appendChild(bLabel);
            GEM_COLORS.forEach(color => {
                if (p.bonuses[color] > 0) {
                    const b = document.createElement('div');
                    b.className = 'panel-bonus ' + GEM_CSS[color];
                    b.textContent = p.bonuses[color];
                    bonusDiv.appendChild(b);
                }
            });
            panel.appendChild(bonusDiv);

            // Reserved count
            if (p.reserved.length > 0) {
                const res = document.createElement('div');
                res.className = 'panel-reserved';
                res.textContent = '예약: ' + p.reserved.length + '장';
                panel.appendChild(res);
            }

            // Noble count
            if (p.nobles.length > 0) {
                const nob = document.createElement('div');
                nob.className = 'panel-nobles';
                nob.textContent = '귀족: ' + p.nobles.length + '명 (+' + (p.nobles.length * 3) + '점)';
                panel.appendChild(nob);
            }

            playersArea.appendChild(panel);
        });
    }

    function renderReserved() {
        reservedArea.innerHTML = '';
        if (isSpectator) return;
        const me = players[myIndex];
        if (!me || me.reserved.length === 0) return;

        const label = document.createElement('div');
        label.style.cssText = 'width:100%;text-align:center;font-size:0.85rem;color:#9a8b78;margin-bottom:2px;';
        label.textContent = '예약한 카드 (클릭하여 구매)';
        reservedArea.appendChild(label);

        me.reserved.forEach(card => {
            const el = createCardElement(card);
            el.style.width = '90px';
            el.style.height = '126px';
            reservedArea.appendChild(el);
        });
    }

    function updateActionBar() {
        if (selectedGems.length > 0) {
            actionBar.classList.remove('hidden');
        } else {
            actionBar.classList.add('hidden');
        }
    }

    function updateTurnInfo() {
        if (!gameRunning) {
            turnInfo.textContent = '게임을 시작하세요';
            return;
        }
        const name = players[currentPlayer].name;
        const pts = players[currentPlayer].points;
        if (finalRoundTriggered) {
            turnInfo.textContent = name + '의 턴 (' + pts + '점) - 최종 라운드!';
        } else {
            turnInfo.textContent = name + '의 턴 (' + pts + '점)';
        }
        gemSelectionInfo.textContent = '';
    }

    // ── Game Logic ──
    function isMyTurn() {
        if (isSpectator) return false;
        if (!gameRunning || gameOver) return false;
        if (isMultiplayer) return currentPlayer === myIndex;
        return currentPlayer === 0; // solo: always player 0
    }

    function totalGems(p) {
        let total = 0;
        for (const c of [...GEM_COLORS, 'gold']) {
            total += (p.gems[c] || 0);
        }
        return total;
    }

    function canAfford(card, player) {
        let goldNeeded = 0;
        for (const [color, count] of Object.entries(card.cost)) {
            const have = (player.gems[color] || 0) + (player.bonuses[color] || 0);
            if (have < count) {
                goldNeeded += count - have;
            }
        }
        return goldNeeded <= (player.gems.gold || 0);
    }

    function buyCard(card, playerIdx) {
        const p = players[playerIdx];
        let goldUsed = 0;

        for (const [color, count] of Object.entries(card.cost)) {
            let remaining = count;
            // Use bonuses first (free)
            const bonusReduction = Math.min(p.bonuses[color] || 0, remaining);
            remaining -= bonusReduction;
            // Use color gems
            const colorUsed = Math.min(p.gems[color] || 0, remaining);
            p.gems[color] -= colorUsed;
            gems[color] += colorUsed;
            remaining -= colorUsed;
            // Use gold for the rest
            if (remaining > 0) {
                p.gems.gold -= remaining;
                gems.gold += remaining;
                goldUsed += remaining;
            }
        }

        // Gain bonus
        p.bonuses[card.bonus] = (p.bonuses[card.bonus] || 0) + 1;
        p.points += card.pts;
        p.cards.push(card);

        // Remove from table or reserved
        for (let t = 0; t < 3; t++) {
            const idx = tableCards[t].findIndex(c => c && c.id === card.id);
            if (idx !== -1) {
                // Replace with card from deck
                tableCards[t][idx] = tiers[t].length > 0 ? tiers[t].pop() : null;
                return;
            }
        }
        // Check reserved
        const resIdx = p.reserved.findIndex(c => c.id === card.id);
        if (resIdx !== -1) {
            p.reserved.splice(resIdx, 1);
        }
    }

    function takeGemsAction(gemList) {
        const p = players[currentPlayer];
        gemList.forEach(color => {
            if (gems[color] > 0) {
                gems[color]--;
                p.gems[color] = (p.gems[color] || 0) + 1;
            }
        });
    }

    function reserveCard(card, playerIdx) {
        const p = players[playerIdx];
        if (p.reserved.length >= 3) return false;

        p.reserved.push(card);

        // Remove from table
        for (let t = 0; t < 3; t++) {
            const idx = tableCards[t].findIndex(c => c && c.id === card.id);
            if (idx !== -1) {
                tableCards[t][idx] = tiers[t].length > 0 ? tiers[t].pop() : null;
                break;
            }
        }

        // Give gold token if available
        if (gems.gold > 0) {
            gems.gold--;
            p.gems.gold = (p.gems.gold || 0) + 1;
        }
        return true;
    }

    function reserveFromDeck(tierIdx, playerIdx) {
        const p = players[playerIdx];
        if (p.reserved.length >= 3) return false;
        if (tiers[tierIdx].length === 0) return false;

        const card = tiers[tierIdx].pop();
        p.reserved.push(card);

        if (gems.gold > 0) {
            gems.gold--;
            p.gems.gold = (p.gems.gold || 0) + 1;
        }
        return true;
    }

    function checkNoble(playerIdx) {
        const p = players[playerIdx];
        const eligible = nobles.filter(noble => {
            for (const [color, count] of Object.entries(noble.requires)) {
                if ((p.bonuses[color] || 0) < count) return false;
            }
            return true;
        });

        if (eligible.length === 0) return null;
        if (eligible.length === 1) {
            // Auto-attract
            const noble = eligible[0];
            p.nobles.push(noble);
            p.points += noble.pts;
            nobles = nobles.filter(n => n.id !== noble.id);
            return noble;
        }
        // Multiple eligible: need choice (for AI, pick first)
        return eligible;
    }

    function checkGameEnd() {
        if (finalRoundTriggered) {
            // Check if we've come back to the start player
            if (currentPlayer === finalRoundStartPlayer) {
                endGame();
                return true;
            }
        } else {
            // Check if any player hit 15+
            for (let i = 0; i < NUM_PLAYERS; i++) {
                if (players[i].points >= WIN_POINTS) {
                    finalRoundTriggered = true;
                    finalRoundStartPlayer = 0; // complete the round
                    break;
                }
            }
        }
        return false;
    }

    function endGame() {
        gameRunning = false;
        gameOver = true;

        // Find winner(s)
        let maxPts = -1;
        players.forEach(p => { if (p.points > maxPts) maxPts = p.points; });
        const winners = players.filter(p => p.points === maxPts);

        let winner;
        if (winners.length === 1) {
            winner = winners[0];
        } else {
            // Tiebreak: fewest cards
            let minCards = Infinity;
            winners.forEach(w => { if (w.cards.length < minCards) minCards = w.cards.length; });
            winner = winners.find(w => w.cards.length === minCards);
        }

        gameOverTitle.textContent = '게임 종료!';
        let msg = winner.name + ' 승리! (' + winner.points + '점)\n\n';
        players.forEach(p => {
            msg += p.name + ': ' + p.points + '점 (카드 ' + p.cards.length + '장)\n';
        });
        gameOverMsg.textContent = msg;
        gameOverMsg.style.whiteSpace = 'pre-line';
        overlay.classList.add('active');

        if (isMultiplayer && isHost) {
            broadcastState();
        }
    }

    // ── Token Return Logic ──
    let tokensToReturn = 0;
    let returnCallback = null;

    function promptTokenReturn(playerIdx, callback) {
        const p = players[playerIdx];
        const total = totalGems(p);
        if (total <= 10) {
            callback();
            return;
        }
        tokensToReturn = total - 10;

        if (isAI(playerIdx)) {
            // AI returns least valuable gems
            aiReturnTokens(playerIdx, tokensToReturn);
            callback();
            return;
        }

        if (isMultiplayer && playerIdx !== myIndex) {
            // Wait for remote player to return tokens
            returnCallback = callback;
            return;
        }

        returnCallback = callback;
        tokenReturnInfo.textContent = tokensToReturn + '개의 보석을 반환하세요';
        tokenReturnOverlay.classList.remove('hidden');
        renderTokenReturn(playerIdx);
    }

    function renderTokenReturn(playerIdx) {
        const p = players[playerIdx];
        tokenReturnGems.innerHTML = '';
        [...GEM_COLORS, 'gold'].forEach(color => {
            if (p.gems[color] > 0) {
                const stack = document.createElement('div');
                stack.className = 'gem-stack';
                const token = document.createElement('div');
                token.className = 'gem-token ' + GEM_CSS[color];
                token.textContent = p.gems[color];
                stack.appendChild(token);
                const label = document.createElement('div');
                label.className = 'gem-label';
                label.textContent = GEM_DISPLAY[color];
                stack.appendChild(label);
                stack.addEventListener('click', () => {
                    if (tokensToReturn <= 0) return;
                    if (p.gems[color] <= 0) return;
                    p.gems[color]--;
                    gems[color]++;
                    tokensToReturn--;
                    tokenReturnInfo.textContent = tokensToReturn + '개의 보석을 반환하세요';
                    renderTokenReturn(playerIdx);
                    if (tokensToReturn <= 0) {
                        btnConfirmReturn.style.display = '';
                    }
                });
                tokenReturnGems.appendChild(stack);
            }
        });
        btnConfirmReturn.style.display = tokensToReturn > 0 ? 'none' : '';
    }

    btnConfirmReturn.addEventListener('click', () => {
        tokenReturnOverlay.classList.add('hidden');
        if (returnCallback) {
            const cb = returnCallback;
            returnCallback = null;
            cb();
        }
    });

    function aiReturnTokens(playerIdx, count) {
        const p = players[playerIdx];
        // Return gems in order: least useful first
        const order = [...GEM_COLORS, 'gold'];
        let returned = 0;
        while (returned < count) {
            let found = false;
            for (const color of order) {
                if (p.gems[color] > 0 && returned < count) {
                    p.gems[color]--;
                    gems[color]++;
                    returned++;
                    found = true;
                    break;
                }
            }
            if (!found) break;
        }
    }

    // ── Noble Choice ──
    function promptNobleChoice(playerIdx, eligibleNobles, callback) {
        if (isAI(playerIdx)) {
            // AI picks the first noble
            const noble = eligibleNobles[0];
            const p = players[playerIdx];
            p.nobles.push(noble);
            p.points += noble.pts;
            nobles = nobles.filter(n => n.id !== noble.id);
            callback();
            return;
        }

        if (isMultiplayer && playerIdx !== myIndex) {
            // Wait for remote player
            callback();
            return;
        }

        nobleChoiceTiles.innerHTML = '';
        eligibleNobles.forEach(noble => {
            const tile = document.createElement('div');
            tile.className = 'noble-tile';
            tile.innerHTML = '<span class="noble-crown">&#128081;</span>';
            const pts = document.createElement('div');
            pts.className = 'noble-points';
            pts.textContent = noble.pts;
            tile.appendChild(pts);
            const reqs = document.createElement('div');
            reqs.className = 'noble-reqs';
            for (const [color, count] of Object.entries(noble.requires)) {
                const req = document.createElement('div');
                req.className = 'noble-req ' + GEM_CSS[color];
                req.textContent = count;
                reqs.appendChild(req);
            }
            tile.appendChild(reqs);
            tile.addEventListener('click', () => {
                const p = players[playerIdx];
                p.nobles.push(noble);
                p.points += noble.pts;
                nobles = nobles.filter(n => n.id !== noble.id);
                nobleChoiceOverlay.classList.add('hidden');
                callback();
            });
            nobleChoiceTiles.appendChild(tile);
        });
        nobleChoiceOverlay.classList.remove('hidden');
    }

    // ── End of Turn ──
    function finishTurn() {
        const pidx = currentPlayer;

        // Check nobles
        const nobleResult = checkNoble(pidx);
        if (nobleResult && Array.isArray(nobleResult)) {
            // Multiple eligible nobles - need to choose
            promptNobleChoice(pidx, nobleResult, () => {
                afterNobleCheck();
            });
            return;
        }

        afterNobleCheck();
    }

    function afterNobleCheck() {
        if (isMultiplayer && isHost) {
            broadcastState();
        }

        // Check game end
        if (checkGameEnd()) return;

        // Next player
        currentPlayer = (currentPlayer + 1) % NUM_PLAYERS;
        renderAll();
        updateTurnInfo();

        if (isMultiplayer && isHost) {
            broadcastState();
        }

        // AI turn
        if (isHost && isAI(currentPlayer) && gameRunning) {
            setTimeout(() => aiTurn(), 600);
        }
    }

    // ── User Actions ──
    function handleGemClick(color) {
        if (!isMyTurn()) return;
        if (gems[color] <= 0) return;

        const alreadySelected = selectedGems.filter(g => g === color).length;

        if (selectedGems.length === 0) {
            selectedGems.push(color);
        } else if (selectedGems.length === 1 && selectedGems[0] === color) {
            // Taking 2 of same color - need 4+ remaining
            if (gems[color] >= 4) {
                selectedGems.push(color);
            } else {
                gemSelectionInfo.textContent = '같은 색 2개는 4개 이상 남아있어야 합니다.';
                return;
            }
        } else if (selectedGems.length === 1 && selectedGems[0] !== color) {
            selectedGems.push(color);
        } else if (selectedGems.length === 2) {
            if (selectedGems[0] === selectedGems[1]) {
                // Already selected 2 same - can't add more
                gemSelectionInfo.textContent = '같은 색 2개를 선택했습니다. 가져오기를 눌러주세요.';
                return;
            }
            if (selectedGems.includes(color)) {
                gemSelectionInfo.textContent = '이미 선택한 색입니다.';
                return;
            }
            selectedGems.push(color);
        } else {
            gemSelectionInfo.textContent = '최대 3개까지 선택 가능합니다.';
            return;
        }

        // Update display
        const names = selectedGems.map(c => GEM_DISPLAY[c]);
        gemSelectionInfo.textContent = '선택: ' + names.join(', ');
        renderGems();
        updateActionBar();
    }

    function handleCardClick(card) {
        if (!isMyTurn()) return;
        const me = players[myIndex];

        if (canAfford(card, me)) {
            buyCard(card, myIndex);
            clearSelection();

            if (isMultiplayer) {
                sendAction({ type: 'buy', cardId: card.id });
            }

            promptTokenReturn(myIndex, () => {
                finishTurn();
            });
        } else {
            gemSelectionInfo.textContent = '보석이 부족합니다. 우클릭으로 예약할 수 있습니다.';
        }
    }

    function handleReserveCard(card) {
        if (!isMyTurn()) return;
        const me = players[myIndex];
        if (me.reserved.length >= 3) {
            gemSelectionInfo.textContent = '예약은 최대 3장까지 가능합니다.';
            return;
        }

        reserveCard(card, myIndex);
        clearSelection();

        if (isMultiplayer) {
            sendAction({ type: 'reserve', cardId: card.id });
        }

        promptTokenReturn(myIndex, () => {
            finishTurn();
        });
    }

    function handleReserveFromDeck(tierIdx) {
        if (!isMyTurn()) return;
        const me = players[myIndex];
        if (me.reserved.length >= 3) {
            gemSelectionInfo.textContent = '예약은 최대 3장까지 가능합니다.';
            return;
        }
        if (tiers[tierIdx].length === 0) {
            gemSelectionInfo.textContent = '해당 티어의 카드가 없습니다.';
            return;
        }

        reserveFromDeck(tierIdx, myIndex);
        clearSelection();

        if (isMultiplayer) {
            sendAction({ type: 'reserve_deck', tier: tierIdx });
        }

        promptTokenReturn(myIndex, () => {
            finishTurn();
        });
    }

    btnTakeGems.addEventListener('click', () => {
        if (!isMyTurn()) return;

        // Validate selection
        if (selectedGems.length === 2 && selectedGems[0] === selectedGems[1]) {
            // Taking 2 same - ok
        } else if (selectedGems.length === 3) {
            // Taking 3 different - check all different
            const unique = new Set(selectedGems);
            if (unique.size !== 3) {
                gemSelectionInfo.textContent = '서로 다른 3가지 색을 선택하세요.';
                return;
            }
        } else if (selectedGems.length === 1) {
            // Taking less than full amount is allowed if not enough gems available
            const availableColors = GEM_COLORS.filter(c => c !== selectedGems[0] && gems[c] > 0);
            if (availableColors.length > 0 && !(gems[selectedGems[0]] >= 4)) {
                gemSelectionInfo.textContent = '다른 색 보석도 가져갈 수 있습니다.';
                return;
            }
        } else if (selectedGems.length === 0) {
            gemSelectionInfo.textContent = '보석을 선택하세요.';
            return;
        }

        takeGemsAction(selectedGems);

        if (isMultiplayer) {
            sendAction({ type: 'take_gems', gems: selectedGems });
        }

        clearSelection();

        promptTokenReturn(myIndex, () => {
            finishTurn();
        });
    });

    btnCancel.addEventListener('click', () => {
        clearSelection();
    });

    function clearSelection() {
        selectedGems = [];
        gemSelectionInfo.textContent = '';
        renderGems();
        updateActionBar();
    }

    // ── AI Strategy ──
    function aiTurn() {
        if (!gameRunning || gameOver) return;
        const pidx = currentPlayer;
        if (!isAI(pidx)) return;

        const p = players[pidx];

        // 1. Try to buy a card (prioritize highest points)
        const buyable = [];
        for (let t = 2; t >= 0; t--) {
            tableCards[t].forEach(card => {
                if (card && canAfford(card, p)) {
                    buyable.push(card);
                }
            });
        }
        // Also check reserved
        p.reserved.forEach(card => {
            if (canAfford(card, p)) {
                buyable.push(card);
            }
        });

        if (buyable.length > 0) {
            // Sort by points descending, then by cost ascending
            buyable.sort((a, b) => {
                if (b.pts !== a.pts) return b.pts - a.pts;
                const costA = Object.values(a.cost).reduce((s, v) => s + v, 0);
                const costB = Object.values(b.cost).reduce((s, v) => s + v, 0);
                return costA - costB;
            });
            buyCard(buyable[0], pidx);
            promptTokenReturn(pidx, () => {
                finishTurn();
            });
            return;
        }

        // 2. Try to take gems strategically
        // Look at what cards we might want to buy and what gems we need
        const neededGems = {};
        GEM_COLORS.forEach(c => neededGems[c] = 0);

        // Find the cheapest unbought card we could work toward
        for (let t = 0; t < 3; t++) {
            tableCards[t].forEach(card => {
                if (!card) return;
                for (const [color, count] of Object.entries(card.cost)) {
                    const have = (p.gems[color] || 0) + (p.bonuses[color] || 0);
                    if (have < count) {
                        neededGems[color] += count - have;
                    }
                }
            });
        }

        // Try to take 3 different gems we need
        const available3 = GEM_COLORS.filter(c => gems[c] > 0 && neededGems[c] > 0);
        if (available3.length >= 3) {
            // Sort by most needed
            available3.sort((a, b) => neededGems[b] - neededGems[a]);
            const take = available3.slice(0, 3);
            takeGemsAction(take);
            promptTokenReturn(pidx, () => {
                finishTurn();
            });
            return;
        }

        // Try to take 2 of same color
        const available2 = GEM_COLORS.filter(c => gems[c] >= 4 && neededGems[c] >= 2);
        if (available2.length > 0) {
            available2.sort((a, b) => neededGems[b] - neededGems[a]);
            takeGemsAction([available2[0], available2[0]]);
            promptTokenReturn(pidx, () => {
                finishTurn();
            });
            return;
        }

        // Take any available gems (up to 3 different)
        const anyAvailable = GEM_COLORS.filter(c => gems[c] > 0);
        if (anyAvailable.length > 0) {
            const take = anyAvailable.slice(0, Math.min(3, anyAvailable.length));
            takeGemsAction(take);
            promptTokenReturn(pidx, () => {
                finishTurn();
            });
            return;
        }

        // 3. Reserve a card if nothing else
        if (p.reserved.length < 3) {
            // Reserve a high-value card
            for (let t = 2; t >= 0; t--) {
                for (let c = 0; c < 4; c++) {
                    if (tableCards[t][c]) {
                        reserveCard(tableCards[t][c], pidx);
                        promptTokenReturn(pidx, () => {
                            finishTurn();
                        });
                        return;
                    }
                }
            }
        }

        // Fallback: just end turn (shouldn't happen normally)
        finishTurn();
    }

    // ── Multiplayer State Sync ──
    function buildStateSnapshot() {
        return {
            gems: JSON.parse(JSON.stringify(gems)),
            nobles: JSON.parse(JSON.stringify(nobles)),
            tiers: tiers.map(t => JSON.parse(JSON.stringify(t))),
            tableCards: tableCards.map(t => JSON.parse(JSON.stringify(t))),
            players: players.map(p => ({
                name: p.name,
                gems: { ...p.gems },
                bonuses: { ...p.bonuses },
                reserved: JSON.parse(JSON.stringify(p.reserved)),
                nobles: JSON.parse(JSON.stringify(p.nobles)),
                cards: JSON.parse(JSON.stringify(p.cards)),
                points: p.points
            })),
            currentPlayer: currentPlayer,
            gameRunning: gameRunning,
            gameOver: gameOver,
            finalRoundTriggered: finalRoundTriggered,
            finalRoundStartPlayer: finalRoundStartPlayer
        };
    }

    function applyState(state) {
        gems = state.gems;
        nobles = state.nobles;
        tiers = state.tiers;
        tableCards = state.tableCards;
        players = state.players;
        currentPlayer = state.currentPlayer;
        gameRunning = state.gameRunning;
        gameOver = state.gameOver;
        finalRoundTriggered = state.finalRoundTriggered;
        finalRoundStartPlayer = state.finalRoundStartPlayer;

        clearSelection();
        renderAll();
        updateTurnInfo();

        if (gameOver) {
            endGame();
        }
    }

    function broadcastState() {
        if (!socket || !isHost) return;
        const state = buildStateSnapshot();
        socket.emit('game_move', { room_id: ROOM_ID, type: 'state', data: state });
    }

    function sendAction(action) {
        if (!socket) return;
        if (isHost) {
            broadcastState();
        } else {
            socket.emit('game_move', { room_id: ROOM_ID, type: 'action', data: action });
        }
    }

    // ── Apply remote action (host only) ──
    function applyRemoteAction(action) {
        if (!isHost) return;
        const pidx = currentPlayer;
        const p = players[pidx];

        if (action.type === 'buy') {
            // Find the card
            let card = null;
            for (let t = 0; t < 3; t++) {
                const found = tableCards[t].find(c => c && c.id === action.cardId);
                if (found) { card = found; break; }
            }
            if (!card) {
                card = p.reserved.find(c => c.id === action.cardId);
            }
            if (card && canAfford(card, p)) {
                buyCard(card, pidx);
                finishTurn();
            }
        } else if (action.type === 'take_gems') {
            takeGemsAction(action.gems);
            // Token return may be needed - host handles it
            promptTokenReturn(pidx, () => {
                finishTurn();
            });
        } else if (action.type === 'reserve') {
            let card = null;
            for (let t = 0; t < 3; t++) {
                const found = tableCards[t].find(c => c && c.id === action.cardId);
                if (found) { card = found; break; }
            }
            if (card && p.reserved.length < 3) {
                reserveCard(card, pidx);
                promptTokenReturn(pidx, () => {
                    finishTurn();
                });
            }
        } else if (action.type === 'reserve_deck') {
            if (p.reserved.length < 3 && tiers[action.tier].length > 0) {
                reserveFromDeck(action.tier, pidx);
                promptTokenReturn(pidx, () => {
                    finishTurn();
                });
            }
        }
    }

    // ── Start / Restart ──
    startBtn.addEventListener('click', () => {
        if (isMultiplayer && !gameReady && !isSpectator) return;
        initGame();
    });

    restartBtn.addEventListener('click', () => {
        overlay.classList.remove('active');
        if (isMultiplayer && !isHost) return;
        initGame();
        if (isMultiplayer && isHost) {
            broadcastState();
        }
    });

    // ── Multiplayer Socket ──
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
            socket.emit('join_spectate', { room_id: ROOM_ID, user_id: MY_USER });
            socket.emit('user_status', { user_id: MY_USER, status: 'spectating' });

            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    applyState(data.data);
                }
            });

            startBtn.style.display = 'none';

        } else {
            // Player
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

            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    if (!isHost) {
                        applyState(data.data);
                    }
                } else if (data.type === 'action' && data.data && isHost) {
                    applyRemoteAction(data.data);
                }
            });

            socket.on('opponent_disconnected', () => {
                if (gameOver || isSpectator) return;
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

    // ── Game Chat (multiplayer only) ──
    if (isMultiplayer && socket) {
        const chatBox = document.getElementById('game-chat');
        const chatMessages = document.getElementById('chat-messages');
        const chatInput = document.getElementById('chat-input');
        const chatSend = document.getElementById('chat-send');
        const chatHeader = document.getElementById('chat-header');
        const chatOpacity = document.getElementById('chat-opacity');
        const chatToggle = document.getElementById('chat-toggle-btn');
        const chatResize = document.getElementById('chat-resize');

        function appendChat(msg) {
            if (!chatMessages) return;
            const div = document.createElement('div');
            div.className = 'chat-msg' + (msg.user_id === MY_USER ? ' chat-mine' : '');
            const roleTag = msg.role ? ' <span class="chat-role">(' + msg.role + ')</span>' : '';
            div.innerHTML = '<strong>' + msg.user_id + '</strong>' + roleTag + ' ' + msg.message;
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
            chatToggle.textContent = chatBox.classList.contains('minimized') ? '+' : '\u2212';
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

        // Resize
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

    // ── Init ──
    renderAll();

    // In multiplayer, hide start button until game_ready
    if (isMultiplayer && !isSpectator && !gameReady) {
        startBtn.style.display = 'none';
    }

})();
