import test from "ava";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeCache, NodeEnv, PersistentCache, shutdown } from "../../dist/node/index.js";

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
    t.is(await cache.put("first", 1), 1);
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

test("overlapping same-key puts integrate with disk storage and reopening", async t => {
    const env = new TestNodeEnv();
    const cache = env.openCache("overlap", PersistentCache.VERSION);
    await cache.get("initialize");
    await Promise.all([
        cache.put("same", "a".repeat(2 * 1024 * 1024)),
        cache.put("same", "small-last")
    ]);
    const reopened = env.openCache("overlap", PersistentCache.VERSION);
    t.is(await reopened.get("same"), "small-last");
});

test("failed puts release queued and later writes without blocking other keys", async t => {
    const failure = new Error("Write failed");
    let rejectFirst!: (error: Error) => void;
    let firstStarted!: () => void;
    const started = new Promise<void>(resolve => { firstStarted = resolve; });
    const calls: string[] = [];
    const cache = new NodeCache({
        init: async () => {},
        setItem: async (key: string, value: string) => {
            calls.push(`${key}:${value}`);
            if (value === "first") {
                firstStarted();
                await new Promise<void>((_, reject) => { rejectFirst = reject; });
            }
            return { content: { key, value } };
        }
    } as never);
    const first = cache.put("same", "first");
    const rejected = t.throwsAsync(first, { is: failure });
    await started;
    const second = cache.put("same", "second");
    try {
        t.is(await cache.put("other", "independent"), "independent");
        t.deepEqual(calls, ["same:first", "other:independent"]);
    } finally {
        rejectFirst(failure);
        await rejected;
        await second;
    }
    t.is(await second, "second");
    t.is(await cache.put("same", "retry"), "retry");
    t.deepEqual(calls, ["same:first", "other:independent", "same:second", "same:retry"]);
    t.is((cache as unknown as { pendingWrites: Map<string, unknown> }).pendingWrites.size, 0);
});
