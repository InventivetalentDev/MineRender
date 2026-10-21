import test from "ava";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeEnv, PersistentCache, shutdown } from "../../dist/node/index.js";

// Match node-persist's default writeQueueIntervalMs.
const WRITE_QUEUE_INTERVAL_MS = 1000;

const cacheDirectory = mkdtempSync(join(tmpdir(), "minerender-node-cache-test-"));
class TestNodeEnv extends NodeEnv {
    openCache(name: string, version: number) {
        return super.openCache(join(cacheDirectory, name), version);
    }
}

test.after.always(() => {
    shutdown();
    rmSync(cacheDirectory, { recursive: true, force: true });
});

test("persistent puts resolve without waiting for the write queue interval", async t => {
    const cache = new TestNodeEnv().openCache("cache", PersistentCache.VERSION);
    const start = performance.now();
    await cache.put("first", 1);
    let writing = true;
    const second = cache.put("second", 2).finally(() => { writing = false; });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.true(writing, "the second put is still writing when the third starts");
    const third = cache.put("third", 3);
    await Promise.all([second, third]);
    const elapsed = performance.now() - start;
    t.true(elapsed < WRITE_QUEUE_INTERVAL_MS / 2, `three puts took ${elapsed.toFixed(1)} ms`);
    t.is(await cache.get("first"), 1);
    t.is(await cache.get("second"), 2);
    t.is(await cache.get("third"), 3);
});
