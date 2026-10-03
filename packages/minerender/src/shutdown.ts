import { Caching } from "./cache/Caching";
import { Requests } from "./request/Requests";
import { Ticker } from "./Ticker";

/**
 * Stops the shared Ticker and request queues, and clears the in-memory caches.
 *
 * Idle Node processes can exit without calling this: cache and Ticker timers are unref'd,
 * and idle request queues hold no timer. Pending requests keep their normal timer references.
 *
 * Call this only when finished with MineRender. Queued, retrying, and future requests reject;
 * HTTP requests already running can finish. Queue shutdown is permanent, and cache expiry timers do not restart.
 */
export function shutdown(): void {
    Ticker.dispose();
    Requests.end();
    Caching.end();
}
