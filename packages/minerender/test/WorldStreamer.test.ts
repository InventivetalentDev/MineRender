import { installMineRenderDataFixtures } from "./helpers/minerender-data";
import test from "ava";
import type { AnvilChunk } from "../src/world/AnvilParser";
import { WorldStreamer } from "../src/world/WorldStreamer";
import { MineRenderWorld } from "../src/world/MineRenderWorld";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { ChunkData } from "../src/world/ChunkData";

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const chunk = (x: number, z: number): AnvilChunk => ({ x, z, sections: [] });
const key = (x: number, z: number) => `${x},${z}`;

test("streaming retains biome-only sections until eviction and restores them on return", async t => {
    t.teardown(installMineRenderDataFixtures());
    const world = new MineRenderWorld(new MineRenderScene());
    const reads: string[] = [];
    const source = { getChunk: async (x: number, z: number): Promise<AnvilChunk> => {
        reads.push(key(x, z));
        return { x, z, sections: [{ y: -4, data: new ChunkData(), biomes: Array(64).fill(`test:biome_${x}_${z}`) }] };
    } };
    const streamer = new WorldStreamer(world, source, { loadRadius: 0, unloadRadius: 1 });
    t.teardown(async () => { await streamer.dispose(); await world.clear(); });
    await streamer.update(-1, -2);
    t.is(world.getBiomeAt(-1, -64, -17), "test:biome_-1_-2");
    t.is(world.getBlockAt(-1, -64, -17), undefined);
    await streamer.update(0, -2);
    t.is(world.getBiomeAt(-1, -64, -17), "test:biome_-1_-2");
    t.is(world.getBiomeAt(0, -49, -32), "test:biome_0_-2");
    await streamer.update(1, -2);
    t.is(world.getBiomeAt(-1, -64, -17), undefined);
    await streamer.update(-1, -2);
    t.is(world.getBiomeAt(-1, -64, -17), "test:biome_-1_-2");
    t.deepEqual(reads, ["-1,-2", "0,-2", "1,-2", "-1,-2"]);
    await streamer.dispose();
    t.is(world.getBiomeAt(-1, -64, -17), undefined);
    t.is(world.getBiomeAt(0, -49, -32), undefined);
});

function fixture(options: { loadRadius?: number; unloadRadius?: number } = { loadRadius: 0, unloadRadius: 0 }, hooks: {
    get?: (x: number, z: number, signal?: AbortSignal) => Promise<AnvilChunk | undefined>;
    place?: (value: AnvilChunk) => Promise<void>;
    placeChunks?: (chunks: readonly AnvilChunk[]) => Promise<void>;
    unloadColumns?: (columns: readonly { x: number; z: number }[]) => Promise<void>;
} = {}) {
    const events: string[] = [], resident = new Set<string>();
    const bulkCalls: { x: number; z: number }[][] = [];
    const placements: { x: number; z: number }[][] = [];
    let active = 0, peak = 0;
    let activeReads = 0, peakReads = 0, activeMutations = 0, peakMutations = 0;
    async function operation<T>(event: string, action: () => Promise<T>): Promise<T> {
        events.push(event);
        peak = Math.max(peak, ++active);
        const reading = event.startsWith("get:");
        if (reading) peakReads = Math.max(peakReads, ++activeReads);
        else peakMutations = Math.max(peakMutations, ++activeMutations);
        try {
            return await action();
        } finally {
            active--;
            if (reading) activeReads--;
            else activeMutations--;
        }
    }
    const source = {
        getChunk: (x: number, z: number, signal?: AbortSignal) => operation(`get:${key(x, z)}`, async () => hooks.get ? hooks.get(x, z, signal) : chunk(x, z))
    };
    const world = {
        placeChunk: (value: AnvilChunk) => operation(`place:${key(value.x, value.z)}`, async () => {
            resident.add(key(value.x, value.z));
            await hooks.place?.(value);
        }),
        unloadChunkColumns: (columns: readonly { x: number; z: number }[]) => operation("unload-many", async () => {
            const requested = columns.map(position => ({ ...position }));
            bulkCalls.push(requested);
            await hooks.unloadColumns?.(columns);
            for (const { x, z } of requested) resident.delete(key(x, z));
        })
    };
    if (hooks.placeChunks) Object.assign(world, {
        placeChunks: (chunks: readonly AnvilChunk[]) => operation("place-many", async () => {
            placements.push(chunks.map(({ x, z }) => ({ x, z })));
            for (const { x, z } of chunks) resident.add(key(x, z));
            await hooks.placeChunks!(chunks);
        })
    });
    return {
        streamer: new WorldStreamer(world, source, options), events, resident, bulkCalls, placements,
        peak: () => peak, peakReads: () => peakReads, peakMutations: () => peakMutations, world, source
    };
}

test("streaming validates bounded radii and floors signed scene coordinates into chunk coordinates", async t => {
    const setup = fixture();
    for (const options of [
        { loadRadius: -1 }, { loadRadius: 0.5 }, { loadRadius: 33 }, { loadRadius: NaN },
        { unloadRadius: Infinity }, { loadRadius: 2, unloadRadius: 1 }, { unloadRadius: 33 }
    ]) {
        t.throws(() => new WorldStreamer(setup.world, setup.source, options), { instanceOf: RangeError });
    }
    for (const [x, z] of [[0.5, 0], [0, NaN], [Infinity, 0]]) {
        await t.throwsAsync(() => setup.streamer.update(x, z), { instanceOf: RangeError });
    }
    await t.throwsAsync(() => setup.streamer.updatePosition({ x: 0, z: Infinity }), { instanceOf: RangeError });
    t.deepEqual(setup.events, []);
    await setup.streamer.updatePosition({ x: -0.1, z: -256.1 });
    t.deepEqual(setup.streamer.loadedChunks, [{ x: -1, z: -2 }]);
    await setup.streamer.updatePosition({ x: -256, z: -256 });
    t.deepEqual(setup.streamer.loadedChunks, [{ x: -1, z: -1 }]);
    await setup.streamer.update(-33, 32);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: -33, z: 32 }]);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
});

