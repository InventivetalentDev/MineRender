import test from "ava";
import localforage from "localforage";
import { BrowserCache } from "../src/env/browser/BrowserCache";

function store() {
    const values = new Map<string, unknown>();
    let readyCalls = 0, reads = 0;
    const backing = {
        ready: async () => { readyCalls++; },
        getItem: async <T>(key: string) => { reads++; return values.get(key) as T; },
        setItem: async <T>(key: string, value: T) => { values.set(key, value); return value; },
        removeItem: async (key: string) => { values.delete(key); },
        clear: async () => values.clear(),
        length: async () => values.size,
        keys: async () => [...values.keys()],
        iterate: async <T>(callback: (value: T, key: string) => void) => {
            for (const [key, value] of values) callback(value as T, key);
        }
    };
    return { values, backing, cache: new BrowserCache(backing as unknown as LocalForage),
        readyCalls: () => readyCalls, reads: () => reads };
}

test("browser cache loads and reuses assets when no storage driver is available", async t => {
    const cache = new BrowserCache(localforage.createInstance({ name: "minerender-no-storage", driver: [] }));
    let loads = 0;
    const load = async () => { loads++; return { model: "stone" }; };
    t.deepEqual(await cache.getOrLoad("asset", load), { model: "stone" });
    t.deepEqual(await cache.getOrLoad("asset", load), { model: "stone" });
    t.is(loads, 1);
    t.deepEqual(await cache.keys(), ["asset"]);
    const entries: unknown[] = [];
    await cache.forEach((value, key) => { entries.push([key, value]); });
    t.deepEqual(entries, [["asset", { model: "stone" }]]);
    await cache.delete("asset");
    t.is(await cache.length(), 0);
    await cache.put("other", false);
    t.is(await cache.get("other"), false);
    await cache.clear();
    t.deepEqual(await cache.keys(), []);
});

test("browser cache initializes healthy storage once and leaves it authoritative", async t => {
    const { cache, values, readyCalls } = store();
    t.is(readyCalls(), 0);
    await cache.put("asset", "stored");
    values.set("asset", "changed outside the cache");
    t.is(await cache.get("asset"), "changed outside the cache");
    t.is(readyCalls(), 1);
    t.deepEqual(await cache.keys(), ["asset"]);
    await cache.delete("asset");
    t.is(await cache.length(), 0);
    await cache.put("other", 0);
    await cache.clear();
    t.is(values.size, 0);
});

test("browser cache keeps failed writes in memory and stops using unavailable storage", async t => {
    const { cache, backing, values, reads } = store();
    await cache.put("persisted", "old");
    backing.setItem = async () => { throw new DOMException("Storage denied", "SecurityError"); };
    t.is(await cache.put("asset", "loaded"), "loaded");
    t.is(await cache.get("asset"), "loaded");
    t.is(await cache.get("persisted"), undefined);
    t.is(reads(), 0);
    t.deepEqual([...values.entries()], [["persisted", "old"]]);
    await cache.clear();
    t.is(await cache.length(), 0);
});

test("browser cache bounds stalled readiness and keeps using memory after late initialization", async t => {
    const { cache, backing, reads, values } = store();
    let release!: () => void;
    backing.ready = () => new Promise<void>(resolve => { release = resolve; });
    t.timeout(5000);
    const [first, second] = await Promise.all([
        cache.getOrLoad("first", async () => "loaded"), cache.getOrLoad("second", async () => "also loaded")
    ]);
    t.is(first, "loaded");
    t.is(second, "also loaded");
    release();
    await Promise.resolve();
    t.is(await cache.get("first"), "loaded");
    t.is(reads(), 0);
    t.is(values.size, 0);
});

test("browser cache does not treat iteration callback errors as storage failures", async t => {
    const { cache, values } = store();
    await cache.put("asset", "stored");
    const failure = new Error("caller failure");
    await t.throwsAsync(cache.forEach(() => { throw failure; }), { is: failure });
    values.set("asset", "still persistent");
    t.is(await cache.get("asset"), "still persistent");
});
