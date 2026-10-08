import test from "ava";
import { AssetContext, AssetKey, AssetLoader, AssetParser, AssetSource, Caching, Fonts, Models,
    HostedAssetSource, PersistentCache, shutdown } from "../src";
import { ArchiveAssetSource } from "../src/assets/source/archive/ArchiveAssetSource";
import { PackFormats } from "../src/assets/source/archive/PackFormats";
import type { Maybe, MinecraftAsset } from "../src";

class MemoryCache extends PersistentCache<Map<string, unknown>> {
    constructor() { super(new Map()); }
    async get<T>(key: string): Promise<T> { return this.backing.get(key) as T; }
    async put<T>(key: string, value: T): Promise<T> { this.backing.set(key, value); return value; }
    async delete(key: string): Promise<void> { this.backing.delete(key); }
    async clear(): Promise<void> { this.backing.clear(); }
    async length(): Promise<number> { return this.backing.size; }
    async keys(): Promise<string[]> { return [...this.backing.keys()]; }
    async forEach<T>(callback: (value: T, key: string) => void): Promise<void> {
        this.backing.forEach((value, key) => callback(value as T, key));
    }
}

class Source extends AssetSource {
    constructor(private readonly load: (key: AssetKey, assets: AssetContext) => unknown | Promise<unknown>,
                private readonly identity?: string) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string, assets: AssetContext): Promise<Maybe<T>> {
        return await this.load(key, assets) as Maybe<T>;
    }
    blocks(): boolean { return true; }
    get cacheId(): Maybe<string> { return this.identity; }
}

function deferred() {
    let resolve!: () => void;
    return { promise: new Promise<void>(done => { resolve = done; }), resolve: () => resolve() };
}

const originalSources = [...AssetLoader["_SOURCES"]];
const originalRoot = AssetLoader.ROOT;
const originalCache = Models["_persistentCache"];
test.beforeEach(() => { Models["_persistentCache"] = new MemoryCache(); Caching.clear(); });
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = [...originalSources];
    AssetLoader.ROOT = originalRoot;
    Models["_persistentCache"] = originalCache;
    Caching.clear();
});
test.after.always(() => shutdown());

test.serial("concurrent packs retain their model parents, provenance, and cache entries", async t => {
    const started = deferred(), release = deferred();
    const calls: string[] = [];
    const make = (name: string) => new AssetContext({ sources: [{ key: "pack", source: new Source(async key => {
        calls.push(`${name}:${key.path}`);
        if (name === "A" && key.path === "child") { started.resolve(); await release.promise; }
        return key.path === "child" ? { parent: "test:block/parent", textures: { child: name } } : { textures: { parent: name } };
    }) }] });
    const a = make("A"), b = make("B");
    const key = AssetKey.parse("models", "test:block/child");
    const pending = a.models.getMerged(key);
    await started.promise;
    const second = await b.models.getMerged(key);
    AssetLoader.setVersion("unrelated-version");
    release.resolve();
    const first = await pending;
    t.deepEqual(first?.textures, { child: "A", parent: "A" });
    t.deepEqual(second?.textures, { child: "B", parent: "B" });
    t.is(AssetContext.for(first), a);
    t.is(AssetContext.for(first!.key), a);
    const texture = AssetKey.parse("textures", "block/stone", first!.key);
    t.is(AssetContext.for(texture), a);
    t.is(await a.models.getMerged(key), first);
    t.is(await b.models.getMerged(key), second);
    t.deepEqual(calls, ["A:child", "B:child", "B:parent", "A:parent"]);
    t.is(key.root, undefined);
});

test.serial("global source changes do not split a model's in-flight parent chain", async t => {
    const started = deferred(), release = deferred();
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("pack", new Source(async key => {
        if (key.path === "child") { started.resolve(); await release.promise; }
        return key.path === "child" ? { parent: "test:block/parent", textures: { child: "A" } } : { textures: { parent: "A" } };
    }));
    const key = AssetKey.parse("models", "test:block/child");
    const pending = Models.getMerged(key);
    await started.promise;
    AssetLoader.addSource("pack", new Source(key => key.path === "child"
        ? { parent: "test:block/parent", textures: { child: "B" } } : { textures: { parent: "B" } }));
    const next = await Models.getMerged(key);
    release.resolve();
    t.deepEqual((await pending)?.textures, { child: "A", parent: "A" });
    t.deepEqual(next?.textures, { child: "B", parent: "B" });
});