test("the default square loads nearest columns first and retains columns inside the unload radius", async t => {
    const setup = fixture({});
    await setup.streamer.update(0, 0);
    const requested = setup.events.filter(value => value.startsWith("get:")).map(value => value.slice(4).split(",").map(Number));
    t.is(requested.length, 25);
    t.deepEqual(requested[0], [0, 0]);
    const distances = requested.map(([x, z]) => x * x + z * z);
    t.deepEqual(distances, [...distances].sort((a, b) => a - b));
    t.is(new Set(requested.map(([x, z]) => key(x, z))).size, 25);
    await setup.streamer.update(1, 0);
    t.is(setup.streamer.loadedChunks.length, 30);
    t.false(setup.events.some(value => value === "unload-many"));
    setup.events.length = 0;
    await setup.streamer.update(2, 0);
    t.is(setup.streamer.loadedChunks.length, 30);
    t.deepEqual(setup.bulkCalls[0].map(({ x, z }) => key(x, z)).sort(), [-2, -1, 0, 1, 2].map(z => key(-2, z)).sort());
    t.is(setup.events[0], "unload-many");
    t.true(setup.events[1].startsWith("get:"));
    t.is(setup.peak(), 1);
    await setup.streamer.dispose();
});

test("updates share the active drain and discard decoded chunks outside the latest load area", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    const latestGate = deferred<AnvilChunk>(), latestStarted = deferred();
    const setup = fixture(undefined, { get: async (x, z) => {
        if (x === 0) {
            started.resolve();
            return gate.promise;
        }
        latestStarted.resolve();
        return latestGate.promise;
    } });
    t.teardown(() => { gate.resolve(chunk(0, 0)); latestGate.resolve(chunk(2, 0)); });
    const first = setup.streamer.update(0, 0);
    await started.promise;
    t.is(setup.streamer.pendingChunks, 1);
    const intermediate = setup.streamer.update(1, 0), latest = setup.streamer.update(2, 0);
    let settled = 0;
    for (const update of [first, intermediate, latest]) void update.then(() => { settled++; });
    gate.resolve(chunk(0, 0));
    await latestStarted.promise;
    t.is(settled, 0);
    latestGate.resolve(chunk(2, 0));
    await Promise.all([first, intermediate, latest]);
    t.deepEqual(setup.events, ["get:0,0", "get:2,0", "place:2,0"]);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 2, z: 0 }]);
    t.is(setup.peak(), 1);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
});

test("leaving the load area aborts a cooperative read and advances to a fresh request", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    const signals: (AbortSignal | undefined)[] = [];
    const setup = fixture(undefined, { get: async (x, z, signal) => {
        signals.push(signal);
        if (x === 0) {
            signal?.addEventListener("abort", () => gate.reject(signal.reason), { once: true });
            started.resolve();
            return gate.promise;
        }
        return chunk(x, z);
    } });
    t.teardown(() => gate.resolve(chunk(0, 0)));
    const first = setup.streamer.update(0, 0);
    await started.promise;
    const latest = setup.streamer.update(1, 0);
    await Promise.all([first, latest]);
    t.true(signals[0]?.aborted);
    t.false(signals[1]?.aborted);
    t.not(signals[0], signals[1]);
    t.deepEqual(setup.events, ["get:0,0", "get:1,0", "place:1,0"]);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 1, z: 0 }]);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
    t.is(setup.peak(), 1);
    await setup.streamer.dispose();
});

test("moving the center retains an active source read that remains inside the load area", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    let activeSignal: AbortSignal | undefined;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { get: async (x, z, signal) => {
        if (x === 0 && z === 0) {
            activeSignal = signal;
            started.resolve();
            return gate.promise;
        }
        return chunk(x, z);
    } });
    t.teardown(() => gate.resolve(chunk(0, 0)));
    const first = setup.streamer.update(0, 0);
    await started.promise;
    const latest = setup.streamer.update(1, 0);
    t.false(activeSignal?.aborted);
    gate.resolve(chunk(0, 0));
    await Promise.all([first, latest]);
    t.false(activeSignal?.aborted);
    t.is(setup.events.filter(value => value === "get:0,0").length, 1);
    t.true(setup.resident.has("0,0"));
    t.is(setup.streamer.loadedChunks.length, 9);
    t.true(setup.streamer.loadedChunks.every(({ x, z }) => Math.abs(x - 1) <= 1 && Math.abs(z) <= 1));
    t.deepEqual(setup.streamer.failedChunks, []);
    await setup.streamer.dispose();
});

test("an ignored aborted result is discarded even when the view returns to its column", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    const signals: (AbortSignal | undefined)[] = [];
    const setup = fixture(undefined, { get: async (x, z, signal) => {
        signals.push(signal);
        if (signals.length === 1) {
            started.resolve();
            return gate.promise;
        }
        return chunk(x, z);
    } });
    t.teardown(() => gate.resolve(chunk(0, 0)));
    const first = setup.streamer.update(0, 0);
    await started.promise;
    const away = setup.streamer.update(1, 0), returned = setup.streamer.update(0, 0);
    gate.resolve(chunk(0, 0));
    await Promise.all([first, away, returned]);
    t.true(signals[0]?.aborted);
    t.false(signals[1]?.aborted);
    t.not(signals[0], signals[1]);
    t.deepEqual(setup.events, ["get:0,0", "get:0,0", "place:0,0"]);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.peak(), 1);
    await setup.streamer.dispose();
});

test("a completed stale placement is unloaded before loading the latest target", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    const setup = fixture(undefined, { place: async value => {
        if (value.x === 0) {
            started.resolve();
            await gate.promise;
        }
    } });
    t.teardown(() => gate.resolve());
    const first = setup.streamer.update(0, 0);
    await started.promise;
    const latest = setup.streamer.update(4, 0);
    gate.resolve();
    await Promise.all([first, latest]);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload-many", "get:4,0", "place:4,0"]);
    t.deepEqual([...setup.resident], ["4,0"]);
    t.is(setup.peak(), 1);
    await setup.streamer.dispose();
});

