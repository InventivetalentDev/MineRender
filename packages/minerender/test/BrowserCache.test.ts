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

test.serial("browser cache loads and reuses assets when no storage driver is available", async t => {
    const warn = console.warn, warnings: unknown[][] = [];
    console.warn = (...args) => { warnings.push(args); };
    t.teardown(() => { console.warn = warn; });
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
    t.is(warnings.length, 1);
    t.true(warnings[0][2] instanceof Error);
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

test("browser cache propagates failed writes and keeps using opened storage", async t => {
    const { cache, backing, values, reads } = store();
    await cache.put("persisted", "old");
    const failure = new DOMException("Storage denied", "SecurityError");
    backing.setItem = async () => { throw failure; };
    await t.throwsAsync(cache.put("asset", "loaded"), { is: failure });
    t.is(await cache.get("persisted"), "old");
    t.is(reads(), 1);
    t.deepEqual([...values.entries()], [["persisted", "old"]]);
    await cache.clear();
    t.is(await cache.length(), 0);
});
