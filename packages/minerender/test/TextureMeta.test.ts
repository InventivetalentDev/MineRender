import { installMineRenderDataFixtures } from "./helpers/minerender-data";
import test, { ExecutionContext } from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { ModelTextures } from "../src/assets/ModelTextures";
import { HostedAssetSource } from "../src/assets/source/HostedAssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { PersistentCache } from "../src/cache/PersistentCache";
import type { MinecraftTextureMeta } from "../src/MinecraftTextureMeta";

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

let restoreData: () => void;
test.before(() => { restoreData = installMineRenderDataFixtures(); });
test.after.always(() => restoreData());

function fixture(t: ExecutionContext) {
    const original = { get: AssetLoader.get, sources: [...AssetLoader["_SOURCES"]], cache: ModelTextures["_persistentMetaCache"] };
    const cache = new MemoryCache();
    ModelTextures["_persistentMetaCache"] = cache;
    Caching.clear();
    t.teardown(() => {
        AssetLoader.get = original.get;
        AssetLoader["_SOURCES"] = original.sources;
        ModelTextures["_persistentMetaCache"] = original.cache;
        Caching.clear();
    });
    return cache;
}

test.serial("missing metadata is cached in memory and persists when the directory list is unavailable", async t => {
    const cache = fixture(t);
    const calls: (AssetParser | string)[] = [];
    AssetLoader.get = async (key, parser) => { calls.push(parser); return undefined; };
    const key = AssetKey.parse("textures", "minecraft:block/stone");
    t.is(await ModelTextures.getMeta(key), undefined);
    t.is(await ModelTextures.getMeta(key), undefined);
    t.deepEqual(calls, [AssetParser.LIST, AssetParser.META]);
    t.is(await cache.get(key.serialize()), Caching.MISSING);
    Caching.clear();
    t.is(await ModelTextures.getMeta(key), undefined);
    t.deepEqual(calls, [AssetParser.LIST, AssetParser.META]);
});

test.serial("the vanilla directory list skips missing metadata and permits listed files", async t => {
    fixture(t);
    const root = "https://example.test/1.21.11";
    const meta: MinecraftTextureMeta = { texture: { blur: true } };
    const calls: (AssetParser | string)[] = [];
    AssetLoader.get = async (key, parser) => {
        calls.push(parser);
        if (parser === AssetParser.LIST) {
            t.deepEqual(key, new AssetKey("minecraft", "block/_list", "textures", undefined, "assets", ".json", root));
            return { files: ["water_still.png.mcmeta"], directories: [] } as never;
        }
        t.is(key.extension, ".png.mcmeta");
        t.is(key.getFullPath(), "block/water_still");
        return meta as never;
    };
    const key = AssetKey.parse("textures", "minecraft:block/stone");
    key.root = root;
    t.is(await ModelTextures.getMeta(key), undefined);
    const water = AssetKey.parse("textures", "minecraft:block/water_still", key);
    t.is(await ModelTextures.getMeta(water), meta);
    t.is(meta.key?.root, root);
    t.deepEqual(calls, [AssetParser.LIST, AssetParser.META]);
});

test.serial("added sources request metadata without consulting a directory list", async t => {
    fixture(t);
    AssetLoader.addSource("pack", new HostedAssetSource("https://pack.example/assets"));
    t.not(AssetLoader.persistentScope, "");
    let calls = 0;
    const meta: MinecraftTextureMeta = { texture: { clamp: true } };
    AssetLoader.get = async (key, parser) => {
        calls++;
        t.is(parser, AssetParser.META);
        return meta as never;
    };
    t.is(await ModelTextures.getMeta(AssetKey.parse("textures", "minecraft:block/stone")), meta);
    t.is(calls, 1);
});