test.serial("a pending persistent miss keeps the configuration used for its storage key", async t => {
    const cache = Models["_persistentCache"] as MemoryCache;
    const started = deferred(), release = deferred();
    const originalGet = cache.get.bind(cache);
    let paused = false;
    cache.get = async key => {
        if (!paused) { paused = true; started.resolve(); await release.promise; }
        return originalGet(key);
    };
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("pack", new Source(() => ({ textures: { side: "A" } }), "pack-A"));
    const captured = AssetLoader.context;
    const key = AssetKey.parse("models", "test:block/stone");
    const pending = Models.getRaw(key);
    await started.promise;
    AssetLoader.addSource("pack", new Source(() => ({ textures: { side: "B" } }), "pack-B"));
    release.resolve();
    t.deepEqual((await pending)?.textures, { side: "A" });
    t.deepEqual((await cache.get<{ textures: unknown }>(captured.persistentKey(key))).textures, { side: "A" });
    t.deepEqual((await Models.getRaw(key))?.textures, { side: "B" });
});

test.serial("identified sources share persistent data while anonymous contexts stay separate", async t => {
    const key = AssetKey.parse("models", "test:block/stone");
    let calls = 0;
    const source = new Source(() => { calls++; return { elements: [] }; }, "same-pack");
    const a = new AssetContext({ sources: [{ key: "pack", source }] });
    const b = new AssetContext({ sources: [{ key: "pack", source }] });
    const first = await a.models.getRaw(key), second = await b.models.getRaw(key);
    t.is(calls, 1);
    t.not(first, second);
    t.is(AssetContext.for(first), a);
    t.is(AssetContext.for(second), b);
    t.not(a.cacheKey(key), b.cacheKey(key));
    t.is(a.persistentKey(key), b.persistentKey(key));

    const anonymous = () => new AssetContext({ sources: [{ key: "pack", source: new Source(() => ({})) }] });
    t.not(anonymous().persistentKey(key), anonymous().persistentKey(key));
});

test.serial("persistent model selection distinguishes added and removed default sources", async t => {
    const key = AssetKey.parse("models", "test:block/stone");
    const vanilla = { key: "mcassets", source: new Source(() => ({ textures: { side: "vanilla" } }), `hosted:${AssetLoader.ROOT}`) };
    const mirror = { key: "mirror", source: new Source(() => ({ textures: { side: "mirror" } }), "hosted:https://mirror.example/assets") };
    AssetLoader["_SOURCES"] = [vanilla];
    t.is(AssetLoader.persistentScope, "");
    t.deepEqual((await Models.getRaw(key))?.textures, { side: "vanilla" });
    AssetLoader["_SOURCES"] = [mirror, vanilla];
    t.deepEqual((await Models.getRaw(key))?.textures, { side: "mirror" });
    AssetLoader["_SOURCES"] = [mirror];
    t.deepEqual((await Models.getRaw(key))?.textures, { side: "mirror" });
    AssetLoader["_SOURCES"] = [];
    t.is(await Models.getRaw(key), undefined);
});

test.serial("hosted fallback settings have distinct persistent identities", t => {
    const make = (retryDefaults: boolean) => new AssetContext({ sources: [{ key: "mirror",
        source: new HostedAssetSource("https://mirror.example/assets", { retryDefaults }) }] });
    t.not(make(true).persistentScope, make(false).persistentScope);
});

test.serial("low-level context lookups retain provenance without rebinding source-owned data", async t => {
    const shared = { elements: [] };
    const source = new Source(() => shared);
    const a = new AssetContext({ sources: [{ key: "pack", source }] });
    const b = new AssetContext({ sources: [{ key: "pack", source }] });
    const key = AssetKey.parse("models", "test:block/stone");
    const first = await a.get(key, AssetParser.MODEL);
    const second = await b.getFirst([key], AssetParser.MODEL);
    const all = await a.getAll(key, AssetParser.MODEL);
    t.is(AssetContext.for(first), a);
    t.is(AssetContext.for(second!.asset), b);
    t.is(AssetContext.for(second!.key), b);
    t.is(AssetContext.for(all[0]), a);
    t.not(first, shared);
    t.not(first, second!.asset);
    t.is(AssetContext.for(shared, a), a);
    t.is(AssetContext.for(shared, b), b);
});