test("missing columns are remembered only while they remain inside the retention area", async t => {
    const setup = fixture({ loadRadius: 0, unloadRadius: 1 }, { get: async () => undefined });
    await setup.streamer.update(0, 0);
    await setup.streamer.update(0, 0);
    await setup.streamer.update(1, 0);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.events, ["get:0,0", "get:1,0"]);
    await setup.streamer.update(3, 0);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.events, ["get:0,0", "get:1,0", "get:3,0", "get:0,0"]);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
});

test("a source failure allows neighboring columns to load and requires explicit retry", async t => {
    const error = new Error("invalid center chunk");
    let fail = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { get: async (x, z) => {
        if (x === 0 && z === 0 && fail) throw error;
        return chunk(x, z);
    } });
    await setup.streamer.retryFailedChunks();
    t.deepEqual(setup.events, []);
    await setup.streamer.update(0, 0);
    t.is(setup.resident.size, 8);
    t.false(setup.resident.has("0,0"));
    t.deepEqual(setup.streamer.failedChunks, [{ x: 0, z: 0, error }]);
    t.is(setup.streamer.failedChunks[0].error, error);
    t.is(setup.streamer.pendingChunks, 0);
    const events = [...setup.events];
    fail = false;
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.events, events);
    await setup.streamer.retryFailedChunks();
    t.deepEqual(setup.events.slice(events.length), ["get:0,0", "place:0,0"]);
    t.is(setup.streamer.loadedChunks.length, 9);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
});

test("failed source columns are forgotten outside the retention area and cleared on disposal", async t => {
    const error = new Error("unreadable chunk");
    const setup = fixture({ loadRadius: 0, unloadRadius: 1 }, { get: async () => { throw error; } });
    await setup.streamer.update(0, 0);
    await setup.streamer.update(1, 0);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.events, ["get:0,0", "get:1,0"]);
    t.deepEqual(setup.streamer.failedChunks.map(({ x, z }) => ({ x, z })), [{ x: 0, z: 0 }, { x: 1, z: 0 }]);
    await setup.streamer.update(3, 0);
    t.deepEqual(setup.streamer.failedChunks, [{ x: 3, z: 0, error }]);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.events, ["get:0,0", "get:1,0", "get:3,0", "get:0,0"]);
    t.deepEqual(setup.streamer.failedChunks, [{ x: 0, z: 0, error }]);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
    t.deepEqual(setup.streamer.failedChunks, []);
    await t.throwsAsync(() => setup.streamer.retryFailedChunks());
});

test("retrying failures during an active drain keeps reads and placements serialized", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    let fail = true, firstNeighbor = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { get: async (x, z) => {
        if (x === 0 && z === 0 && fail) throw new Error("center failed");
        if (firstNeighbor) {
            firstNeighbor = false;
            started.resolve();
            await gate.promise;
        }
        return chunk(x, z);
    } });
    t.teardown(() => gate.resolve());
    const update = setup.streamer.update(0, 0);
    await started.promise;
    t.is(setup.streamer.failedChunks.length, 1);
    fail = false;
    const retry = setup.streamer.retryFailedChunks();
    gate.resolve();
    await Promise.all([update, retry]);
    t.is(setup.events.filter(value => value === "get:0,0").length, 2);
    t.is(setup.streamer.loadedChunks.length, 9);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.peak(), 1);
    await setup.streamer.dispose();
});

test("an obsolete source rejection does not record a failure or block the latest center", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    const setup = fixture({ loadRadius: 0, unloadRadius: 2 }, { get: async (x, z) => {
        if (x === 0) {
            started.resolve();
            return gate.promise;
        }
        return chunk(x, z);
    } });
    t.teardown(() => gate.resolve(chunk(0, 0)));
    const first = setup.streamer.update(0, 0);
    await started.promise;
    const latest = setup.streamer.update(1, 0);
    gate.reject(new Error("obsolete decode failed"));
    await Promise.all([first, latest]);
    t.deepEqual(setup.events, ["get:0,0", "get:1,0", "place:1,0"]);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 1, z: 0 }]);
    t.is(setup.streamer.pendingChunks, 0);
    t.is(setup.peak(), 1);
    await setup.streamer.dispose();
});

test("placement failures stop the drain and an explicit update retries after cleanup", async t => {
    const error = new Error("placement failed");
    let fail = true;
    const setup = fixture(undefined, { place: async () => {
        if (fail) {
            fail = false;
            throw error;
        }
    } });
    await t.throwsAsync(setup.streamer.update(0, 0), { is: error });
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.streamer.pendingChunks, 1);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload-many"]);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
});

test("failed unloads remain owned and are retried before subsequent loads", async t => {
    const error = new Error("unload failed");
    let fail = true;
    const setup = fixture(undefined, { unloadColumns: async () => {
        if (fail) {
            fail = false;
            throw error;
        }
    } });
    await setup.streamer.update(0, 0);
    await t.throwsAsync(setup.streamer.update(1, 0), { is: error });
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.false(setup.events.includes("get:1,0"));
    await setup.streamer.update(1, 0);
    t.deepEqual(setup.events.slice(2), ["unload-many", "unload-many", "get:1,0", "place:1,0"]);
    t.deepEqual([...setup.resident], ["1,0"]);
    await setup.streamer.dispose();
});

