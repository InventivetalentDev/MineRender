// Virtual clock for deterministic frame capture. Injected by render-video.mjs before any page
// script runs (page.evaluateOnNewDocument), so three.js, MineRender's Ticker, and every timer in
// the page see this clock instead of the real one.
//
// Two modes:
//   realtime  Time flows with the real clock; timers and animation frames fire from a native pump.
//             Used while a shot loads its assets (request queues need their timers to fire).
//   stepped   Time only advances by __clock.step(ms). Each step fires the timers due in that
//             interval, then the pending animation-frame callbacks with the new timestamp.
(() => {
    const native = {
        now: performance.now.bind(performance),
        dateNow: Date.now.bind(Date),
        setInterval: window.setInterval.bind(window)
    };
    const epoch = native.dateNow();
    let mode = "realtime";
    let now = 0;
    let realBase = native.now();
    let nextId = 1;
    let lastFrame = 0;
    const timers = new Map();
    const frames = new Map();

    const currentNow = () => mode === "realtime" ? now + (native.now() - realBase) : now;

    performance.now = () => currentNow();
    Date.now = () => epoch + currentNow();

    window.setTimeout = (fn, delay = 0, ...args) => {
        const id = nextId++;
        timers.set(id, { at: currentNow() + Math.max(0, Number(delay) || 0), fn, args });
        return id;
    };
    window.setInterval = (fn, delay = 0, ...args) => {
        const id = nextId++;
        const interval = Math.max(1, Number(delay) || 0);
        timers.set(id, { at: currentNow() + interval, fn, args, interval });
        return id;
    };
    window.clearTimeout = window.clearInterval = id => { timers.delete(id); };
    window.requestAnimationFrame = callback => {
        const id = nextId++;
        frames.set(id, callback);
        return id;
    };
    window.cancelAnimationFrame = id => { frames.delete(id); };

    function runTimers(limit) {
        for (let guard = 0; guard < 100000; guard++) {
            let dueId;
            let due;
            for (const [id, timer] of timers) {
                if (timer.at <= limit && (!due || timer.at < due.at)) {
                    dueId = id;
                    due = timer;
                }
            }
            if (!due) return;
            if (due.interval) due.at += due.interval;
            else timers.delete(dueId);
            try {
                if (typeof due.fn === "function") due.fn(...due.args);
            } catch (error) {
                console.error(error);
            }
        }
    }

    function runFrames(timestamp) {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) {
            try {
                callback(timestamp);
            } catch (error) {
                console.error(error);
            }
        }
    }

    native.setInterval(() => {
        if (mode !== "realtime") return;
        const t = currentNow();
        runTimers(t);
        if (t - lastFrame >= 1000 / 60) {
            lastFrame = t;
            runFrames(t);
        }
    }, 4);

    window.__clock = {
        freeze() {
            if (mode !== "realtime") return;
            now = currentNow();
            mode = "stepped";
        },
        resume() {
            if (mode !== "stepped") return;
            realBase = native.now();
            mode = "realtime";
        },
        step(ms) {
            this.freeze();
            now += ms;
            runTimers(now);
            lastFrame = now;
            runFrames(now);
            return now;
        },
        now: currentNow,
        get mode() { return mode; }
    };
})();
