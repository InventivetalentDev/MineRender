import test from "ava";
import type { AnvilChunk } from "../src/world/AnvilParser";
import { WorldStreamer } from "../src/world/WorldStreamer";

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const chunk = (x: number, z: number): AnvilChunk => ({ x, z, sections: [] });
const key = (x: number, z: number) => `${x},${z}`;

function fixture(options: { loadRadius?: number; unloadRadius?: number } = { loadRadius: 0, unloadRadius: 0 }, hooks: {
    get?: (x: number, z: number, signal?: AbortSignal) => Promise<AnvilChunk | undefined>;
    place?: (value: AnvilChunk) => Promise<void>;
    unload?: (x: number, z: number) => Promise<void>;
} = {}) {
    const events: string[] = [], resident = new Set<string>();
    let active = 0, peak = 0;
    async function operation<T>(event: string, action: () => Promise<T>): Promise<T> {
        events.push(event);
        peak = Math.max(peak, ++active);
        try {
            return await action();
        } finally {
            active--;
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
        unloadChunkColumn: (x: number, z: number) => operation(`unload:${key(x, z)}`, async () => {
            await hooks.unload?.(x, z);
            resident.delete(key(x, z));
        })
    };
    return { streamer: new WorldStreamer(world, source, options), events, resident, peak: () => peak, world, source };
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
    t.false(setup.events.some(value => value.startsWith("unload:")));
    setup.events.length = 0;
    await setup.streamer.update(2, 0);
    t.is(setup.streamer.loadedChunks.length, 30);
    t.deepEqual(setup.events.slice(0, 5).sort(), [-2, -1, 0, 1, 2].map(z => `unload:-2,${z}`).sort());
    t.true(setup.events[5].startsWith("get:"));
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
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload:0,0", "get:4,0", "place:4,0"]);
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
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload:0,0"]);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
    t.is(setup.streamer.pendingChunks, 0);
    await setup.streamer.dispose();
});

test("failed unloads remain owned and are retried before subsequent loads", async t => {
    const error = new Error("unload failed");
    let fail = true;
    const setup = fixture(undefined, { unload: async () => {
        if (fail) {
            fail = false;
            throw error;
        }
    } });
    await setup.streamer.update(0, 0);
    await t.throwsAsync(setup.streamer.update(1, 0), { is: error });
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
    t.false(setup.events.includes("get:1,0"));
    await setup.streamer.update(1, 0);
    t.deepEqual(setup.events.slice(2), ["unload:0,0", "unload:0,0", "get:1,0", "place:1,0"]);
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
        unload: async () => {
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
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload:0,0", "unload:0,0", "get:0,0", "place:0,0"]);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
    await setup.streamer.dispose();
});

test("cleanup failures preserve frozen or primitive placement errors as the primary message", async t => {
    for (const placementError of [Object.freeze(new Error("frozen placement failure")), "primitive placement failure"]) {
        const cleanupError = new Error("cleanup failed");
        let failUnload = true;
        const setup = fixture(undefined, {
            place: async () => { throw placementError; },
            unload: async () => {
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
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "get:1,0", "unload:0,0"]);
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
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "get:1,0", "unload:0,0"]);
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
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload:0,0"]);
    t.deepEqual([...setup.resident], []);
    t.is(setup.peak(), 1);
});

test("disposal waits for an active unload without starting or repeating world mutations", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    const setup = fixture(undefined, { unload: async () => {
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
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload:0,0"]);
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

test("disposal attempts every owned column and can retry failed cleanup", async t => {
    const error = new Error("cleanup failed");
    let fail = true;
    const setup = fixture({ loadRadius: 1, unloadRadius: 1 }, { unload: async (x, z) => {
        if (x === 0 && z === 0 && fail) {
            fail = false;
            throw error;
        }
    } });
    await setup.streamer.update(0, 0);
    await t.throwsAsync(setup.streamer.dispose());
    t.is(setup.events.filter(value => value.startsWith("unload:")).length, 9);
    t.deepEqual([...setup.resident], ["0,0"]);
    await setup.streamer.dispose();
    t.deepEqual([...setup.resident], []);
    t.deepEqual(setup.streamer.loadedChunks, []);
    await t.throwsAsync(() => setup.streamer.update(0, 0));
});