test("mismatched source coordinates are recorded while neighboring world columns still load", async t => {
    let mismatched = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { get: async (x, z) =>
        chunk(mismatched && x === -2 && z === 3 ? x + 1 : x, z) });
    await setup.streamer.update(-2, 3);
    t.is(setup.events[0], "get:-2,3");
    t.is(setup.resident.size, 8);
    t.false(setup.resident.has("-2,3"));
    t.true(setup.resident.has("-1,3"));
    t.deepEqual(setup.streamer.failedChunks.map(({ x, z }) => ({ x, z })), [{ x: -2, z: 3 }]);
    t.true(setup.streamer.failedChunks[0].error instanceof Error);
    t.is(setup.streamer.pendingChunks, 0);
    const events = [...setup.events];
    mismatched = false;
    await setup.streamer.update(-2, 3);
    t.deepEqual(setup.events, events);
    await setup.streamer.retryFailedChunks();
    t.deepEqual(setup.events.slice(events.length), ["get:-2,3", "place:-2,3"]);
    t.is(setup.streamer.loadedChunks.length, 9);
    t.deepEqual(setup.streamer.failedChunks, []);
    await setup.streamer.dispose();
});

test("failed placement cleanup is retried before reloading the same column", async t => {
    let failPlace = true, failUnload = true;
    const placementError = new Error("placement failed"), cleanupError = new Error("cleanup failed");
    const setup = fixture(undefined, {
        place: async () => {
            if (failPlace) {
                failPlace = false;
                throw placementError;
            }
        },
        unloadColumns: async () => {
            if (failUnload) {
                failUnload = false;
                throw cleanupError;
            }
        }
    });
    const error = await t.throwsAsync(setup.streamer.update(0, 0), { is: placementError });
    t.is((error as Error & { cause?: unknown }).cause, cleanupError);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.deepEqual([...setup.resident], ["0,0"]);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload-many", "unload-many", "get:0,0", "place:0,0"]);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
    await setup.streamer.dispose();
});

test("cleanup failures preserve frozen or primitive placement errors as the primary message", async t => {
    for (const placementError of [Object.freeze(new Error("frozen placement failure")), "primitive placement failure"]) {
        const cleanupError = new Error("cleanup failed");
        let failUnload = true;
        const setup = fixture(undefined, {
            place: async () => { throw placementError; },
            unloadColumns: async () => {
                if (failUnload) {
                    failUnload = false;
                    throw cleanupError;
                }
            }
        });
        const error = await t.throwsAsync(setup.streamer.update(0, 0), {
            message: placementError instanceof Error ? placementError.message : placementError
        });
        t.is((error as Error & { cause?: unknown }).cause, cleanupError);
        await setup.streamer.dispose();
        t.deepEqual([...setup.resident], []);
    }
});

test("disposal aborts a cooperative source read without waiting for its result", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    let activeSignal: AbortSignal | undefined;
    const setup = fixture({ loadRadius: 0, unloadRadius: 1 }, { get: async (x, z, signal) => {
        if (x === 1) {
            activeSignal = signal;
            signal?.addEventListener("abort", () => gate.reject(signal.reason), { once: true });
            started.resolve();
            return gate.promise;
        }
        return chunk(x, z);
    } });
    t.teardown(() => gate.resolve(chunk(1, 0)));
    await setup.streamer.update(0, 0);
    const update = setup.streamer.update(1, 0);
    await started.promise;
    await Promise.all([update, setup.streamer.dispose()]);
    t.true(activeSignal?.aborted);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "get:1,0", "unload-many"]);
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
    t.is(setup.peak(), 1);
});

test("disposal waits for an active decode and removes owned columns without placing the result", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    const setup = fixture({ loadRadius: 0, unloadRadius: 1 }, { get: async (x, z) => {
        if (x === 1) {
            started.resolve();
            return gate.promise;
        }
        return chunk(x, z);
    } });
    t.teardown(() => gate.resolve(chunk(1, 0)));
    await setup.streamer.update(0, 0);
    const update = setup.streamer.update(1, 0);
    await started.promise;
    let disposed = false;
    const dispose = setup.streamer.dispose().then(() => { disposed = true; });
    await t.throwsAsync(() => setup.streamer.update(2, 0));
    t.false(disposed);
    t.deepEqual([...setup.resident], ["0,0"]);
    gate.resolve(chunk(1, 0));
    await Promise.all([update, dispose]);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "get:1,0", "unload-many"]);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
    t.is(setup.peak(), 1);
    await setup.streamer.dispose();
});

test("disposal waits for an active placement and cleans up the completed column", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    const setup = fixture(undefined, { place: async () => {
        started.resolve();
        await gate.promise;
    } });
    t.teardown(() => gate.resolve());
    const update = setup.streamer.update(0, 0);
    await started.promise;
    const dispose = setup.streamer.dispose();
    t.deepEqual(setup.events, ["get:0,0", "place:0,0"]);
    gate.resolve();
    await Promise.all([update, dispose]);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload-many"]);
    t.deepEqual([...setup.resident], []);
    t.is(setup.peak(), 1);
});

test("disposal waits for an active unload without starting or repeating world mutations", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    const setup = fixture(undefined, { unloadColumns: async () => {
        started.resolve();
        await gate.promise;
    } });
    t.teardown(() => gate.resolve());
    await setup.streamer.update(0, 0);
    const update = setup.streamer.update(1, 0);
    await started.promise;
    let disposed = false;
    const dispose = setup.streamer.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    t.false(disposed);
    t.deepEqual([...setup.resident], ["0,0"]);
    gate.resolve();
    await Promise.all([update, dispose]);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload-many"]);
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.peak(), 1);
});

test("a source rejection during disposal does not leave failure records or allow retries", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    const setup = fixture(undefined, { get: async () => {
        started.resolve();
        return gate.promise;
    } });
    t.teardown(() => gate.resolve(chunk(0, 0)));
    const update = setup.streamer.update(0, 0);
    await started.promise;
    const dispose = setup.streamer.dispose();
    await t.throwsAsync(() => setup.streamer.retryFailedChunks());
    gate.reject(new Error("decode failed after disposal"));
    await Promise.all([update, dispose]);
    t.deepEqual(setup.events, ["get:0,0"]);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
});

