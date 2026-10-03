import test from "ava";
import { PersistentCache } from "../src/cache/PersistentCache";

class MemoryCache extends PersistentCache<Map<string, unknown>> {
    writes = 0;
    constructor() { super(new Map()); }
    async get<T>(key: string): Promise<T> { return this.backing.get(key) as T; }
    async put<T>(key: string, value: T): Promise<T> {
        this.writes++;
        this.backing.set(key, value);
        return value;
    }
    async delete<T>(key: string): Promise<void> { this.backing.delete(key); }
    async clear(): Promise<void> { this.backing.clear(); }
    async length(): Promise<number> { return this.backing.size; }
    async keys(): Promise<string[]> { return [...this.backing.keys()]; }
    async forEach<T>(callback: (value: T, key: string) => void): Promise<void> {
        this.backing.forEach((value, key) => callback(value as T, key));
    }
}

test("nullish loads are returned without writes and can recover on the next lookup", async t => {
    for (const missing of [undefined, null]) {
        const cache = new MemoryCache();
        cache.backing.set("asset", missing);
        t.is(await cache.getOrLoad("asset", async () => missing), missing);
        t.is(cache.writes, 0);
        t.is(await cache.getOrLoad("asset", async () => "recovered"), "recovered");
        t.is(cache.writes, 1);
    }
});

test("falsy values are persisted and do not reload", async t => {
    for (const value of [false, 0, ""]) {
        const cache = new MemoryCache();
        let loads = 0;
        const load = async () => { loads++; return value; };
        t.is(await cache.getOrLoad("asset", load), value);
        t.is(await cache.getOrLoad("asset", load), value);
        t.is(loads, 1);
        t.is(cache.writes, 1);
    }
});

test("a failed load leaves no persistent entry and preserves its error", async t => {
    const cache = new MemoryCache();
    const failure = new Error("temporary failure");
    await t.throwsAsync(cache.getOrLoad("asset", async () => { throw failure; }), { is: failure });
    t.is(cache.writes, 0);
    t.false(cache.backing.has("asset"));
    t.is(await cache.getOrLoad("asset", async () => "recovered"), "recovered");
});
