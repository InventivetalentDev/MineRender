import { Caching } from "./cache/Caching";
import { Requests } from "./request/Requests";
import { Ticker } from "./Ticker";

/**
 * Releases every long-lived timer MineRender holds, so a Node process can exit.
 *
 * Both `@inventivetalent/loading-cache` (cache expiry) and `jobqu` (request queue draining) use
 * self-rescheduling timers that are not unref'd, which keeps the event loop alive for as long as
 * the library is loaded. Browsers don't care, but anything headless - a render server, a CLI, a
 * test run - has to call this when it's done.
 *
 * The library stays usable afterwards; the caches and queues simply start over.
 */
export function shutdown(): void {
    Ticker.dispose();
    Requests.end();
    Caching.end();
}
