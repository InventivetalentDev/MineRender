import test from "ava";
import type { AnvilChunk } from "../src/world/AnvilParser";
import { WorldStreamer } from "../src/world/WorldStreamer";

function deferred<T = void>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}

const chunk = (x: number, z: number): AnvilChunk => ({ x, z, sections: [] });
const key = (x: number, z: number) => `${x},${z}`;

function fixture(options: { loadRadius?: number; unloadRadius?: number } = { loadRadius: 0, unloadRadius: 0 }, hooks: {
    get?: (x: number, z: number) => Promise<AnvilChunk | undefined>;
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
        getChunk: (x: number, z: number) => operation(`get:${key(x, z)}`, async () => hooks.get ? hooks.get(x, z) : chunk(x, z))
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

test("source and placement failures stop the drain and an explicit update retries after cleanup", async t => {
    for (const stage of ["get", "place"] as const) {
        const error = new Error(`${stage} failed`);
        let fail = true;
        const setup = fixture(undefined, {
            [stage]: async (value: number | AnvilChunk, z?: number) => {
                if (fail) {
                    fail = false;
                    throw error;
                }
                if (typeof value === "number") return chunk(value, z!);
            }
        });
        await t.throwsAsync(setup.streamer.update(0, 0), { is: error });
        t.deepEqual([...setup.resident], []);
        t.deepEqual(setup.streamer.loadedChunks, []);
        t.is(setup.streamer.pendingChunks, 1);
        t.deepEqual(setup.events, stage === "get" ? ["get:0,0"] : ["get:0,0", "place:0,0", "unload:0,0"]);
        await setup.streamer.update(0, 0);
        t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
        t.is(setup.streamer.pendingChunks, 0);
        await setup.streamer.dispose();
    }
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

test("source chunks with mismatched coordinates cannot replace unrelated world columns", async t => {
    let mismatched = true;
    const setup = fixture(undefined, { get: async (x, z) => chunk(mismatched ? x + 1 : x, z) });
    await t.throwsAsync(setup.streamer.update(-2, 3));
    t.deepEqual(setup.events, ["get:-2,3"]);
    t.deepEqual([...setup.resident], []);
    mismatched = false;
    await setup.streamer.update(-2, 3);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: -2, z: 3 }]);
    await setup.streamer.dispose();
});

test("failed placement cleanup is retried before reloading the same column", async t => {
    let failPlace = true, failUnload = true;
    const setup = fixture(undefined, {
        place: async () => {
            if (failPlace) {
                failPlace = false;
                throw new Error("placement failed");
            }
        },
        unload: async () => {
            if (failUnload) {
                failUnload = false;
                throw new Error("cleanup failed");
            }
        }
    });
    await t.throwsAsync(setup.streamer.update(0, 0));
    t.deepEqual(setup.streamer.loadedChunks, []);
    t.deepEqual([...setup.resident], ["0,0"]);
    await setup.streamer.update(0, 0);
    t.deepEqual(setup.events, ["get:0,0", "place:0,0", "unload:0,0", "unload:0,0", "get:0,0", "place:0,0"]);
    t.deepEqual(setup.streamer.loadedChunks, [{ x: 0, z: 0 }]);
    await setup.streamer.dispose();
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
