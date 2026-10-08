import test from "ava";
import { AssetKey, AssetLoader, AssetParser, AssetSource, BlockStates, Caching, HostedAssetSource, shutdown } from "../src";
import { ArchiveAssetSource } from "../src/assets/source/archive/ArchiveAssetSource";
import { PersistentCache } from "../src/cache/PersistentCache";
import type { ArchiveProxy } from "../src/assets/source/archive/ArchiveProxy";
import type { Maybe, MinecraftAsset } from "../src";

class StubSource extends AssetSource {
    constructor(private readonly id: Maybe<string>, private readonly asset: unknown = { variants: {} }) { super(); }
    get cacheId(): Maybe<string> { return this.id; }
    async get<T extends MinecraftAsset>(): Promise<Maybe<T>> { return this.asset as T; }
}

class MemoryCache extends PersistentCache<Map<string, unknown>> {
    constructor() { super(new Map()); }
    async get<T>(key: string): Promise<T> { return this.backing.get(key) as T; }
    async put<T>(key: string, value: T): Promise<T> { this.backing.set(key, value); return value; }
    async delete(key: string): Promise<void> { this.backing.delete(key); }
    async clear(): Promise<void> { this.backing.clear(); }
    async length(): Promise<number> { return this.backing.size; }
    async keys(): Promise<string[]> { return [...this.backing.keys()]; }
    async forEach<T>(callback: (value: T, key: string) => void): Promise<void> { this.backing.forEach((v, k) => callback(v as T, k)); }
}

const originalSources = [...AssetLoader["_SOURCES"]];
const originalRoot = AssetLoader.ROOT;
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = [...originalSources];
    AssetLoader.ROOT = originalRoot;
    Caching.clear();
});
test.after.always(() => shutdown());

test.serial("only the default vanilla sources leave persistent keys unscoped", t => {
    t.is(AssetLoader.persistentScope, "");
    t.is(AssetLoader.persistentKey("asset"), "asset");

    AssetLoader.setVersion("1.20.4");
    t.is(AssetLoader.persistentScope, "");
});

test.serial("added sources scope persistent keys by their content identity", t => {
    AssetLoader.addSource("pack", new StubSource("archive:pack.zip:10:1"));
    const packScope = AssetLoader.persistentScope;
    t.true(packScope.includes("archive:pack.zip:10:1"));
    t.is(AssetLoader.persistentKey("asset"), `${packScope}\nasset`);

    AssetLoader.addSource("mirror", new HostedAssetSource("https://mirror.example/assets"));
    t.not(AssetLoader.persistentScope, packScope);
    t.true(AssetLoader.persistentScope.includes("hosted:https://mirror.example/assets"));

    AssetLoader.removeSource("mirror");
    AssetLoader.removeSource("pack");
    t.is(AssetLoader.persistentKey("asset"), "asset");
});

test.serial("a source without a content identity confines persisted entries to one registry snapshot", t => {
    AssetLoader.addSource("anonymous", new StubSource(undefined));
    const scope = AssetLoader.persistentScope;
    t.regex(scope, /^session:/);
    t.is(AssetLoader.persistentScope, scope);
    AssetLoader.addSource("pack", new StubSource("archive:pack"));
    t.not(AssetLoader.persistentScope, scope);
});

test.serial("archive sources identify themselves through their proxy", t => {
    const proxy = (id?: string): ArchiveProxy => ({ id, getEntries: async () => [] });
    t.is(new ArchiveAssetSource(proxy("pack.zip:10:1")).cacheId,
        `archive-metadata:1:pack.zip:10:1:${JSON.stringify([AssetLoader.version, AssetLoader.version])}`);
    t.is(new ArchiveAssetSource(proxy()).cacheId, undefined);
    t.is(new HostedAssetSource("https://cdn.example/root").cacheId, "hosted:https://cdn.example/root");
});

test.serial("blockstates loaded through a pack do not persist under the vanilla key", async t => {
    const cache = new MemoryCache();
    const originalCache = BlockStates["_persistentCache"];
    BlockStates["_persistentCache"] = cache;
    t.teardown(() => { BlockStates["_persistentCache"] = originalCache; });

    const key = AssetKey.parse("blockstates", "minecraft:stone");
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("mcassets", new StubSource(`hosted:${AssetLoader.ROOT}`, { variants: { "": { model: "block/stone" } } }));
    const vanillaKey = AssetLoader.persistentKey(key.serialize());
    await BlockStates.get(key);
    t.deepEqual(await cache.keys(), [vanillaKey]);

    Caching.clear();
    AssetLoader.addSource("pack", new StubSource("archive:pack.zip:10:1", { variants: { "": { model: "block/stone7" } } }));
    const packed = await BlockStates.get(key);
    t.is(packed?.variants?.[""] && (packed.variants[""] as { model: string }).model, "block/stone7");
    const packedKey = AssetLoader.persistentKey(key.serialize());
    t.not(packedKey, vanillaKey);
    t.deepEqual((await cache.keys()).sort(), [vanillaKey, packedKey].sort());

    Caching.clear();
    AssetLoader.removeSource("pack");
    const vanilla = await BlockStates.get(key);
    t.is((vanilla!.variants![""] as { model: string }).model, "block/stone");
    t.is(await AssetLoader.get(key, AssetParser.BLOCKSTATE) !== undefined, true);
});