test("streaming groups obsolete columns while keeping neighbors inside the retention radius", async t => {
    const setup = fixture({ loadRadius: 1, unloadRadius: 2 }, { unloadColumns: async () => {} });
    await setup.streamer.update(0, 0);
    await setup.streamer.update(1, 0);
    t.is(setup.resident.size, 12);
    t.deepEqual(setup.bulkCalls, []);
    setup.events.length = 0;
    await setup.streamer.update(2, 0);
    t.is(setup.bulkCalls.length, 1);
    t.deepEqual(setup.bulkCalls[0].map(({ x, z }) => key(x, z)).sort(), ["-1,-1", "-1,0", "-1,1"]);
    t.is(setup.events[0], "unload-many");
    t.true(setup.events[1].startsWith("get:"));
    t.false(setup.events.some(event => event.startsWith("unload:")));
    t.is(setup.resident.size, 12);
    t.true(setup.resident.has("0,0"));
    t.true(setup.resident.has("3,0"));
    t.true(setup.streamer.loadedChunks.every(({ x, z }) => Math.abs(x - 2) <= 2 && Math.abs(z) <= 2));
    await setup.streamer.dispose();
    t.is(setup.bulkCalls.length, 2);
    t.is(setup.bulkCalls[1].length, 12);
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.peak(), 1);
});

test("failed bulk unloading preserves every owner and passes fresh coordinates on retry", async t => {
    for (const retryCenter of [0, 6]) {
        const error = new Error("one column failed");
        let fail = true;
        const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { unloadColumns: async columns => {
            if (fail) {
                fail = false;
                for (const { x, z } of columns.slice(1)) setup.resident.delete(key(x, z));
                columns[0].x = 999;
                throw error;
            }
        } });
        await setup.streamer.update(0, 0);
        await t.throwsAsync(setup.streamer.update(6, 0), { is: error });
        t.is(setup.resident.size, 1);
        t.deepEqual(setup.streamer.loadedChunks, []);
        t.is(setup.bulkCalls[0].length, 9);
        t.false(setup.events.includes("get:6,0"));
        await setup.streamer.update(retryCenter, 0);
        t.deepEqual(setup.bulkCalls[1], setup.bulkCalls[0]);
        t.is(setup.resident.size, 9);
        t.true(setup.streamer.loadedChunks.every(({ x, z }) => Math.abs(x - retryCenter) <= 1 && Math.abs(z) <= 1));
        t.is(setup.streamer.pendingChunks, 0);
        t.is(setup.peak(), 1);
        await setup.streamer.dispose();
    }
});

test("an awaited bulk unload rechecks the latest center, including a return to the removed area", async t => {
    t.timeout(3000);
    for (const target of [0, 10]) {
        const gate = deferred(), started = deferred();
        let first = true;
        const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { unloadColumns: async () => {
            if (first) {
                first = false;
                started.resolve();
                await gate.promise;
            }
        } });
        t.teardown(() => gate.resolve());
        await setup.streamer.update(0, 0);
        setup.events.length = 0;
        const away = setup.streamer.update(6, 0);
        await started.promise;
        const latest = setup.streamer.update(target, 0);
        t.deepEqual(setup.events, ["unload-many"]);
        gate.resolve();
        await Promise.all([away, latest]);
        t.is(setup.bulkCalls.length, 1);
        t.is(setup.bulkCalls[0].length, 9);
        t.is(setup.events.filter(event => event.startsWith("get:")).length, 9);
        t.false(setup.events.includes("get:6,0"));
        t.true(setup.events.includes(`get:${target},0`));
        t.is(setup.streamer.loadedChunks.length, 9);
        t.true(setup.streamer.loadedChunks.every(({ x, z }) => Math.abs(x - target) <= 1 && Math.abs(z) <= 1));
        t.is(setup.peak(), 1);
        await setup.streamer.dispose();
    }
});

test("disposal waits for an active bulk unload without loading or repeating removed columns", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { unloadColumns: async () => {
        started.resolve();
        await gate.promise;
    } });
    t.teardown(() => gate.resolve());
    await setup.streamer.update(0, 0);
    setup.events.length = 0;
    const update = setup.streamer.update(6, 0);
    await started.promise;
    let disposed = false;
    const dispose = setup.streamer.dispose().then(() => { disposed = true; });
    await Promise.resolve();
    t.false(disposed);
    t.deepEqual(setup.events, ["unload-many"]);
    gate.resolve();
    await Promise.all([update, dispose]);
    t.deepEqual(setup.events, ["unload-many"]);
    t.is(setup.bulkCalls.length, 1);
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
    t.is(setup.peak(), 1);
});

test("bulk disposal aborts a source read before unloading retained owners", async t => {
    t.timeout(3000);
    const gate = deferred<AnvilChunk>(), started = deferred();
    let activeSignal: AbortSignal | undefined;
    const setup = fixture({ loadRadius: 0, unloadRadius: 1 }, {
        get: async (x, z, signal) => {
            if (x === 1) {
                activeSignal = signal;
                signal?.addEventListener("abort", () => gate.reject(signal.reason), { once: true });
                started.resolve();
                return gate.promise;
            }
            return chunk(x, z);
        },
        unloadColumns: async () => {}
    });
    t.teardown(() => gate.resolve(chunk(1, 0)));
    await setup.streamer.update(0, 0);
    const update = setup.streamer.update(1, 0);
    await started.promise;
    await Promise.all([update, setup.streamer.dispose()]);
    t.true(activeSignal?.aborted);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "get:1,0", "unload-many"]);
    t.deepEqual(setup.bulkCalls, [[{ x: 0, z: 0 }]]);
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.peak(), 1);
});

