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
    const ROLE_SHERIFF = 'sheriff';
    const ROLE_DEPUTY = 'deputy';
    const ROLE_OUTLAW = 'outlaw';
    const ROLE_RENEGADE = 'renegade';

    const ROLE_LABELS = {
        [ROLE_SHERIFF]: '보안관',
        [ROLE_DEPUTY]: '부관',
        [ROLE_OUTLAW]: '무법자',
        [ROLE_RENEGADE]: '배신자'
    };

    const ROLE_CLASSES = {
        [ROLE_SHERIFF]: 'role-sheriff',
        [ROLE_DEPUTY]: 'role-deputy',
        [ROLE_OUTLAW]: 'role-outlaw',
        [ROLE_RENEGADE]: 'role-renegade'
    };

    // Role distribution per player count
    const ROLE_DISTRIBUTION = {
        4: [ROLE_SHERIFF, ROLE_RENEGADE, ROLE_OUTLAW, ROLE_OUTLAW],
        5: [ROLE_SHERIFF, ROLE_DEPUTY, ROLE_OUTLAW, ROLE_OUTLAW, ROLE_RENEGADE],
        6: [ROLE_SHERIFF, ROLE_DEPUTY, ROLE_OUTLAW, ROLE_OUTLAW, ROLE_OUTLAW, ROLE_RENEGADE],
        7: [ROLE_SHERIFF, ROLE_DEPUTY, ROLE_DEPUTY, ROLE_OUTLAW, ROLE_OUTLAW, ROLE_OUTLAW, ROLE_RENEGADE]
    };

    // Card definitions
    const CARD_TYPES = {
        BANG: { name: '뱅!', icon: '💥', type: 'attack', needsTarget: true },
        MISSED: { name: '빗나감!', icon: '🛡️', type: 'defense', needsTarget: false },
        BEER: { name: '맥주', icon: '🍺', type: 'heal', needsTarget: false },
        PANIC: { name: '빼앗기!', icon: '🤏', type: 'action', needsTarget: true },
        CAT_BALOU: { name: '총알 빼기', icon: '💨', type: 'action', needsTarget: true },
        STAGECOACH: { name: '역마차', icon: '🐴', type: 'draw', needsTarget: false },
        WELLS_FARGO: { name: '우물', icon: '💧', type: 'draw', needsTarget: false },
        GENERAL_STORE: { name: '잡화점', icon: '🏪', type: 'draw', needsTarget: false },
        INDIANS: { name: '인디언', icon: '🏹', type: 'attack', needsTarget: false },
        GATLING: { name: '개틀링', icon: '🔫', type: 'attack', needsTarget: false },
        DUEL: { name: '결투', icon: '⚔️', type: 'attack', needsTarget: true },
        BARREL: { name: '통', icon: '🛢️', type: 'equipment', needsTarget: false },
        MUSTANG: { name: '머스탱', icon: '🐎', type: 'equipment', needsTarget: false },
        SCOPE: { name: '조준경', icon: '🔭', type: 'equipment', needsTarget: false },
        JAIL: { name: '감옥', icon: '🔒', type: 'equipment', needsTarget: true },
        DYNAMITE: { name: '다이너마이트', icon: '🧨', type: 'equipment', needsTarget: false }
    };

    const SUITS = ['♠', '♥', '♦', '♣'];
    const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

    // AI player names
    const AI_NAMES = ['카우보이', '보안관봇', '현상금', '무법자봇', '방랑자', '사냥꾼'];

    // ── Player Setup ──
    const SOLO_PLAYER_COUNT = 5;
    let PLAYER_NAMES = [];
    let NUM_PLAYERS = 0;
    let myIndex = 0;
    let isHost = false;

    if (isMultiplayer) {
        PLAYER_NAMES = roomPlayers.slice();
        // Fill with AI if less than 4
        let aiIdx = 0;
        while (PLAYER_NAMES.length < 4) {
            PLAYER_NAMES.push(AI_NAMES[aiIdx++]);
        }
        NUM_PLAYERS = PLAYER_NAMES.length;
        myIndex = PLAYER_NAMES.indexOf(myUser);
        if (myIndex === -1) myIndex = 0;
        isHost = (myIndex === 0);
    } else {
        PLAYER_NAMES = ['나'];
        for (let i = 0; i < SOLO_PLAYER_COUNT - 1; i++) {
            PLAYER_NAMES.push(AI_NAMES[i]);
        }
        NUM_PLAYERS = SOLO_PLAYER_COUNT;
        myIndex = 0;
        isHost = true;
    }

    function isAIPlayer(idx) {
        if (!isMultiplayer) return idx !== 0;
        return AI_NAMES.includes(PLAYER_NAMES[idx]);
    }

    // ── Game State ──
    let players = [];
    let deck = [];
    let discardPile = [];
    let currentPlayerIndex = 0;
    let phase = 'idle'; // idle, playing, discard, waiting_response, game_over
    let bangPlayedThisTurn = false;
    let gameRunning = false;
    let turnActions = []; // log of actions this turn
    let targetingCard = null; // card waiting for target selection
    let discardMode = false;
    let generalStoreCards = []; // for General Store
    let duelState = null; // { attacker, defender, turn }
    let waitingForResponse = null; // { type, from, to, card }

    // ── DOM Elements ──
    const bangTable = document.getElementById('bang-table');
    const centerInfo = document.getElementById('bang-center-info');
    const deckPile = document.getElementById('deck-pile');
    const deckCountEl = document.getElementById('deck-count');
    const discardPileEl = document.getElementById('discard-pile');
    const discardTopEl = document.getElementById('discard-top');
    const myHandArea = document.getElementById('my-hand-area');
    const actionBar = document.getElementById('action-bar');
    const btnEndTurn = document.getElementById('btn-end-turn');
    const btnDiscardMode = document.getElementById('btn-discard-mode');
    const roundInfo = document.getElementById('round-info');
    const startBtn = document.getElementById('start-btn');
    const resultEl = document.getElementById('bang-result');
    const targetPrompt = document.getElementById('target-prompt');
    const drawCheckOverlay = document.getElementById('draw-check-overlay');
    const gameOverOverlay = document.getElementById('game-over-overlay');
    const gameOverTitle = document.getElementById('game-over-title');
    const gameOverMsg = document.getElementById('game-over-msg');
    const restartBtn = document.getElementById('restart-btn');

    // ── Utilities ──
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function uid() { return Math.random().toString(36).substr(2, 9); }

    // ── Deck Creation ──
    function createDeck() {
        const cards = [];
        // Distribution of cards (simplified but balanced 80-card deck)
        const distribution = [
            { key: 'BANG', count: 25 },
            { key: 'MISSED', count: 12 },
            { key: 'BEER', count: 6 },
            { key: 'PANIC', count: 4 },
            { key: 'CAT_BALOU', count: 4 },
            { key: 'STAGECOACH', count: 2 },
            { key: 'WELLS_FARGO', count: 1 },
            { key: 'GENERAL_STORE', count: 2 },
            { key: 'INDIANS', count: 2 },
            { key: 'GATLING', count: 1 },
            { key: 'DUEL', count: 3 },
            { key: 'BARREL', count: 2 },
            { key: 'MUSTANG', count: 2 },
            { key: 'SCOPE', count: 2 },
            { key: 'JAIL', count: 3 },
            { key: 'DYNAMITE', count: 1 }
        ];
        // total = 72, pad with extra BANGs and MISSEDs
        let total = distribution.reduce((s, d) => s + d.count, 0);
        // Add to reach 80
        distribution[0].count += (80 - total); // extra BANGs

        let suitIdx = 0;
        let rankIdx = 0;
        for (const d of distribution) {
            const ct = CARD_TYPES[d.key];
            for (let i = 0; i < d.count; i++) {
                cards.push({
                    id: uid(),
                    key: d.key,
                    name: ct.name,
                    icon: ct.icon,
                    type: ct.type,
                    needsTarget: ct.needsTarget,
                    suit: SUITS[suitIdx % 4],
                    rank: RANKS[rankIdx % 13]
                });
                suitIdx++;
                rankIdx++;
            }
        }
        return shuffle(cards);
    }

    function drawCard() {
        if (deck.length === 0) {
            // Reshuffle discard pile into deck
            if (discardPile.length === 0) return null;
            const top = discardPile.pop();
            deck = shuffle(discardPile.splice(0));
            discardPile = [top];
        }
        return deck.pop();
    }

    function addToDiscard(card) {
        discardPile.push(card);
        updateDiscardDisplay();
    }

    // ── "Draw!" check (for Barrel, Jail, Dynamite) ──
    function drawCheck() {
        const card = drawCard();
        if (card) addToDiscard(card);
        return card;
    }

    function isHeart(card) {
        return card && card.suit === '♥';
    }

    function isSpadeRange2to9(card) {
        if (!card || card.suit !== '♠') return false;
        const ri = RANKS.indexOf(card.rank);
        return ri >= 0 && ri <= 7; // 2-9
    }

    // ── Distance Calculation ──
    function calculateDistance(from, to) {
        if (from === to) return 0;
        const alive = players.filter(p => p.alive).map(p => p.index);
        const fi = alive.indexOf(from);
        const ti = alive.indexOf(to);
        if (fi === -1 || ti === -1) return Infinity;
        const n = alive.length;
        const clockwise = (ti - fi + n) % n;
        const counter = (fi - ti + n) % n;
        let dist = Math.min(clockwise, counter);
        // Mustang: target has +1 distance from shooter
        if (players[to].equipment.some(c => c.key === 'MUSTANG')) dist += 1;
        // Scope: shooter sees at -1 distance
        if (players[from].equipment.some(c => c.key === 'SCOPE')) dist = Math.max(1, dist - 1);
        return dist;
    }

    // ── Role Assignment ──
    function assignRoles() {
        const dist = ROLE_DISTRIBUTION[NUM_PLAYERS];
        if (!dist) return;
        const roles = shuffle([...dist]);
        for (let i = 0; i < NUM_PLAYERS; i++) {
            players[i].role = roles[i];
            players[i].maxHp = (roles[i] === ROLE_SHERIFF) ? 5 : 4;
            players[i].hp = players[i].maxHp;
        }
    }

    // ── Player Initialization ──
    function initPlayers() {
        players = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            players.push({
                index: i,
                name: PLAYER_NAMES[i],
                role: null,
                hp: 4,
                maxHp: 4,
                hand: [],
                equipment: [],
                alive: true,
                isAI: isAIPlayer(i),
                jailed: false,
                hasDynamite: false
            });
        }
    }

    // ── Deal Cards ──
    function dealCards() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const count = players[i].hp;
            for (let c = 0; c < count; c++) {
                const card = drawCard();
                if (card) players[i].hand.push(card);
            }
        }
    }

    // ── Seat Creation ──
    function createSeats() {
        // Remove old seats
        document.querySelectorAll('.bang-seat').forEach(el => el.remove());

        for (let i = 0; i < NUM_PLAYERS; i++) {
            const seat = document.createElement('div');
            seat.className = 'bang-seat seat-' + getSeatPosition(i);
            seat.id = 'seat-' + i;
            if (i === myIndex && !isSpectator) seat.classList.add('my-seat');
            seat.dataset.playerIndex = i;

            seat.addEventListener('click', () => onSeatClick(i));

            const info = document.createElement('div');
            info.className = 'bang-player-info';
            info.id = 'info-' + i;
            info.innerHTML = `
                <div class="bp-name">${escHtml(players[i].name)} <span class="bp-role-badge" id="role-badge-${i}"></span></div>
                <div class="bp-hp" id="hp-${i}"></div>
                <div class="bp-equipment" id="equip-${i}"></div>
                <div class="bp-hand-count" id="hcount-${i}"></div>
            `;
            seat.appendChild(info);
            bangTable.appendChild(seat);
        }
    }

    function getSeatPosition(playerIdx) {
        // Remap player indices to seat positions (0=bottom, then clockwise)
        // Shift so myIndex is always seat-0 (bottom)
        const shifted = (playerIdx - myIndex + NUM_PLAYERS) % NUM_PLAYERS;
        // Map positions based on player count
        const positionMaps = {
            4: [0, 2, 4, 6],
            5: [0, 1, 2, 4, 5],
            6: [0, 1, 2, 3, 4, 5],
            7: [0, 1, 2, 3, 4, 5, 6]
        };
        const map = positionMaps[NUM_PLAYERS] || positionMaps[7];
        return map[shifted] !== undefined ? map[shifted] : shifted;
    }

    function escHtml(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // ── Update Display ──
    function updateAllDisplay() {
        updateSeats();
        updateMyHand();
        updateDeckDisplay();
        updateDiscardDisplay();
    }

    function updateSeats() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const p = players[i];
            const info = document.getElementById('info-' + i);
            if (!info) continue;

            // Active turn highlight
            info.classList.toggle('active-turn', i === currentPlayerIndex && phase === 'playing');
            info.classList.toggle('dead', !p.alive);

            // Role badge
            const badge = document.getElementById('role-badge-' + i);
            if (badge) {
                let showRole = false;
                if (p.role === ROLE_SHERIFF) showRole = true;
                else if (!p.alive) showRole = true; // dead = role revealed
                else if (i === myIndex && !isSpectator) showRole = true; // own role
                else if (isSpectator) showRole = true;

                if (showRole && p.role) {
                    badge.textContent = ROLE_LABELS[p.role];
                    badge.className = 'bp-role-badge ' + ROLE_CLASSES[p.role];
                } else {
                    badge.textContent = '';
                    badge.className = 'bp-role-badge';
                }
            }

            // HP
            const hpEl = document.getElementById('hp-' + i);
            if (hpEl) {
                if (p.alive) {
                    let hearts = '';
                    for (let h = 0; h < p.maxHp; h++) {
                        hearts += h < p.hp ? '❤️' : '🖤';
                    }
                    hpEl.textContent = hearts;
                } else {
                    hpEl.textContent = '💀';
                }
            }

            // Equipment
            const equipEl = document.getElementById('equip-' + i);
            if (equipEl) {
                const equipNames = p.equipment.map(c => c.icon + c.name);
                equipEl.textContent = equipNames.join(' ');
            }

            // Hand count
            const hcountEl = document.getElementById('hcount-' + i);
            if (hcountEl) {
                hcountEl.textContent = p.alive ? '🃏 ' + p.hand.length : '';
            }
        }
    }

    function updateMyHand() {
        myHandArea.innerHTML = '';
        if (isSpectator) return;
        const p = players[myIndex];
        if (!p || !p.alive) return;

        for (let i = 0; i < p.hand.length; i++) {
            const card = p.hand[i];
            const el = createCardElement(card, i);
            // Check if card is playable
            if (phase === 'playing' && currentPlayerIndex === myIndex && !discardMode) {
                const playable = canPlayCard(myIndex, card);
                if (!playable) el.classList.add('disabled');
            } else if (discardMode && currentPlayerIndex === myIndex) {
                // In discard mode, all cards are clickable
                el.classList.remove('disabled');
            } else {
                el.classList.add('disabled');
            }
            el.addEventListener('click', () => onCardClick(i));
            myHandArea.appendChild(el);
        }
    }

    function createCardElement(card, index) {
        const el = document.createElement('div');
        el.className = 'bang-card type-' + card.type;
        el.dataset.cardIndex = index;
        const suitColor = (card.suit === '♥' || card.suit === '♦') ? '#d32f2f' : '#222';
        el.innerHTML = `
            <div class="card-icon">${card.icon}</div>
            <div class="card-title">${card.name}</div>
            <div class="card-suit-rank" style="color:${suitColor}">${card.rank}${card.suit}</div>
        `;
        return el;
    }

    function updateDeckDisplay() {
        deckCountEl.textContent = deck.length;
    }

    function updateDiscardDisplay() {
        if (discardPile.length > 0) {
            const top = discardPile[discardPile.length - 1];
            discardTopEl.innerHTML = top.icon + '<br>' + top.name;
        } else {
            discardTopEl.textContent = '비어있음';
        }
    }

    // ── Card Playability ──
    function canPlayCard(playerIdx, card) {
        const p = players[playerIdx];
        if (!p.alive) return false;

        switch (card.key) {
            case 'BANG':
                if (bangPlayedThisTurn) return false;
                // Need at least one target in range
                return getValidBangTargets(playerIdx).length > 0;
            case 'MISSED':
                return false; // Only played reactively
            case 'BEER':
                if (p.hp >= p.maxHp) return false;
                // Beer has no effect with 2 players alive
                if (alivePlayers().length <= 2) return false;
                return true;
            case 'PANIC':
                return getValidPanicTargets(playerIdx).length > 0;
            case 'CAT_BALOU':
                return getValidCatBalouTargets(playerIdx).length > 0;
            case 'STAGECOACH':
            case 'WELLS_FARGO':
            case 'GENERAL_STORE':
                return true;
            case 'INDIANS':
            case 'GATLING':
                return alivePlayers().filter(i => i !== playerIdx).length > 0;
            case 'DUEL':
                return alivePlayers().filter(i => i !== playerIdx).length > 0;
            case 'BARREL':
                return !p.equipment.some(c => c.key === 'BARREL');
            case 'MUSTANG':
                return !p.equipment.some(c => c.key === 'MUSTANG');
            case 'SCOPE':
                return !p.equipment.some(c => c.key === 'SCOPE');
            case 'JAIL':
                return getValidJailTargets(playerIdx).length > 0;
            case 'DYNAMITE':
                return !p.equipment.some(c => c.key === 'DYNAMITE');
            default:
                return false;
        }
    }

    function getValidBangTargets(playerIdx) {
        const targets = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (i === playerIdx) continue;
            if (!players[i].alive) continue;
            if (calculateDistance(playerIdx, i) <= 1) targets.push(i);
        }
        return targets;
    }

    function getValidPanicTargets(playerIdx) {
        const targets = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (i === playerIdx) continue;
            if (!players[i].alive) continue;
            if (calculateDistance(playerIdx, i) <= 1 && (players[i].hand.length > 0 || players[i].equipment.length > 0)) {
                targets.push(i);
            }
        }
        return targets;
    }

    function getValidCatBalouTargets(playerIdx) {
        const targets = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (i === playerIdx) continue;
            if (!players[i].alive) continue;
            if (players[i].hand.length > 0 || players[i].equipment.length > 0) targets.push(i);
        }
        return targets;
    }

    function getValidJailTargets(playerIdx) {
        const targets = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (i === playerIdx) continue;
            if (!players[i].alive) continue;
            if (players[i].role === ROLE_SHERIFF) continue; // Can't jail the sheriff
            if (players[i].jailed) continue;
            targets.push(i);
        }
        return targets;
    }

    function alivePlayers() {
        return players.filter(p => p.alive).map(p => p.index);
    }

    // ── Card Click Handler ──
    function onCardClick(handIndex) {
        if (isSpectator) return;
        const p = players[myIndex];
        if (!p || !p.alive) return;
        if (handIndex < 0 || handIndex >= p.hand.length) return;

        if (discardMode) {
            // Discard the card
            const card = p.hand.splice(handIndex, 1)[0];
            addToDiscard(card);
            addLog(p.name + '이(가) ' + card.name + '을(를) 버렸습니다.');
            updateAllDisplay();
            checkDiscardDone();
            broadcastState();
            return;
        }

        if (phase !== 'playing' || currentPlayerIndex !== myIndex) return;

        const card = p.hand[handIndex];
        if (!canPlayCard(myIndex, card)) return;

        if (card.needsTarget) {
            // Enter targeting mode
            targetingCard = { handIndex, card };
            showTargetableSeats(card);
        } else {
            // Play immediately
            playCard(myIndex, handIndex, -1);
        }
    }

    function showTargetableSeats(card) {
        let validTargets = [];
        switch (card.key) {
            case 'BANG':
                validTargets = getValidBangTargets(myIndex);
                break;
            case 'PANIC':
                validTargets = getValidPanicTargets(myIndex);
                break;
            case 'CAT_BALOU':
                validTargets = getValidCatBalouTargets(myIndex);
                break;
            case 'JAIL':
                validTargets = getValidJailTargets(myIndex);
                break;
            case 'DUEL':
                validTargets = alivePlayers().filter(i => i !== myIndex);
                break;
            default:
                validTargets = alivePlayers().filter(i => i !== myIndex);
        }

        document.querySelectorAll('.bang-seat').forEach(el => {
            const idx = parseInt(el.dataset.playerIndex);
            if (validTargets.includes(idx)) {
                el.classList.add('targetable');
            } else {
                el.classList.remove('targetable');
            }
        });

        targetPrompt.classList.add('visible');
    }

    function hideTargeting() {
        targetingCard = null;
        targetPrompt.classList.remove('visible');
        document.querySelectorAll('.bang-seat').forEach(el => el.classList.remove('targetable'));
    }

    function onSeatClick(playerIdx) {
        if (!targetingCard) return;
        const seat = document.getElementById('seat-' + playerIdx);
        if (!seat || !seat.classList.contains('targetable')) return;

        const { handIndex } = targetingCard;
        hideTargeting();
        playCard(myIndex, handIndex, playerIdx);
    }

    // ── Play Card ──
    async function playCard(playerIdx, handIndex, targetIdx) {
        const p = players[playerIdx];
        if (handIndex < 0 || handIndex >= p.hand.length) return;
        const card = p.hand.splice(handIndex, 1)[0];
        addToDiscard(card);

        addLog(p.name + '이(가) ' + card.name + '을(를) 사용했습니다.' +
            (targetIdx >= 0 ? ' (대상: ' + players[targetIdx].name + ')' : ''));

        switch (card.key) {
            case 'BANG':
                bangPlayedThisTurn = true;
                await resolveBang(playerIdx, targetIdx);
                break;
            case 'BEER':
                p.hp = Math.min(p.hp + 1, p.maxHp);
                showTempResult(p.name + ' HP +1');
                break;
            case 'PANIC':
                await resolvePanic(playerIdx, targetIdx);
                break;
            case 'CAT_BALOU':
                await resolveCatBalou(targetIdx);
                break;
            case 'STAGECOACH':
                for (let i = 0; i < 2; i++) {
                    const c = drawCard();
                    if (c) p.hand.push(c);
                }
                showTempResult(p.name + ' 카드 2장 획득');
                break;
            case 'WELLS_FARGO':
                for (let i = 0; i < 3; i++) {
                    const c = drawCard();
                    if (c) p.hand.push(c);
                }
                showTempResult(p.name + ' 카드 3장 획득');
                break;
            case 'GENERAL_STORE':
                await resolveGeneralStore(playerIdx);
                break;
            case 'INDIANS':
                await resolveIndians(playerIdx);
                break;
            case 'GATLING':
                await resolveGatling(playerIdx);
                break;
            case 'DUEL':
                await resolveDuel(playerIdx, targetIdx);
                break;
            case 'BARREL':
            case 'MUSTANG':
            case 'SCOPE':
                p.equipment.push(card);
                showTempResult(p.name + ' ' + card.name + ' 장착');
                break;
            case 'JAIL':
                players[targetIdx].jailed = true;
                players[targetIdx].equipment.push(card);
                showTempResult(players[targetIdx].name + ' 감옥에 갇힘!');
                break;
            case 'DYNAMITE':
                p.equipment.push(card);
                p.hasDynamite = true;
                showTempResult(p.name + ' 다이너마이트 설치!');
                break;
        }

        updateAllDisplay();
        broadcastState();

        // Check for eliminations
        await checkAllEliminations(playerIdx);

        if (checkWinCondition()) return;
    }

    // ── Card Resolutions ──
    async function resolveBang(attackerIdx, targetIdx) {
        const target = players[targetIdx];

        // Check barrel first
        if (target.equipment.some(c => c.key === 'BARREL')) {
            const check = drawCheck();
            await showDrawCheck(check, '통 판정');
            if (check && isHeart(check)) {
                showTempResult(target.name + ' 통으로 회피!');
                return;
            }
        }

        // Check for Missed! in hand
        if (target.isAI) {
            const missedIdx = target.hand.findIndex(c => c.key === 'MISSED');
            if (missedIdx >= 0) {
                const missedCard = target.hand.splice(missedIdx, 1)[0];
                addToDiscard(missedCard);
                addLog(target.name + '이(가) 빗나감!으로 회피');
                showTempResult(target.name + ' 빗나감!');
                return;
            }
        } else if (targetIdx === myIndex && !isSpectator) {
            // Human player needs to respond
            const hasMissed = target.hand.some(c => c.key === 'MISSED');
            if (hasMissed) {
                const respond = await waitForMissedResponse(targetIdx);
                if (respond) return;
            }
        } else if (isMultiplayer && !target.isAI) {
            // Remote human player - wait for response via socket
            const respond = await waitForRemoteResponse(targetIdx, 'missed', attackerIdx);
            if (respond) return;
        }

        // Take damage
        applyDamage(targetIdx, 1, attackerIdx);
    }

    async function waitForMissedResponse(playerIdx) {
        return new Promise(resolve => {
            const p = players[playerIdx];
            const missedCards = p.hand.map((c, i) => ({ card: c, idx: i })).filter(x => x.card.key === 'MISSED');
            if (missedCards.length === 0) { resolve(false); return; }

            centerInfo.textContent = '빗나감! 카드를 사용하시겠습니까?';
            actionBar.classList.remove('hidden');
            actionBar.innerHTML = '';

            const btnUse = document.createElement('button');
            btnUse.className = 'btn btn-end-turn';
            btnUse.textContent = '빗나감! 사용';
            btnUse.addEventListener('click', () => {
                const mIdx = p.hand.findIndex(c => c.key === 'MISSED');
                if (mIdx >= 0) {
                    const card = p.hand.splice(mIdx, 1)[0];
                    addToDiscard(card);
                    addLog(p.name + '이(가) 빗나감!으로 회피');
                    showTempResult(p.name + ' 빗나감!');
                }
                restoreActionBar();
                updateAllDisplay();
                broadcastState();
                resolve(true);
            });

            const btnTake = document.createElement('button');
            btnTake.className = 'btn btn-discard-mode';
            btnTake.textContent = '맞기';
            btnTake.addEventListener('click', () => {
                restoreActionBar();
                resolve(false);
            });

            actionBar.appendChild(btnUse);
            actionBar.appendChild(btnTake);
        });
    }

    async function waitForBangResponse(playerIdx) {
        return new Promise(resolve => {
            const p = players[playerIdx];
            const bangCards = p.hand.filter(c => c.key === 'BANG');
            if (bangCards.length === 0) { resolve(false); return; }

            centerInfo.textContent = '뱅! 카드를 사용하시겠습니까? (결투)';
            actionBar.classList.remove('hidden');
            actionBar.innerHTML = '';

            const btnUse = document.createElement('button');
            btnUse.className = 'btn btn-end-turn';
            btnUse.textContent = '뱅! 사용';
            btnUse.addEventListener('click', () => {
                const bIdx = p.hand.findIndex(c => c.key === 'BANG');
                if (bIdx >= 0) {
                    const card = p.hand.splice(bIdx, 1)[0];
                    addToDiscard(card);
                    addLog(p.name + '이(가) 뱅!으로 응사');
                }
                restoreActionBar();
                updateAllDisplay();
                broadcastState();
                resolve(true);
            });

            const btnTake = document.createElement('button');
            btnTake.className = 'btn btn-discard-mode';
            btnTake.textContent = '포기';
            btnTake.addEventListener('click', () => {
                restoreActionBar();
                resolve(false);
            });

            actionBar.appendChild(btnUse);
            actionBar.appendChild(btnTake);
        });
    }

    async function waitForRemoteResponse(targetIdx, responseType, fromIdx) {
        // In multiplayer, for simplicity the host simulates AI responses for remote players
        // A full implementation would use socket events
        if (isHost) {
            // Simulate: check if they have the card
            const p = players[targetIdx];
            const cardKey = responseType === 'missed' ? 'MISSED' : 'BANG';
            const idx = p.hand.findIndex(c => c.key === cardKey);
            if (idx >= 0) {
                // AI-like behavior: always use it if available
                const card = p.hand.splice(idx, 1)[0];
                addToDiscard(card);
                addLog(p.name + '이(가) ' + card.name + '으로 응답');
                showTempResult(p.name + ' ' + card.name + '!');
                return true;
            }
        }
        return false;
    }

    function restoreActionBar() {
        actionBar.innerHTML = '';
        const et = document.createElement('button');
        et.className = 'btn btn-end-turn';
        et.id = 'btn-end-turn';
        et.textContent = '턴 종료';
        et.addEventListener('click', onEndTurn);
        actionBar.appendChild(et);

        const dm = document.createElement('button');
        dm.className = 'btn btn-discard-mode';
        dm.id = 'btn-discard-mode';
        dm.textContent = '카드 버리기';
        dm.style.display = 'none';
        dm.addEventListener('click', onDiscardMode);
        actionBar.appendChild(dm);
    }

    async function resolvePanic(attackerIdx, targetIdx) {
        const target = players[targetIdx];
        // Steal a random card from hand or equipment
        const totalCards = target.hand.length + target.equipment.length;
        if (totalCards === 0) return;

        const pick = Math.floor(Math.random() * totalCards);
        let stolenCard;
        if (pick < target.hand.length) {
            stolenCard = target.hand.splice(pick, 1)[0];
        } else {
            const eqIdx = pick - target.hand.length;
            stolenCard = target.equipment.splice(eqIdx, 1)[0];
            if (stolenCard.key === 'JAIL') target.jailed = false;
            if (stolenCard.key === 'DYNAMITE') target.hasDynamite = false;
        }
        if (stolenCard) {
            players[attackerIdx].hand.push(stolenCard);
            showTempResult(players[attackerIdx].name + '이(가) ' + stolenCard.name + ' 훔침!');
        }
    }

    async function resolveCatBalou(targetIdx) {
        const target = players[targetIdx];
        const totalCards = target.hand.length + target.equipment.length;
        if (totalCards === 0) return;

        const pick = Math.floor(Math.random() * totalCards);
        let discardedCard;
        if (pick < target.hand.length) {
            discardedCard = target.hand.splice(pick, 1)[0];
        } else {
            const eqIdx = pick - target.hand.length;
            discardedCard = target.equipment.splice(eqIdx, 1)[0];
            if (discardedCard.key === 'JAIL') target.jailed = false;
            if (discardedCard.key === 'DYNAMITE') target.hasDynamite = false;
        }
        if (discardedCard) {
            addToDiscard(discardedCard);
            showTempResult(target.name + '의 ' + discardedCard.name + ' 제거!');
        }
    }

    async function resolveGeneralStore(playerIdx) {
        // Reveal cards equal to alive players count
        const aliveList = alivePlayers();
        generalStoreCards = [];
        for (let i = 0; i < aliveList.length; i++) {
            const c = drawCard();
            if (c) generalStoreCards.push(c);
        }

        // Each player picks one, starting from the player who played it
        let pickOrder = [];
        const aliveCount = aliveList.length;
        const startPos = aliveList.indexOf(playerIdx);
        for (let i = 0; i < aliveCount; i++) {
            pickOrder.push(aliveList[(startPos + i) % aliveCount]);
        }

        for (const pi of pickOrder) {
            if (generalStoreCards.length === 0) break;
            if (players[pi].isAI || pi !== myIndex) {
                // AI picks the best card (or first)
                const bestIdx = aiFindBestGeneralStoreCard(pi);
                const picked = generalStoreCards.splice(bestIdx, 1)[0];
                players[pi].hand.push(picked);
                addLog(players[pi].name + '이(가) ' + picked.name + '을(를) 선택');
            } else {
                // Human player picks
                const picked = await humanPickGeneralStore();
                players[pi].hand.push(picked);
                addLog(players[pi].name + '이(가) ' + picked.name + '을(를) 선택');
            }
            updateAllDisplay();
        }
        generalStoreCards = [];
    }

    function aiFindBestGeneralStoreCard(playerIdx) {
        // Preference: MISSED > BANG > BEER > others
        const priority = ['MISSED', 'BANG', 'BEER', 'BARREL', 'MUSTANG', 'SCOPE'];
        for (const key of priority) {
            const idx = generalStoreCards.findIndex(c => c.key === key);
            if (idx >= 0) return idx;
        }
        return 0;
    }

    function humanPickGeneralStore() {
        return new Promise(resolve => {
            centerInfo.textContent = '잡화점에서 카드를 선택하세요';
            myHandArea.innerHTML = '';
            for (let i = 0; i < generalStoreCards.length; i++) {
                const card = generalStoreCards[i];
                const el = createCardElement(card, i);
                el.classList.remove('disabled');
                el.addEventListener('click', () => {
                    const picked = generalStoreCards.splice(i, 1)[0];
                    resolve(picked);
                });
                myHandArea.appendChild(el);
            }
        });
    }

    async function resolveIndians(attackerIdx) {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (i === attackerIdx || !players[i].alive) continue;

            if (players[i].isAI || (isMultiplayer && i !== myIndex)) {
                const bangIdx = players[i].hand.findIndex(c => c.key === 'BANG');
                if (bangIdx >= 0) {
                    const card = players[i].hand.splice(bangIdx, 1)[0];
                    addToDiscard(card);
                    addLog(players[i].name + '이(가) 뱅!으로 인디언 회피');
                } else {
                    applyDamage(i, 1, attackerIdx);
                }
            } else if (i === myIndex && !isSpectator) {
                const responded = await waitForBangResponse(i);
                if (!responded) {
                    applyDamage(i, 1, attackerIdx);
                }
            }
            updateAllDisplay();
            await sleep(300);
        }
        await checkAllEliminations(attackerIdx);
    }

    async function resolveGatling(attackerIdx) {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (i === attackerIdx || !players[i].alive) continue;

            // Check barrel
            let avoided = false;
            if (players[i].equipment.some(c => c.key === 'BARREL')) {
                const check = drawCheck();
                await showDrawCheck(check, players[i].name + ' 통 판정');
                if (check && isHeart(check)) {
                    addLog(players[i].name + '이(가) 통으로 회피!');
                    avoided = true;
                }
            }

            if (!avoided) {
                if (players[i].isAI || (isMultiplayer && i !== myIndex)) {
                    const missedIdx = players[i].hand.findIndex(c => c.key === 'MISSED');
                    if (missedIdx >= 0) {
                        const card = players[i].hand.splice(missedIdx, 1)[0];
                        addToDiscard(card);
                        addLog(players[i].name + '이(가) 빗나감!으로 회피');
                    } else {
                        applyDamage(i, 1, attackerIdx);
                    }
                } else if (i === myIndex && !isSpectator) {
                    const responded = await waitForMissedResponse(i);
                    if (!responded) {
                        applyDamage(i, 1, attackerIdx);
                    }
                }
            }
            updateAllDisplay();
            await sleep(300);
        }
        await checkAllEliminations(attackerIdx);
    }

    async function resolveDuel(attackerIdx, defenderIdx) {
        let currentAttacker = defenderIdx;
        let currentDefender = attackerIdx;

        while (true) {
            // Current attacker must play BANG or take damage
            const p = players[currentAttacker];
            let playedBang = false;

            if (p.isAI || (isMultiplayer && currentAttacker !== myIndex)) {
                const bangIdx = p.hand.findIndex(c => c.key === 'BANG');
                if (bangIdx >= 0) {
                    const card = p.hand.splice(bangIdx, 1)[0];
                    addToDiscard(card);
                    addLog(p.name + '이(가) 뱅!으로 응사');
                    playedBang = true;
                }
            } else if (currentAttacker === myIndex && !isSpectator) {
                playedBang = await waitForBangResponse(currentAttacker);
            }

            if (!playedBang) {
                applyDamage(currentAttacker, 1, currentDefender);
                break;
            }

            // Swap roles
            [currentAttacker, currentDefender] = [currentDefender, currentAttacker];
            updateAllDisplay();
            await sleep(400);
        }
    }

    // ── Damage & Elimination ──
    function applyDamage(targetIdx, amount, sourceIdx) {
        const target = players[targetIdx];
        target.hp -= amount;
        showTempResult(target.name + ' -' + amount + ' HP!');
        addLog(target.name + '이(가) ' + amount + ' 피해를 입었습니다.');

        if (target.hp <= 0) {
            // Check for beer save (only if more than 2 alive)
            if (alivePlayers().length > 2) {
                const beerIdx = target.hand.findIndex(c => c.key === 'BEER');
                if (beerIdx >= 0) {
                    const beer = target.hand.splice(beerIdx, 1)[0];
                    addToDiscard(beer);
                    target.hp = 1;
                    addLog(target.name + '이(가) 맥주로 부활!');
                    showTempResult(target.name + ' 맥주 부활!');
                    return;
                }
            }
        }
    }

    async function checkAllEliminations(killerIdx) {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (players[i].alive && players[i].hp <= 0) {
                await eliminatePlayer(i, killerIdx);
            }
        }
    }

    async function eliminatePlayer(playerIdx, killerIdx) {
        const p = players[playerIdx];
        p.alive = false;
        p.hp = 0;

        addLog(p.name + '이(가) 제거되었습니다! 역할: ' + ROLE_LABELS[p.role]);
        showTempResult(p.name + ' 제거! (' + ROLE_LABELS[p.role] + ')');

        // Discard all cards
        while (p.hand.length > 0) addToDiscard(p.hand.pop());
        while (p.equipment.length > 0) {
            const eq = p.equipment.pop();
            if (eq.key === 'DYNAMITE') p.hasDynamite = false;
            addToDiscard(eq);
        }
        p.jailed = false;

        // Penalty: Sheriff kills Deputy -> Sheriff discards all cards
        if (killerIdx >= 0 && players[killerIdx].role === ROLE_SHERIFF && p.role === ROLE_DEPUTY) {
            addLog('보안관이 부관을 처치! 보안관의 카드 모두 버림!');
            while (players[killerIdx].hand.length > 0) addToDiscard(players[killerIdx].hand.pop());
            while (players[killerIdx].equipment.length > 0) addToDiscard(players[killerIdx].equipment.pop());
        }

        // Reward: player kills outlaw -> draw 3 cards
        if (killerIdx >= 0 && p.role === ROLE_OUTLAW && players[killerIdx].alive) {
            for (let i = 0; i < 3; i++) {
                const c = drawCard();
                if (c) players[killerIdx].hand.push(c);
            }
            addLog(players[killerIdx].name + '이(가) 무법자 처치 보상 3장 획득!');
        }

        updateAllDisplay();
        await sleep(800);
    }

    // ── Win Condition ──
    function checkWinCondition() {
        const alive = alivePlayers();
        const sheriff = players.find(p => p.role === ROLE_SHERIFF);

        // Sheriff dead?
        if (sheriff && !sheriff.alive) {
            // Check if renegade is the only one alive
            if (alive.length === 1 && players[alive[0]].role === ROLE_RENEGADE) {
                endGame('배신자 승리!', ROLE_RENEGADE);
                return true;
            }
            // Outlaws win
            endGame('무법자 승리! 보안관 사망!', ROLE_OUTLAW);
            return true;
        }

        // All outlaws and renegade dead?
        const outlawsAlive = players.filter(p => p.alive && p.role === ROLE_OUTLAW).length;
        const renegadesAlive = players.filter(p => p.alive && p.role === ROLE_RENEGADE).length;
        if (outlawsAlive === 0 && renegadesAlive === 0) {
            endGame('보안관 팀 승리!', ROLE_SHERIFF);
            return true;
        }

        // Only one player alive (renegade scenario)
        if (alive.length === 1) {
            const lastRole = players[alive[0]].role;
            if (lastRole === ROLE_RENEGADE) {
                // Renegade must still face sheriff - but if sheriff is dead this was caught above
                endGame('배신자 승리!', ROLE_RENEGADE);
            } else {
                endGame(ROLE_LABELS[lastRole] + ' 승리!', lastRole);
            }
            return true;
        }

        return false;
    }

    function endGame(message, winningRole) {
        phase = 'game_over';
        gameOver = true;
        gameRunning = false;

        // Show all roles
        for (const p of players) {
            // roles already revealed through updateSeats dead check
        }
        updateAllDisplay();

        gameOverTitle.textContent = '게임 종료!';
        gameOverMsg.innerHTML = message + '<br><br>';
        // Show all roles
        for (const p of players) {
            const status = p.alive ? '생존' : '사망';
            gameOverMsg.innerHTML += `${escHtml(p.name)}: ${ROLE_LABELS[p.role]} (${status})<br>`;
        }
        gameOverOverlay.classList.add('active');
        actionBar.classList.add('hidden');

        if (isMultiplayer && socket) {
            socket.emit('game_over_event', { room_id: ROOM_ID, loser: '' });
        }
    }

    // ── Draw Check Display ──
    async function showDrawCheck(card, label) {
        if (!card) return;
        const suitColor = (card.suit === '♥' || card.suit === '♦') ? 'red' : '';
        drawCheckOverlay.innerHTML = `
            <div>${label}</div>
            <div class="draw-check-card ${suitColor}">
                <div>${card.rank}</div>
                <div style="font-size:1.5rem">${card.suit}</div>
            </div>
        `;
        drawCheckOverlay.classList.add('visible');
        await sleep(1200);
        drawCheckOverlay.classList.remove('visible');
    }

    function showTempResult(msg) {
        resultEl.textContent = msg;
        resultEl.classList.add('visible');
        setTimeout(() => resultEl.classList.remove('visible'), 1500);
    }

    // ── Turn Flow ──
    async function startTurn(playerIdx) {
        if (phase === 'game_over') return;
        if (!players[playerIdx].alive) {
            await advanceTurn();
            return;
        }

        currentPlayerIndex = playerIdx;
        bangPlayedThisTurn = false;
        discardMode = false;
        const p = players[playerIdx];

        centerInfo.textContent = p.name + '의 턴';
        roundInfo.textContent = p.name + '의 턴 — 카드 사용 중';

        // === Phase 1: Dynamite check ===
        if (p.hasDynamite) {
            const dynCard = p.equipment.find(c => c.key === 'DYNAMITE');
            const check = drawCheck();
            await showDrawCheck(check, '다이너마이트 판정');
            if (check && isSpadeRange2to9(check)) {
                // Explodes!
                addLog('다이너마이트 폭발! ' + p.name + ' 3 피해!');
                showTempResult('다이너마이트 폭발! 💥');
                // Remove dynamite
                const eqIdx = p.equipment.findIndex(c => c.key === 'DYNAMITE');
                if (eqIdx >= 0) {
                    addToDiscard(p.equipment.splice(eqIdx, 1)[0]);
                }
                p.hasDynamite = false;
                applyDamage(playerIdx, 3, -1);
                await checkAllEliminations(-1);
                if (checkWinCondition()) return;
                if (!p.alive) {
                    await advanceTurn();
                    return;
                }
            } else {
                // Pass dynamite to next alive player
                const eqIdx = p.equipment.findIndex(c => c.key === 'DYNAMITE');
                if (eqIdx >= 0) {
                    const dynCardObj = p.equipment.splice(eqIdx, 1)[0];
                    p.hasDynamite = false;
                    const nextAlive = getNextAlivePlayer(playerIdx);
                    if (nextAlive >= 0) {
                        players[nextAlive].equipment.push(dynCardObj);
                        players[nextAlive].hasDynamite = true;
                        addLog('다이너마이트가 ' + players[nextAlive].name + '에게 전달');
                    }
                }
            }
        }

        // === Phase 2: Jail check ===
        if (p.jailed) {
            const jailCard = p.equipment.find(c => c.key === 'JAIL');
            const check = drawCheck();
            await showDrawCheck(check, '감옥 탈출 판정');
            // Remove jail equipment
            const eqIdx = p.equipment.findIndex(c => c.key === 'JAIL');
            if (eqIdx >= 0) addToDiscard(p.equipment.splice(eqIdx, 1)[0]);
            p.jailed = false;

            if (check && isHeart(check)) {
                addLog(p.name + '이(가) 감옥에서 탈출!');
                showTempResult(p.name + ' 감옥 탈출!');
            } else {
                addLog(p.name + '이(가) 감옥에서 턴 스킵');
                showTempResult(p.name + ' 턴 스킵 (감옥)');
                await sleep(800);
                await advanceTurn();
                return;
            }
        }

        // === Phase 3: Draw 2 cards ===
        for (let i = 0; i < 2; i++) {
            const c = drawCard();
            if (c) p.hand.push(c);
        }
        addLog(p.name + '이(가) 카드 2장 획득');

        updateAllDisplay();
        broadcastState();

        // === Phase 4: Play cards ===
        phase = 'playing';

        if (p.isAI) {
            await aiPlayTurn(playerIdx);
        } else if (playerIdx === myIndex && !isSpectator) {
            // Human turn - wait for actions
            showActionBar();
            updateMyHand();
        } else if (isMultiplayer && !p.isAI) {
            // Remote player - wait for their moves
            roundInfo.textContent = p.name + '의 턴 대기 중...';
            // The host will receive their actions via socket
        }
    }

    function showActionBar() {
        restoreActionBar();
        actionBar.classList.remove('hidden');
        // Check if discard is needed
        const p = players[myIndex];
        const discardBtn = document.getElementById('btn-discard-mode');
        if (discardBtn) {
            discardBtn.style.display = p.hand.length > p.hp ? '' : 'none';
        }
    }

    function onEndTurn() {
        if (currentPlayerIndex !== myIndex) return;
        const p = players[myIndex];

        // Must discard down to HP
        if (p.hand.length > p.hp) {
            discardMode = true;
            centerInfo.textContent = '카드를 버려야 합니다 (' + p.hand.length + '/' + p.hp + ')';
            roundInfo.textContent = 'HP보다 많은 카드를 버리세요';
            updateMyHand();
            return;
        }

        finishTurn();
    }

    function onDiscardMode() {
        discardMode = true;
        centerInfo.textContent = '버릴 카드를 선택하세요';
        updateMyHand();
    }

    function checkDiscardDone() {
        const p = players[myIndex];
        if (p.hand.length <= p.hp) {
            discardMode = false;
            finishTurn();
        } else {
            centerInfo.textContent = '카드를 버려야 합니다 (' + p.hand.length + '/' + p.hp + ')';
        }
    }

    async function finishTurn() {
        phase = 'idle';
        actionBar.classList.add('hidden');
        hideTargeting();
        discardMode = false;
        broadcastState();
        await advanceTurn();
    }

    function getNextAlivePlayer(fromIdx) {
        for (let i = 1; i < NUM_PLAYERS; i++) {
            const idx = (fromIdx + i) % NUM_PLAYERS;
            if (players[idx].alive) return idx;
        }
        return -1;
    }

    async function advanceTurn() {
        if (checkWinCondition()) return;
        const next = getNextAlivePlayer(currentPlayerIndex);
        if (next < 0) {
            checkWinCondition();
            return;
        }
        await sleep(500);
        await startTurn(next);
    }

    // ── AI Turn ──
    async function aiPlayTurn(playerIdx) {
        const p = players[playerIdx];
        if (!p.alive || !p.isAI) return;

        await sleep(600);

        // AI strategy based on role
        const playable = p.hand.map((c, i) => ({ card: c, idx: i }))
            .filter(x => canPlayCard(playerIdx, x.card));

        // Play equipment first
        for (const { card, idx } of [...playable]) {
            if (['BARREL', 'MUSTANG', 'SCOPE', 'DYNAMITE'].includes(card.key)) {
                if (canPlayCard(playerIdx, card)) {
                    await playCard(playerIdx, p.hand.indexOf(card), -1);
                    await sleep(400);
                    if (checkWinCondition()) return;
                }
            }
        }

        // Play draw cards
        for (const key of ['WELLS_FARGO', 'STAGECOACH', 'GENERAL_STORE']) {
            const idx = p.hand.findIndex(c => c.key === key);
            if (idx >= 0 && canPlayCard(playerIdx, p.hand[idx])) {
                await playCard(playerIdx, idx, -1);
                await sleep(400);
                if (checkWinCondition()) return;
            }
        }

        // Play Beer if hurt
        if (p.hp < p.maxHp) {
            const beerIdx = p.hand.findIndex(c => c.key === 'BEER');
            if (beerIdx >= 0 && canPlayCard(playerIdx, p.hand[beerIdx])) {
                await playCard(playerIdx, beerIdx, -1);
                await sleep(400);
            }
        }

        // Play Jail on threats
        const jailIdx = p.hand.findIndex(c => c.key === 'JAIL');
        if (jailIdx >= 0) {
            const targets = getValidJailTargets(playerIdx);
            const target = aiPickTarget(playerIdx, targets, 'JAIL');
            if (target >= 0) {
                await playCard(playerIdx, jailIdx, target);
                await sleep(400);
                if (checkWinCondition()) return;
            }
        }

        // Play BANG on enemy
        if (!bangPlayedThisTurn) {
            const bangIdx = p.hand.findIndex(c => c.key === 'BANG');
            if (bangIdx >= 0 && canPlayCard(playerIdx, p.hand[bangIdx])) {
                const targets = getValidBangTargets(playerIdx);
                const target = aiPickTarget(playerIdx, targets, 'BANG');
                if (target >= 0) {
                    await playCard(playerIdx, bangIdx, target);
                    await sleep(400);
                    if (checkWinCondition()) return;
                }
            }
        }

        // Play action cards
        for (const key of ['INDIANS', 'GATLING']) {
            const idx = p.hand.findIndex(c => c.key === key);
            if (idx >= 0 && canPlayCard(playerIdx, p.hand[idx])) {
                await playCard(playerIdx, idx, -1);
                await sleep(400);
                if (checkWinCondition()) return;
            }
        }

        // Play Duel
        const duelIdx = p.hand.findIndex(c => c.key === 'DUEL');
        if (duelIdx >= 0 && canPlayCard(playerIdx, p.hand[duelIdx])) {
            const targets = alivePlayers().filter(i => i !== playerIdx);
            const target = aiPickTarget(playerIdx, targets, 'DUEL');
            if (target >= 0) {
                await playCard(playerIdx, duelIdx, target);
                await sleep(400);
                if (checkWinCondition()) return;
            }
        }

        // Panic / Cat Balou
        for (const key of ['PANIC', 'CAT_BALOU']) {
            const idx = p.hand.findIndex(c => c.key === key);
            if (idx >= 0 && canPlayCard(playerIdx, p.hand[idx])) {
                const targets = key === 'PANIC' ? getValidPanicTargets(playerIdx) : getValidCatBalouTargets(playerIdx);
                const target = aiPickTarget(playerIdx, targets, key);
                if (target >= 0) {
                    await playCard(playerIdx, idx, target);
                    await sleep(400);
                    if (checkWinCondition()) return;
                }
            }
        }

        // Discard down to HP
        while (p.hand.length > p.hp) {
            // Discard least useful card
            const worstIdx = aiPickDiscardCard(playerIdx);
            const card = p.hand.splice(worstIdx, 1)[0];
            addToDiscard(card);
        }

        updateAllDisplay();
        broadcastState();
        await sleep(300);

        if (!checkWinCondition()) {
            await advanceTurn();
        }
    }

    function aiPickTarget(playerIdx, validTargets, cardKey) {
        if (validTargets.length === 0) return -1;

        const p = players[playerIdx];
        const role = p.role;

        // Determine enemies and allies based on role
        let enemies = [];
        let allies = [];

        switch (role) {
            case ROLE_SHERIFF:
            case ROLE_DEPUTY:
                // Attack non-sheriff players (can't know who is who, but attack suspicious ones)
                enemies = validTargets.filter(i => players[i].role !== ROLE_SHERIFF && players[i].role !== ROLE_DEPUTY);
                allies = validTargets.filter(i => players[i].role === ROLE_SHERIFF || players[i].role === ROLE_DEPUTY);
                break;
            case ROLE_OUTLAW:
                // Priority: sheriff
                enemies = validTargets.filter(i => players[i].role === ROLE_SHERIFF);
                if (enemies.length === 0) enemies = validTargets.filter(i => players[i].role !== ROLE_OUTLAW);
                allies = validTargets.filter(i => players[i].role === ROLE_OUTLAW);
                break;
            case ROLE_RENEGADE:
                // Attack outlaws first, then deputies, then sheriff last
                const outlaws = validTargets.filter(i => players[i].role === ROLE_OUTLAW);
                if (outlaws.length > 0) enemies = outlaws;
                else {
                    const deps = validTargets.filter(i => players[i].role === ROLE_DEPUTY);
                    if (deps.length > 0) enemies = deps;
                    else enemies = validTargets.filter(i => players[i].role === ROLE_SHERIFF);
                }
                break;
        }

        // Filter out allies for attack cards
        if (['BANG', 'DUEL', 'JAIL', 'CAT_BALOU'].includes(cardKey)) {
            const targetList = enemies.length > 0 ? enemies : validTargets.filter(i => !allies.includes(i));
            if (targetList.length > 0) {
                // Pick lowest HP target
                targetList.sort((a, b) => players[a].hp - players[b].hp);
                return targetList[0];
            }
        }

        // For Panic, steal from enemies
        if (cardKey === 'PANIC') {
            const targetList = enemies.length > 0 ? enemies : validTargets;
            return targetList[Math.floor(Math.random() * targetList.length)];
        }

        return validTargets[Math.floor(Math.random() * validTargets.length)];
    }

    function aiPickDiscardCard(playerIdx) {
        const p = players[playerIdx];
        // Priority to keep: MISSED > BANG > BEER > equipment > others
        const keepPriority = { 'MISSED': 5, 'BANG': 4, 'BEER': 3, 'BARREL': 2, 'MUSTANG': 2, 'SCOPE': 2 };
        let worstIdx = 0;
        let worstScore = Infinity;
        for (let i = 0; i < p.hand.length; i++) {
            const score = keepPriority[p.hand[i].key] || 1;
            if (score < worstScore) {
                worstScore = score;
                worstIdx = i;
            }
        }
        return worstIdx;
    }

    // ── Game Start ──
    async function startGame() {
        if (gameRunning) return;
        if (isMultiplayer && !gameReady && !isSpectator) return;

        gameRunning = true;
        gameOver = false;
        phase = 'idle';

        // Clamp NUM_PLAYERS
        if (NUM_PLAYERS < 4) NUM_PLAYERS = 4;
        if (NUM_PLAYERS > 7) NUM_PLAYERS = 7;

        // Ensure we have enough player names
        while (PLAYER_NAMES.length < NUM_PLAYERS) {
            PLAYER_NAMES.push(AI_NAMES[PLAYER_NAMES.length - 1] || 'AI_' + PLAYER_NAMES.length);
        }
        if (PLAYER_NAMES.length > NUM_PLAYERS) {
            PLAYER_NAMES.length = NUM_PLAYERS;
        }

        deck = createDeck();
        discardPile = [];
        initPlayers();
        assignRoles();
        createSeats();
        dealCards();

        updateAllDisplay();

        startBtn.style.display = 'none';
        gameOverOverlay.classList.remove('active');

        // Find sheriff to start
        const sheriffIdx = players.findIndex(p => p.role === ROLE_SHERIFF);
        addLog('게임 시작! 보안관: ' + players[sheriffIdx].name);
        centerInfo.textContent = '게임 시작!';
        roundInfo.textContent = '보안관 ' + players[sheriffIdx].name + '부터 시작';

        broadcastState();
        await sleep(1000);

        await startTurn(sheriffIdx);
    }

    // ── Event Listeners ──
    startBtn.addEventListener('click', () => {
        if (isHost || !isMultiplayer) startGame();
    });

    restartBtn.addEventListener('click', () => {
        gameOverOverlay.classList.remove('active');
        gameOver = false;
        gameRunning = false;
        startGame();
    });

    btnEndTurn.addEventListener('click', onEndTurn);
    btnDiscardMode.addEventListener('click', onDiscardMode);

    // Cancel targeting with Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideTargeting();
            if (discardMode) {
                discardMode = false;
                updateMyHand();
            }
        }
    });

    // ── Logging ──
    const actionLog = [];
    function addLog(msg) {
        actionLog.push(msg);
        roundInfo.textContent = msg;
        if (actionLog.length > 100) actionLog.shift();
    }

    // ── State Sync (Multiplayer) ──
    function buildStateSnapshot() {
        return {
            players: players.map(p => ({
                index: p.index,
                name: p.name,
                role: p.role,
                hp: p.hp,
                maxHp: p.maxHp,
                hand: p.hand,
                equipment: p.equipment,
                alive: p.alive,
                isAI: p.isAI,
                jailed: p.jailed,
                hasDynamite: p.hasDynamite
            })),
            deck: deck,
            discardPile: discardPile,
            currentPlayerIndex: currentPlayerIndex,
            phase: phase,
            bangPlayedThisTurn: bangPlayedThisTurn,
            gameRunning: gameRunning,
            gameOver: gameOver
        };
    }

    function applyState(state) {
        if (!state) return;
        if (state.players) {
            for (let i = 0; i < state.players.length; i++) {
                if (i < players.length) {
                    Object.assign(players[i], state.players[i]);
                }
            }
        }
        if (state.deck) deck = state.deck;
        if (state.discardPile) discardPile = state.discardPile;
        if (state.currentPlayerIndex !== undefined) currentPlayerIndex = state.currentPlayerIndex;
        if (state.phase !== undefined) phase = state.phase;
        if (state.bangPlayedThisTurn !== undefined) bangPlayedThisTurn = state.bangPlayedThisTurn;
        if (state.gameRunning !== undefined) gameRunning = state.gameRunning;
        if (state.gameOver !== undefined) gameOver = state.gameOver;

        // Rebuild seats if needed
        if (state.players && state.players.length !== NUM_PLAYERS) {
            NUM_PLAYERS = state.players.length;
            createSeats();
        }

        updateAllDisplay();

        // If it's my turn and phase is playing, show action bar
        if (phase === 'playing' && currentPlayerIndex === myIndex && !isSpectator && !players[myIndex].isAI) {
            showActionBar();
        } else {
            actionBar.classList.add('hidden');
        }
    }

    function broadcastState() {
        if (!isMultiplayer || !socket || !isHost) return;
        const state = buildStateSnapshot();
        // Hide hands from other players
        const safeState = JSON.parse(JSON.stringify(state));
        // Actually, for simplicity in host-driven model, send full state
        // The host is trusted
        socket.emit('game_move', {
            room_id: ROOM_ID,
            type: 'state',
            data: safeState
        });
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

            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    applyState(data.data);
                }
            });

            startBtn.style.display = 'none';

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
                // Only host initializes game; non-host waits for state broadcast
                if (isHost && !gameRunning) {
                    startBtn.click();
                }
            });

            socket.on('opponent_move', (data) => {
                if (data.type === 'state' && data.data) {
                    if (!isHost) {
                        applyState(data.data);
                    }
                } else if (data.type === 'action' && data.data && isHost) {
                    // Host receives player actions
                    const action = data.data;
                    if (action.type === 'play_card') {
                        const pIdx = action.playerIndex;
                        if (pIdx === currentPlayerIndex && phase === 'playing') {
                            playCard(pIdx, action.handIndex, action.targetIdx);
                        }
                    } else if (action.type === 'end_turn') {
                        const pIdx = action.playerIndex;
                        if (pIdx === currentPlayerIndex) {
                            // Force discard if needed then advance
                            const p = players[pIdx];
                            while (p.hand.length > p.hp) {
                                const card = p.hand.pop();
                                addToDiscard(card);
                            }
                            advanceTurn();
                        }
                    } else if (action.type === 'discard') {
                        const pIdx = action.playerIndex;
                        if (pIdx >= 0 && pIdx < NUM_PLAYERS) {
                            const card = players[pIdx].hand.splice(action.handIndex, 1)[0];
                            if (card) addToDiscard(card);
                            updateAllDisplay();
                            broadcastState();
                        }
                    }
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
                x = Math.max(0, Math.min(window.innerWidth - 100, x));
                y = Math.max(0, Math.min(window.innerHeight - 50, y));
                chatBox.style.left = x + 'px';
                chatBox.style.top = y + 'px';
                chatBox.style.right = 'auto';
                chatBox.style.bottom = 'auto';
            });
            document.addEventListener('mouseup', () => {
                dragging = false;
                chatBox.style.transition = '';
            });
        }

        // Resize
        if (chatResize) {
            let resizing = false, startW = 0, startH = 0, startX = 0, startY = 0;
            chatResize.addEventListener('mousedown', (e) => {
                resizing = true;
                const rect = chatBox.getBoundingClientRect();
                startW = rect.width;
                startH = rect.height;
                startX = e.clientX;
                startY = e.clientY;
                e.preventDefault();
            });
            document.addEventListener('mousemove', (e) => {
                if (!resizing) return;
                const newW = Math.max(250, startW + (e.clientX - startX));
                const newH = Math.max(200, startH + (e.clientY - startY));
                chatBox.style.width = newW + 'px';
                chatBox.style.height = newH + 'px';
            });
            document.addEventListener('mouseup', () => { resizing = false; });
        }
    }

    // In multiplayer, hide start button until game_ready
    if (isMultiplayer && !gameReady && !isSpectator) {
        startBtn.style.display = 'none';
    }

})();
