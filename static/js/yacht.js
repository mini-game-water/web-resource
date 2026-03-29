(() => {
    // ──────────────────── Constants ────────────────────
    const CATEGORIES = [
        { id: 'ones',    name: '1 (Ones)',           section: 'upper' },
        { id: 'twos',    name: '2 (Twos)',           section: 'upper' },
        { id: 'threes',  name: '3 (Threes)',         section: 'upper' },
        { id: 'fours',   name: '4 (Fours)',          section: 'upper' },
        { id: 'fives',   name: '5 (Fives)',          section: 'upper' },
        { id: 'sixes',   name: '6 (Sixes)',          section: 'upper' },
        { id: 'choice',  name: '초이스 (Choice)',     section: 'lower' },
        { id: 'fourKind',name: '포커 (4 of a Kind)',  section: 'lower' },
        { id: 'fullHouse',name:'풀하우스 (Full House)',section: 'lower' },
        { id: 'smallStr',name: '스몰 스트레이트 (S.Str)',section:'lower' },
        { id: 'largeStr',name: '라지 스트레이트 (L.Str)',section:'lower' },
        { id: 'yacht',   name: '요트 (Yacht)',        section: 'lower' },
    ];
    const TOTAL_TURNS = 12;
    const BONUS_THRESHOLD = 63;
    const BONUS_POINTS = 35;

    // ──────────────────── Multiplayer Detection ────────────────────
    const isMultiplayer = typeof ROOM_ID !== 'undefined' && ROOM_ID;
    const isSpectator = typeof IS_SPECTATOR !== 'undefined' && IS_SPECTATOR;
    let socket = null;
    let gameReady = !isMultiplayer || isSpectator;
    let gameOverFlag = false;

    // Multiplayer player list and turn tracking
    let players = []; // array of user IDs in turn order
    let currentTurnPlayerIdx = 0;
    let disconnectedPlayers = new Set();

    // ──────────────────── State ────────────────────
    let dice = [1, 1, 1, 1, 1];
    let held = [false, false, false, false, false];
    let rollsLeft = 3;
    let turn = 1; // solo mode turn counter
    let scores = {};       // solo: { catId: value }, multiplayer: { playerId: { catId: value } }
    let rolling = false;
    let hasRolled = false;  // has rolled at least once this turn

    // ──────────────────── DOM Refs ────────────────────
    const diceRow = document.getElementById('dice-row');
    const rollBtn = document.getElementById('roll-btn');
    const turnInfo = document.getElementById('turn-info');
    const scorecardBody = document.getElementById('scorecard-body');
    const overlay = document.getElementById('game-over-overlay');
    const finalScore = document.getElementById('final-score');
    const restartBtn = document.getElementById('restart-btn');
    const gameMessage = document.getElementById('game-message');

    // ──────────────────── Helpers ────────────────────
    function isMyTurn() {
        if (!isMultiplayer) return true;
        if (isSpectator) return false;
        return players[currentTurnPlayerIdx] === MY_USER;
    }

    function currentTurnPlayer() {
        return players[currentTurnPlayerIdx];
    }

    function getPlayerScores(playerId) {
        if (!isMultiplayer) return scores;
        if (!scores[playerId]) scores[playerId] = {};
        return scores[playerId];
    }

    function allCategoriesScoredForPlayer(playerId) {
        const ps = isMultiplayer ? (scores[playerId] || {}) : scores;
        return CATEGORIES.every(cat => cat.id in ps);
    }

    function calcTotal(playerScores) {
        const upperSum = CATEGORIES
            .filter(c => c.section === 'upper')
            .reduce((sum, c) => sum + (playerScores[c.id] || 0), 0);
        const bonus = upperSum >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
        const lowerSum = CATEGORIES
            .filter(c => c.section === 'lower')
            .reduce((sum, c) => sum + (playerScores[c.id] || 0), 0);
        return upperSum + bonus + lowerSum;
    }

    // ──────────────────── Dice Rendering ────────────────────
    function createPips(val) {
        let html = '';
        for (let i = 0; i < val; i++) {
            html += '<span class="pip"></span>';
        }
        return html;
    }

    function createDieFace(val, faceClass) {
        return `<div class="die-face ${faceClass} val-${val}">${createPips(val)}</div>`;
    }

    // Face arrangement: front=1, back=6, right=3, left=4, top=2, bottom=5
    // We rotate the cube to show the desired value
    const FACE_VALUES = {
        front: 1, back: 6, right: 3, left: 4, top: 2, bottom: 5
    };

    function getRotationForValue(val) {
        switch(val) {
            case 1: return 'rotateX(0deg) rotateY(0deg)';
            case 2: return 'rotateX(-90deg) rotateY(0deg)';
            case 3: return 'rotateX(0deg) rotateY(-90deg)';
            case 4: return 'rotateX(0deg) rotateY(90deg)';
            case 5: return 'rotateX(90deg) rotateY(0deg)';
            case 6: return 'rotateX(0deg) rotateY(180deg)';
            default: return 'rotateX(0deg) rotateY(0deg)';
        }
    }

    function buildDice() {
        diceRow.innerHTML = '';
        for (let i = 0; i < 5; i++) {
            const wrapper = document.createElement('div');
            wrapper.className = 'die-wrapper';

            const scene = document.createElement('div');
            scene.className = 'die-scene';
            scene.dataset.index = i;

            const cube = document.createElement('div');
            cube.className = 'die-cube';
            cube.innerHTML =
                createDieFace(FACE_VALUES.front, 'front') +
                createDieFace(FACE_VALUES.back, 'back') +
                createDieFace(FACE_VALUES.right, 'right') +
                createDieFace(FACE_VALUES.left, 'left') +
                createDieFace(FACE_VALUES.top, 'top') +
                createDieFace(FACE_VALUES.bottom, 'bottom');
            cube.style.transform = getRotationForValue(dice[i]);

            scene.appendChild(cube);

            const shadow = document.createElement('div');
            shadow.className = 'die-shadow';

            const holdBtn = document.createElement('button');
            holdBtn.className = 'hold-btn';
            holdBtn.textContent = '홀드';
            holdBtn.dataset.index = i;
            holdBtn.addEventListener('click', () => toggleHold(i));

            scene.addEventListener('click', () => toggleHold(i));

            wrapper.appendChild(scene);
            wrapper.appendChild(shadow);
            wrapper.appendChild(holdBtn);
            diceRow.appendChild(wrapper);
        }
    }

    function updateDiceDisplay() {
        const scenes = diceRow.querySelectorAll('.die-scene');
        const holdBtns = diceRow.querySelectorAll('.hold-btn');
        scenes.forEach((scene, i) => {
            const cube = scene.querySelector('.die-cube');
            cube.style.transform = getRotationForValue(dice[i]);
            scene.classList.toggle('held', held[i]);
            holdBtns[i].classList.toggle('active', held[i]);
        });
    }

    // ──────────────────── 3D Roll Animation ────────────────────
    function animateRoll(callback) {
        rolling = true;
        const scenes = diceRow.querySelectorAll('.die-scene');
        const shadows = diceRow.querySelectorAll('.die-shadow');
        const cubes = diceRow.querySelectorAll('.die-cube');
        let completed = 0;
        const toAnimate = [];

        scenes.forEach((scene, i) => {
            if (held[i]) {
                completed++;
                return;
            }
            toAnimate.push(i);
        });

        if (toAnimate.length === 0) {
            rolling = false;
            callback();
            return;
        }

        // Generate new values only in solo mode or if we're the rolling player
        // In multiplayer, dice values come from the broadcast for non-rolling players
        if (!isMultiplayer || isMyTurn()) {
            toAnimate.forEach(i => {
                dice[i] = Math.floor(Math.random() * 6) + 1;
            });
        }

        // Animate each die with slight delay variation
        toAnimate.forEach((i, idx) => {
            const cube = cubes[i];
            const shadow = shadows[i];
            cube.classList.add('rolling');
            shadow.classList.add('rolling');

            const delay = idx * 60;
            const duration = 800 + Math.random() * 400;
            const startTime = performance.now() + delay;
            const targetRotation = getRotationForValue(dice[i]);

            // Random spin parameters for each die
            const spinX = (3 + Math.floor(Math.random() * 4)) * 360 * (Math.random() > 0.5 ? 1 : -1);
            const spinY = (3 + Math.floor(Math.random() * 4)) * 360 * (Math.random() > 0.5 ? 1 : -1);
            const spinZ = (1 + Math.floor(Math.random() * 2)) * 360 * (Math.random() > 0.5 ? 1 : -1);

            // Parse target angles
            const targetMatch = targetRotation.match(/rotateX\((-?\d+)deg\)\s*rotateY\((-?\d+)deg\)/);
            const targetX = parseInt(targetMatch[1]);
            const targetY = parseInt(targetMatch[2]);

            function animate(now) {
                const elapsed = now - startTime;
                if (elapsed < 0) {
                    requestAnimationFrame(animate);
                    return;
                }
                const progress = Math.min(elapsed / duration, 1);
                // Ease out cubic
                const ease = 1 - Math.pow(1 - progress, 3);

                const rx = spinX * (1 - ease) + targetX;
                const ry = spinY * (1 - ease) + targetY;
                const rz = spinZ * (1 - ease);
                cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;

                if (progress < 1) {
                    requestAnimationFrame(animate);
                } else {
                    cube.style.transform = targetRotation;
                    cube.classList.remove('rolling');
                    shadow.classList.remove('rolling');
                    completed++;
                    if (completed === 5) {
                        rolling = false;
                        callback();
                    }
                }
            }
            requestAnimationFrame(animate);
        });

        // Count held dice as completed
        // (already incremented above)
        if (completed === 5) {
            rolling = false;
            callback();
        }
    }

    // ──────────────────── Hold Logic ────────────────────
    function toggleHold(i) {
        if (rolling || !hasRolled || rollsLeft === 0 && !hasRolled) return;
        if (!hasRolled) return;
        if (isMultiplayer && !isMyTurn()) return;
        if (isSpectator) return;

        held[i] = !held[i];
        if (typeof GameSounds !== 'undefined') GameSounds.play('click');
        updateDiceDisplay();

        if (isMultiplayer && socket) {
            socket.emit('game_move', {
                room_id: ROOM_ID,
                type: 'hold',
                data: { held: [...held] }
            });
        }
    }

    // ──────────────────── Score Calculation ────────────────────
    function countDice(diceArr) {
        const counts = [0, 0, 0, 0, 0, 0]; // index 0-5 for values 1-6
        diceArr.forEach(v => counts[v - 1]++);
        return counts;
    }

    function sumAll(diceArr) {
        return diceArr.reduce((a, b) => a + b, 0);
    }

    function calcScore(catId, diceArr) {
        const counts = countDice(diceArr);
        const total = sumAll(diceArr);
        const sorted = [...diceArr].sort();
        const unique = [...new Set(sorted)];

        switch(catId) {
            case 'ones':   return counts[0] * 1;
            case 'twos':   return counts[1] * 2;
            case 'threes': return counts[2] * 3;
            case 'fours':  return counts[3] * 4;
            case 'fives':  return counts[4] * 5;
            case 'sixes':  return counts[5] * 6;
            case 'choice': return total;
            case 'fourKind':
                return counts.some(c => c >= 4) ? total : 0;
            case 'fullHouse':
                return (counts.includes(3) && counts.includes(2)) ? 25 : 0;
            case 'smallStr': {
                // 4 consecutive: check all possible runs
                const u = unique.map(Number);
                const straights = [[1,2,3,4],[2,3,4,5],[3,4,5,6]];
                return straights.some(s => s.every(v => u.includes(v))) ? 15 : 0;
            }
            case 'largeStr': {
                const u = unique.map(Number);
                const straights = [[1,2,3,4,5],[2,3,4,5,6]];
                return straights.some(s => s.every(v => u.includes(v))) ? 30 : 0;
            }
            case 'yacht':
                return counts.some(c => c === 5) ? 50 : 0;
            default: return 0;
        }
    }

    // ──────────────────── Scorecard ────────────────────
    function buildScorecard() {
        scorecardBody.innerHTML = '';

        if (isMultiplayer) {
            buildMultiplayerScorecard();
        } else {
            buildSoloScorecard();
        }
    }

    // --- Solo scorecard (original) ---
    function buildSoloScorecard() {
        addSectionRow('상단 (Upper)', 1);
        CATEGORIES.filter(c => c.section === 'upper').forEach(cat => {
            addCategoryRow(cat, 1);
        });
        addSubtotalRow('upper-subtotal', '상단 합계', 1);
        addBonusRow(1);

        addSectionRow('하단 (Lower)', 1);
        CATEGORIES.filter(c => c.section === 'lower').forEach(cat => {
            addCategoryRow(cat, 1);
        });
        addSubtotalRow('lower-subtotal', '하단 합계', 1);
        addTotalRow(1);
    }

    // --- Multiplayer scorecard ---
    function buildMultiplayerScorecard() {
        const numPlayers = players.length;

        // Header row with player names
        const headerTr = document.createElement('tr');
        headerTr.className = 'player-header-row';
        const emptyTh = document.createElement('th');
        emptyTh.className = 'cat-name';
        emptyTh.textContent = '';
        headerTr.appendChild(emptyTh);
        players.forEach((pid, idx) => {
            const th = document.createElement('th');
            th.className = 'player-col-header';
            th.textContent = pid;
            th.dataset.playerIdx = idx;
            if (idx === currentTurnPlayerIdx) th.classList.add('current-turn');
            headerTr.appendChild(th);
        });
        scorecardBody.appendChild(headerTr);

        // Upper section
        addSectionRow('상단 (Upper)', numPlayers);
        CATEGORIES.filter(c => c.section === 'upper').forEach(cat => {
            addMultiCategoryRow(cat);
        });
        addMultiSubtotalRow('upper-subtotal', '상단 합계');
        addMultiBonusRow();

        // Lower section
        addSectionRow('하단 (Lower)', numPlayers);
        CATEGORIES.filter(c => c.section === 'lower').forEach(cat => {
            addMultiCategoryRow(cat);
        });
        addMultiSubtotalRow('lower-subtotal', '하단 합계');
        addMultiTotalRow();
    }

    function addSectionRow(label, colCount) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="${colCount + 1}" class="section-header">${label}</td>`;
        scorecardBody.appendChild(tr);
    }

    // Solo category row
    function addCategoryRow(cat, colCount) {
        const tr = document.createElement('tr');
        tr.dataset.catId = cat.id;
        const tdName = document.createElement('td');
        tdName.className = 'cat-name';
        tdName.textContent = cat.name;
        const tdScore = document.createElement('td');
        tdScore.className = 'score-cell';
        tdScore.dataset.catId = cat.id;
        tdScore.addEventListener('click', () => selectCategory(cat.id));
        tr.appendChild(tdName);
        tr.appendChild(tdScore);
        scorecardBody.appendChild(tr);
    }

    // Multiplayer category row - one cell per player
    function addMultiCategoryRow(cat) {
        const tr = document.createElement('tr');
        tr.dataset.catId = cat.id;
        const tdName = document.createElement('td');
        tdName.className = 'cat-name';
        tdName.textContent = cat.name;
        tr.appendChild(tdName);

        players.forEach((pid, idx) => {
            const td = document.createElement('td');
            td.className = 'score-cell';
            td.dataset.catId = cat.id;
            td.dataset.playerId = pid;
            td.dataset.playerIdx = idx;
            // Only allow clicking on the current turn player's column (and only if it's me)
            td.addEventListener('click', () => {
                if (pid === currentTurnPlayer() && isMyTurn()) {
                    selectCategory(cat.id);
                }
            });
            tr.appendChild(td);
        });
        scorecardBody.appendChild(tr);
    }

    function addSubtotalRow(id, label, colCount) {
        const tr = document.createElement('tr');
        tr.className = 'subtotal-row';
        tr.id = id;
        tr.innerHTML = `<td class="cat-name">${label}</td><td>0</td>`;
        scorecardBody.appendChild(tr);
    }

    function addMultiSubtotalRow(id, label) {
        const tr = document.createElement('tr');
        tr.className = 'subtotal-row';
        tr.id = id;
        let html = `<td class="cat-name">${label}</td>`;
        players.forEach((pid, idx) => {
            html += `<td data-player-id="${pid}" data-player-idx="${idx}">0</td>`;
        });
        tr.innerHTML = html;
        scorecardBody.appendChild(tr);
    }

    function addBonusRow(colCount) {
        const tr = document.createElement('tr');
        tr.className = 'bonus-row';
        tr.id = 'bonus-row';
        tr.innerHTML = `<td class="cat-name">보너스 (+35, 63점 이상)</td><td>-</td>`;
        scorecardBody.appendChild(tr);
    }

    function addMultiBonusRow() {
        const tr = document.createElement('tr');
        tr.className = 'bonus-row';
        tr.id = 'bonus-row';
        let html = `<td class="cat-name">보너스 (+35, 63점 이상)</td>`;
        players.forEach((pid, idx) => {
            html += `<td data-player-id="${pid}" data-player-idx="${idx}">-</td>`;
        });
        tr.innerHTML = html;
        scorecardBody.appendChild(tr);
    }

    function addTotalRow(colCount) {
        const tr = document.createElement('tr');
        tr.className = 'total-row';
        tr.id = 'total-row';
        tr.innerHTML = `<td class="cat-name">총점</td><td>0</td>`;
        scorecardBody.appendChild(tr);
    }

    function addMultiTotalRow() {
        const tr = document.createElement('tr');
        tr.className = 'total-row';
        tr.id = 'total-row';
        let html = `<td class="cat-name">총점</td>`;
        players.forEach((pid, idx) => {
            html += `<td data-player-id="${pid}" data-player-idx="${idx}">0</td>`;
        });
        tr.innerHTML = html;
        scorecardBody.appendChild(tr);
    }

    function updateScorecard() {
        if (isMultiplayer) {
            updateMultiplayerScorecard();
        } else {
            updateSoloScorecard();
        }
    }

    function updateSoloScorecard() {
        CATEGORIES.forEach(cat => {
            const cell = scorecardBody.querySelector(`td[data-cat-id="${cat.id}"]`);
            if (!cell) return;

            if (cat.id in scores) {
                cell.textContent = scores[cat.id];
                cell.className = 'score-cell scored';
            } else if (hasRolled) {
                const potential = calcScore(cat.id, dice);
                cell.textContent = potential;
                cell.className = 'score-cell preview' + (potential === 0 ? ' zero-preview' : '');
            } else {
                cell.textContent = '';
                cell.className = 'score-cell';
            }
        });

        // Upper subtotal
        const upperSum = CATEGORIES
            .filter(c => c.section === 'upper' && c.id in scores)
            .reduce((sum, c) => sum + scores[c.id], 0);
        const upperSubEl = document.getElementById('upper-subtotal');
        if (upperSubEl) upperSubEl.querySelector('td:last-child').textContent = upperSum;

        // Bonus
        const bonus = upperSum >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
        const bonusEl = document.getElementById('bonus-row');
        if (bonusEl) {
            const allUpperScored = CATEGORIES.filter(c => c.section === 'upper').every(c => c.id in scores);
            if (allUpperScored) {
                bonusEl.querySelector('td:last-child').textContent = bonus;
            } else {
                bonusEl.querySelector('td:last-child').textContent = `${upperSum} / 63`;
            }
        }

        // Lower subtotal
        const lowerSum = CATEGORIES
            .filter(c => c.section === 'lower' && c.id in scores)
            .reduce((sum, c) => sum + scores[c.id], 0);
        const lowerSubEl = document.getElementById('lower-subtotal');
        if (lowerSubEl) lowerSubEl.querySelector('td:last-child').textContent = lowerSum;

        // Total
        const total = upperSum + bonus + lowerSum;
        const totalEl = document.getElementById('total-row');
        if (totalEl) totalEl.querySelector('td:last-child').textContent = total;
    }

    function updateMultiplayerScorecard() {
        // Highlight current turn player column header
        const headers = scorecardBody.querySelectorAll('.player-col-header');
        headers.forEach(h => {
            h.classList.toggle('current-turn', parseInt(h.dataset.playerIdx) === currentTurnPlayerIdx);
        });

        players.forEach((pid, pIdx) => {
            const ps = scores[pid] || {};

            CATEGORIES.forEach(cat => {
                const cell = scorecardBody.querySelector(`td[data-cat-id="${cat.id}"][data-player-id="${pid}"]`);
                if (!cell) return;

                if (cat.id in ps) {
                    cell.textContent = ps[cat.id];
                    cell.className = 'score-cell scored';
                } else if (hasRolled && pIdx === currentTurnPlayerIdx) {
                    // Show preview only for the current turn player
                    const potential = calcScore(cat.id, dice);
                    cell.textContent = potential;
                    cell.className = 'score-cell preview' + (potential === 0 ? ' zero-preview' : '');
                } else {
                    cell.textContent = '';
                    cell.className = 'score-cell';
                }

                // Add column highlighting
                if (pIdx === currentTurnPlayerIdx) {
                    cell.classList.add('active-col');
                } else {
                    cell.classList.remove('active-col');
                }
            });

            // Upper subtotal per player
            const upperSum = CATEGORIES
                .filter(c => c.section === 'upper' && c.id in ps)
                .reduce((sum, c) => sum + ps[c.id], 0);
            const upperSubEl = document.getElementById('upper-subtotal');
            if (upperSubEl) {
                const cell = upperSubEl.querySelector(`td[data-player-id="${pid}"]`);
                if (cell) cell.textContent = upperSum;
            }

            // Bonus per player
            const bonus = upperSum >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
            const bonusEl = document.getElementById('bonus-row');
            if (bonusEl) {
                const cell = bonusEl.querySelector(`td[data-player-id="${pid}"]`);
                if (cell) {
                    const allUpperScored = CATEGORIES.filter(c => c.section === 'upper').every(c => c.id in ps);
                    if (allUpperScored) {
                        cell.textContent = bonus;
                    } else {
                        cell.textContent = `${upperSum} / 63`;
                    }
                }
            }

            // Lower subtotal per player
            const lowerSum = CATEGORIES
                .filter(c => c.section === 'lower' && c.id in ps)
                .reduce((sum, c) => sum + ps[c.id], 0);
            const lowerSubEl = document.getElementById('lower-subtotal');
            if (lowerSubEl) {
                const cell = lowerSubEl.querySelector(`td[data-player-id="${pid}"]`);
                if (cell) cell.textContent = lowerSum;
            }

            // Total per player
            const total = upperSum + bonus + lowerSum;
            const totalEl = document.getElementById('total-row');
            if (totalEl) {
                const cell = totalEl.querySelector(`td[data-player-id="${pid}"]`);
                if (cell) cell.textContent = total;
            }
        });
    }

    // ──────────────────── Game Flow ────────────────────
    function rollDice() {
        if (rolling || rollsLeft <= 0) return;
        if (isMultiplayer && !isMyTurn()) return;
        if (isSpectator) return;
        if (gameOverFlag) return;

        rollsLeft--;
        rollBtn.disabled = true;
        if (typeof GameSounds !== 'undefined') GameSounds.play('roll');

        animateRoll(() => {
            hasRolled = true;
            updateRollButton();
            updateScorecard();
            if (rollsLeft === 0) {
                gameMessage.textContent = '카테고리를 선택하세요!';
            } else {
                gameMessage.textContent = '주사위를 홀드하거나 다시 굴리세요.';
            }

            // Broadcast roll in multiplayer
            if (isMultiplayer && socket) {
                socket.emit('game_move', {
                    room_id: ROOM_ID,
                    type: 'roll',
                    data: { dice: [...dice], held: [...held], rollsLeft: rollsLeft }
                });
            }
        });
    }

    function updateRollButton() {
        if (isMultiplayer && !isMyTurn()) {
            rollBtn.textContent = '상대 차례...';
            rollBtn.disabled = true;
            return;
        }
        if (rollsLeft > 0) {
            rollBtn.textContent = `주사위 굴리기 (${rollsLeft})`;
            rollBtn.disabled = rolling || gameOverFlag;
        } else {
            rollBtn.textContent = '남은 굴리기 없음';
            rollBtn.disabled = true;
        }
    }

    function selectCategory(catId) {
        if (rolling || !hasRolled) return;
        if (gameOverFlag) return;
        if (isSpectator) return;

        if (isMultiplayer) {
            if (!isMyTurn()) return;
            const pid = currentTurnPlayer();
            const ps = getPlayerScores(pid);
            if (catId in ps) return; // already scored

            const value = calcScore(catId, dice);
            ps[catId] = value;
            if (typeof GameSounds !== 'undefined') GameSounds.play('place');

            // Broadcast score
            if (socket) {
                socket.emit('game_move', {
                    room_id: ROOM_ID,
                    type: 'score',
                    data: { player: pid, category: catId, value: value }
                });
            }

            advanceTurn();
        } else {
            // Solo mode
            if (catId in scores) return;
            scores[catId] = calcScore(catId, dice);
            if (typeof GameSounds !== 'undefined') GameSounds.play('place');
            turn++;

            // Reset for next turn
            hasRolled = false;
            rollsLeft = 3;
            held = [false, false, false, false, false];
            updateDiceDisplay();
            updateScorecard();
            updateRollButton();

            if (turn > TOTAL_TURNS) {
                gameOver();
            } else {
                turnInfo.textContent = `턴: ${turn} / ${TOTAL_TURNS}`;
                gameMessage.textContent = '주사위를 굴리세요!';
            }
        }
    }

    function advanceTurn() {
        // Reset dice state for next turn
        hasRolled = false;
        rollsLeft = 3;
        held = [false, false, false, false, false];
        dice = [1, 1, 1, 1, 1];

        // Check if game is over (all players scored all categories)
        const activePlayers = players.filter(p => !disconnectedPlayers.has(p));
        const allDone = activePlayers.every(p => allCategoriesScoredForPlayer(p));
        if (allDone) {
            multiplayerGameOver();
            return;
        }

        // Move to next active player
        let attempts = 0;
        do {
            currentTurnPlayerIdx = (currentTurnPlayerIdx + 1) % players.length;
            attempts++;
            if (attempts > players.length) {
                // All disconnected or done, game over
                multiplayerGameOver();
                return;
            }
        } while (
            disconnectedPlayers.has(players[currentTurnPlayerIdx]) ||
            allCategoriesScoredForPlayer(players[currentTurnPlayerIdx])
        );

        updateDiceDisplay();
        updateScorecard();
        updateRollButton();
        updateTurnInfo();
    }

    function updateTurnInfo() {
        if (!isMultiplayer) return;
        const pid = currentTurnPlayer();
        const scoredCount = Object.keys(scores[pid] || {}).length;
        turnInfo.textContent = `${pid}의 차례 (${scoredCount + 1} / ${TOTAL_TURNS})`;
        if (isMyTurn()) {
            gameMessage.textContent = '주사위를 굴리세요!';
        } else if (isSpectator) {
            gameMessage.textContent = `${pid}의 차례를 관전 중...`;
        } else {
            gameMessage.textContent = `${pid}의 차례를 기다리는 중...`;
        }
    }

    function gameOver() {
        gameOverFlag = true;
        if (typeof GameSounds !== 'undefined') GameSounds.play('win');
        if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();
        const upperSum = CATEGORIES
            .filter(c => c.section === 'upper')
            .reduce((sum, c) => sum + (scores[c.id] || 0), 0);
        const bonus = upperSum >= BONUS_THRESHOLD ? BONUS_POINTS : 0;
        const lowerSum = CATEGORIES
            .filter(c => c.section === 'lower')
            .reduce((sum, c) => sum + (scores[c.id] || 0), 0);
        const total = upperSum + bonus + lowerSum;

        finalScore.textContent = total;
        overlay.classList.add('active');
        rollBtn.disabled = true;
        gameMessage.textContent = '게임 종료!';
    }

    function multiplayerGameOver() {
        gameOverFlag = true;
        rollBtn.disabled = true;
        gameMessage.textContent = '게임 종료!';

        // Calculate all players' totals
        const results = players.map(pid => {
            const ps = scores[pid] || {};
            return { player: pid, total: calcTotal(ps) };
        });
        results.sort((a, b) => b.total - a.total);

        const winner = results[0];
        if (typeof GameSounds !== 'undefined') {
            if (winner.player === MY_USER) GameSounds.play('win');
            else GameSounds.play('lose');
        }
        if (typeof GameAnimations !== 'undefined') { if (winner.player === MY_USER) GameAnimations.showConfetti(); else GameAnimations.showShake(document.body); }
        let html = `<div style="font-size:1.3em;margin-bottom:12px;">게임 종료!</div>`;
        html += `<div style="font-size:1.1em;margin-bottom:8px;">우승: <strong>${winner.player}</strong> (${winner.total}점)</div>`;
        html += `<div style="margin-top:8px;">`;
        results.forEach((r, i) => {
            const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';
            html += `<div>${medal} ${r.player}: ${r.total}점</div>`;
        });
        html += `</div>`;

        finalScore.innerHTML = html;
        overlay.classList.add('active');
    }

    function resetGame() {
        dice = [1, 1, 1, 1, 1];
        held = [false, false, false, false, false];
        rollsLeft = 3;
        turn = 1;
        hasRolled = false;
        rolling = false;
        gameOverFlag = false;
        currentTurnPlayerIdx = 0;
        disconnectedPlayers = new Set();

        if (isMultiplayer) {
            scores = {};
            players.forEach(p => scores[p] = {});
        } else {
            scores = {};
        }

        overlay.classList.remove('active');
        buildDice();
        updateDiceDisplay();
        buildScorecard();
        updateScorecard();
        updateRollButton();

        if (isMultiplayer) {
            updateTurnInfo();
        } else {
            turnInfo.textContent = `턴: 1 / ${TOTAL_TURNS}`;
            gameMessage.textContent = '주사위를 굴려 게임을 시작하세요!';
        }
    }

    // ──────────────────── Events ────────────────────
    rollBtn.addEventListener('click', rollDice);
    if (restartBtn) restartBtn.addEventListener('click', resetGame);

    // ──────────────────── Multiplayer ────────────────────
    if (isMultiplayer) {
        socket = io();
        players = typeof ROOM_PLAYERS !== 'undefined' ? [...ROOM_PLAYERS] : [];
        scores = {};
        players.forEach(p => scores[p] = {});

        socket.on('room_destroyed', () => {
            if (!gameOverFlag) window.location.href = '/';
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
            // Player
            socket.emit('join_game', { room_id: ROOM_ID, user_id: MY_USER });

            window.addEventListener('beforeunload', () => {
                if (!gameOverFlag && gameReady) {
                    socket.emit('game_over_event', { room_id: ROOM_ID, loser: MY_USER });
                }
            });

            socket.on('game_ready', () => {
                gameReady = true;
                const el = document.getElementById('mp-status');
                if (el) el.textContent = '게임 시작!';
                setTimeout(() => { if (el) el.style.display = 'none'; }, 1000);
                buildScorecard();
                updateScorecard();
                updateRollButton();
                updateTurnInfo();
            });
        }

        // Both player and spectator receive moves
        socket.on('opponent_move', (data) => {
            if (data.type === 'roll') {
                dice = data.data.dice;
                held = data.data.held;
                rollsLeft = data.data.rollsLeft;
                hasRolled = true;

                // Animate the dice display with the received values
                updateDiceDisplay();
                updateScorecard();
                updateRollButton();

                if (rollsLeft === 0) {
                    gameMessage.textContent = isSpectator
                        ? `${currentTurnPlayer()}가 카테고리를 선택 중...`
                        : '상대가 카테고리를 선택 중...';
                }
            } else if (data.type === 'hold') {
                held = data.data.held;
                updateDiceDisplay();
            } else if (data.type === 'score') {
                const pid = data.data.player;
                const catId = data.data.category;
                const value = data.data.value;
                if (!scores[pid]) scores[pid] = {};
                scores[pid][catId] = value;
                advanceTurn();
            }
        });

        function showVictoryByLeave() {
            if (gameOverFlag || isSpectator) return;
            gameOverFlag = true;
            rollBtn.disabled = true;
            if (typeof GameSounds !== 'undefined') GameSounds.play('win');
            if (typeof GameAnimations !== 'undefined') GameAnimations.showConfetti();

            const myTotal = calcTotal(scores[MY_USER] || {});
            finalScore.innerHTML = `<div style="font-size:1.3em;margin-bottom:8px;">승리!</div>`
                + `<div>상대방이 나갔습니다!</div>`
                + `<div style="margin-top:8px;">내 점수: ${myTotal}점</div>`;
            overlay.classList.add('active');
            gameMessage.textContent = '승리!';
        }

        socket.on('opponent_disconnected', (data) => {
            if (data && data.user_id) {
                disconnectedPlayers.add(data.user_id);
                // If it was the disconnected player's turn, advance
                if (players[currentTurnPlayerIdx] === data.user_id && !gameOverFlag) {
                    advanceTurn();
                }
                // If only one active player remains, they win
                const activePlayers = players.filter(p => !disconnectedPlayers.has(p));
                if (activePlayers.length <= 1) {
                    showVictoryByLeave();
                }
            } else {
                showVictoryByLeave();
            }
        });
        socket.on('opponent_game_over', showVictoryByLeave);
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

    // ──────────────────── Init ────────────────────
    if (isMultiplayer) {
        buildDice();
        buildScorecard();
        updateScorecard();
        updateRollButton();
        if (isSpectator || gameReady) {
            updateTurnInfo();
        } else {
            turnInfo.textContent = '대기 중...';
            gameMessage.textContent = '상대를 기다리는 중...';
            rollBtn.disabled = true;
        }
    } else {
        buildDice();
        buildScorecard();
        updateScorecard();
        updateRollButton();
    }
})();
