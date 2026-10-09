import test from "ava";
import { AssetKey, AssetLoader, AssetParser, AssetSource, shutdown } from "../src";
import type { MinecraftAsset, Maybe } from "../src";

class StubSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey) => Promise<unknown>,
                private readonly block: (key: AssetKey) => boolean | Promise<boolean> = () => false) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<Maybe<T>> { return await this.load(key) as Maybe<T>; }
    blocks(key: AssetKey): boolean | Promise<boolean> { return this.block(key); }
}

const key = AssetKey.parse("models", "block/stone");
const lookup = (): Promise<unknown> => AssetLoader.get(key, AssetParser.MODEL);
let defaults: Array<{ name: string; source: AssetSource }>;

test.beforeEach(() => {
    defaults = [];
    for (const name of ["mcassets"]) {
        const source = AssetLoader.removeSource(name);
        if (source) defaults.push({ name, source });
    }
});
test.afterEach.always(() => {
    for (const name of ["test-low", "test-high", "test-added"]) AssetLoader.removeSource(name);
    for (const { name, source } of defaults.reverse()) AssetLoader.addSource(name, source);
});
test.after.always(() => shutdown());

test.serial("the highest-priority defined asset wins without loading or merging lower sources", async t => {
    let lowerCalls = 0;
    const winner = { textures: { all: "custom" } };
    AssetLoader.addSource("test-low", new StubSource(async () => { lowerCalls++; return { elements: [] }; }));
    AssetLoader.addSource("test-high", new StubSource(async () => winner));
    t.deepEqual(await lookup(), winner);
    t.is(lowerCalls, 0);
    t.deepEqual(winner, { textures: { all: "custom" } });
});

test.serial("only an undefined result permits the next source", async t => {
    const calls: string[] = [];
    AssetLoader.addSource("test-low", new StubSource(async () => { calls.push("low"); return {}; }));
    AssetLoader.addSource("test-high", new StubSource(async () => { calls.push("high"); return undefined; }));
    t.deepEqual(await lookup(), {});
    t.deepEqual(calls, ["high", "low"]);

    calls.length = 0;
    AssetLoader.addSource("test-high", new StubSource(async () => false));
    t.is(await lookup(), false);
    t.deepEqual(calls, []);
});

test.serial("a source rejection stops fallback and preserves the error", async t => {
    const failure = new Error("source unavailable");
    let lowerCalls = 0;
    AssetLoader.addSource("test-low", new StubSource(async () => { lowerCalls++; return {}; }));
    AssetLoader.addSource("test-high", new StubSource(async () => { throw failure; }));
    await t.throwsAsync(lookup(), { is: failure });
    t.is(lowerCalls, 0);
});

test.serial("source changes apply to the next lookup, not one already waiting", async t => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const original = { textures: { all: "original" } };
    const replacement = { textures: { all: "replacement" } };
    AssetLoader.addSource("test-low", new StubSource(async () => original));
    AssetLoader.addSource("test-high", new StubSource(async () => { await waiting; return undefined; }));
    const pending = lookup();
    AssetLoader.removeSource("test-low");
    AssetLoader.addSource("test-added", new StubSource(async () => replacement));
    release();
    t.deepEqual(await pending, original);
    t.deepEqual(await lookup(), replacement);
});

test.serial("structure directory aliases preserve resource-pack priority", async t => {
    const modern = new AssetKey("minecraft", "igloo/top", "structure", undefined, "data", ".nbt");
    const legacy = new AssetKey("minecraft", "igloo/top", "structures", undefined, "data", ".nbt");
    const packed = { size: [7, 5, 8] };
    const hosted = { size: [10, 4, 10] };
    let lowerCalls = 0;
    AssetLoader.addSource("test-low", new StubSource(async key => {
        lowerCalls++;
        return key.assetType === "structure" ? hosted : undefined;
    }));
    AssetLoader.addSource("test-high", new StubSource(async key => key.assetType === "structures" ? packed : undefined));

    t.deepEqual(await AssetLoader.get(modern, AssetParser.NBT), packed);
    t.deepEqual(await AssetLoader.get(legacy, AssetParser.NBT), packed);
    t.is(lowerCalls, 0);
    t.deepEqual(await AssetLoader.getFirst([modern, legacy], AssetParser.NBT), { key: legacy, asset: packed });

    AssetLoader.removeSource("test-high");
    t.deepEqual(await AssetLoader.get(legacy, AssetParser.NBT), hosted);
});

