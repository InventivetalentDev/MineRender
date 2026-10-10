import test from "ava";
import { writeUncompressed } from "prismarine-nbt";
import type { Compound } from "prismarine-nbt";
import { AnvilParser } from "../src/world/AnvilParser";
import type { AnvilChunk } from "../src/world/AnvilParser";
import { AnvilWorldSource } from "../src/world/AnvilWorldSource";
import { NBTHelper } from "../src/nbt/NBTHelper";

function region(x: number, z: number, options: {
    compression?: number; numeric?: number[]; data?: number[]; malformed?: boolean; entities?: Compound["value"][];
} = {}): Uint8Array {
    let payload = writeUncompressed({ name: "", type: "compound", value: {
        DataVersion: { type: "int", value: 2865 },
        xPos: { type: "int", value: x }, zPos: { type: "int", value: z },
        entities: { type: "list", value: { type: "compound", value: options.entities ?? [] } },
        sections: { type: "list", value: { type: "compound", value: options.numeric
            ? [{ Y: { type: "byte", value: 0 }, Blocks: { type: "byteArray", value: options.numeric },
                ...(options.data ? { Data: { type: "byteArray", value: options.data } } : {}) }] : [] } }
    } });
    if (options.malformed) payload = payload.subarray(0, 1);
    const count = Math.ceil((payload.length + 5) / 4096);
    const bytes = Buffer.alloc(8192 + count * 4096);
    const localX = ((x % 32) + 32) % 32, localZ = ((z % 32) + 32) % 32;
    bytes.writeUInt32BE((2 << 8) | count, (localX + localZ * 32) * 4);
    bytes.writeUInt32BE(payload.length + 1, 8192);
    bytes[8196] = options.compression ?? 3;
    bytes.set(payload, 8197);
    return bytes;
}

function entity(id: string, x: number, z: number): Compound["value"] {
    return {
        id: { type: "string", value: id },
        Pos: { type: "list", value: { type: "double", value: [x * 16 + 0.5, 64, z * 16 + 0.5] } },
        UUID: { type: "intArray", value: [1, 2, 3, 4] }
    };
}

function entityRegion(x: number, z: number, entities = [entity("minecraft:pig", x, z)]): Uint8Array {
    const payload = writeUncompressed({ name: "", type: "compound", value: {
        DataVersion: { type: "int", value: 4189 },
        Position: { type: "intArray", value: [x, z] },
        Entities: { type: "list", value: { type: "compound", value: entities } }
    } });
    const bytes = Buffer.from(region(x, z));
    bytes.writeUInt32BE(payload.length + 1, 8192);
    bytes.set(payload, 8197);
    return bytes;
}

function withNeighbor(first: Uint8Array): Uint8Array {
    const bytes = Buffer.alloc(16384);
    bytes.set(first);
    bytes.writeUInt32BE((3 << 8) | 1, 4);
    bytes.set(region(1, 0).subarray(8192), 12288);
    return bytes;
}

function external(x: number, z: number): { stub: Buffer; payload: Buffer } {
    const stub = Buffer.from(region(x, z));
    const payload = Buffer.from(stub.subarray(8197, 8196 + stub.readUInt32BE(8192)));
    stub.fill(0, 8192);
    stub.writeUInt32BE(1, 8192);
    stub[8196] = 128 | 3;
    return { stub, payload };
}

