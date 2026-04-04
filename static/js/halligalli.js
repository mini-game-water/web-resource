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
    const FRUITS = [
        { name: 'banana',     nameKo: '바나나', emoji: '🍌', cssClass: 'fruit-banana' },
        { name: 'strawberry', nameKo: '딸기',   emoji: '🍓', cssClass: 'fruit-strawberry' },
        { name: 'lime',       nameKo: '라임',   emoji: '🍋', cssClass: 'fruit-lime' },
        { name: 'plum',       nameKo: '자두',   emoji: '🫐', cssClass: 'fruit-plum' }
    ];
    // Card distribution per fruit: count -> number of cards with that count
    // 1×5, 2×3, 3×3, 4×2, 5×1 = 14 cards per fruit
    const CARD_DISTRIBUTION = [
        { count: 1, copies: 5 },
        { count: 2, copies: 3 },
        { count: 3, copies: 3 },
        { count: 4, copies: 2 },
        { count: 5, copies: 1 }
    ];
    const TURN_TIME = 5000;       // ms before auto-flip
    const AI_REACTION_MIN = 600;  // ms min AI reaction to bell
    const AI_REACTION_MAX = 1800; // ms max AI reaction
    const AI_ERROR_CHANCE = 0.08; // chance AI rings incorrectly
    const AI_MISS_CHANCE = 0.15;  // chance AI misses a correct bell
    const SOLO_AI_NAMES = ['AI 1', 'AI 2', 'AI 3'];

    // ── Player setup ──
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
        PLAYER_NAMES = ['나', 'AI 1'];
        NUM_PLAYERS = 2;
        myIndex = 0;
        isHost = true;
    }

    function isAIPlayer(idx) {
        return SOLO_AI_NAMES.includes(PLAYER_NAMES[idx]);
    }

    // ── Game State ──
    let players = [];          // [{name, deck:[], discard:[], eliminated:false}]
    let currentTurn = 0;       // index of player whose turn it is
    let turnTimerId = null;
    let turnStartTime = 0;
    let timerIntervalId = null;
    let gameRunning = false;
    let bellLocked = false;    // prevent multiple bell rings
    let aiTimerId = null;
    let lastAction = '';       // display text
    let collectingAnimation = false;
    let turnFlipped = false;   // prevent multiple flips per turn

    // ── DOM Elements ──
    const hgTable = document.getElementById('hg-table');
    const bellBtn = document.getElementById('bell-btn');
    const fruitCountsEl = document.getElementById('fruit-counts');
    const turnTimerEl = document.getElementById('turn-timer');
    const hgStatusEl = document.getElementById('hg-status');
    const roundInfoEl = document.getElementById('round-info');
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');
    const gameOverOverlay = document.getElementById('game-over-overlay');
    const gameOverTitle = document.getElementById('game-over-title');
    const gameOverMsg = document.getElementById('game-over-msg');

    // ── Deck Creation ──
    function createDeck() {
        const deck = [];
        for (const fruit of FRUITS) {
            for (const dist of CARD_DISTRIBUTION) {
                for (let i = 0; i < dist.copies; i++) {
                    deck.push({ fruit: fruit.name, count: dist.count });
                }
            }
        }
        return deck;
    }

    function shuffleDeck(deck) {
        const arr = deck.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function dealCards(numPlayers) {
        const deck = shuffleDeck(createDeck());
        const hands = Array.from({ length: numPlayers }, () => []);
        for (let i = 0; i < deck.length; i++) {
            hands[i % numPlayers].push(deck[i]);
        }
        return hands;
    }

    // ── Fruit Counting ──
    function countFruits() {
        const counts = { banana: 0, strawberry: 0, lime: 0, plum: 0 };
        for (const p of players) {
            if (p.eliminated || p.discard.length === 0) continue;
            const topCard = p.discard[p.discard.length - 1];
            counts[topCard.fruit] += topCard.count;
        }
        return counts;
    }

    function checkBell() {
        const counts = countFruits();
        return Object.values(counts).some(c => c === 5);
    }

    // ── Fruit Info Lookup ──
    function getFruitInfo(fruitName) {
        return FRUITS.find(f => f.name === fruitName);
    }

    // ── Card HTML ──
    function createFruitCardHTML(card, extraClass) {
        const info = getFruitInfo(card.fruit);
        const cls = extraClass ? `hg-card ${info.cssClass} ${extraClass}` : `hg-card ${info.cssClass}`;
        let emojiHTML;
        if (card.count <= 4) {
            emojiHTML = info.emoji.repeat(card.count);
        } else {
            const rows = [];
            let remaining = card.count;
            const perRow = card.count <= 6 ? 2 : 3;
            while (remaining > 0) {
                const n = Math.min(perRow, remaining);
                rows.push(info.emoji.repeat(n));
                remaining -= n;
            }
            emojiHTML = rows.join('<br>');
        }
        return `<div class="${cls}">
            <div class="card-emoji">${emojiHTML}</div>
            <div class="card-count">${card.count}</div>
        </div>`;
    }

    function createFaceDownCardHTML(extraClass) {
        const cls = extraClass ? `hg-card face-down ${extraClass}` : 'hg-card face-down';
        return `<div class="${cls}">
            <div class="card-back-pattern">
                <div class="card-back-logo">HG</div>
            </div>
        </div>`;
    }

    // ── Seat Positions ──
    const SEAT_POSITIONS = {
        2: [
            { bottom: '-50px', left: '50%', transform: 'translateX(-50%)' },
            { top: '-50px', left: '50%', transform: 'translateX(-50%)' }
        ],
        3: [
            { bottom: '-50px', left: '50%', transform: 'translateX(-50%)' },
            { top: '10%', left: '-10px', transform: 'none' },
            { top: '10%', right: '-10px', transform: 'none' }
        ],
        4: [
            { bottom: '-50px', left: '50%', transform: 'translateX(-50%)' },
            { top: '50%', left: '-35px', transform: 'translateY(-50%)' },
            { top: '-50px', left: '50%', transform: 'translateX(-50%)' },
            { top: '50%', right: '-35px', transform: 'translateY(-50%)' }
        ],
        5: [
            { bottom: '-50px', left: '50%', transform: 'translateX(-50%)' },
            { bottom: '15%', left: '-20px', transform: 'none' },
            { top: '5%', left: '10%', transform: 'none' },
            { top: '5%', right: '10%', transform: 'none' },
            { bottom: '15%', right: '-20px', transform: 'none' }
        ],
        6: [
            { bottom: '-50px', left: '50%', transform: 'translateX(-50%)' },
            { bottom: '15%', left: '-20px', transform: 'none' },
            { top: '10%', left: '-10px', transform: 'none' },
            { top: '-50px', left: '50%', transform: 'translateX(-50%)' },
            { top: '10%', right: '-10px', transform: 'none' },
            { bottom: '15%', right: '-20px', transform: 'none' }
        ]
    };

    // ── Rendering ──
    function createSeats() {
        // Remove old seats
        hgTable.querySelectorAll('.player-seat').forEach(el => el.remove());

        const positions = SEAT_POSITIONS[NUM_PLAYERS] || SEAT_POSITIONS[2];

        for (let i = 0; i < NUM_PLAYERS; i++) {
            // Rotate so myIndex is at seat-0 (bottom)
            const seatIdx = (i - myIndex + NUM_PLAYERS) % NUM_PLAYERS;
            const pos = positions[seatIdx];

            const seat = document.createElement('div');
            seat.className = 'player-seat seat-' + seatIdx + (i === myIndex ? ' my-seat' : '');
            seat.id = 'seat-' + i;

            // Apply position styles
            for (const [key, val] of Object.entries(pos)) {
                seat.style[key] = val;
            }

            // Player info
            const info = document.createElement('div');
            info.className = 'player-info';
            info.id = 'player-info-' + i;
            info.innerHTML = `
                <div class="player-name">${PLAYER_NAMES[i]}</div>
                <div class="player-cards-count" id="player-deck-count-${i}">덱: 0장</div>
                <div class="player-action" id="player-action-${i}"></div>
            `;
            seat.appendChild(info);

            // Card area (deck + discard)
            const cardArea = document.createElement('div');
            cardArea.className = 'player-card-area';
            cardArea.id = 'player-card-area-' + i;
            seat.appendChild(cardArea);

            hgTable.appendChild(seat);
        }
    }

    function updatePlayerCards() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const p = players[i];
            const cardArea = document.getElementById('player-card-area-' + i);
            const deckCountEl = document.getElementById('player-deck-count-' + i);
            const infoEl = document.getElementById('player-info-' + i);

            if (!cardArea) continue;

            let html = '';

            // Deck (face-down stack)
            if (p.deck.length > 0) {
                html += '<div class="deck-stack">';
                if (p.deck.length > 2) html += createFaceDownCardHTML('mini deck-shadow-2');
                if (p.deck.length > 1) html += createFaceDownCardHTML('mini deck-shadow-1');
                html += createFaceDownCardHTML('mini');
                html += `<span class="deck-count-label">${p.deck.length}</span>`;
                html += '</div>';
            }

            // Discard (top card face-up)
            if (p.discard.length > 0) {
                const topCard = p.discard[p.discard.length - 1];
                html += createFruitCardHTML(topCard, 'mini');
            }

            cardArea.innerHTML = html;

            // Update deck count text
            if (deckCountEl) {
                const totalCards = p.deck.length + p.discard.length;
                deckCountEl.textContent = `카드: ${totalCards}장`;
            }

            // Update eliminated state
            if (infoEl) {
                if (p.eliminated) {
                    infoEl.classList.add('eliminated');
                } else {
                    infoEl.classList.remove('eliminated');
                }
            }

            // Active turn highlight
            if (infoEl) {
                if (i === currentTurn && gameRunning && !p.eliminated) {
                    infoEl.classList.add('active-turn');
                } else {
                    infoEl.classList.remove('active-turn');
                }
            }
        }
    }

    function updateFruitCounts() {
        const counts = countFruits();
        let html = '';
        for (const fruit of FRUITS) {
            const count = counts[fruit.name];
            const highlight = count === 5 ? ' highlight-five' : '';
            html += `<div class="fruit-count-item${highlight}">${fruit.emoji} ${count}</div>`;
        }
        fruitCountsEl.innerHTML = html;
    }

    function setStatus(text) {
        if (hgStatusEl) hgStatusEl.textContent = text;
    }

    function setRoundInfo(text) {
        if (roundInfoEl) roundInfoEl.textContent = text;
    }

    function setPlayerAction(idx, text) {
        const el = document.getElementById('player-action-' + idx);
        if (el) {
            el.textContent = text;
            // Clear after 2 seconds
            setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 2500);
        }
    }

    // ── Bell ──
    function updateBellState() {
        if (!gameRunning || bellLocked || collectingAnimation) {
            bellBtn.classList.remove('pulse');
            return;
        }
        // Always allow bell press in a running game (player decides correctness)
        if (checkBell()) {
            bellBtn.classList.add('pulse');
        } else {
            bellBtn.classList.remove('pulse');
        }
    }

    // ── Game Init ──
    function initGame() {
        const hands = dealCards(NUM_PLAYERS);
        players = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            players.push({
                name: PLAYER_NAMES[i],
                deck: hands[i],
                discard: [],
                eliminated: false
            });
        }
        currentTurn = 0;
        gameRunning = true;
        gameOver = false;
        bellLocked = false;
        collectingAnimation = false;
        lastAction = '';

        // Find first non-eliminated player
        advanceToActivePlayer();

        createSeats();
        updatePlayerCards();
        updateFruitCounts();
        updateBellState();
        setRoundInfo(`${PLAYER_NAMES[currentTurn]}의 차례`);
        setStatus('');

        startBtn.style.display = 'none';
        gameOverOverlay.classList.remove('active');

        startTurnTimer();
    }

    // ── Turn Management ──
    function advanceToActivePlayer() {
        let attempts = 0;
        while (players[currentTurn].eliminated && attempts < NUM_PLAYERS) {
            currentTurn = (currentTurn + 1) % NUM_PLAYERS;
            attempts++;
        }
    }

    function nextTurn() {
        if (!gameRunning) return;
        clearTurnTimer();
        turnFlipped = false;

        let next = (currentTurn + 1) % NUM_PLAYERS;
        let attempts = 0;
        while (players[next].eliminated && attempts < NUM_PLAYERS) {
            next = (next + 1) % NUM_PLAYERS;
            attempts++;
        }
        currentTurn = next;

        updatePlayerCards();
        updateFruitCounts();
        updateBellState();
        setRoundInfo(`${PLAYER_NAMES[currentTurn]}의 차례`);

        if (isHost) {
            broadcastState();
        }

        // Check if current player has cards to flip
        if (players[currentTurn].deck.length === 0) {
            // Player has no deck cards but has discard -> shuffle discard into deck
            if (players[currentTurn].discard.length > 0) {
                reshuffleDiscard(currentTurn);
            } else {
                // No cards at all - should be eliminated
                eliminatePlayer(currentTurn);
                if (checkGameEnd()) return;
                nextTurn();
                return;
            }
        }

        startTurnTimer();
    }

    function reshuffleDiscard(playerIdx) {
        const p = players[playerIdx];
        // Move discard to deck and shuffle
        p.deck = shuffleDeck(p.discard);
        p.discard = [];
        setPlayerAction(playerIdx, '덱 리셔플!');
    }

    function startTurnTimer() {
        clearTurnTimer();

        if (!gameRunning) return;

        turnStartTime = Date.now();

        // Update timer display
        timerIntervalId = setInterval(() => {
            const elapsed = Date.now() - turnStartTime;
            const remaining = Math.max(0, Math.ceil((TURN_TIME - elapsed) / 1000));
            turnTimerEl.textContent = remaining > 0 ? remaining + 's' : '';
        }, 100);

        if (isHost) {
            // If it's an AI player's turn, auto-flip faster
            if (isAIPlayer(currentTurn)) {
                const aiDelay = 500 + Math.random() * 1000;
                turnTimerId = setTimeout(() => {
                    if (gameRunning) flipCard(currentTurn);
                }, aiDelay);
            } else if (!isMultiplayer || currentTurn === myIndex) {
                // Local player's turn - auto-flip after timer
                turnTimerId = setTimeout(() => {
                    if (gameRunning) flipCard(currentTurn);
                }, TURN_TIME);
            } else {
                // Remote player's turn - host waits with longer timeout
                turnTimerId = setTimeout(() => {
                    if (gameRunning) flipCard(currentTurn);
                }, TURN_TIME + 2000);
            }
        } else if (isMultiplayer && currentTurn === myIndex) {
            // Non-host player: auto-flip fallback
            turnTimerId = setTimeout(() => {
                if (gameRunning) {
                    // Send flip action to host
                    emitFlip();
                }
            }, TURN_TIME);
        }
    }

    function clearTurnTimer() {
        if (turnTimerId) { clearTimeout(turnTimerId); turnTimerId = null; }
        if (timerIntervalId) { clearInterval(timerIntervalId); timerIntervalId = null; }
        turnTimerEl.textContent = '';
    }

    // ── Card Flip ──
    function flipCard(playerIdx) {
        if (!gameRunning || collectingAnimation) return;
        if (players[playerIdx].eliminated) return;
        if (playerIdx === currentTurn && turnFlipped) return; // already flipped this turn
        if (players[playerIdx].deck.length === 0) {
            if (players[playerIdx].discard.length > 0) {
                reshuffleDiscard(playerIdx);
            } else {
                eliminatePlayer(playerIdx);
                if (checkGameEnd()) return;
                nextTurn();
                return;
            }
        }

        clearTurnTimer();

        turnFlipped = true;
        if (typeof GameSounds !== 'undefined') GameSounds.play('flip');

        // Take top card from deck and put on discard
        const card = players[playerIdx].deck.pop();
        players[playerIdx].discard.push(card);

        const info = getFruitInfo(card.fruit);
        setPlayerAction(playerIdx, `${info.emoji}×${card.count}`);

        updatePlayerCards();
        updateFruitCounts();
        updateBellState();

        // Add flip animation to the discard card
        const cardArea = document.getElementById('player-card-area-' + playerIdx);
        if (cardArea) {
            const discardCards = cardArea.querySelectorAll('.hg-card:not(.face-down)');
            if (discardCards.length > 0) {
                const lastCard = discardCards[discardCards.length - 1];
                lastCard.classList.add('flipping');
                setTimeout(() => lastCard.classList.remove('flipping'), 400);
            }
        }

        // Check if any fruit hits 5 - AI might ring
        if (isHost) {
            scheduleAIBellCheck();
        }

        // Brief pause then next turn
        if (isHost) {
            broadcastState();
            setTimeout(() => {
                if (gameRunning && !collectingAnimation) {
                    nextTurn();
                }
            }, 800);
        }
    }

    function emitFlip() {
        if (socket && isMultiplayer && !isSpectator) {
            socket.emit('game_move', {
                room_id: ROOM_ID,
                user_id: myUser,
                type: 'flip',
                data: { playerIndex: myIndex }
            });
        }
    }

    // ── Bell Ring ──
    function ringBell(playerIdx) {
        if (!gameRunning || bellLocked || collectingAnimation) return;
        if (players[playerIdx].eliminated) return;

        bellLocked = true;
        clearTurnTimer();
        cancelAIBellCheck();

        const correct = checkBell();

        if (correct) {
            // Correct ring! Collect all discard piles
            if (typeof GameSounds !== 'undefined') GameSounds.play('bell');
            bellBtn.classList.remove('pulse');
            bellBtn.classList.add('ring-correct');
            setTimeout(() => bellBtn.classList.remove('ring-correct'), 500);

            setStatus(`${PLAYER_NAMES[playerIdx]}이(가) 정답! 카드 수집!`);
            setPlayerAction(playerIdx, '벨 정답! 🎉');

            collectingAnimation = true;

            // Collect all discard piles
            setTimeout(() => {
                let collected = [];
                for (let i = 0; i < NUM_PLAYERS; i++) {
                    if (players[i].discard.length > 0) {
                        collected = collected.concat(players[i].discard);
                        players[i].discard = [];
                    }
                }
                // Shuffle collected cards and add to bottom of winner's deck
                collected = shuffleDeck(collected);
                players[playerIdx].deck = collected.concat(players[playerIdx].deck);

                collectingAnimation = false;
                bellLocked = false;

                // Check eliminations
                checkAllEliminations();
                if (checkGameEnd()) return;

                updatePlayerCards();
                updateFruitCounts();
                updateBellState();

                setStatus('');

                // Continue from the player after the one who rang
                currentTurn = playerIdx;
                if (isHost) {
                    broadcastState();
                }
                nextTurn();
            }, 600);

        } else {
            // Wrong ring! Penalty: give 1 card to each other player
            if (typeof GameSounds !== 'undefined') GameSounds.play('buzz');
            bellBtn.classList.remove('pulse');
            bellBtn.classList.add('ring-wrong');
            setTimeout(() => {
                bellBtn.classList.remove('ring-wrong');
                bellBtn.style.background = '';
            }, 400);

            setStatus(`${PLAYER_NAMES[playerIdx]}이(가) 오답! 페널티!`);
            setPlayerAction(playerIdx, '오답! ❌');

            setTimeout(() => {
                let penaltyCount = 0;
                for (let i = 0; i < NUM_PLAYERS; i++) {
                    if (i === playerIdx || players[i].eliminated) continue;
                    // Give 1 card from the ringer's deck or discard
                    let card = null;
                    if (players[playerIdx].deck.length > 0) {
                        card = players[playerIdx].deck.pop();
                    } else if (players[playerIdx].discard.length > 0) {
                        card = players[playerIdx].discard.pop();
                    }
                    if (card) {
                        players[i].deck.unshift(card); // add to bottom
                        penaltyCount++;
                    }
                }

                bellLocked = false;

                // Check if penalty caused elimination
                checkAllEliminations();
                if (checkGameEnd()) return;

                updatePlayerCards();
                updateFruitCounts();
                updateBellState();

                setStatus('');

                // Continue from the player who wrongly rang
                currentTurn = playerIdx;
                if (isHost) {
                    broadcastState();
                }
                nextTurn();
            }, 600);
        }
    }

    // ── AI Bell Check ──
    function scheduleAIBellCheck() {
        cancelAIBellCheck();

        if (!isHost) return;

        // Check each AI player
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!isAIPlayer(i) || players[i].eliminated) continue;

            const delay = AI_REACTION_MIN + Math.random() * (AI_REACTION_MAX - AI_REACTION_MIN);

            const timerId = setTimeout(() => {
                if (!gameRunning || bellLocked || collectingAnimation) return;

                const shouldRing = checkBell();

                if (shouldRing && Math.random() > AI_MISS_CHANCE) {
                    // AI correctly rings the bell
                    ringBell(i);
                    if (isHost) broadcastState();
                } else if (!shouldRing && Math.random() < AI_ERROR_CHANCE) {
                    // AI incorrectly rings the bell
                    ringBell(i);
                    if (isHost) broadcastState();
                }
            }, delay);

            // Store timer (we only track one; simplification)
            aiTimerId = timerId;
        }
    }

    function cancelAIBellCheck() {
        if (aiTimerId) { clearTimeout(aiTimerId); aiTimerId = null; }
    }

    // ── Elimination ──
    function eliminatePlayer(idx) {
        if (players[idx].eliminated) return;
        players[idx].eliminated = true;
        players[idx].deck = [];
        players[idx].discard = [];
        setPlayerAction(idx, '탈락!');
        setStatus(`${PLAYER_NAMES[idx]}이(가) 탈락!`);
    }

    function checkAllEliminations() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (players[i].eliminated) continue;
            if (players[i].deck.length === 0 && players[i].discard.length === 0) {
                eliminatePlayer(i);
            }
        }
    }

    function checkGameEnd() {
        const activePlayers = players.filter(p => !p.eliminated);
        if (activePlayers.length <= 1) {
            endGame();
            return true;
        }
        return false;
    }

    function endGame() {
        gameRunning = false;
        gameOver = true;
        clearTurnTimer();
        cancelAIBellCheck();

        const activePlayers = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!players[i].eliminated) {
                activePlayers.push({ index: i, cards: players[i].deck.length + players[i].discard.length });
            }
        }

        let winnerName = '';
        if (activePlayers.length === 1) {
            winnerName = PLAYER_NAMES[activePlayers[0].index];
        } else if (activePlayers.length > 1) {
            // Most cards wins
            activePlayers.sort((a, b) => b.cards - a.cards);
            winnerName = PLAYER_NAMES[activePlayers[0].index];
        } else {
            winnerName = '없음';
        }

        const isMyWin = activePlayers.length > 0 && activePlayers[0].index === myIndex;

        gameOverTitle.textContent = isMyWin ? '승리!' : '게임 종료';
        gameOverMsg.textContent = `${winnerName} 승리!`;
        gameOverOverlay.classList.add('active');
        if (typeof GameSounds !== 'undefined') GameSounds.play(isMyWin ? 'win' : 'lose');
        if (typeof GameAnimations !== 'undefined') { if (isMyWin) GameAnimations.showConfetti(); else GameAnimations.showShake(document.body); }

        setRoundInfo('게임 종료');
        updatePlayerCards();
        bellBtn.classList.remove('pulse');

        if (isHost) broadcastState();
    }

    // ── State Sync (Multiplayer) ──
    function buildStateSnapshot() {
        return {
            players: players.map(p => ({
                name: p.name,
                deck: p.deck.slice(),
                discard: p.discard.slice(),
                eliminated: p.eliminated
            })),
            currentTurn: currentTurn,
            gameRunning: gameRunning,
            gameOver: gameOver,
            bellLocked: bellLocked,
            collectingAnimation: collectingAnimation,
            turnFlipped: turnFlipped
        };
    }

    function applyState(state) {
        if (!state) return;

        // Rebuild players
        players = state.players.map(p => ({
            name: p.name,
            deck: p.deck ? p.deck.slice() : [],
            discard: p.discard ? p.discard.slice() : [],
            eliminated: p.eliminated || false
        }));

        currentTurn = state.currentTurn || 0;
        gameRunning = state.gameRunning !== undefined ? state.gameRunning : true;
        gameOver = state.gameOver || false;
        bellLocked = state.bellLocked || false;
        collectingAnimation = state.collectingAnimation || false;
        turnFlipped = state.turnFlipped || false;

        // Update NUM_PLAYERS if needed
        if (players.length !== NUM_PLAYERS) {
            NUM_PLAYERS = players.length;
            PLAYER_NAMES = players.map(p => p.name);
        }

        createSeats();
        updatePlayerCards();
        updateFruitCounts();
        updateBellState();

        if (gameOver) {
            clearTurnTimer();
            const active = players.filter(p => !p.eliminated);
            if (active.length > 0) {
                const winnerIdx = players.indexOf(active[0]);
                const isMyWin = winnerIdx === myIndex;
                gameOverTitle.textContent = isMyWin ? '승리!' : '게임 종료';
                gameOverMsg.textContent = `${active[0].name} 승리!`;
                gameOverOverlay.classList.add('active');
            }
            setRoundInfo('게임 종료');
        } else if (gameRunning) {
            setRoundInfo(`${PLAYER_NAMES[currentTurn]}의 차례`);
            startBtn.style.display = 'none';

            // Non-host: restart turn timer for local display
            if (!isHost) {
                clearTurnTimer();
                turnStartTime = Date.now();
                timerIntervalId = setInterval(() => {
                    const elapsed = Date.now() - turnStartTime;
                    const remaining = Math.max(0, Math.ceil((TURN_TIME - elapsed) / 1000));
                    turnTimerEl.textContent = remaining > 0 ? remaining + 's' : '';
                }, 100);
            }
        }
    }

    function broadcastState() {
        if (!isMultiplayer || !socket || !isHost) return;
        const state = buildStateSnapshot();
        socket.emit('game_move', {
            room_id: ROOM_ID,
            user_id: myUser,
            type: 'state',
            data: state
        });
    }

    // ── Event Handlers ──

    // Bell button click
    if (bellBtn) bellBtn.addEventListener('click', () => {
        if (!gameRunning || bellLocked || collectingAnimation || isSpectator) return;

        if (isMultiplayer) {
            // In multiplayer, emit bell ring event
            if (isHost) {
                ringBell(myIndex);
                broadcastState();
            } else {
                // Send bell ring to host
                socket.emit('game_move', {
                    room_id: ROOM_ID,
                    user_id: myUser,
                    type: 'bell',
                    data: { playerIndex: myIndex }
                });
            }
        } else {
            // Solo mode
            ringBell(myIndex);
        }
    });

    // Keyboard shortcuts: Space = flip card, Enter = ring bell
    document.addEventListener('keydown', (e) => {
        if (isSpectator) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        // Enter to ring bell
        if (e.key === 'Enter') {
            e.preventDefault();
            bellBtn.click();
        }
        // Space to flip card (if it's your turn)
        if ((e.code === 'Space' || e.key === ' ') && gameRunning && !collectingAnimation) {
            e.preventDefault();
            if (currentTurn === myIndex && !players[myIndex].eliminated) {
                if (isMultiplayer && !isHost) {
                    emitFlip();
                } else {
                    flipCard(myIndex);
                }
            }
        }
    });

    // Click on own card area to flip (if it's your turn)
    hgTable.addEventListener('click', (e) => {
        if (isSpectator || !gameRunning || collectingAnimation) return;

        // Check if click is on the player's own card area (deck)
        const seat = e.target.closest('.player-seat');
        if (!seat) return;

        const seatId = seat.id; // seat-X
        const idx = parseInt(seatId.replace('seat-', ''));
        if (idx !== myIndex || currentTurn !== myIndex) return;
        if (players[myIndex].eliminated) return;

        // Check if clicking on the face-down deck cards
        const faceDown = e.target.closest('.face-down');
        if (!faceDown) return;

        if (isMultiplayer && !isHost) {
            emitFlip();
        } else {
            flipCard(myIndex);
        }
    });

    // Start button
    if (startBtn) startBtn.addEventListener('click', () => {
        if (isMultiplayer && (!gameReady || !isHost)) return;
        initGame();
        if (isHost) broadcastState();
    });

    // Restart button
    if (restartBtn) restartBtn.addEventListener('click', () => {
        if (isMultiplayer && !isHost) return;
        gameOverOverlay.classList.remove('active');
        initGame();
        if (isHost) broadcastState();
    });

    // ── Solo Mode: AI Player Count Selection ──
    if (!isMultiplayer) {
        // Add AI count selector
        const controlsDiv = document.querySelector('.game-controls');
        if (controlsDiv) {
            const selectDiv = document.createElement('div');
            selectDiv.style.cssText = 'margin-bottom: 0.5rem; text-align: center;';
            selectDiv.innerHTML = `
                <label style="color: #9a8b78; font-size: 0.9rem;">
                    AI 플레이어 수:
                    <select id="ai-count" style="padding: 4px 8px; border-radius: 6px; border: 1px solid rgba(167,139,250,0.3); background: rgba(15,15,45,0.8); color: #e0dcd6; margin-left: 6px;">
                        <option value="1" selected>1명 (2인 게임)</option>
                        <option value="2">2명 (3인 게임)</option>
                        <option value="3">3명 (4인 게임)</option>
                        <option value="4">4명 (5인 게임)</option>
                        <option value="5">5명 (6인 게임)</option>
                    </select>
                </label>
            `;
            controlsDiv.insertBefore(selectDiv, startBtn);

            document.getElementById('ai-count').addEventListener('change', (e) => {
                const aiCount = parseInt(e.target.value);
                PLAYER_NAMES = ['나'];
                for (let i = 0; i < aiCount; i++) {
                    PLAYER_NAMES.push(SOLO_AI_NAMES[i] || `AI ${i + 1}`);
                }
                NUM_PLAYERS = PLAYER_NAMES.length;
                createSeats();
            });
        }
    }

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

            // Spectator receives state updates
            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    applyState(data.data);
                }
            });

            // Hide start button for spectators
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

                // Only host initializes game; non-host waits for state broadcast
                if (isHost && !gameRunning) {
                    initGame();
                    broadcastState();
                }
            });

            // Receive moves
            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    if (!isHost) {
                        applyState(data.data);
                    }
                } else if (data.type === 'bell' && data.data && isHost) {
                    // Remote player rings the bell
                    const bellPlayerIdx = data.data.playerIndex;
                    if (bellPlayerIdx !== undefined && bellPlayerIdx !== myIndex) {
                        ringBell(bellPlayerIdx);
                        broadcastState();
                    }
                } else if (data.type === 'flip' && data.data && isHost) {
                    // Remote player flips a card
                    const flipPlayerIdx = data.data.playerIndex;
                    if (flipPlayerIdx !== undefined && flipPlayerIdx === currentTurn) {
                        flipCard(flipPlayerIdx);
                    }
                }
            });

            // Handle disconnection
            function handleDisconnect() {
                if (gameOver || isSpectator) return;
                // If opponent disconnects, eliminate them
                for (let i = 0; i < NUM_PLAYERS; i++) {
                    if (i !== myIndex && !players[i].eliminated) {
                        // Check if they're still connected (simplified)
                    }
                }
            }

            socket.on('opponent_disconnected', () => {
                if (gameOver || isSpectator) return;
                // Check if only one player remains
                if (isHost && gameRunning) {
                    // End game - remaining player wins
                    setStatus('상대방이 나갔습니다.');
                    setTimeout(() => {
                        if (gameRunning) endGame();
                    }, 1000);
                }
            });

            socket.on('opponent_game_over', () => {
                if (gameOver || isSpectator) return;
                if (isHost && gameRunning) {
                    setStatus('상대방이 나갔습니다.');
                    setTimeout(() => {
                        if (gameRunning) endGame();
                    }, 1000);
                }
            });

            socket.on('game_winner', (data) => {
                gameOver = true;
                gameRunning = false;
                const msg = data.winner === myUser ? '승리! 상대방이 나갔습니다.' : data.winner + '님이 승리했습니다.';
                if (gameOverMsg) gameOverMsg.textContent = msg;
                if (gameOverOverlay) gameOverOverlay.classList.add('active');
                if (typeof GameSounds !== 'undefined') GameSounds.play(data.winner === myUser ? 'win' : 'lose');
                if (typeof GameAnimations !== 'undefined') { if (data.winner === myUser) GameAnimations.showConfetti(); else GameAnimations.showShake(document.body); }
            });

            // Admin force-closed room
            socket.on('room_force_closed', (data) => {
                alert(data.message || '관리자에 의해 방이 강제 종료되었습니다.');
                window.location.replace('/');
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

    // ── Init ──
    createSeats();
    updatePlayerCards();
    updateFruitCounts();
    setRoundInfo('게임을 시작하세요');

    // In multiplayer, hide start button until game_ready
    if (isMultiplayer && !isSpectator && !gameReady) {
        startBtn.style.display = 'none';
    }
})();
