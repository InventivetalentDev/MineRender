import test from "ava";
import { writeUncompressed } from "prismarine-nbt";
import { AnvilWorldSource } from "../src/world/AnvilWorldSource";

function region(x: number, z: number): Uint8Array {
    const payload = writeUncompressed({ name: "", type: "compound", value: {
        DataVersion: { type: "int", value: 2865 },
        xPos: { type: "int", value: x }, zPos: { type: "int", value: z },
        sections: { type: "list", value: { type: "compound", value: [] } }
    } });
    const bytes = Buffer.alloc(12288);
    const localX = ((x % 32) + 32) % 32, localZ = ((z % 32) + 32) % 32;
    bytes.writeUInt32BE((2 << 8) | 1, (localX + localZ * 32) * 4);
    bytes.writeUInt32BE(payload.length + 1, 8192);
    bytes[8196] = 3;
    bytes.set(payload, 8197);
    return bytes;
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(accept => { resolve = accept; });
    return { promise, resolve };
}

test("world sources map signed chunk coordinates to region readers and decode absolute columns", async t => {
    for (const [x, z] of [[0, 0], [31, 32], [-1, -32], [-33, 65]]) {
        const reads: number[][] = [];
        const source = new AnvilWorldSource(async (regionX, regionZ) => {
            reads.push([regionX, regionZ]);
            return region(x, z).buffer as ArrayBuffer;
        });
        const chunk = (await source.getChunk(x, z))!;
        t.deepEqual([chunk.x, chunk.z], [x, z]);
        t.is(chunk.dataVersion, 2865);
        t.deepEqual(reads, [[Math.floor(x / 32), Math.floor(z / 32)]]);
        t.is(await source.getChunk(x + (x % 32 === 31 ? -1 : 1), z), undefined);
    }
});

test("region cache uses access order and limits retained bytes as well as region count", async t => {
    for (const options of [{ maxCachedRegions: 2 }, { maxCachedRegions: 8, maxCachedBytes: 16384 }]) {
        const reads: number[] = [];
        const source = new AnvilWorldSource(async x => {
            reads.push(x);
            return new Uint8Array(8192);
        }, options);
        for (const x of [0, 32, 0, 64, 0, 32]) await source.getChunk(x, 0);
        t.deepEqual(reads, [0, 1, 2, 1]);
    }
});

test("missing regions consume bounded cache entries and oversized regions are not retained", async t => {
    const reads: number[] = [];
    const missing = new AnvilWorldSource(async x => { reads.push(x); return undefined; }, { maxCachedRegions: 1 });
    for (const x of [0, 0, 32, 0]) t.is(await missing.getChunk(x, 0), undefined);
    t.deepEqual(reads, [0, 1, 0]);

    for (const options of [{ maxCachedBytes: 8191 }, { maxCachedRegions: 0 }]) {
        let count = 0;
        const source = new AnvilWorldSource(async () => { count++; return new Uint8Array(8192); }, options);
        await source.getChunk(0, 0);
        await source.getChunk(0, 0);
        t.is(count, 2);
    }
});

test("concurrent requests for one region share the read", async t => {
    const read = deferred<Uint8Array>();
    let count = 0;
    const source = new AnvilWorldSource(async () => { count++; return read.promise; });
    const first = source.getChunk(0, 0), second = source.getChunk(1, 0);
    await Promise.resolve();
    t.is(count, 1);
    read.resolve(new Uint8Array(8192));
    t.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
});

test("failed region reads, malformed regions and misplaced columns can be retried", async t => {
    for (const invalid of [new Error("read failed"), new Uint8Array(7), region(32, 0)]) {
        let reads = 0;
        const source = new AnvilWorldSource(async () => {
            if (++reads === 1) {
                if (invalid instanceof Error) throw invalid;
                return invalid;
            }
            return region(0, 0);
        });
        await t.throwsAsync(source.getChunk(0, 0));
        t.is((await source.getChunk(0, 0))!.x, 0);
        t.is(reads, 2);
    }
});

test("clearing a cache releases settled entries and prevents older reads replacing newer results", async t => {
    const first = deferred<Uint8Array>();
    let reads = 0;
    const source = new AnvilWorldSource(async () => ++reads === 1 ? first.promise : region(0, 0));
    const pending = source.getChunk(0, 0);
    await Promise.resolve();
    source.clearCache();
    t.is((await source.getChunk(0, 0))!.x, 0);
    first.resolve(new Uint8Array(8192));
    t.is(await pending, undefined);
    t.is((await source.getChunk(0, 0))!.x, 0);
    t.is(reads, 2);
    source.clearCache();
    await source.getChunk(0, 0);
    t.is(reads, 3);
});

test("region subarray views retain their own bytes within the cache limit", async t => {
    for (const buffer of [new Uint8Array(16384), Buffer.alloc(16384)]) {
        const view = buffer.subarray(4096, 12288);
        let reads = 0;
        const source = new AnvilWorldSource(async () => { reads++; return view; }, { maxCachedBytes: 8192 });
        t.is(await source.getChunk(0, 0), undefined);
        view[0] = 255;
        t.is(await source.getChunk(0, 0), undefined);
        t.is(reads, 1);
    }
});

test("invalid source cache limits and coordinates reject before invoking the reader", async t => {
    let reads = 0;
    const reader = async () => { reads++; return undefined; };
    for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
        t.throws(() => new AnvilWorldSource(reader, { maxCachedRegions: value }), { instanceOf: RangeError });
        t.throws(() => new AnvilWorldSource(reader, { maxCachedBytes: value }), { instanceOf: RangeError });
        if (value !== -1) {
            const source = new AnvilWorldSource(reader);
            await t.throwsAsync(source.getChunk(value, 0), { instanceOf: RangeError });
            await t.throwsAsync(source.getChunk(0, value), { instanceOf: RangeError });
        }
    }
    t.is(reads, 0);
});