test.serial("a missing filtered asset never loads from lower sources", async t => {
    let lowerCalls = 0;
    AssetLoader.addSource("test-low", new StubSource(async () => { lowerCalls++; return {}; }));
    AssetLoader.addSource("test-high", new StubSource(async () => undefined, async blocked => blocked.serialize() === key.serialize()));

    t.is(await lookup(), undefined);
    t.is(lowerCalls, 0);
});

test.serial("a source can supply the same asset it filters from lower sources", async t => {
    let lowerCalls = 0;
    const winner = { textures: { all: "custom" } };
    AssetLoader.addSource("test-low", new StubSource(async () => { lowerCalls++; return {}; }));
    AssetLoader.addSource("test-high", new StubSource(async () => winner, () => true));

    t.deepEqual(await lookup(), winner);
    t.is(lowerCalls, 0);
});

test.serial("alias filters apply after trying the current source and preserve unblocked alternatives", async t => {
    const modern = new AssetKey("minecraft", "igloo/top", "structure", undefined, "data", ".nbt");
    const legacy = new AssetKey("minecraft", "igloo/top", "structures", undefined, "data", ".nbt");
    const packed = { size: [7, 5, 8] };
    const hosted = { size: [10, 4, 10] };
    const calls: string[] = [];
    AssetLoader.addSource("test-low", new StubSource(async key => {
        calls.push(`low:${key.assetType}`);
        return hosted;
    }));
    AssetLoader.addSource("test-high", new StubSource(async key => {
        calls.push(`high:${key.assetType}`);
        return key.assetType === legacy.assetType ? packed : undefined;
    }, () => true));

    t.deepEqual(await AssetLoader.getFirst([modern, legacy], AssetParser.NBT), { key: legacy, asset: packed });
    t.deepEqual(calls, ["high:structure", "high:structures"]);

    calls.length = 0;
    AssetLoader.addSource("test-high", new StubSource(async key => {
        calls.push(`high:${key.assetType}`);
        return undefined;
    }, key => key.assetType === modern.assetType));

    t.deepEqual(await AssetLoader.getFirst([modern, legacy], AssetParser.NBT), { key: legacy, asset: hosted });
    t.deepEqual(calls, ["high:structure", "high:structures", "low:structures"]);
});

test.serial("getAll includes a filtering source's asset and stops even when that asset is missing", async t => {
    const font = AssetKey.parse("font", "default");
    const upper = { providers: [{ type: "space", advances: { " ": 4 } }] };
    const filtered = { providers: [{ type: "space", advances: { " ": 6 } }] };
    let lowerCalls = 0;
    AssetLoader.addSource("test-low", new StubSource(async () => { lowerCalls++; return { providers: [] }; }));
    AssetLoader.addSource("test-added", new StubSource(async () => filtered, async () => true));
    AssetLoader.addSource("test-high", new StubSource(async () => upper));

    t.deepEqual(await AssetLoader.getAll(font, AssetParser.JSON), [upper, filtered]);
    t.is(lowerCalls, 0);

    AssetLoader.removeSource("test-high");
    AssetLoader.addSource("test-added", new StubSource(async () => undefined, () => true));
    AssetLoader.addSource("test-high", new StubSource(async () => upper));

    t.deepEqual(await AssetLoader.getAll(font, AssetParser.JSON), [upper]);
    t.is(lowerCalls, 0);
});

test.serial("getAll keeps its source snapshot while an asynchronous filter is pending", async t => {
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let started!: () => void;
    const filtering = new Promise<void>(resolve => { started = resolve; });
    const original = { providers: [] };
    const replacement = { providers: [{ type: "space", advances: { " ": 4 } }] };
    AssetLoader.addSource("test-low", new StubSource(async () => original));
    AssetLoader.addSource("test-high", new StubSource(async () => undefined, async () => {
        started();
        await waiting;
        return false;
    }));

    const pending = AssetLoader.getAll(key, AssetParser.JSON);
    await filtering;
    AssetLoader.removeSource("test-low");
    AssetLoader.addSource("test-added", new StubSource(async () => replacement));
    release();

    t.deepEqual(await pending, [original]);
    t.deepEqual(await AssetLoader.getAll(key, AssetParser.JSON), [replacement]);
});
