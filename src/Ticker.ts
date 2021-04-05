import Timeout = NodeJS.Timeout;

export interface TickerFunction {
    (): void;
}

export class Ticker {

    private static counter: number = 0;
    private static readonly _tickers: Map<number, TickerFunction> = new Map<number, TickerFunction>();

    private static readonly interval: Timeout = setInterval(() => {
        Ticker._tickers.forEach(t => {
            try{
                t()
            }catch (e) {
                console.warn(e);
            }
        });
        Ticker.oneSecondTicks++;
        Ticker.fiveSecondTicks++;
    }, 1000 / 20);

    private static oneSecondTps = 0;
    private static oneSecondTicks = 0;
    private static oneSecondTicksTracker = setInterval(() => {
        Ticker.oneSecondTps = Ticker.oneSecondTicks;
        Ticker.oneSecondTicks = 0;
    }, 1000);

    private static fiveSecondTps = 0;
    private static fiveSecondTicks = 0;
    private static fiveSecondTicksTracker = setInterval(() => {
        Ticker.fiveSecondTps = Ticker.fiveSecondTicks / 5;
        Ticker.fiveSecondTicks = 0;
    }, 1000 * 5);

    public static add(tick: TickerFunction): number {
        const c = this.counter++;
        this._tickers.set(c, tick);
        return c;
    }

    public static remove(c?: number) {
        if (c) this._tickers.delete(c);
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
        clearInterval(this.interval);
        clearInterval(this.fiveSecondTicksTracker);
    }

}
