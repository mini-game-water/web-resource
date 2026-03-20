(() => {
    'use strict';

    // ── Constants ──
    const SUITS = ['♠', '♥', '♦', '♣'];
    const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];
    const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
    const HAND_NAMES = [
        '하이 카드', '원 페어', '투 페어', '쓰리 오브 어 카인드',
        '스트레이트', '플러시', '풀 하우스', '포 오브 어 카인드',
        '스트레이트 플러시', '로얄 플러시'
    ];
    const STARTING_CHIPS = 1000;
    const SMALL_BLIND = 10;
    const BIG_BLIND = 20;
    const PLAYER_NAMES = ['나', 'AI 딜러 1', 'AI 딜러 2', 'AI 딜러 3'];
    const NUM_PLAYERS = 4;

    // ── Game State ──
    let players = [];
    let deck = [];
    let communityCards = [];
    let pot = 0;
    let currentBets = [0, 0, 0, 0];
    let dealerIndex = 0;
    let currentPlayerIndex = 0;
    let phase = 'idle'; // idle, preflop, flop, turn, river, showdown
    let folded = [false, false, false, false];
    let allIn = [false, false, false, false];
    let roundBet = 0; // current highest bet in this betting round
    let lastRaiser = -1;
    let actedThisRound = [false, false, false, false];
    let gameRunning = false;
    let handInProgress = false;
    let sidePots = [];

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
        return card.suit === 1 || card.suit === 2; // hearts or diamonds
    }

    // ── 3D Card DOM Creation ──
    function createCardElement(card, faceUp, mini) {
        const el = document.createElement('div');
        el.className = 'card-3d' + (mini ? ' mini' : '');
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
        // Corner indicators
        const tl = document.createElement('div');
        tl.className = 'corner-tl';
        tl.innerHTML = `<span>${RANKS[card.rank]}</span><span>${SUITS[card.suit]}</span>`;
        front.appendChild(tl);
        const br = document.createElement('div');
        br.className = 'corner-br';
        br.innerHTML = `<span>${RANKS[card.rank]}</span><span>${SUITS[card.suit]}</span>`;
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

    function dealCardAnimated(container, card, faceUp, mini, delayMs, fromLeft) {
        return new Promise(resolve => {
            setTimeout(() => {
                const el = createCardElement(card, false, mini);
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
        potDisplay.textContent = '팟: ' + pot;
    }

    function updatePlayerInfo() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const info = document.getElementById('info-' + i);
            const chipsEl = document.getElementById('chips-' + i);
            const actionEl = document.getElementById('action-' + i);
            const betEl = document.getElementById('bet-' + i);
            const nameEl = document.getElementById('name-' + i);

            chipsEl.textContent = players[i].chips + ' 칩';

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
                betEl.textContent = '베팅: ' + currentBets[i];
            } else {
                betEl.textContent = '';
            }
        }
        updatePot();
    }

    function showPlayerAction(index, text) {
        const actionEl = document.getElementById('action-' + index);
        actionEl.textContent = text;
    }

    function clearActions() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            document.getElementById('action-' + i).textContent = '';
        }
    }

    function clearPlayerCards() {
        for (let i = 0; i < NUM_PLAYERS; i++) {
            document.getElementById('cards-' + i).innerHTML = '';
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
        if (currentPlayerIndex !== 0 || folded[0] || !handInProgress) {
            bettingControls.classList.add('hidden');
            return;
        }
        bettingControls.classList.remove('hidden');

        const toCall = roundBet - currentBets[0];
        if (toCall > 0) {
            btnCheck.textContent = '콜 (' + Math.min(toCall, players[0].chips) + ')';
        } else {
            btnCheck.textContent = '체크';
        }

        // Raise slider
        const minRaise = Math.max(BIG_BLIND, roundBet * 2 - currentBets[0]);
        const maxRaise = players[0].chips;
        if (maxRaise <= toCall) {
            // Can only go all-in or fold
            btnRaise.style.display = 'none';
            raiseSlider.style.display = 'none';
            raiseAmountEl.style.display = 'none';
            btnCheck.textContent = '올인 (' + players[0].chips + ')';
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
        // Returns { rank: 0-9, tiebreaker: [...], name: string }
        // cards = array of 5 {suit, rank}
        const ranks = cards.map(c => c.rank).sort((a, b) => b - a);
        const suits = cards.map(c => c.suit);
        const isFlush = suits.every(s => s === suits[0]);

        // Check straight
        let isStraight = false;
        let straightHigh = ranks[0];
        const unique = [...new Set(ranks)];
        if (unique.length === 5) {
            if (unique[0] - unique[4] === 4) {
                isStraight = true;
                straightHigh = unique[0];
            }
            // Ace-low straight (A-2-3-4-5)
            if (unique[0] === 12 && unique[1] === 3 && unique[2] === 2 && unique[3] === 1 && unique[4] === 0) {
                isStraight = true;
                straightHigh = 3; // 5-high
            }
        }

        // Count ranks
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
        // combos with first
        for (const c of combinations(rest, k - 1)) {
            result.push([first, ...c]);
        }
        // combos without first
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

    // ── AI Strategy ──
    function aiDecision(playerIndex) {
        const hole = players[playerIndex].hand;
        const toCall = roundBet - currentBets[playerIndex];
        const chips = players[playerIndex].chips;

        // Simple hand strength estimation
        let strength = estimateStrength(hole, communityCards);

        // Add some randomness
        strength += (Math.random() - 0.5) * 0.15;

        if (toCall === 0) {
            // Can check for free
            if (strength > 0.7 && chips > BIG_BLIND * 4) {
                const raiseAmt = Math.min(
                    Math.floor(pot * (0.5 + Math.random() * 0.5)),
                    chips
                );
                if (raiseAmt >= BIG_BLIND) {
                    return { action: 'raise', amount: raiseAmt };
                }
            }
            return { action: 'check' };
        }

        // Must call or fold
        const potOdds = toCall / (pot + toCall);
        if (strength < potOdds * 0.7 && strength < 0.25) {
            return { action: 'fold' };
        }
        if (strength > 0.75 && chips > toCall * 3) {
            const raiseAmt = Math.min(
                Math.floor(pot * (0.5 + Math.random())),
                chips
            );
            if (raiseAmt > toCall) {
                return { action: 'raise', amount: raiseAmt };
            }
        }
        return { action: 'call' };
    }

    function estimateStrength(hole, community) {
        if (community.length === 0) {
            return preflopStrength(hole);
        }
        const hand = bestHand(hole, community);
        // Map hand rank to a 0-1 strength
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
        // Premium hands
        if (pair && high >= 10) s = Math.max(s, 0.85); // JJ+
        if (high === 12 && low >= 10) s = Math.max(s, 0.8); // AK, AQ, AJ
        if (high === 12 && low >= 9 && suited) s = Math.max(s, 0.78); // A10s+

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

    async function executePlayerAction(action, amount) {
        const i = currentPlayerIndex;
        const toCall = roundBet - currentBets[i];

        if (action === 'fold') {
            folded[i] = true;
            showPlayerAction(i, '폴드');
        } else if (action === 'check') {
            if (toCall > 0) {
                // Actually a call
                placeBet(i, toCall);
                if (allIn[i]) {
                    showPlayerAction(i, '올인!');
                } else {
                    showPlayerAction(i, '콜 ' + toCall);
                }
            } else {
                showPlayerAction(i, '체크');
            }
        } else if (action === 'call') {
            placeBet(i, toCall);
            if (allIn[i]) {
                showPlayerAction(i, '올인!');
            } else {
                showPlayerAction(i, '콜 ' + toCall);
            }
        } else if (action === 'raise') {
            const totalBet = currentBets[i] + amount;
            placeBet(i, amount);
            roundBet = currentBets[i];
            lastRaiser = i;
            // Reset acted flags for others
            for (let j = 0; j < NUM_PLAYERS; j++) {
                if (j !== i) actedThisRound[j] = false;
            }
            if (allIn[i]) {
                showPlayerAction(i, '올인! (' + currentBets[i] + ')');
            } else {
                showPlayerAction(i, '레이즈 → ' + currentBets[i]);
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
        // Bets are already added to pot during placeBet
        currentBets = [0, 0, 0, 0];
    }

    // ── Deal & Game Flow ──
    function initPlayers() {
        players = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            players.push({
                name: PLAYER_NAMES[i],
                chips: STARTING_CHIPS,
                hand: [],
                isAI: i !== 0
            });
        }
    }

    async function startNewHand() {
        if (checkGameOver()) return;

        handInProgress = true;
        hideHandResult();
        clearActions();
        clearPlayerCards();
        clearCommunityCards();

        deck = shuffleDeck(createDeck());
        communityCards = [];
        pot = 0;
        currentBets = [0, 0, 0, 0];
        folded = [false, false, false, false];
        allIn = [false, false, false, false];
        roundBet = 0;
        lastRaiser = -1;
        actedThisRound = [false, false, false, false];

        // Mark eliminated players as folded
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (players[i].chips <= 0) {
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

        roundInfo.textContent = '프리플랍 - 카드를 배분 중...';
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
                const faceUp = (i === 0); // Only show player's cards
                const isLeft = (i === 2);
                for (let c = 0; c < 2; c++) {
                    await dealCardAnimated(container, players[i].hand[c], faceUp, true, c * 120, isLeft);
                }
            }
        }

        await sleep(300);

        // Preflop betting
        phase = 'preflop';
        // Preflop starts left of BB
        // BB has already acted (posted blind), but can still raise
        actedThisRound = [false, false, false, false];
        actedThisRound[sb] = true; // SB has acted
        // BB can still act
        currentPlayerIndex = nextActivePlayer(bb);
        if (currentPlayerIndex === -1) currentPlayerIndex = bb;

        roundInfo.textContent = '프리플랍 베팅';
        await bettingLoop();

        if (checkSingleWinner()) return;

        // Flop
        collectBetsIntoPot();
        resetBettingRound();
        phase = 'flop';
        roundInfo.textContent = '플랍';
        deck.pop(); // burn
        communityCards.push(deck.pop(), deck.pop(), deck.pop());
        await dealCommunityCards(0, 3);
        await sleep(400);

        currentPlayerIndex = nextActivePlayer(dealerIndex);
        if (currentPlayerIndex === -1) { await finishHand(); return; }
        actedThisRound = [false, false, false, false];
        roundInfo.textContent = '플랍 베팅';
        await bettingLoop();

        if (checkSingleWinner()) return;

        // Turn
        collectBetsIntoPot();
        resetBettingRound();
        phase = 'turn';
        roundInfo.textContent = '턴';
        deck.pop(); // burn
        communityCards.push(deck.pop());
        await dealCommunityCards(3, 1);
        await sleep(400);

        currentPlayerIndex = nextActivePlayer(dealerIndex);
        if (currentPlayerIndex === -1) { await finishHand(); return; }
        actedThisRound = [false, false, false, false];
        roundInfo.textContent = '턴 베팅';
        await bettingLoop();

        if (checkSingleWinner()) return;

        // River
        collectBetsIntoPot();
        resetBettingRound();
        phase = 'river';
        roundInfo.textContent = '리버';
        deck.pop(); // burn
        communityCards.push(deck.pop());
        await dealCommunityCards(4, 1);
        await sleep(400);

        currentPlayerIndex = nextActivePlayer(dealerIndex);
        if (currentPlayerIndex === -1) { await finishHand(); return; }
        actedThisRound = [false, false, false, false];
        roundInfo.textContent = '리버 베팅';
        await bettingLoop();

        // Showdown
        await finishHand();
    }

    async function dealCommunityCards(startIndex, count) {
        for (let i = 0; i < count; i++) {
            const card = communityCards[startIndex + i];
            await dealCardAnimated(communityCardsEl, card, true, false, i * 200, false);
        }
    }

    async function bettingLoop() {
        while (true) {
            if (activePlayers() <= 1) return;
            if (activeNonAllIn() === 0) return;
            if (bettingRoundComplete()) return;

            // Skip folded/all-in/eliminated players
            if (folded[currentPlayerIndex] || allIn[currentPlayerIndex] || players[currentPlayerIndex].chips <= 0) {
                actedThisRound[currentPlayerIndex] = true;
                currentPlayerIndex = nextActivePlayer(currentPlayerIndex);
                if (currentPlayerIndex === -1) return;
                continue;
            }

            updatePlayerInfo();
            updateBettingControls();

            if (currentPlayerIndex === 0) {
                // Human player
                await waitForPlayerAction();
            } else {
                // AI
                await sleep(600 + Math.random() * 800);
                const decision = aiDecision(currentPlayerIndex);
                if (decision.action === 'raise') {
                    const toCall = roundBet - currentBets[currentPlayerIndex];
                    await executePlayerAction('raise', toCall + decision.amount);
                } else {
                    await executePlayerAction(decision.action, 0);
                }
            }

            if (bettingRoundComplete()) return;

            currentPlayerIndex = nextActivePlayer(currentPlayerIndex);
            if (currentPlayerIndex === -1) return;
        }
    }

    function waitForPlayerAction() {
        return new Promise(resolve => {
            const handler = (action, amount) => {
                resolve();
                _playerActionResolve = null;
            };
            _playerActionResolve = handler;
        });
    }

    let _playerActionResolve = null;

    function checkSingleWinner() {
        const active = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i]) active.push(i);
        }
        if (active.length === 1) {
            collectBetsIntoPot();
            const winner = active[0];
            players[winner].chips += pot;
            showHandResult(players[winner].name + ' 승리! (+' + pot + ' 칩)');
            pot = 0;
            updatePlayerInfo();
            handInProgress = false;
            roundInfo.textContent = '핸드 종료 - 다음 핸드 준비 중...';

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
        roundInfo.textContent = '쇼다운!';
        bettingControls.classList.add('hidden');

        // Reveal all cards
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (!folded[i] && i !== 0) {
                const container = document.getElementById('cards-' + i);
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
            if (!folded[i]) {
                const best = bestHand(players[i].hand, communityCards);
                hands.push({ player: i, hand: best });
            }
        }

        // Sort by hand strength (descending)
        hands.sort((a, b) => compareHands(b.hand, a.hand));

        // Determine winner(s) - handle ties
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
        showHandResult(winnerNames + ' 승리! (' + handName + ') +' + pot + ' 칩');

        // Show hand name for each non-folded player
        for (const h of hands) {
            showPlayerAction(h.player, h.hand.name);
        }

        pot = 0;
        updatePlayerInfo();
        handInProgress = false;

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
        // Player is broke
        if (players[0].chips <= 0) {
            showGameOver('패배!', '칩을 모두 잃었습니다.');
            return true;
        }
        // Count remaining players
        let alive = 0;
        for (let i = 0; i < NUM_PLAYERS; i++) {
            if (players[i].chips > 0) alive++;
        }
        if (alive <= 1) {
            if (players[0].chips > 0) {
                showGameOver('승리!', '모든 AI를 이겼습니다! 최종 칩: ' + players[0].chips);
            } else {
                showGameOver('패배!', '칩을 모두 잃었습니다.');
            }
            return true;
        }
        return false;
    }

    function showGameOver(title, msg) {
        gameOverTitle.textContent = title;
        gameOverMsg.textContent = msg;
        overlay.style.display = 'flex';
        gameRunning = false;
        handInProgress = false;
        bettingControls.classList.add('hidden');
    }

    // ── Event Handlers ──
    btnFold.addEventListener('click', async () => {
        if (_playerActionResolve && currentPlayerIndex === 0) {
            await executePlayerAction('fold', 0);
            _playerActionResolve();
        }
    });

    btnCheck.addEventListener('click', async () => {
        if (_playerActionResolve && currentPlayerIndex === 0) {
            const toCall = roundBet - currentBets[0];
            if (toCall > 0) {
                await executePlayerAction('call', 0);
            } else {
                await executePlayerAction('check', 0);
            }
            _playerActionResolve();
        }
    });

    btnRaise.addEventListener('click', async () => {
        if (_playerActionResolve && currentPlayerIndex === 0) {
            const raiseAmount = parseInt(raiseSlider.value);
            await executePlayerAction('raise', raiseAmount);
            _playerActionResolve();
        }
    });

    raiseSlider.addEventListener('input', () => {
        raiseAmountEl.textContent = raiseSlider.value;
    });

    startBtn.addEventListener('click', () => {
        if (gameRunning) return;
        gameRunning = true;
        overlay.style.display = 'none';
        startBtn.textContent = '진행 중...';
        startBtn.disabled = true;
        initPlayers();
        dealerIndex = Math.floor(Math.random() * NUM_PLAYERS);
        updatePlayerInfo();
        startNewHand();
    });

    restartBtn.addEventListener('click', () => {
        overlay.style.display = 'none';
        gameRunning = true;
        startBtn.textContent = '진행 중...';
        startBtn.disabled = true;
        hideHandResult();
        clearActions();
        clearPlayerCards();
        clearCommunityCards();
        initPlayers();
        dealerIndex = Math.floor(Math.random() * NUM_PLAYERS);
        updatePlayerInfo();
        startNewHand();
    });

    // ── Keyboard shortcut for quick actions ──
    document.addEventListener('keydown', (e) => {
        if (!_playerActionResolve || currentPlayerIndex !== 0) return;
        if (e.key === 'f' || e.key === 'F') btnFold.click();
        if (e.key === 'c' || e.key === 'C') btnCheck.click();
        if (e.key === 'r' || e.key === 'R') btnRaise.click();
    });

    // Init display
    initPlayers();
    updatePlayerInfo();
})();