test.serial("context configuration copies source order and retains hosted source roots", async t => {
    const source = new Source((_key, assets) => ({ version: assets.version }));
    const sources = [{ key: "pack", source }];
    const assets = new AssetContext({ version: "1.20.4", sources });
    sources.length = 0;
    AssetLoader.setVersion("1.21.11");
    const key = AssetKey.parse("models", "test:block/stone");
    t.deepEqual(await assets.get(key, AssetParser.JSON), { version: "1.20.4" });
    t.is(assets.sources[0].source, source);
    t.is(assets.root, "https://assets.mcasset.cloud/1.20.4");
    const hosted = assets.sources[1].source as import("../src").HostedAssetSource;
    t.is(hosted.assetBasePath(key, assets), "https://assets.mcasset.cloud/1.20.4/assets/test/models/");
});

test.serial("shared archives select overlays from each context's version concurrently", async t => {
    const original = PackFormats.get;
    PackFormats.get = async version => version === "1.20.4" ? 22 : 75;
    t.teardown(() => { PackFormats.get = original; });
    const files: Record<string, unknown> = {
        "pack.mcmeta": { overlays: { entries: [{ directory: "modern", formats: 75 }] } },
        "assets/minecraft/models/block/stone.json": { source: "base" },
        "modern/assets/minecraft/models/block/stone.json": { source: "overlay" }
    };
    const source = new ArchiveAssetSource({ id: "shared", getEntries: async () => Object.entries(files).map(([filename, value]) => ({
        filename, directory: false, getData: async () => new Blob([JSON.stringify(value)])
    })) });
    const old = new AssetContext({ version: "1.20.4", sources: [{ key: "pack", source }] });
    const modern = new AssetContext({ version: "1.21.11", sources: [{ key: "pack", source }] });
    AssetLoader.setVersion("unrelated-version");
    const key = AssetKey.parse("models", "block/stone");
    t.deepEqual(await Promise.all([old.get(key, AssetParser.JSON), modern.get(key, AssetParser.JSON)]),
        [{ source: "base" }, { source: "overlay" }]);
    t.not(source.getCacheId(old), source.getCacheId(modern));
});

test.serial("font references and cached glyphs remain local to each context", async t => {
    const make = (advance: number) => new AssetContext({ sources: [{ key: "font", source: new Source(key => ({ providers:
        key.path === "default" ? [{ type: "reference", id: "test:shared" }] : [{ type: "space", advances: { A: advance } }]
    })) }] });
    const a = make(3), b = make(9);
    const [first, second] = await Promise.all([a.fonts.get(), b.fonts.get()]);
    t.is(first.glyphs.get("A")?.advance, 3);
    t.is(second.glyphs.get("A")?.advance, 9);
    t.is(await a.fonts.get("minecraft:default"), first);
});

test.serial("global changes evict the previous context without flushing independent scene caches", async t => {
    const key = AssetKey.parse("models", "test:block/stone");
    AssetLoader["_SOURCES"] = [...originalSources];
    const source = new Source(() => ({ elements: [] }));
    AssetLoader.addSource("pack", source);
    const previous = AssetLoader.context;
    const independent = new AssetContext({ sources: [{ key: "pack", source }] });
    const first = await previous.models.getRaw(key);
    const separate = await independent.models.getRaw(key);
    t.true(Caching.rawModelCache.keys().includes(previous.cacheKey(key)));

    AssetLoader.setVersion("1.20.4");
    t.false(Caching.rawModelCache.keys().includes(previous.cacheKey(key)));
    t.is(await independent.models.getRaw(key), separate);
    t.not(await previous.models.getRaw(key), first);

    const next = AssetLoader.context;
    await next.models.getRaw(key);
    AssetLoader.addSource("pack", new Source(() => ({ elements: [] })));
    t.false(Caching.rawModelCache.keys().includes(next.cacheKey(key)));
    t.is(await independent.models.getRaw(key), separate);
    independent.clearCache();
    t.false(Caching.rawModelCache.keys().includes(independent.cacheKey(key)));
});