test("bulk disposal waits for active placement and groups the completed owner with retained columns", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    const setup = fixture({ loadRadius: 0, unloadRadius: 1 }, {
        place: async value => {
            if (value.x === 1) {
                started.resolve();
                await gate.promise;
            }
        },
        unloadColumns: async () => {}
    });
    t.teardown(() => gate.resolve());
    await setup.streamer.update(0, 0);
    const update = setup.streamer.update(1, 0);
    await started.promise;
    const dispose = setup.streamer.dispose();
    t.deepEqual(setup.bulkCalls, []);
    gate.resolve();
    await Promise.all([update, dispose]);
    t.deepEqual(setup.bulkCalls, [[{ x: 0, z: 0 }, { x: 1, z: 0 }]]);
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.peak(), 1);
});

test("failed bulk disposal retries the whole group after partial removal", async t => {
    const error = new Error("cleanup failed");
    let fail = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { unloadColumns: async columns => {
        if (fail) {
            fail = false;
            for (const { x, z } of columns.slice(1)) setup.resident.delete(key(x, z));
            throw error;
        }
    } });
    await setup.streamer.update(0, 0);
    await t.throwsAsync(setup.streamer.dispose(), { is: error });
    t.is(setup.bulkCalls.length, 1);
    t.is(setup.bulkCalls[0].length, 9);
    t.is(setup.resident.size, 1);
    t.deepEqual(setup.streamer.loadedChunks, []);
    await setup.streamer.dispose();
    t.deepEqual(setup.bulkCalls[1], setup.bulkCalls[0]);
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.peak(), 1);
    await t.throwsAsync(() => setup.streamer.update(0, 0));
});

test("bulk disposal preserves null or undefined rejections and remains retryable", async t => {
    for (const error of [null, undefined]) {
        let fail = true;
        const setup = fixture(undefined, { unloadColumns: async () => {
            if (fail) {
                fail = false;
                throw error;
            }
        } });
        await setup.streamer.update(0, 0);
        let rejected = false;
        try {
            await setup.streamer.dispose();
        } catch (failure) {
            rejected = true;
            t.is(failure, error);
        }
        t.true(rejected);
        t.deepEqual(setup.streamer.loadedChunks, []);
        await setup.streamer.dispose();
        t.deepEqual([...setup.resident], []);
        t.is(setup.bulkCalls.length, 2);
    }
});

test("disposing an empty bulk-capable streamer does not call world unload methods", async t => {
    const setup = fixture(undefined, { unloadColumns: async () => {} });
    await setup.streamer.dispose();
    await setup.streamer.dispose();
    t.deepEqual(setup.events, []);
    t.deepEqual(setup.bulkCalls, []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    await t.throwsAsync(() => setup.streamer.update(0, 0));
});

test("bulk placement prefetches four columns and groups ready columns in distance order", async t => {
    t.timeout(3000);
    const reads: { x: number; z: number; gate: ReturnType<typeof deferred<AnvilChunk>> }[] = [];
    const started = deferred(), placing = deferred(), release = deferred();
    let first = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z) => {
            if (reads.length < 4) {
                const gate = deferred<AnvilChunk>();
                reads.push({ x, z, gate });
                if (reads.length === 4) started.resolve();
                return gate.promise;
            }
            return chunk(x, z);
        },
        placeChunks: async () => {
            if (first) {
                first = false;
                placing.resolve();
                await release.promise;
            }
        }
    });
    t.teardown(() => { reads.forEach(({ x, z, gate }) => gate.resolve(chunk(x, z))); release.resolve(); });
    const update = setup.streamer.update(0, 0);
    await started.promise;
    t.deepEqual(setup.placements, []);
    for (const { x, z, gate } of reads) gate.resolve(chunk(x, z));
    await placing.promise;
    t.deepEqual(setup.placements[0], reads.map(({ x, z }) => ({ x, z })));
    t.is(setup.placements[0].length, 4);
    t.is(setup.events.filter(event => event.startsWith("get:")).length, 4);
    release.resolve();
    await update;
    const requested = setup.events.filter(event => event.startsWith("get:")).map(event => event.slice(4));
    t.deepEqual(setup.placements.flat().map(({ x, z }) => key(x, z)), requested);
    const distances = setup.placements.flat().map(({ x, z }) => x * x + z * z);
    t.deepEqual(distances, distances.slice().sort((a, b) => a - b));
    t.true(setup.placements.every(group => group.length > 0 && group.length <= 4));
    t.is(setup.streamer.loadedChunks.length, 9);
    t.is(setup.peakReads(), 4);
    t.is(setup.peakMutations(), 1);
    t.false(setup.events.some(event => event.startsWith("place:")));
    await setup.streamer.dispose();
});

test("a ready nearest column is placed before slow later source reads finish", async t => {
    t.timeout(3000);
    const placing = deferred(), release = deferred();
    const reads: { x: number; z: number; gate: ReturnType<typeof deferred<AnvilChunk>> }[] = [];
    let allowReads = false, first = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z) => {
            if (x === 0 && z === 0 || allowReads) return chunk(x, z);
            const gate = deferred<AnvilChunk>();
            reads.push({ x, z, gate });
            return gate.promise;
        },
        placeChunks: async () => {
            if (first) {
                first = false;
                placing.resolve();
                await release.promise;
            }
        }
    });
    t.teardown(() => { reads.forEach(({ x, z, gate }) => gate.resolve(chunk(x, z))); release.resolve(); });
    const update = setup.streamer.update(0, 0);
    await placing.promise;
    t.deepEqual(setup.placements, [[{ x: 0, z: 0 }]]);
    t.is(reads.length, 3);
    t.deepEqual(setup.streamer.loadedChunks, []);
    allowReads = true;
    for (const { x, z, gate } of reads) gate.resolve(chunk(x, z));
    release.resolve();
    await update;
    t.is(setup.streamer.loadedChunks.length, 9);
    t.is(setup.peakMutations(), 1);
    await setup.streamer.dispose();
});