function deferred<T = void>() {
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

test("world sources apply custom and lenient numeric mappings without changing strict defaults", async t => {
    const blocks = Array<number>(4096).fill(0), data = Array<number>(2048).fill(0);
    blocks.splice(0, 3, 1, 1, -3);
    data[0] = -15;
    const input = region(-33, 65, { numeric: blocks, data });
    const strict = new AnvilWorldSource(async () => input);
    await t.throwsAsync(strict.getChunk(-33, 65), { message: /1:15.*section 0.*index 1/ });
    for (const useExternal of [false, true]) {
        const stub = Buffer.from(input), payload = Buffer.from(input.subarray(8197));
        if (useExternal) {
            stub.fill(0, 8192);
            stub.writeUInt32BE(1, 8192);
            stub[8196] = 128 | 3;
        }
        let reads = 0, externalReads = 0;
        const source = new AnvilWorldSource(async () => { reads++; return stub; }, {
            legacyMappings: Object.freeze({ "1:0": "minecraft:diamond_block" }), lenient: true,
            readExternalChunk: async (x, z) => {
                t.deepEqual([x, z], [-33, 65]);
                externalReads++;
                return payload;
            },
            readEntityRegion: async () => entityRegion(-33, 65)
        });
        for (let i = 0; i < 2; i++) {
            const parsed = (await source.getChunk(-33, 65))!;
            t.deepEqual([parsed.x, parsed.z], [-33, 65]);
            t.deepEqual([0, 1, 2].map(index => parsed.sections[0].data.get(index)?.type), [
                "minecraft:granite", "minecraft:diamond_block", undefined
            ]);
            t.is(parsed.entityDataVersion, 4189);
            t.is(parsed.entities?.length, 1);
        }
        t.is(reads, 1);
        t.is(externalReads, useExternal ? 2 : 0);
    }
    const entityStub = Buffer.from(entityRegion(-33, 65));
    entityStub[8196] |= 128;
    let terrainExternalReads = 0;
    const wrongDirectory = new AnvilWorldSource(async () => undefined, {
        readEntityRegion: async () => entityStub,
        readExternalChunk: async () => { terrainExternalReads++; return undefined; }
    });
    await t.throwsAsync(wrongDirectory.getChunk(-33, 65), { message: /readExternalChunk/ });
    t.is(terrainExternalReads, 0);
});

test("world sources read external chunks at absolute coordinates without retaining their payloads", async t => {
    for (const [x, z] of [[31, 32], [-1, -32], [-33, 65]]) {
        const { stub, payload } = external(x, z);
        const regions: number[][] = [], chunks: number[][] = [];
        const controller = new AbortController();
        const source = new AnvilWorldSource(async (x, z) => { regions.push([x, z]); return stub; }, {
            readExternalChunk: async (x, z, signal) => {
                chunks.push([x, z]);
                t.truthy(signal);
                t.false(signal!.aborted);
                return payload;
            }
        });
        for (let i = 0; i < 2; i++) {
            const chunk = (await source.getChunk(x, z, controller.signal))!;
            t.deepEqual([chunk.x, chunk.z], [x, z]);
        }
        t.deepEqual(regions, [[Math.floor(x / 32), Math.floor(z / 32)]]);
        t.deepEqual(chunks, [[x, z], [x, z]]);
    }
});

test("missing and invalid external chunks retry without evicting a region or blocking its neighbors", async t => {
    const { stub, payload } = external(0, 0);
    for (const invalid of [undefined, new Error("external read failed"), new Uint8Array([0]), external(32, 0).payload]) {
        let regionReads = 0, chunkReads = 0;
        const source = new AnvilWorldSource(async () => { regionReads++; return withNeighbor(stub); }, {
            readExternalChunk: async () => {
                if (++chunkReads === 1) {
                    if (invalid instanceof Error) throw invalid;
                    return invalid;
                }
                return payload;
            }
        });
        await t.throwsAsync(source.getChunk(0, 0));
        t.is((await source.getChunk(1, 0))!.x, 1);
        t.is(chunkReads, 1);
        t.is((await source.getChunk(0, 0))!.x, 0);
        t.is(regionReads, 1);
        t.is(chunkReads, 2);
    }
});

test("cancelling an external chunk read leaves another caller and the cached region usable", async t => {
    t.timeout(3000);
    const { stub, payload } = external(0, 0);
    const firstRead = deferred<Uint8Array>(), secondRead = deferred<Uint8Array>(), started = deferred();
    const firstController = new AbortController(), secondController = new AbortController();
    const signals: (AbortSignal | undefined)[] = [];
    let regionReads = 0;
    const source = new AnvilWorldSource(async () => { regionReads++; return stub; }, {
        readExternalChunk: async (_x, _z, signal) => {
            signals.push(signal);
            if (signals.length === 2) started.resolve();
            return signals.length === 1 ? firstRead.promise : secondRead.promise;
        }
    });
    t.teardown(() => { firstRead.resolve(payload); secondRead.resolve(payload); });
    const first = source.getChunk(0, 0, firstController.signal);
    const second = source.getChunk(0, 0, secondController.signal);
    await started.promise;
    const reason = new Error("external read cancelled");
    firstController.abort(reason);
    await t.throwsAsync(first, { is: reason });
    t.true(signals[0]!.aborted);
    t.false(signals[1]!.aborted);
    secondRead.resolve(payload);
    t.is((await second)!.x, 0);
    t.is((await source.getChunk(0, 0))!.x, 0);
    t.is(regionReads, 1);
    firstRead.resolve(payload);
});

test("entity regions replace embedded entities and retain their own data version", async t => {
    const x = -33, z = 65, embedded = entity("minecraft:cow", x, z), saved = entity("minecraft:pig", x, z);
    for (const entities of [[saved], []]) {
        const reads: number[][] = [];
        const source = new AnvilWorldSource(async () => region(x, z, { entities: [embedded] }), {
            readEntityRegion: async (regionX, regionZ) => {
                reads.push([regionX, regionZ]);
                return new Uint8Array(entityRegion(x, z, entities)).buffer;
            }
        });
        const chunk = (await source.getChunk(x, z))!;
        t.deepEqual([chunk.x, chunk.z], [x, z]);
        t.is(chunk.dataVersion, 2865);
        t.is(chunk.entityDataVersion, 4189);
        t.deepEqual(chunk.entities, entities.map(nbt => ({
            position: [x * 16 + 0.5, 64, z * 16 + 0.5], nbt: { type: "compound", value: nbt }
        })));
        t.deepEqual(reads, [[-2, 2]]);
    }
});

test("missing entity regions or slots preserve embedded entities, and entity-only columns remain loadable", async t => {
    const saved = entity("minecraft:cow", 0, 0);
    for (const absent of [undefined, new Uint8Array(8192)]) {
        const fallback = new AnvilWorldSource(async () => region(0, 0, { entities: [saved] }), {
            readEntityRegion: async () => absent
        });
        const chunk = (await fallback.getChunk(0, 0))!;
        t.deepEqual(chunk.entities?.map(entity => entity.nbt.value), [saved]);
        t.is(chunk.entityDataVersion, undefined);

        const entities = new AnvilWorldSource(async () => absent, { readEntityRegion: async () => entityRegion(0, 0) });
        const entityOnly = (await entities.getChunk(0, 0))!;
        t.deepEqual([entityOnly.x, entityOnly.z, entityOnly.sections], [0, 0, []]);
        t.is(entityOnly.dataVersion, undefined);
        t.is(entityOnly.entityDataVersion, 4189);
        t.is(entityOnly.entities?.length, 1);
        t.is(await entities.getChunk(1, 0), undefined);
    }
});

test("terrain and entity regions have separate count limits and a shared byte limit", async t => {
    for (const [options, expected] of [
        [{ maxCachedRegions: 2 }, [0, 1, 2, 1]],
        [{ maxCachedRegions: 8, maxCachedBytes: 24576 }, [0, 1, 0, 2, 0, 1]]
    ] as const) {
        const terrainReads: number[] = [], entityReads: number[] = [];
        const source = new AnvilWorldSource(async x => { terrainReads.push(x); return region(x * 32, 0); }, {
            ...options,
            readEntityRegion: async x => { entityReads.push(x); return entityRegion(x * 32, 0); }
        });
        for (const x of [0, 32, 0, 64, 0, 32]) {
            const chunk = (await source.getChunk(x, 0))!;
            t.is(chunk.dataVersion, 2865);
            t.is(chunk.entityDataVersion, 4189);
        }
        t.deepEqual(terrainReads, [...expected]);
        t.deepEqual(entityReads, [...expected]);
    }
});

test("failed entity region reads and headers can retry without rereading retained terrain", async t => {
    const sector = Buffer.from(entityRegion(0, 0));
    sector.writeUInt32BE((1 << 8) | 1, 0);
    for (const invalid of [new Error("entity read failed"), new Uint8Array(7), sector]) {
        let terrainReads = 0, entityReads = 0;
        const source = new AnvilWorldSource(async () => { terrainReads++; return region(0, 0); }, {
            readEntityRegion: async () => {
                if (++entityReads === 1) {
                    if (invalid instanceof Error) throw invalid;
                    return invalid;
                }
                return entityRegion(0, 0);
            }
        });
        await t.throwsAsync(source.getChunk(0, 0));
        t.is((await source.getChunk(0, 0))!.entities?.length, 1);
        t.is(terrainReads, 1);
        t.is(entityReads, 2);
    }
});

test("a failed terrain read cancels this caller's pending entity read", async t => {
    t.timeout(3000);
    const gate = deferred<Uint8Array>(), started = deferred(), reason = new Error("terrain read failed");
    let entitySignal!: AbortSignal;
    const source = new AnvilWorldSource(async () => { await started.promise; throw reason; }, {
        readEntityRegion: async (_x, _z, signal) => {
            entitySignal = signal!;
            started.resolve();
            return gate.promise;
        }
    });
    t.teardown(() => gate.resolve(entityRegion(0, 0)));
    await t.throwsAsync(source.getChunk(0, 0), { is: reason });
    t.true(entitySignal.aborted);
    t.is(entitySignal.reason, reason);
});

test("misplaced entity chunks reject until corrected region bytes replace the cache", async t => {
    let bytes = entityRegion(32, 0), reads = 0;
    const source = new AnvilWorldSource(async () => region(0, 0), {
        readEntityRegion: async () => { reads++; return bytes; }
    });
    await t.throwsAsync(source.getChunk(0, 0), { message: /do not match requested/ });
    bytes = entityRegion(0, 0);
    await t.throwsAsync(source.getChunk(0, 0), { message: /do not match requested/ });
    t.is(reads, 1);
    source.clearCache();
    t.is((await source.getChunk(0, 0))!.entityDataVersion, 4189);
    t.is(reads, 2);
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

test("failed region reads and corrupt headers or sectors can be retried", async t => {
    const sector = Buffer.from(region(0, 0)), length = Buffer.from(region(0, 0));
    sector.writeUInt32BE((1 << 8) | 1, 0);
    length.writeUInt32BE(4096, 8192);
    for (const invalid of [new Error("read failed"), new Uint8Array(7), sector, length]) {
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

test("unsupported, malformed and misplaced chunk payloads do not evict neighboring columns", async t => {
    for (const invalid of [region(0, 0, { compression: 4 }), region(0, 0, { numeric: [1] }),
        region(0, 0, { malformed: true }), region(32, 0)]) {
        let reads = 0;
        const source = new AnvilWorldSource(async () => { reads++; return withNeighbor(invalid); });
        await t.throwsAsync(source.getChunk(0, 0));
        t.is((await source.getChunk(1, 0))!.x, 1);
        await t.throwsAsync(source.getChunk(0, 0));
        t.is(reads, 1);
    }
});

test("corrected chunk payloads replace cached bytes only after explicitly clearing the cache", async t => {
    let bytes = region(32, 0), reads = 0;
    const source = new AnvilWorldSource(async () => { reads++; return bytes; });
    await t.throwsAsync(source.getChunk(0, 0), { message: /do not match requested/ });
    bytes = region(0, 0);
    await t.throwsAsync(source.getChunk(0, 0), { message: /do not match requested/ });
    t.is(reads, 1);
    source.clearCache();
    t.is((await source.getChunk(0, 0))!.x, 0);
    t.is(reads, 2);
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

test("already aborted callers neither start region reads nor consume cached regions", async t => {
    const controller = new AbortController(), reason = new Error("cancelled");
    controller.abort(reason);
    let reads = 0;
    const source = new AnvilWorldSource(async () => { reads++; return region(0, 0); });
    await t.throwsAsync(source.getChunk(0, 0, controller.signal), { is: reason });
    t.is(reads, 0);
    await source.getChunk(0, 0);
    await t.throwsAsync(source.getChunk(0, 0, controller.signal), { is: reason });
    t.is(reads, 1);
});

test("cancelling one coalesced caller leaves independent callers and the reader active", async t => {
    t.timeout(3000);
    for (const cancellableNeighbor of [false, true]) {
        const gate = deferred<Uint8Array>(), started = deferred();
        const firstController = new AbortController(), secondController = new AbortController();
        let signal!: AbortSignal, reads = 0;
        const source = new AnvilWorldSource(async (_x, _z, readerSignal) => {
            signal = readerSignal!;
            reads++;
            started.resolve();
            return gate.promise;
        });
        t.teardown(() => gate.resolve(withNeighbor(region(0, 0))));
        const first = source.getChunk(0, 0, firstController.signal);
        const second = source.getChunk(1, 0, cancellableNeighbor ? secondController.signal : undefined);
        await started.promise;
        const reason = new Error("first caller cancelled");
        firstController.abort(reason);
        await t.throwsAsync(first, { is: reason });
        t.false(signal.aborted);
        gate.resolve(withNeighbor(region(0, 0)));
        t.is((await second)!.x, 1);
        t.is((await source.getChunk(0, 0))!.x, 0);
        t.is(reads, 1);
        secondController.abort();
        t.false(signal.aborted);
    }
});

test("coalesced terrain and entity reads cancel only after their last caller leaves", async t => {
    t.timeout(3000);
    for (const cancelRemaining of [false, true]) {
        const terrainGate = deferred<Uint8Array>(), entityGate = deferred<Uint8Array>();
        const terrainStarted = deferred(), entityStarted = deferred();
        const terrainSignals: AbortSignal[] = [], entitySignals: AbortSignal[] = [];
        const source = new AnvilWorldSource(async (_x, _z, signal) => {
            terrainSignals.push(signal!);
            terrainStarted.resolve();
            return terrainSignals.length === 1 ? terrainGate.promise : region(0, 0);
        }, {
            readEntityRegion: async (_x, _z, signal) => {
                entitySignals.push(signal!);
                entityStarted.resolve();
                return entitySignals.length === 1 ? entityGate.promise : entityRegion(0, 0);
            }
        });
        t.teardown(() => { terrainGate.resolve(region(0, 0)); entityGate.resolve(entityRegion(0, 0)); });
        const firstController = new AbortController(), secondController = new AbortController();
        const first = source.getChunk(0, 0, firstController.signal);
        const second = source.getChunk(0, 0, secondController.signal);
        await Promise.all([terrainStarted.promise, entityStarted.promise]);
        firstController.abort();
        await t.throwsAsync(first, { name: "AbortError" });
        t.false(terrainSignals[0].aborted);
        t.false(entitySignals[0].aborted);
        if (cancelRemaining) {
            const reason = new Error("last caller cancelled");
            secondController.abort(reason);
            await t.throwsAsync(second, { is: reason });
            t.is(terrainSignals[0].reason, reason);
            t.is(entitySignals[0].reason, reason);
            t.is((await source.getChunk(0, 0))!.entityDataVersion, 4189);
        }
        terrainGate.resolve(region(0, 0));
        entityGate.resolve(entityRegion(0, 0));
        if (!cancelRemaining) t.is((await second)!.entityDataVersion, 4189);
        t.is((await source.getChunk(0, 0))!.entities?.length, 1);
        t.is(terrainSignals.length, cancelRemaining ? 2 : 1);
        t.is(entitySignals.length, cancelRemaining ? 2 : 1);
    }
});

test("the last cancelled caller aborts and detaches its read before a replacement starts", async t => {
    t.timeout(3000);
    const gate = deferred<Uint8Array>(), started = deferred();
    const firstController = new AbortController(), secondController = new AbortController();
    const signals: AbortSignal[] = [];
    const source = new AnvilWorldSource(async (_x, _z, signal) => {
        signals.push(signal!);
        started.resolve();
        return signals.length === 1 ? gate.promise : region(0, 0);
    });
    t.teardown(() => gate.resolve(region(32, 0)));
    const first = source.getChunk(0, 0, firstController.signal), second = source.getChunk(1, 0, secondController.signal);
    await started.promise;
    firstController.abort();
    t.false(signals[0].aborted);
    const reason = new Error("last caller cancelled");
    secondController.abort(reason);
    t.true(signals[0].aborted);
    t.is(signals[0].reason, reason);
    const replacement = source.getChunk(0, 0);
    await Promise.all([t.throwsAsync(first, { name: "AbortError" }), t.throwsAsync(second, { is: reason })]);
    t.is((await replacement)!.x, 0);
    t.is(signals.length, 2);
    t.false(signals[1].aborted);
    gate.resolve(region(32, 0));
    await new Promise<void>(resolve => setImmediate(resolve));
    t.is((await source.getChunk(0, 0))!.x, 0);
    t.is(signals.length, 2);
});

test("cancelling before the reader starts skips its callback and permits a fresh read", async t => {
    let reads = 0;
    const source = new AnvilWorldSource(async () => { reads++; return region(0, 0); });
    const controller = new AbortController();
    const cancelled = source.getChunk(0, 0, controller.signal);
    controller.abort();
    const replacement = source.getChunk(0, 0);
    await t.throwsAsync(cancelled, { name: "AbortError" });
    t.is((await replacement)!.x, 0);
    t.is(reads, 1);
});

test.serial("aborting during chunk decoding rejects promptly without evicting the raw region", async t => {
    t.timeout(3000);
    const gate = deferred();
    const started = deferred();
    const original = NBTHelper.fromBuffer;
    let reads = 0;
    const source = new AnvilWorldSource(async () => { reads++; return region(0, 0); });
    NBTHelper.fromBuffer = async (...args) => { started.resolve(); await gate.promise; return original(...args); };
    t.teardown(() => { NBTHelper.fromBuffer = original; gate.resolve(); });
    const controller = new AbortController(), reason = new Error("decode cancelled");
    const pending = source.getChunk(0, 0, controller.signal);
    await started.promise;
    controller.abort(reason);
    await t.throwsAsync(pending, { is: reason });
    NBTHelper.fromBuffer = original;
    t.is((await source.getChunk(0, 0))!.x, 0);
    t.is(reads, 1);
    gate.resolve();
});
