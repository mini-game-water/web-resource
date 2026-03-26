/**
 * GameSounds — Web Audio API sound manager for Game Hub.
 * All sounds are generated programmatically (no external files).
 * Attach to window.GameSounds for use by game JS files.
 */
window.GameSounds = (() => {
    let ctx = null;
    let muted = localStorage.getItem('gamehub_muted') === 'true';
    let volume = 0.35;

    function ensureCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function gain(v, t) {
        const g = ensureCtx().createGain();
        g.gain.setValueAtTime(v * volume, t || ctx.currentTime);
        g.connect(ctx.destination);
        return g;
    }

    function osc(type, freq, g, start, dur) {
        const o = ensureCtx().createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, start);
        o.connect(g);
        o.start(start);
        o.stop(start + dur);
    }

    function noise(g, start, dur) {
        const c = ensureCtx();
        const len = c.sampleRate * dur;
        const buf = c.createBuffer(1, len, c.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(g);
        src.start(start);
        src.stop(start + dur);
    }

    const sounds = {
        click() {
            const t = ctx.currentTime;
            const g = gain(0.3, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
            noise(g, t, 0.06);
        },
        place() {
            const t = ctx.currentTime;
            const g = gain(0.4, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
            osc('sine', 600, g, t, 0.08);
            osc('sine', 800, g, t + 0.04, 0.11);
        },
        capture() {
            const t = ctx.currentTime;
            const g = gain(0.35, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
            osc('sine', 600, g, t, 0.12);
            osc('sine', 400, g, t + 0.1, 0.15);
        },
        flip() {
            const t = ctx.currentTime;
            const g = gain(0.25, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
            const o = ensureCtx().createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(300, t);
            o.frequency.exponentialRampToValueAtTime(1200, t + 0.08);
            o.connect(g);
            o.start(t);
            o.stop(t + 0.1);
        },
        roll() {
            const t = ctx.currentTime;
            for (let i = 0; i < 6; i++) {
                const g = gain(0.15, t + i * 0.05);
                g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.04);
                noise(g, t + i * 0.05, 0.04);
            }
        },
        bell() {
            const t = ctx.currentTime;
            const g = gain(0.4, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
            osc('sine', 2000, g, t, 0.6);
            osc('sine', 3000, g, t, 0.3);
        },
        win() {
            const t = ctx.currentTime;
            const notes = [523, 659, 784, 1047];
            notes.forEach((f, i) => {
                const g = gain(0.3, t + i * 0.12);
                g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.12 + 0.25);
                osc('sine', f, g, t + i * 0.12, 0.25);
            });
        },
        lose() {
            const t = ctx.currentTime;
            const notes = [400, 350, 300, 250];
            notes.forEach((f, i) => {
                const g = gain(0.25, t + i * 0.15);
                g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.15 + 0.3);
                osc('sine', f, g, t + i * 0.15, 0.3);
            });
        },
        check() {
            const t = ctx.currentTime;
            [0, 0.12].forEach(d => {
                const g = gain(0.35, t + d);
                g.gain.exponentialRampToValueAtTime(0.001, t + d + 0.08);
                osc('square', 880, g, t + d, 0.08);
            });
        },
        chip() {
            const t = ctx.currentTime;
            const g = gain(0.2, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
            osc('sine', 4000, g, t, 0.04);
            osc('sine', 5000, g, t + 0.04, 0.04);
            osc('sine', 6000, g, t + 0.08, 0.04);
        },
        buzz() {
            const t = ctx.currentTime;
            const g = gain(0.25, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
            osc('sawtooth', 150, g, t, 0.2);
        },
        tick() {
            const t = ctx.currentTime;
            const g = gain(0.2, t);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.03);
            osc('sine', 1000, g, t, 0.03);
        }
    };

    return {
        play(name) {
            if (muted) return;
            try {
                ensureCtx();
                if (sounds[name]) sounds[name]();
            } catch (e) { /* best-effort */ }
        },
        toggleMute() {
            muted = !muted;
            localStorage.setItem('gamehub_muted', muted);
            return muted;
        },
        isMuted() { return muted; },
        setVolume(v) { volume = Math.max(0, Math.min(1, v)); }
    };
})();
