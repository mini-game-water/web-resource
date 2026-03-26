/**
 * GameAnimations — Shared animation utilities for Game Hub.
 * CSS-based animations triggered via DOM manipulation.
 */
window.GameAnimations = (() => {
    const CONFETTI_COLORS = [
        '#ff6b6b', '#ffd93d', '#6bcb77', '#4d96ff',
        '#ff9ff3', '#ff6348', '#7bed9f', '#70a1ff',
        '#ffa502', '#2ed573', '#1e90ff', '#ff4757'
    ];

    function showConfetti(duration) {
        duration = duration || 3000;
        const container = document.createElement('div');
        container.className = 'confetti-container';
        document.body.appendChild(container);

        const count = 40;
        for (let i = 0; i < count; i++) {
            const piece = document.createElement('div');
            piece.className = 'confetti-piece';
            piece.style.left = Math.random() * 100 + '%';
            piece.style.backgroundColor = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
            piece.style.width = (6 + Math.random() * 8) + 'px';
            piece.style.height = (6 + Math.random() * 8) + 'px';
            piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
            piece.style.setProperty('--delay', (Math.random() * 0.8) + 's');
            piece.style.setProperty('--fall-dur', (2 + Math.random() * 1.5) + 's');
            piece.style.setProperty('--rot', (360 + Math.random() * 720) + 'deg');
            container.appendChild(piece);
        }

        setTimeout(() => container.remove(), duration + 500);
    }

    function showShake(element) {
        if (!element) return;
        element.classList.remove('game-shake');
        void element.offsetWidth; // force reflow
        element.classList.add('game-shake');
        element.addEventListener('animationend', () => {
            element.classList.remove('game-shake');
        }, { once: true });
    }

    function showFlash(element) {
        if (!element) return;
        const flash = document.createElement('div');
        flash.className = 'flash-overlay';
        const pos = getComputedStyle(element).position;
        if (pos === 'static') element.style.position = 'relative';
        element.appendChild(flash);
        flash.addEventListener('animationend', () => flash.remove(), { once: true });
    }

    function showRipple(element, x, y) {
        if (!element) return;
        const ripple = document.createElement('div');
        ripple.className = 'ripple-effect';
        const pos = getComputedStyle(element).position;
        if (pos === 'static') element.style.position = 'relative';
        const rect = element.getBoundingClientRect();
        ripple.style.left = (x - rect.left) + 'px';
        ripple.style.top = (y - rect.top) + 'px';
        element.appendChild(ripple);
        ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    }

    function showGlow(element) {
        if (!element) return;
        element.classList.remove('glow-pulse');
        void element.offsetWidth;
        element.classList.add('glow-pulse');
        element.addEventListener('animationend', () => {
            element.classList.remove('glow-pulse');
        }, { once: true });
    }

    function showSparkle(element, color) {
        if (!element) return;
        const pos = getComputedStyle(element).position;
        if (pos === 'static') element.style.position = 'relative';
        const count = 8;
        for (let i = 0; i < count; i++) {
            const s = document.createElement('div');
            s.className = 'sparkle-effect';
            s.style.backgroundColor = color || '#ffd700';
            s.style.left = '50%';
            s.style.top = '50%';
            const angle = (i / count) * Math.PI * 2;
            s.style.setProperty('--tx', Math.cos(angle) * 25 + 'px');
            s.style.setProperty('--ty', Math.sin(angle) * 25 + 'px');
            s.style.setProperty('--delay', (Math.random() * 0.1) + 's');
            element.appendChild(s);
            s.addEventListener('animationend', () => s.remove(), { once: true });
        }
    }

    function showDamage(element) {
        if (!element) return;
        element.classList.remove('damage-flash');
        void element.offsetWidth;
        element.classList.add('damage-flash');
        element.addEventListener('animationend', () => {
            element.classList.remove('damage-flash');
        }, { once: true });
    }

    function bounceIn(element) {
        if (!element) return;
        element.classList.remove('bounce-in');
        void element.offsetWidth;
        element.classList.add('bounce-in');
        element.addEventListener('animationend', () => {
            element.classList.remove('bounce-in');
        }, { once: true });
    }

    return {
        showConfetti,
        showShake,
        showFlash,
        showRipple,
        showGlow,
        showSparkle,
        showDamage,
        bounceIn
    };
})();
