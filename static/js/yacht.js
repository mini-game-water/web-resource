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

    // ──────────────────── State ────────────────────
    let dice = [1, 1, 1, 1, 1];
    let held = [false, false, false, false, false];
    let rollsLeft = 3;
    let turn = 1;
    let scores = {};       // id -> number (scored)
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

        // Generate new values
        toAnimate.forEach(i => {
            dice[i] = Math.floor(Math.random() * 6) + 1;
        });

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
        // Can't hold if no rolls have been made yet or all rolls used up (still allow hold between rolls)
        if (!hasRolled) return;
        held[i] = !held[i];
        updateDiceDisplay();
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

        // Upper section header
        addSectionRow('상단 (Upper)');
        CATEGORIES.filter(c => c.section === 'upper').forEach(cat => {
            addCategoryRow(cat);
        });
        // Upper subtotal + bonus row
        addSubtotalRow('upper-subtotal', '상단 합계');
        addBonusRow();

        // Lower section header
        addSectionRow('하단 (Lower)');
        CATEGORIES.filter(c => c.section === 'lower').forEach(cat => {
            addCategoryRow(cat);
        });
        addSubtotalRow('lower-subtotal', '하단 합계');

        // Grand total
        addTotalRow();
    }

    function addSectionRow(label) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td colspan="2" class="section-header">${label}</td>`;
        scorecardBody.appendChild(tr);
    }

    function addCategoryRow(cat) {
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

    function addSubtotalRow(id, label) {
        const tr = document.createElement('tr');
        tr.className = 'subtotal-row';
        tr.id = id;
        tr.innerHTML = `<td class="cat-name">${label}</td><td>0</td>`;
        scorecardBody.appendChild(tr);
    }

    function addBonusRow() {
        const tr = document.createElement('tr');
        tr.className = 'bonus-row';
        tr.id = 'bonus-row';
        tr.innerHTML = `<td class="cat-name">보너스 (+35, 63점 이상)</td><td>-</td>`;
        scorecardBody.appendChild(tr);
    }

    function addTotalRow() {
        const tr = document.createElement('tr');
        tr.className = 'total-row';
        tr.id = 'total-row';
        tr.innerHTML = `<td class="cat-name">총점</td><td>0</td>`;
        scorecardBody.appendChild(tr);
    }

    function updateScorecard() {
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

    // ──────────────────── Game Flow ────────────────────
    function rollDice() {
        if (rolling || rollsLeft <= 0) return;
        rollsLeft--;
        rollBtn.disabled = true;

        animateRoll(() => {
            hasRolled = true;
            updateRollButton();
            updateScorecard();
            if (rollsLeft === 0) {
                gameMessage.textContent = '카테고리를 선택하세요!';
            } else {
                gameMessage.textContent = '주사위를 홀드하거나 다시 굴리세요.';
            }
        });
    }

    function updateRollButton() {
        if (rollsLeft > 0) {
            rollBtn.textContent = `주사위 굴리기 (${rollsLeft})`;
            rollBtn.disabled = rolling;
        } else {
            rollBtn.textContent = '남은 굴리기 없음';
            rollBtn.disabled = true;
        }
    }

    function selectCategory(catId) {
        if (rolling || !hasRolled) return;
        if (catId in scores) return; // already scored

        scores[catId] = calcScore(catId, dice);
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

    function gameOver() {
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

    function resetGame() {
        dice = [1, 1, 1, 1, 1];
        held = [false, false, false, false, false];
        rollsLeft = 3;
        turn = 1;
        scores = {};
        hasRolled = false;
        rolling = false;

        overlay.classList.remove('active');
        buildDice();
        updateDiceDisplay();
        buildScorecard();
        updateScorecard();
        updateRollButton();
        turnInfo.textContent = `턴: 1 / ${TOTAL_TURNS}`;
        gameMessage.textContent = '주사위를 굴려 게임을 시작하세요!';
    }

    // ──────────────────── Events ────────────────────
    rollBtn.addEventListener('click', rollDice);
    restartBtn.addEventListener('click', resetGame);

    // ──────────────────── Init ────────────────────
    buildDice();
    buildScorecard();
    updateScorecard();
    updateRollButton();
})();
