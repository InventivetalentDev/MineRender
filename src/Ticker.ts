export interface TickerFunction {
    (): void;
}

type IntervalHandle = ReturnType<typeof setInterval>;

/**
 * Shared 20-per-second tick loop, used for things like animated texture frames.
 *
 * The timers are started lazily by {@link Ticker.add} and unref'd where the platform supports it -
 * importing MineRender must never on its own keep a Node process alive.
 */
export class Ticker {

    public static readonly TPS = 20;

    private static counter: number = 0;
    private static readonly _tickers: Map<number, TickerFunction> = new Map<number, TickerFunction>();

    private static interval: IntervalHandle | undefined;
    private static oneSecondTicksTracker: IntervalHandle | undefined;
    private static fiveSecondTicksTracker: IntervalHandle | undefined;

    private static oneSecondTps = 0;
    private static oneSecondTicks = 0;

    private static fiveSecondTps = 0;
    private static fiveSecondTicks = 0;

    private static schedule(fn: () => void, ms: number): IntervalHandle {
        const handle = setInterval(fn, ms);
        // Node's Timeout keeps the event loop alive unless unref'd; browsers return a plain number
        const unref = (handle as { unref?: () => void }).unref;
        if (typeof unref === "function") {
            unref.call(handle);
        }
        return handle;
    }

    public static start(): void {
        if (this.interval) return;

        this.interval = this.schedule(() => {
            Ticker._tickers.forEach(t => {
                try {
                    t();
                } catch (e) {
                    console.warn(e);
                }
            });
            Ticker.oneSecondTicks++;
            Ticker.fiveSecondTicks++;
        }, 1000 / this.TPS);

        this.oneSecondTicksTracker = this.schedule(() => {
            Ticker.oneSecondTps = Ticker.oneSecondTicks;
            Ticker.oneSecondTicks = 0;
        }, 1000);

        this.fiveSecondTicksTracker = this.schedule(() => {
            Ticker.fiveSecondTps = Ticker.fiveSecondTicks / 5;
            Ticker.fiveSecondTicks = 0;
        }, 1000 * 5);
    }

    public static stop(): void {
        if (this.interval) clearInterval(this.interval);
        if (this.oneSecondTicksTracker) clearInterval(this.oneSecondTicksTracker);
        if (this.fiveSecondTicksTracker) clearInterval(this.fiveSecondTicksTracker);
        this.interval = undefined;
        this.oneSecondTicksTracker = undefined;
        this.fiveSecondTicksTracker = undefined;
    }

    public static add(tick: TickerFunction): number {
        this.start();
        const c = this.counter++;
        this._tickers.set(c, tick);
        return c;
    }

    public static remove(c?: number) {
        // note: plain `if (c)` used to drop id 0, i.e. the very first registered ticker
        if (typeof c === "number") this._tickers.delete(c);
    }

    public static get tickers(): Map<number, TickerFunction> {
        return this._tickers;
    }

    public static get tpsOneSecond() {
        return this.oneSecondTps;
    }

    public static get tpsFiveSeconds() {
        return this.fiveSecondTps;
    }

    public static dispose() {
        this.stop();
        this._tickers.clear();
    }

}