test("ready later columns occupy the prefetch window without bypassing an unresolved nearer column", async t => {
    t.timeout(3000);
    const initial = deferred(), firstPlacement = deferred(), fifthRead = deferred();
    const reads: { x: number; z: number; gate: ReturnType<typeof deferred<AnvilChunk>> }[] = [];
    let allowReads = false;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z) => {
            if (allowReads) return chunk(x, z);
            const gate = deferred<AnvilChunk>();
            reads.push({ x, z, gate });
            if (reads.length === 4) initial.resolve();
            if (reads.length === 5) fifthRead.resolve();
            return gate.promise;
        },
        placeChunks: async () => { firstPlacement.resolve(); }
    });
    t.teardown(() => reads.forEach(({ x, z, gate }) => gate.resolve(chunk(x, z))));
    const update = setup.streamer.update(0, 0);
    await initial.promise;
    for (const index of [0, 2, 3]) {
        const { x, z, gate } = reads[index];
        gate.resolve(chunk(x, z));
    }
    await firstPlacement.promise;
    await fifthRead.promise;
    await new Promise<void>(resolve => setImmediate(resolve));
    t.is(reads.length, 5);
    t.deepEqual(setup.placements, [[{ x: 0, z: 0 }]]);
    allowReads = true;
    for (const { x, z, gate } of reads) gate.resolve(chunk(x, z));
    await update;
    const requested = setup.events.filter(event => event.startsWith("get:")).map(event => event.slice(4));
    t.deepEqual(setup.placements.flat().map(({ x, z }) => key(x, z)), requested);
    t.is(setup.streamer.loadedChunks.length, 9);
    await setup.streamer.dispose();
});

test("moving the bulk target aborts every obsolete read and discards ignored late results", async t => {
    t.timeout(3000);
    const started = deferred();
    const reads: { x: number; z: number; gate: ReturnType<typeof deferred<AnvilChunk>>; signal?: AbortSignal }[] = [];
    let allowReads = false;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z, signal) => {
            if (allowReads) return chunk(x, z);
            const gate = deferred<AnvilChunk>();
            reads.push({ x, z, gate, signal });
            if (reads.length === 4) started.resolve();
            return gate.promise;
        },
        placeChunks: async () => {}
    });
    t.teardown(() => reads.forEach(({ x, z, gate }) => gate.resolve(chunk(x, z))));
    const first = setup.streamer.update(0, 0);
    await started.promise;
    const latest = setup.streamer.update(6, 0);
    t.true(reads.every(read => read.signal?.aborted));
    t.is(setup.events.length, 4);
    allowReads = true;
    for (const { x, z, gate } of reads) gate.resolve(chunk(x, z));
    await Promise.all([first, latest]);
    t.is(setup.streamer.loadedChunks.length, 9);
    t.true(setup.placements.flat().every(({ x, z }) => Math.abs(x - 6) <= 1 && Math.abs(z) <= 1));
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.peakReads(), 4);
    t.is(setup.peakMutations(), 1);
    await setup.streamer.dispose();
});

test("a center change during grouped placement unloads that whole group before placing the new area", async t => {
    t.timeout(3000);
    const started = deferred(), gate = deferred();
    let first = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { placeChunks: async () => {
        if (first) {
            first = false;
            started.resolve();
            await gate.promise;
        }
    } });
    t.teardown(() => gate.resolve());
    const initial = setup.streamer.update(0, 0);
    await started.promise;
    const placed = setup.placements[0];
    const latest = setup.streamer.update(6, 0);
    t.deepEqual(setup.bulkCalls, []);
    gate.resolve();
    await Promise.all([initial, latest]);
    t.deepEqual(setup.bulkCalls[0], placed);
    t.true(setup.placements.slice(1).flat().every(({ x, z }) => Math.abs(x - 6) <= 1 && Math.abs(z) <= 1));
    t.is(setup.resident.size, 9);
    t.is(setup.streamer.loadedChunks.length, 9);
    t.is(setup.peakMutations(), 1);
    await setup.streamer.dispose();
});

test("disposal aborts bulk prefetch and waits for active grouped placement before cleanup", async t => {
    t.timeout(3000);
    const started = deferred(), placement = deferred();
    const signals: AbortSignal[] = [];
    const reads: ReturnType<typeof deferred<AnvilChunk>>[] = [];
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z, signal) => {
            if (x === 0 && z === 0) return chunk(x, z);
            const read = deferred<AnvilChunk>();
            reads.push(read);
            signals.push(signal!);
            signal!.addEventListener("abort", () => read.reject(signal!.reason), { once: true });
            return read.promise;
        },
        placeChunks: async () => { started.resolve(); await placement.promise; }
    });
    t.teardown(() => { reads.forEach(read => read.resolve(chunk(0, 0))); placement.resolve(); });
    const update = setup.streamer.update(0, 0);
    await started.promise;
    const dispose = setup.streamer.dispose();
    t.true(signals.every(signal => signal.aborted));
    t.is(signals.length, 3);
    t.deepEqual(setup.bulkCalls, []);
    placement.resolve();
    await Promise.all([update, dispose]);
    t.deepEqual(setup.bulkCalls, [[{ x: 0, z: 0 }]]);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.deepEqual([...setup.resident], []);
    t.is(setup.streamer.pendingChunks, 0);
    t.is(setup.peakMutations(), 1);
});

test("bulk source failures, missing columns, and coordinate mismatches do not prevent later ready columns", async t => {
    const error = new Error("unreadable center");
    let fail = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z) => {
            if (fail && x === 0 && z === 0) throw error;
            if (x === 0 && z === -1) return undefined;
            return chunk(fail && x === -1 && z === 0 ? x + 1 : x, z);
        },
        placeChunks: async () => {}
    });
    await setup.streamer.update(0, 0);
    t.is(setup.streamer.loadedChunks.length, 6);
    t.is(setup.streamer.failedChunks.length, 2);
    t.is(setup.streamer.failedChunks[0].error, error);
    t.is(setup.streamer.pendingChunks, 0);
    const count = setup.events.filter(event => event.startsWith("get:")).length;
    await setup.streamer.update(0, 0);
    t.is(setup.events.filter(event => event.startsWith("get:")).length, count);
    fail = false;
    await setup.streamer.retryFailedChunks();
    t.is(setup.streamer.loadedChunks.length, 8);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
});

