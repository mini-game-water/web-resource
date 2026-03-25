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
    const SUITS = ['\u2660', '\u2665', '\u2666', '\u2663'];
    const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
    const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const HAND_NAMES = [
        '\ud558\uc774 \uce74\ub4dc', '\uc6d0 \ud398\uc5b4', '\ud22c \ud398\uc5b4', '\uc4f0\ub9ac \uc624\ube0c \uc5b4 \uce74\uc778\ub4dc',
        '\uc2a4\ud2b8\ub808\uc774\ud2b8', '\ud50c\ub7ec\uc2dc', '\ud480 \ud558\uc6b0\uc2a4', '\ud3ec \uc624\ube0c \uc5b4 \uce74\uc778\ub4dc',
        '\uc2a4\ud2b8\ub808\uc774\ud2b8 \ud50c\ub7ec\uc2dc', '\ub85c\uc584 \ud50c\ub7ec\uc2dc'
    ];
    const STARTING_CHIPS = 1000;
    const SMALL_BLIND = 500;
    const BIG_BLIND = 1000;
    const DEALER_NAME = '딜러';
    const SOLO_PLAYER_NAMES = ['나', DEALER_NAME];

    // ── Determine player names and count ──
    let PLAYER_NAMES;
    let NUM_PLAYERS;
    let myIndex = 0;
    let isHost = false;

    let pendingJoins = [];
    let pendingLeaves = [];

    if (isMultiplayer) {
        PLAYER_NAMES = roomPlayers.slice();
        PLAYER_NAMES.push(DEALER_NAME); // Always add dealer as AI
        NUM_PLAYERS = PLAYER_NAMES.length;
        myIndex = PLAYER_NAMES.indexOf(myUser);
        if (myIndex === -1) myIndex = 0;
        isHost = (myIndex === 0); // Player 1 is the host
    } else {
        PLAYER_NAMES = SOLO_PLAYER_NAMES;
        NUM_PLAYERS = 2;
        myIndex = 0;
        isHost = true;
    }

    function isAIPlayer(idx) {
        return PLAYER_NAMES[idx] === DEALER_NAME;
    }

    // ── Game State ──
    let players = [];
    let deck = [];
    let communityCards = [];
    let pot = 0;
    let currentBets = [];
    let dealerIndex = 0;
    let currentPlayerIndex = 0;
    let phase = 'idle'; // idle, preflop, flop, turn, river, showdown
    let folded = [];
    let allIn = [];
    let roundBet = 0;
    let lastRaiser = -1;
    let actedThisRound = [];
    let gameRunning = false;
    let handInProgress = false;
    let disconnectedPlayers = [];

    // ── DOM Elements ──
    const potDisplay = document.getElementById('pot-display');
    const communityCardsEl = document.getElementById('community-cards');
    const bettingControls = document.getElementById('betting-controls');
    const btnFold = document.getElementById('btn-fold');
    const btnCheck = document.getElementById('btn-check');
    const btnRaise = document.getElementById('btn-raise');
    const raiseSlider = document.getElementById('raise-slider');
    const raiseAmountEl = document.getElementById('raise-amount');
    const roundInfo = document.getElementById('round-info');
    const startBtn = document.getElementById('start-btn');
    const restartBtn = document.getElementById('restart-btn');
    const overlay = document.getElementById('game-over-overlay');
    const gameOverTitle = document.getElementById('game-over-title');
    const gameOverMsg = document.getElementById('game-over-msg');
    const handResult = document.getElementById('hand-result');
    const pokerTable = document.getElementById('poker-table');

    // ── Seat Generation ──
    function createSeats(playerNames, myIdx) {
        // Remove old seats
        pokerTable.querySelectorAll('.player-seat').forEach(s => s.remove());

        const numPlayers = playerNames.length;
        playerNames.forEach((name, i) => {
            // Rotate so myIdx maps to seat-0 visual position (bottom center)
            const visualSeat = (i - myIdx + numPlayers) % numPlayers;
            const seat = document.createElement('div');
            seat.className = 'player-seat seat-' + visualSeat;
            seat.id = 'seat-' + i;
            if (i === myIdx && !isSpectator) seat.classList.add('my-seat');

            const info = document.createElement('div');
            info.className = 'player-info';
            info.id = 'info-' + i;

            const nameEl = document.createElement('div');
            nameEl.className = 'player-name';
            nameEl.id = 'name-' + i;
            nameEl.textContent = name;

            const chipsEl = document.createElement('div');
            chipsEl.className = 'player-chips';
            chipsEl.id = 'chips-' + i;
            chipsEl.textContent = STARTING_CHIPS + ' \uce69';

            const actionEl = document.createElement('div');
            actionEl.className = 'player-action';
            actionEl.id = 'action-' + i;

            info.appendChild(nameEl);
            info.appendChild(chipsEl);
            info.appendChild(actionEl);

            const cards = document.createElement('div');
            cards.className = 'player-cards';
            cards.id = 'cards-' + i;

            const bet = document.createElement('div');
            bet.className = 'player-bet';
            bet.id = 'bet-' + i;

            seat.appendChild(info);
            seat.appendChild(cards);
            seat.appendChild(bet);
            pokerTable.appendChild(seat);
        });
    }

    // ── Utility ──
    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function createDeck() {
        const d = [];
        for (let s = 0; s < 4; s++) {
            for (let r = 0; r < 13; r++) {
                d.push({ suit: s, rank: r });
            }
        }
        return d;
    }

    function shuffleDeck(d) {
        for (let i = d.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [d[i], d[j]] = [d[j], d[i]];
        }
        return d;
    }

    function cardStr(card) {
        return RANKS[card.rank] + SUITS[card.suit];
    }

    function isRed(card) {
        return card.suit === 1 || card.suit === 2;
    }

    function initArrays() {
        currentBets = new Array(NUM_PLAYERS).fill(0);
        folded = new Array(NUM_PLAYERS).fill(false);
        allIn = new Array(NUM_PLAYERS).fill(false);
        actedThisRound = new Array(NUM_PLAYERS).fill(false);
        disconnectedPlayers = new Array(NUM_PLAYERS).fill(false);
    }

    // ── 3D Card DOM Creation ──
    function createCardElement(card, faceUp, extraClass) {
        const el = document.createElement('div');
        el.className = 'card-3d mini';
        if (extraClass) el.classList.add(extraClass);
        const inner = document.createElement('div');
        inner.className = 'card-inner';

        // Front
        const front = document.createElement('div');
        front.className = 'card-front ' + (isRed(card) ? 'red' : 'black');
        const rankEl = document.createElement('div');
        rankEl.className = 'card-rank';
        rankEl.textContent = RANKS[card.rank];
        const suitEl = document.createElement('div');
        suitEl.className = 'card-suit';
        suitEl.textContent = SUITS[card.suit];
        front.appendChild(rankEl);
        front.appendChild(suitEl);
        const tl = document.createElement('div');
        tl.className = 'corner-tl';
        tl.innerHTML = '<span>' + RANKS[card.rank] + '</span><span>' + SUITS[card.suit] + '</span>';
        front.appendChild(tl);
        const br = document.createElement('div');
        br.className = 'corner-br';
        br.innerHTML = '<span>' + RANKS[card.rank] + '</span><span>' + SUITS[card.suit] + '</span>';
        front.appendChild(br);

        // Back
        const back = document.createElement('div');
        back.className = 'card-back';
        const pattern = document.createElement('div');
        pattern.className = 'card-back-pattern';
        const logo = document.createElement('div');
        logo.className = 'card-back-logo';
        logo.textContent = 'GH';
        pattern.appendChild(logo);
        back.appendChild(pattern);

        inner.appendChild(front);
        inner.appendChild(back);
        el.appendChild(inner);

        if (faceUp) {
            el.classList.add('flipped');
        }

        el._card = card;
        return el;
    }

    function flipCard(el) {
        el.classList.add('flipped');
    }

    function dealCardAnimated(container, card, faceUp, extraClass, delayMs, fromLeft) {
        return new Promise(resolve => {
            setTimeout(() => {
                const el = createCardElement(card, false, extraClass);
                el.classList.add(fromLeft ? 'dealing-left' : 'dealing');
                container.appendChild(el);
                if (faceUp) {
                    setTimeout(() => flipCard(el), 300);
                }
                setTimeout(resolve, 400);
            }, delayMs);
        });
    }

    // ── UI Updates ──
    function updatePot() {
        potDisplay.textContent = '\ud31f: ' + pot;
    }

    function updatePlayerInfo() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const info = document.getElementById('info-' + i);
            const chipsEl = document.getElementById('chips-' + i);
            const betEl = document.getElementById('bet-' + i);
            const nameEl = document.getElementById('name-' + i);
            if (!info) continue;

            chipsEl.textContent = players[i].chips + ' \uce69';

            // Dealer chip
            const existingDealer = nameEl.querySelector('.dealer-chip');
            if (existingDealer) existingDealer.remove();
            if (i === dealerIndex && handInProgress) {
                const dc = document.createElement('span');
                dc.className = 'dealer-chip';
                dc.textContent = 'D';
                nameEl.appendChild(dc);
            }

            // Active turn highlight
            info.classList.toggle('active-turn', handInProgress && i === currentPlayerIndex && !folded[i] && players[i].chips >= 0);
            info.classList.toggle('folded', folded[i]);
            info.classList.toggle('eliminated', players[i].chips <= 0 && !handInProgress);

            // Bet display
            if (currentBets[i] > 0 && handInProgress) {
                betEl.textContent = '\ubca0\ud305: ' + currentBets[i];
            } else {
                betEl.textContent = '';
            }
        }
        updatePot();
    }

    function showPlayerAction(index, text) {
        const actionEl = document.getElementById('action-' + index);
        if (actionEl) actionEl.textContent = text;
    }

    function clearActions() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const el = document.getElementById('action-' + i);
            if (el) el.textContent = '';
        }
    }

    function clearPlayerCards() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const el = document.getElementById('cards-' + i);
            if (el) el.innerHTML = '';
        }
    }

    function clearCommunityCards() {
        communityCardsEl.innerHTML = '';
    }

    function hideHandResult() {
        handResult.classList.remove('visible');
    }

    function showHandResult(text) {
        handResult.textContent = text;
        handResult.classList.add('visible');
    }

    function updateBettingControls() {
        if (isSpectator) {
            bettingControls.classList.add('hidden');
            return;
        }
        if (currentPlayerIndex !== myIndex || folded[myIndex] || !handInProgress) {
            bettingControls.classList.add('hidden');
            return;
        }
        bettingControls.classList.remove('hidden');

        const toCall = roundBet - currentBets[myIndex];
        if (toCall > 0) {
            btnCheck.textContent = '\ucf5c (' + Math.min(toCall, players[myIndex].chips) + ')';
        } else {
            btnCheck.textContent = '\uccb4\ud06c';
        }

        // Raise slider
        const minRaise = Math.max(BIG_BLIND, roundBet * 2 - currentBets[myIndex]);
        const maxRaise = players[myIndex].chips;
        if (maxRaise <= toCall) {
            btnRaise.style.display = 'none';
            raiseSlider.style.display = 'none';
            raiseAmountEl.style.display = 'none';
            btnCheck.textContent = '\uc62c\uc778 (' + players[myIndex].chips + ')';
        } else {
            btnRaise.style.display = '';
            raiseSlider.style.display = '';
            raiseAmountEl.style.display = '';
            raiseSlider.min = Math.min(minRaise, maxRaise);
            raiseSlider.max = maxRaise;
            raiseSlider.value = Math.min(minRaise, maxRaise);
            raiseAmountEl.textContent = raiseSlider.value;
        }
    }

    // ── Hand Evaluation ──
    function handRank(cards) {
        const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
        const suits = cards.map(c => c.suit);
        const isFlush = suits.every(s => s === suits[0]);

        let isStraight = false;
        let straightHigh = ranks[0];
        const unique = [...new Set(ranks)];
        if (unique.length === 5) {
            if (unique[0] - unique[4] === 4) {
                isStraight = true;
                straightHigh = unique[0];
            }
            if (unique[0] === 12 && unique[1] === 3 && unique[2] === 2 && unique[3] === 1 && unique[4] === 0) {
                isStraight = true;
                straightHigh = 3;
            }
        }

        const counts = {};
        ranks.forEach(r => { counts[r] = (counts[r] || 0) + 1; });
        const groups = Object.entries(counts).map(([r, c]) => ({ rank: parseInt(r), count: c }));
        groups.sort((a, b) => b.count - a.count || b.rank - a.rank);

        if (isFlush && isStraight) {
            if (straightHigh === 12) return { rank: 9, tiebreaker: [straightHigh], name: HAND_NAMES[9] };
            return { rank: 8, tiebreaker: [straightHigh], name: HAND_NAMES[8] };
        }
        if (groups[0].count === 4) {
            return { rank: 7, tiebreaker: [groups[0].rank, groups[1].rank], name: HAND_NAMES[7] };
        }
        if (groups[0].count === 3 && groups[1].count === 2) {
            return { rank: 6, tiebreaker: [groups[0].rank, groups[1].rank], name: HAND_NAMES[6] };
        }
        if (isFlush) {
            return { rank: 5, tiebreaker: ranks, name: HAND_NAMES[5] };
        }
        if (isStraight) {
            return { rank: 4, tiebreaker: [straightHigh], name: HAND_NAMES[4] };
        }
        if (groups[0].count === 3) {
            const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
            return { rank: 3, tiebreaker: [groups[0].rank, ...kickers], name: HAND_NAMES[3] };
        }
        if (groups[0].count === 2 && groups[1].count === 2) {
            const pairs = [groups[0].rank, groups[1].rank].sort((a, b) => b - a);
            const kicker = groups[2].rank;
            return { rank: 2, tiebreaker: [...pairs, kicker], name: HAND_NAMES[2] };
        }
        if (groups[0].count === 2) {
            const kickers = groups.slice(1).map(g => g.rank).sort((a, b) => b - a);
            return { rank: 1, tiebreaker: [groups[0].rank, ...kickers], name: HAND_NAMES[1] };
        }
        return { rank: 0, tiebreaker: ranks, name: HAND_NAMES[0] };
    }

    function combinations(arr, k) {
        if (k === 0) return [[]];
        if (arr.length < k) return [];
        const result = [];
        const first = arr[0];
        const rest = arr.slice(1);
        for (const c of combinations(rest, k - 1)) {
            result.push([first, ...c]);
        }
        for (const c of combinations(rest, k)) {
            result.push(c);
        }
        return result;
    }

    function bestHand(holeCards, community) {
        const all7 = [...holeCards, ...community];
        const combos = combinations(all7, 5);
        let best = null;
        for (const combo of combos) {
            const h = handRank(combo);
            if (!best || compareHands(h, best) > 0) {
                best = h;
                best.cards = combo;
            }
        }
        return best;
    }

    function compareHands(a, b) {
        if (a.rank !== b.rank) return a.rank - b.rank;
        for (let i = 0; i < Math.min(a.tiebreaker.length, b.tiebreaker.length); i++) {
            if (a.tiebreaker[i] !== b.tiebreaker[i]) return a.tiebreaker[i] - b.tiebreaker[i];
        }
        return 0;
    }

    // ── AI Strategy (solo mode only) ──
    function aiDecision(playerIndex) {
        const hole = players[playerIndex].hand;
        const toCall = roundBet - currentBets[playerIndex];
        const chips = players[playerIndex].chips;
        let strength = estimateStrength(hole, communityCards);
        strength += (Math.random() - 0.5) * 0.15;

        if (toCall === 0) {
            if (strength > 0.7 && chips > BIG_BLIND * 4) {
                const raiseAmt = Math.min(Math.floor(pot * (0.5 + Math.random() * 0.5)), chips);
                if (raiseAmt >= BIG_BLIND) return { action: 'raise', amount: raiseAmt };
            }
            return { action: 'check' };
        }

        const potOdds = toCall / (pot + toCall);
        if (strength < potOdds * 0.7 && strength < 0.25) return { action: 'fold' };
        if (strength > 0.75 && chips > toCall * 3) {
            const raiseAmt = Math.min(Math.floor(pot * (0.5 + Math.random())), chips);
            if (raiseAmt > toCall) return { action: 'raise', amount: raiseAmt };
        }
        return { action: 'call' };
    }

    function estimateStrength(hole, community) {
        if (community.length === 0) return preflopStrength(hole);
        const hand = bestHand(hole, community);
        const baseStrength = [0.1, 0.3, 0.45, 0.55, 0.65, 0.7, 0.8, 0.88, 0.95, 1.0];
        return baseStrength[hand.rank];
    }

    function preflopStrength(hole) {
        const r1 = hole[0].rank;
        const r2 = hole[1].rank;
        const suited = hole[0].suit === hole[1].suit;
        const high = Math.max(r1, r2);
        const low = Math.min(r1, r2);
        const gap = high - low;
        const pair = r1 === r2;

        let s = 0.2;
        if (pair) {
            s = 0.5 + high * 0.035;
        } else {
            s = 0.15 + high * 0.025 + low * 0.01;
            if (suited) s += 0.06;
            if (gap <= 2) s += 0.04;
            if (gap >= 5) s -= 0.05;
        }
        if (pair && high >= 10) s = Math.max(s, 0.85);
        if (high === 12 && low >= 10) s = Math.max(s, 0.8);
        if (high === 12 && low >= 9 && suited) s = Math.max(s, 0.78);

        return Math.max(0, Math.min(1, s));
    }

    // ── Betting Logic ──
    function activePlayers() {
        let count = 0;
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i] && players[i].chips >= 0) count++;
        }
        return count;
    }

    function activeNonAllIn() {
        let count = 0;
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i] && !allIn[i] && players[i].chips > 0) count++;
        }
        return count;
    }

    function nextActivePlayer(from) {
        let i = (from + 1) % NUM_PLAYERS;
        let safety = 0;
        while (safety < NUM_PLAYERS) {
            if (!folded[i] && !allIn[i] && players[i].chips > 0) return i;
            i = (i + 1) % NUM_PLAYERS;
            safety++;
        }
        return -1;
    }

    function placeBet(playerIndex, amount) {
        const actual = Math.min(amount, players[playerIndex].chips);
        players[playerIndex].chips -= actual;
        currentBets[playerIndex] += actual;
        pot += actual;
        if (players[playerIndex].chips === 0) {
            allIn[playerIndex] = true;
        }
        return actual;
    }

    async function executePlayerAction(action, amount, playerIdx) {
        const i = (playerIdx !== undefined) ? playerIdx : currentPlayerIndex;
        const toCall = roundBet - currentBets[i];

        if (action === 'fold') {
            folded[i] = true;
            showPlayerAction(i, '\ud3f4\ub4dc');
        } else if (action === 'check') {
            if (toCall > 0) {
                placeBet(i, toCall);
                if (allIn[i]) {
                    showPlayerAction(i, '\uc62c\uc778!');
                } else {
                    showPlayerAction(i, '\ucf5c ' + toCall);
                }
            } else {
                showPlayerAction(i, '\uccb4\ud06c');
            }
        } else if (action === 'call') {
            placeBet(i, toCall);
            if (allIn[i]) {
                showPlayerAction(i, '\uc62c\uc778!');
            } else {
                showPlayerAction(i, '\ucf5c ' + toCall);
            }
        } else if (action === 'raise') {
            placeBet(i, amount);
            roundBet = currentBets[i];
            lastRaiser = i;
            for (let j = 0; j < NUM_PLAYERS; j++) {
                if (j !== i) actedThisRound[j] = false;
            }
            if (allIn[i]) {
                showPlayerAction(i, '\uc62c\uc778! (' + currentBets[i] + ')');
            } else {
                showPlayerAction(i, '\ub808\uc774\uc988 \u2192 ' + currentBets[i]);
            }
        }

        actedThisRound[i] = true;
        updatePlayerInfo();
    }

    function bettingRoundComplete() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (folded[i] || allIn[i] || players[i].chips <= 0) continue;
            if (!actedThisRound[i]) return false;
            if (currentBets[i] < roundBet) return false;
        }
        return true;
    }

    function resetBettingRound() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            actedThisRound[i] = false;
        }
        roundBet = 0;
        lastRaiser = -1;
    }

    function collectBetsIntoPot() {
        currentBets = new Array(NUM_PLAYERS).fill(0);
    }

    // ── Build state snapshot for multiplayer broadcast ──
    function buildStateSnapshot() {
        return {
            phase: phase,
            pot: pot,
            dealerIndex: dealerIndex,
            currentPlayerIndex: currentPlayerIndex,
            communityCards: communityCards.slice(),
            playerStates: players.map((p, i) => ({
                name: p.name,
                chips: p.chips,
                bet: currentBets[i],
                folded: folded[i],
                allIn: allIn[i],
                hand: p.hand ? p.hand.slice() : null,
                action: document.getElementById('action-' + i) ? document.getElementById('action-' + i).textContent : ''
            })),
            roundBet: roundBet,
            handInProgress: handInProgress,
            gameRunning: gameRunning
        };
    }

    function broadcastState() {
        if (!isMultiplayer || !isHost || !socket) return;
        const state = buildStateSnapshot();
        socket.emit('game_move', { room_id: ROOM_ID, type: 'state', data: state });
    }

    // ── Apply state from host (non-host players) ──
    function applyState(state) {
        phase = state.phase;
        pot = state.pot;
        dealerIndex = state.dealerIndex;
        currentPlayerIndex = state.currentPlayerIndex;
        communityCards = state.communityCards || [];
        roundBet = state.roundBet;
        handInProgress = state.handInProgress;
        gameRunning = state.gameRunning;

        // Sync player list if it changed (mid-game joins)
        const stateNames = state.playerStates.map(ps => ps.name);
        const localHasMyUser = isMultiplayer && myUser && !isSpectator;
        const stateHasMyUser = localHasMyUser ? stateNames.includes(myUser) : true;

        if (state.playerStates.length !== NUM_PLAYERS) {
            if (!stateHasMyUser && localHasMyUser && state.playerStates.length < NUM_PLAYERS) {
                // Host hasn't processed our join yet — keep local player list,
                // only apply state for the players we know about from the host
            } else {
                PLAYER_NAMES = stateNames;
                NUM_PLAYERS = PLAYER_NAMES.length;
                if (isMultiplayer) myIndex = PLAYER_NAMES.indexOf(myUser);
                players = [];
                initArrays();
                createSeats(PLAYER_NAMES, isSpectator ? 0 : myIndex);
            }
        }

        state.playerStates.forEach((ps, i) => {
            if (i >= NUM_PLAYERS) return; // Skip if state has more players than local
            if (!players[i]) {
                players[i] = { name: ps.name, chips: ps.chips, hand: [], isAI: ps.name === DEALER_NAME };
            }
            players[i].name = ps.name;
            players[i].chips = ps.chips;
            currentBets[i] = ps.bet;
            folded[i] = ps.folded;
            allIn[i] = ps.allIn;
            // Show own hand, hide others (unless showdown)
            if (i === myIndex && ps.hand) {
                players[i].hand = ps.hand;
            } else if (phase === 'showdown' && ps.hand && !ps.folded) {
                players[i].hand = ps.hand;
            } else {
                // Keep hand reference but don't reveal
                players[i].hand = ps.hand;
            }
            showPlayerAction(i, ps.action || '');
        });

        // Re-render community cards
        renderCommunityCards();
        // Re-render player cards
        renderAllPlayerCards();
        updatePlayerInfo();
        updateBettingControls();

        // Update round info
        const phaseNames = {
            'idle': '\uac8c\uc784\uc744 \uc2dc\uc791\ud558\uc138\uc694',
            'preflop': '\ud504\ub9ac\ud50c\ub7cd \ubca0\ud305',
            'flop': '\ud50c\ub7cd \ubca0\ud305',
            'turn': '\ud134 \ubca0\ud305',
            'river': '\ub9ac\ubc84 \ubca0\ud305',
            'showdown': '\uc1fc\ub2e4\uc6b4!'
        };
        roundInfo.textContent = phaseNames[phase] || phase;
    }

    function renderCommunityCards() {
        communityCardsEl.innerHTML = '';
        communityCards.forEach(card => {
            const el = createCardElement(card, true, 'community-card');
            communityCardsEl.appendChild(el);
        });
    }

    function renderAllPlayerCards() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const container = document.getElementById('cards-' + i);
            if (!container) continue;
            container.innerHTML = '';
            if (!players[i].hand || players[i].hand.length === 0 || folded[i]) continue;

            const showFace = (i === myIndex && !isSpectator) || phase === 'showdown';
            const extraClass = (i === myIndex && !isSpectator) ? 'my-card' : null;

            players[i].hand.forEach(card => {
                const el = createCardElement(card, showFace, extraClass);
                container.appendChild(el);
            });
        }
    }

    // ── Deal & Game Flow (Host / Solo) ──
    function initPlayers() {
        players = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            players.push({
                name: PLAYER_NAMES[i],
                chips: STARTING_CHIPS,
                hand: [],
                isAI: isAIPlayer(i)
            });
        }
        initArrays();
    }

    async function startNewHand() {
        // Process pending mid-game joins
        if (pendingJoins.length > 0 && (isHost || !isMultiplayer)) {
            for (const uid of pendingJoins) {
                if (!PLAYER_NAMES.includes(uid)) {
                    // Insert before the dealer (last element)
                    const dealerIdx = PLAYER_NAMES.indexOf(DEALER_NAME);
                    PLAYER_NAMES.splice(dealerIdx, 0, uid);
                    NUM_PLAYERS = PLAYER_NAMES.length;
                    players.splice(dealerIdx, 0, {
                        name: uid,
                        chips: STARTING_CHIPS,
                        hand: [],
                        isAI: false
                    });
                    disconnectedPlayers.splice(dealerIdx, 0, false);
                    // Update myIndex if needed
                    if (isMultiplayer) {
                        myIndex = PLAYER_NAMES.indexOf(myUser);
                    }
                }
            }
            pendingJoins = [];
            initArrays();
            createSeats(PLAYER_NAMES, isSpectator ? 0 : myIndex);
            updatePlayerInfo();
        }

        // Process pending leaves — remove players who left
        if (pendingLeaves.length > 0 && (isHost || !isMultiplayer)) {
            for (const uid of pendingLeaves) {
                const idx = PLAYER_NAMES.indexOf(uid);
                if (idx !== -1 && uid !== DEALER_NAME) {
                    PLAYER_NAMES.splice(idx, 1);
                    players.splice(idx, 1);
                    disconnectedPlayers.splice(idx, 1);
                    NUM_PLAYERS = PLAYER_NAMES.length;
                    if (dealerIndex >= idx && dealerIndex > 0) dealerIndex--;
                }
            }
            pendingLeaves = [];
            if (isMultiplayer) {
                myIndex = PLAYER_NAMES.indexOf(myUser);
            }
            initArrays();
            createSeats(PLAYER_NAMES, isSpectator ? 0 : myIndex);
            updatePlayerInfo();
        }

        if (checkGameOver()) return;

        handInProgress = true;
        hideHandResult();
        clearActions();
        clearPlayerCards();
        clearCommunityCards();

        deck = shuffleDeck(createDeck());
        communityCards = [];
        pot = 0;
        currentBets = new Array(NUM_PLAYERS).fill(0);
        folded = new Array(NUM_PLAYERS).fill(false);
        allIn = new Array(NUM_PLAYERS).fill(false);
        roundBet = 0;
        lastRaiser = -1;
        actedThisRound = new Array(NUM_PLAYERS).fill(false);

        // Mark eliminated / disconnected players as folded
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (players[i].chips <= 0 || disconnectedPlayers[i]) {
                folded[i] = true;
            }
            players[i].hand = [];
        }

        updatePlayerInfo();

        // Post blinds
        const sb = nextActivePlayer(dealerIndex);
        const bb = nextActivePlayer(sb);
        if (sb === -1 || bb === -1) { checkGameOver(); return; }

        const sbAmount = placeBet(sb, SMALL_BLIND);
        showPlayerAction(sb, 'SB ' + sbAmount);
        const bbAmount = placeBet(bb, BIG_BLIND);
        showPlayerAction(bb, 'BB ' + bbAmount);
        roundBet = BIG_BLIND;

        roundInfo.textContent = '\ud504\ub9ac\ud50c\ub7cd - \uce74\ub4dc\ub97c \ubc30\ubd84 \uc911...';
        updatePlayerInfo();

        // Deal hole cards
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i]) {
                players[i].hand = [deck.pop(), deck.pop()];
            }
        }

        // Animate dealing
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i]) {
                const container = document.getElementById('cards-' + i);
                const isMe = (i === myIndex && !isSpectator);
                const faceUp = isMe;
                const extraClass = isMe ? 'my-card' : null;
                const isLeft = (i === 2);
                for (let c = 0; c < 2; c++) {
                    await dealCardAnimated(container, players[i].hand[c], faceUp, extraClass, c * 120, isLeft);
                }
            }
        }

        await sleep(300);
        broadcastState();

        // Preflop betting
        phase = 'preflop';
        actedThisRound = new Array(NUM_PLAYERS).fill(false);
        actedThisRound[sb] = true;
        currentPlayerIndex = nextActivePlayer(bb);
        if (currentPlayerIndex === -1) currentPlayerIndex = bb;

        roundInfo.textContent = '\ud504\ub9ac\ud50c\ub7cd \ubca0\ud305';
        broadcastState();
        await bettingLoop();

        if (checkSingleWinner()) return;

        // Flop
        collectBetsIntoPot();
        resetBettingRound();
        phase = 'flop';
        roundInfo.textContent = '\ud50c\ub7cd';
        deck.pop();
        communityCards.push(deck.pop(), deck.pop(), deck.pop());
        await dealCommunityCards(0, 3);
        await sleep(400);

        currentPlayerIndex = nextActivePlayer(dealerIndex);
        if (currentPlayerIndex === -1) { await finishHand(); return; }
        actedThisRound = new Array(NUM_PLAYERS).fill(false);
        roundInfo.textContent = '\ud50c\ub7cd \ubca0\ud305';
        broadcastState();
        await bettingLoop();

        if (checkSingleWinner()) return;

        // Turn
        collectBetsIntoPot();
        resetBettingRound();
        phase = 'turn';
        roundInfo.textContent = '\ud134';
        deck.pop();
        communityCards.push(deck.pop());
        await dealCommunityCards(3, 1);
        await sleep(400);

        currentPlayerIndex = nextActivePlayer(dealerIndex);
        if (currentPlayerIndex === -1) { await finishHand(); return; }
        actedThisRound = new Array(NUM_PLAYERS).fill(false);
        roundInfo.textContent = '\ud134 \ubca0\ud305';
        broadcastState();
        await bettingLoop();

        if (checkSingleWinner()) return;

        // River
        collectBetsIntoPot();
        resetBettingRound();
        phase = 'river';
        roundInfo.textContent = '\ub9ac\ubc84';
        deck.pop();
        communityCards.push(deck.pop());
        await dealCommunityCards(4, 1);
        await sleep(400);

        currentPlayerIndex = nextActivePlayer(dealerIndex);
        if (currentPlayerIndex === -1) { await finishHand(); return; }
        actedThisRound = new Array(NUM_PLAYERS).fill(false);
        roundInfo.textContent = '\ub9ac\ubc84 \ubca0\ud305';
        broadcastState();
        await bettingLoop();

        // Showdown
        await finishHand();
    }

    async function dealCommunityCards(startIndex, count) {
        for (let i = 0; i < count; i++) {
            const card = communityCards[startIndex + i];
            await dealCardAnimated(communityCardsEl, card, true, 'community-card', i * 200, false);
        }
    }

    async function bettingLoop() {
        while (true) {
            if (activePlayers() <= 1) return;
            if (activeNonAllIn() === 0) return;
            if (bettingRoundComplete()) return;

            if (folded[currentPlayerIndex] || allIn[currentPlayerIndex] || players[currentPlayerIndex].chips <= 0) {
                actedThisRound[currentPlayerIndex] = true;
                currentPlayerIndex = nextActivePlayer(currentPlayerIndex);
                if (currentPlayerIndex === -1) return;
                continue;
            }

            updatePlayerInfo();
            updateBettingControls();
            broadcastState();

            if (players[currentPlayerIndex].isAI) {
                // AI player (dealer) — works in both solo and multiplayer
                if (isHost || !isMultiplayer) {
                    await sleep(600 + Math.random() * 800);
                    const decision = aiDecision(currentPlayerIndex);
                    if (decision.action === 'raise') {
                        const toCall = roundBet - currentBets[currentPlayerIndex];
                        await executePlayerAction('raise', toCall + decision.amount, currentPlayerIndex);
                    } else {
                        await executePlayerAction(decision.action, 0, currentPlayerIndex);
                    }
                } else {
                    // Non-host waits for state broadcast from host
                    await waitForRemoteAction();
                }
            } else if (disconnectedPlayers[currentPlayerIndex]) {
                // Auto-fold disconnected players
                if (isHost || !isMultiplayer) {
                    await executePlayerAction('fold', 0, currentPlayerIndex);
                } else {
                    await waitForRemoteAction();
                }
            } else if (isMultiplayer) {
                if (currentPlayerIndex === myIndex) {
                    await waitForPlayerAction();
                } else {
                    // Host waits for remote player's action
                    await waitForRemoteAction();
                }
            } else {
                // Solo mode: human player
                await waitForPlayerAction();
            }

            if (bettingRoundComplete()) return;

            currentPlayerIndex = nextActivePlayer(currentPlayerIndex);
            if (currentPlayerIndex === -1) return;
        }
    }

    // Wait for local player action
    let _playerActionResolve = null;
    function waitForPlayerAction() {
        return new Promise(resolve => {
            _playerActionResolve = () => {
                _playerActionResolve = null;
                resolve();
            };
        });
    }

    // Wait for remote player action (host only)
    let _remoteActionResolve = null;
    function waitForRemoteAction() {
        return new Promise(resolve => {
            _remoteActionResolve = (data) => {
                _remoteActionResolve = null;
                resolve(data);
            };
        });
    }

    function checkSingleWinner() {
        const active = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i]) active.push(i);
        }
        if (active.length === 1) {
            collectBetsIntoPot();
            const winner = active[0];
            players[winner].chips += pot;
            showHandResult(players[winner].name + ' \uc2b9\ub9ac! (+' + pot + ' \uce69)');
            pot = 0;
            updatePlayerInfo();
            handInProgress = false;
            roundInfo.textContent = '\ud578\ub4dc \uc885\ub8cc - \ub2e4\uc74c \ud578\ub4dc \uc900\ube44 \uc911...';
            broadcastState();

            setTimeout(() => {
                advanceDealer();
                startNewHand();
            }, 2500);
            return true;
        }
        return false;
    }

    async function finishHand() {
        collectBetsIntoPot();
        phase = 'showdown';
        roundInfo.textContent = '\uc1fc\ub2e4\uc6b4!';
        bettingControls.classList.add('hidden');

        // Reveal all cards
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i] && i !== myIndex) {
                const container = document.getElementById('cards-' + i);
                if (!container) continue;
                const cardEls = container.querySelectorAll('.card-3d');
                for (const el of cardEls) {
                    await sleep(150);
                    flipCard(el);
                }
            }
        }

        await sleep(600);

        // Evaluate hands
        const hands = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i] && players[i].hand && players[i].hand.length === 2) {
                const best = bestHand(players[i].hand, communityCards);
                hands.push({ player: i, hand: best });
            }
        }

        hands.sort((a, b) => compareHands(b.hand, a.hand));

        const winners = [hands[0]];
        for (let i = 1; i < hands.length; i++) {
            if (compareHands(hands[i].hand, hands[0].hand) === 0) {
                winners.push(hands[i]);
            }
        }

        const share = Math.floor(pot / winners.length);
        let remainder = pot - share * winners.length;
        for (const w of winners) {
            players[w.player].chips += share;
            if (remainder > 0) {
                players[w.player].chips += 1;
                remainder--;
            }
        }

        const winnerNames = winners.map(w => players[w.player].name).join(', ');
        const handName = winners[0].hand.name;
        showHandResult(winnerNames + ' \uc2b9\ub9ac! (' + handName + ') +' + pot + ' \uce69');

        for (const h of hands) {
            showPlayerAction(h.player, h.hand.name);
        }

        pot = 0;
        updatePlayerInfo();
        handInProgress = false;
        broadcastState();

        await sleep(3500);

        if (!checkGameOver()) {
            advanceDealer();
            startNewHand();
        }
    }

    function advanceDealer() {
        let next = (dealerIndex + 1) % NUM_PLAYERS;
        let safety = 0;
        while (players[next].chips <= 0 && safety < NUM_PLAYERS) {
            next = (next + 1) % NUM_PLAYERS;
            safety++;
        }
        dealerIndex = next;
    }

    function checkGameOver() {
        if (isMultiplayer) {
            // In multiplayer, game over when only 1 player has chips
            let alive = 0;
            let lastAlive = -1;
            for (let i = 0; i < NUM_PLAYERS; i++) {
                if (players[i].chips > 0) {
                    alive++;
                    lastAlive = i;
                }
            }
            if (alive <= 1) {
                if (lastAlive === myIndex) {
                    showGameOver('\uc2b9\ub9ac!', '\ubaa8\ub4e0 \uc0c1\ub300\ub97c \uc774\uacbc\uc2b5\ub2c8\ub2e4! \ucd5c\uc885 \uce69: ' + players[myIndex].chips);
                } else if (lastAlive >= 0) {
                    showGameOver('\ud328\ubc30!', players[lastAlive].name + '\uc774(\uac00) \uc2b9\ub9ac\ud588\uc2b5\ub2c8\ub2e4.');
                } else {
                    showGameOver('\uac8c\uc784 \uc885\ub8cc', '\ubaa8\ub4e0 \ud50c\ub808\uc774\uc5b4\uac00 \ud0c8\ub77d\ud588\uc2b5\ub2c8\ub2e4.');
                }
                return true;
            }
            return false;
        }

        // Solo mode
        if (players[0].chips <= 0) {
            showGameOver('\ud328\ubc30!', '\uce69\uc744 \ubaa8\ub450 \uc783\uc5c8\uc2b5\ub2c8\ub2e4.');
            return true;
        }
        let alive = 0;
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (players[i].chips > 0) alive++;
        }
        if (alive <= 1) {
            if (players[0].chips > 0) {
                showGameOver('\uc2b9\ub9ac!', '\ubaa8\ub4e0 AI\ub97c \uc774\uacbc\uc2b5\ub2c8\ub2e4! \ucd5c\uc885 \uce69: ' + players[0].chips);
            } else {
                showGameOver('\ud328\ubc30!', '\uce69\uc744 \ubaa8\ub450 \uc783\uc5c8\uc2b5\ub2c8\ub2e4.');
            }
            return true;
        }
        return false;
    }

    function showGameOver(title, msg) {
        gameOver = true;
        gameOverTitle.textContent = title;
        gameOverMsg.textContent = msg;
        overlay.style.display = 'flex';
        gameRunning = false;
        handInProgress = false;
        bettingControls.classList.add('hidden');
    }

    // ── Event Handlers ──
    if (btnFold) btnFold.addEventListener('click', async () => {
        if (currentPlayerIndex !== myIndex) return;
        if (isSpectator) return;

        if (isMultiplayer && !isHost) {
            // Non-host sends action to host
            socket.emit('game_move', {
                room_id: ROOM_ID,
                type: 'action',
                data: { playerIndex: myIndex, action: 'fold', amount: 0 }
            });
            return;
        }

        if (_playerActionResolve) {
            await executePlayerAction('fold', 0, myIndex);
            _playerActionResolve();
        }
    });

    if (btnCheck) btnCheck.addEventListener('click', async () => {
        if (currentPlayerIndex !== myIndex) return;
        if (isSpectator) return;

        const toCall = roundBet - currentBets[myIndex];

        if (isMultiplayer && !isHost) {
            socket.emit('game_move', {
                room_id: ROOM_ID,
                type: 'action',
                data: { playerIndex: myIndex, action: toCall > 0 ? 'call' : 'check', amount: 0 }
            });
            return;
        }

        if (_playerActionResolve) {
            if (toCall > 0) {
                await executePlayerAction('call', 0, myIndex);
            } else {
                await executePlayerAction('check', 0, myIndex);
            }
            _playerActionResolve();
        }
    });

    if (btnRaise) btnRaise.addEventListener('click', async () => {
        if (currentPlayerIndex !== myIndex) return;
        if (isSpectator) return;

        const raiseAmount = parseInt(raiseSlider.value);

        if (isMultiplayer && !isHost) {
            socket.emit('game_move', {
                room_id: ROOM_ID,
                type: 'action',
                data: { playerIndex: myIndex, action: 'raise', amount: raiseAmount }
            });
            return;
        }

        if (_playerActionResolve) {
            await executePlayerAction('raise', raiseAmount, myIndex);
            _playerActionResolve();
        }
    });

    if (raiseSlider) raiseSlider.addEventListener('input', () => {
        raiseAmountEl.textContent = raiseSlider.value;
    });

    if (startBtn) startBtn.addEventListener('click', () => {
        if (gameRunning) return;
        if (isSpectator) return;

        if (isMultiplayer && (!gameReady || !isHost)) return;

        gameRunning = true;
        gameOver = false;
        overlay.style.display = 'none';
        startBtn.textContent = '\uc9c4\ud589 \uc911...';
        startBtn.disabled = true;
        initPlayers();
        createSeats(PLAYER_NAMES, isSpectator ? 0 : myIndex);
        dealerIndex = Math.floor(Math.random() * NUM_PLAYERS);
        updatePlayerInfo();

        if (isHost || !isMultiplayer) {
            startNewHand();
        }
    });

    if (restartBtn) restartBtn.addEventListener('click', () => {
        if (isMultiplayer) {
            // In multiplayer, redirect home after game over
            window.location.href = '/';
            return;
        }
        overlay.style.display = 'none';
        gameRunning = true;
        gameOver = false;
        startBtn.textContent = '\uc9c4\ud589 \uc911...';
        startBtn.disabled = true;
        hideHandResult();
        clearActions();
        clearPlayerCards();
        clearCommunityCards();
        initPlayers();
        createSeats(PLAYER_NAMES, myIndex);
        dealerIndex = Math.floor(Math.random() * NUM_PLAYERS);
        updatePlayerInfo();
        startNewHand();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (isSpectator) return;
        if (currentPlayerIndex !== myIndex) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'f' || e.key === 'F') btnFold.click();
        if (e.key === 'c' || e.key === 'C') btnCheck.click();
        if (e.key === 'r' || e.key === 'R') btnRaise.click();
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

            // Spectator receives state updates
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

                // If game is already running (mid-game join), notify others
                if (gameRunning) {
                    socket.emit('poker_join_request', { room_id: ROOM_ID, user_id: MY_USER });
                } else if (isHost) {
                    // Only host initializes game; non-host waits for state broadcast
                    startBtn.click();
                }
            });

            // Receive moves
            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    if (!isHost) {
                        // Non-host: apply the state from host
                        applyState(data.data);
                    }
                } else if (data.type === 'action' && data.data && isHost) {
                    // Host receives action from a remote player
                    const action = data.data;
                    if (_remoteActionResolve && action.playerIndex === currentPlayerIndex) {
                        // Execute the action
                        if (action.action === 'raise') {
                            executePlayerAction('raise', action.amount, action.playerIndex).then(() => {
                                if (_remoteActionResolve) _remoteActionResolve(action);
                            });
                        } else {
                            executePlayerAction(action.action, 0, action.playerIndex).then(() => {
                                if (_remoteActionResolve) _remoteActionResolve(action);
                            });
                        }
                    }
                }
            });

            // Handle disconnection
            function handleDisconnect() {
                if (gameOver || isSpectator) return;
                // For simplicity: if opponent disconnects, auto-fold them
                // Find disconnected player(s) and fold them
                for (let i = 0; i < NUM_PLAYERS; i++) {
                    if (i !== myIndex && !folded[i] && !disconnectedPlayers[i]) {
                        disconnectedPlayers[i] = true;
                        if (isHost && handInProgress && currentPlayerIndex === i && _remoteActionResolve) {
                            // The disconnected player was the one we're waiting for
                            executePlayerAction('fold', 0, i).then(() => {
                                if (_remoteActionResolve) _remoteActionResolve({ action: 'fold' });
                            });
                        }
                    }
                }
            }

            socket.on('opponent_disconnected', handleDisconnect);
            socket.on('opponent_game_over', handleDisconnect);

            socket.on('game_winner', (data) => {
                gameOver = true;
                gameRunning = false;
                const msg = data.winner === myUser ? '승리! 상대방이 나갔습니다.' : data.winner + '님이 승리했습니다.';
                if (gameOverMsg) gameOverMsg.textContent = msg;
                if (overlay) overlay.classList.add('active');
            });

            // Mid-game join for poker
            socket.on('poker_player_joined', (data) => {
                if (data.user_id && !pendingJoins.includes(data.user_id)) {
                    pendingJoins.push(data.user_id);
                }
            });

            // Player left poker room — fold + mark for removal
            socket.on('poker_player_left', (data) => {
                const leftUser = data.user_id;
                const leftIdx = PLAYER_NAMES.indexOf(leftUser);
                if (leftIdx === -1) return;

                disconnectedPlayers[leftIdx] = true;

                // If it's the disconnected player's turn and host is waiting, auto-fold
                if (isHost && handInProgress && currentPlayerIndex === leftIdx && _remoteActionResolve) {
                    executePlayerAction('fold', 0, leftIdx).then(() => {
                        if (_remoteActionResolve) _remoteActionResolve({ action: 'fold' });
                    });
                }

                // Mark for removal after current hand ends
                if (!pendingLeaves) pendingLeaves = [];
                if (!pendingLeaves.includes(leftUser)) {
                    pendingLeaves.push(leftUser);
                }
            });

            // Admin force-closed room
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
    initPlayers();
    createSeats(PLAYER_NAMES, isSpectator ? 0 : myIndex);
    updatePlayerInfo();

    // In multiplayer, hide start button until game_ready (handled above)
    if (isMultiplayer && !isSpectator && !gameReady) {
        startBtn.style.display = 'none';
    }
})();