test("a failed grouped placement cleans every attempted owner before retrying", async t => {
    for (const error of [new Error("partial placement"), null, undefined]) {
        let fail = true;
        const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { placeChunks: async chunks => {
            if (fail) {
                fail = false;
                for (const { x, z } of chunks.slice(1)) setup.resident.delete(key(x, z));
                throw error;
            }
        } });
        let rejected = false;
        try { await setup.streamer.update(0, 0); }
        catch (failure) { rejected = true; t.is(failure, error); }
        t.true(rejected);
        t.deepEqual(setup.bulkCalls[0], setup.placements[0]);
        t.deepEqual(setup.streamer.loadedChunks, []);
        t.deepEqual(setup.streamer.failedChunks, []);
        t.deepEqual([...setup.resident], []);
        await setup.streamer.update(0, 0);
        t.is(setup.streamer.loadedChunks.length, 9);
        t.is(setup.resident.size, 9);
        t.is(setup.peakMutations(), 1);
        await setup.streamer.dispose();
    }
});

test("failed grouped-placement cleanup retains even unattempted owners for a later retry", async t => {
    const placementError = Object.freeze(new Error("partial placement")), cleanupError = new Error("cleanup failed");
    let failPlace = true, failUnload = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        placeChunks: async chunks => {
            if (failPlace) {
                failPlace = false;
                for (const { x, z } of chunks.slice(1)) setup.resident.delete(key(x, z));
                throw placementError;
            }
        },
        unloadColumns: async () => {
            if (failUnload) {
                failUnload = false;
                throw cleanupError;
            }
        }
    });
    const error = await t.throwsAsync(setup.streamer.update(0, 0), { message: placementError.message });
    t.is((error as Error & { cause?: unknown }).cause, cleanupError);
    const attempted = setup.placements[0];
    t.is(attempted.length, 4);
    t.deepEqual(setup.bulkCalls[0], attempted);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.is(setup.resident.size, 1);
    const resumedAt = setup.events.length;
    await setup.streamer.update(0, 0);
    t.is(setup.events[resumedAt], "unload-many");
    t.deepEqual(setup.bulkCalls[1], attempted);
    t.is(setup.streamer.loadedChunks.length, 9);
    t.is(setup.resident.size, 9);
    t.is(setup.peakMutations(), 1);
    await setup.streamer.dispose();
});

test("a placement rejection does not await unrelated reads, but disposal still waits for them", async t => {
    t.timeout(3000);
    const error = new Error("placement failed");
    const reads: { x: number; z: number; gate: ReturnType<typeof deferred<AnvilChunk>>; signal?: AbortSignal }[] = [];
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z, signal) => {
            if (x === 0 && z === 0) return chunk(x, z);
            const gate = deferred<AnvilChunk>();
            reads.push({ x, z, gate, signal });
            return gate.promise;
        },
        placeChunks: async () => { throw error; }
    });
    t.teardown(() => reads.forEach(({ x, z, gate }) => gate.resolve(chunk(x, z))));
    await t.throwsAsync(setup.streamer.update(0, 0), { is: error });
    t.is(reads.length, 3);
    t.true(reads.every(read => read.signal?.aborted));
    t.deepEqual(setup.bulkCalls, [[{ x: 0, z: 0 }]]);
    t.deepEqual([...setup.resident], []);
    let disposed = false;
    const dispose = setup.streamer.dispose().then(() => { disposed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.false(disposed);
    for (const { x, z, gate } of reads) gate.resolve(chunk(x, z));
    await dispose;
    t.true(disposed);
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.placements.length, 1);
    t.is(setup.peakMutations(), 1);
});

test("retrying after placement failure keeps aborted reads bounded and discards their late in-area results", async t => {
    t.timeout(3000);
    const error = new Error("first placement failed"), placing = deferred(), release = deferred();
    const reads: { x: number; z: number; gate: ReturnType<typeof deferred<AnvilChunk>>; signal?: AbortSignal }[] = [];
    let firstPass = true, firstRetry = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, {
        get: async (x, z, signal) => {
            if (!firstPass || x === 0 && z === 0) return chunk(x, z);
            const gate = deferred<AnvilChunk>();
            reads.push({ x, z, gate, signal });
            return gate.promise;
        },
        placeChunks: async () => {
            if (firstPass) throw error;
            if (firstRetry) {
                firstRetry = false;
                placing.resolve();
                await release.promise;
            }
        }
    });
    t.teardown(() => { reads.forEach(({ x, z, gate }) => gate.resolve(chunk(x, z))); release.resolve(); });
    await t.throwsAsync(setup.streamer.update(0, 0), { is: error });
    t.is(reads.length, 3);
    t.true(reads.every(read => read.signal?.aborted));
    firstPass = false;
    const retry = setup.streamer.update(0, 0);
    await placing.promise;
    t.deepEqual(setup.placements, [[{ x: 0, z: 0 }], [{ x: 0, z: 0 }]]);
    t.is(setup.events.filter(event => event.startsWith("get:")).length, 5);
    t.is(setup.peakReads(), 4);
    for (const { x, z, gate } of reads) gate.resolve(chunk(x, z));
    release.resolve();
    await retry;
    for (const { x, z } of reads) t.is(setup.events.filter(event => event === `get:${x},${z}`).length, 2);
    t.is(setup.events.filter(event => event.startsWith("get:")).length, 13);
    t.is(setup.placements.slice(1).flat().length, 9);
    t.is(setup.streamer.loadedChunks.length, 9);
    t.is(setup.resident.size, 9);
    t.deepEqual(setup.streamer.failedChunks, []);
    t.is(setup.peakReads(), 4);
    t.is(setup.peakMutations(), 1);
    await setup.streamer.dispose();
});
