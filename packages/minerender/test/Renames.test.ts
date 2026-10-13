import test from "ava";
import { AssetKey, AssetLoader, AssetSource, BlockStates, Caching, Models, PersistentCache, shutdown } from "../src";
import type { MinecraftAsset } from "../src";
import { MineRenderData, MineRenderDatasets } from "../src/assets/MineRenderData";
import { Renames } from "../src/assets/Renames";
import { installMineRenderDataFixtures, mineRenderDataManifest } from "./helpers/minerender-data";

const chain = { registered: false, ranges: [{ before: 4541, to: "minecraft:iron_chain" }] };
const slab = { registered: true, ranges: [{ before: 1802, to: "minecraft:smooth_stone_slab" }] };
const renames: MineRenderDatasets["renames"] = {
    format: "data-fixer-renames", baseDataVersion: 1451,
    blocks: { "minecraft:chain": chain, "minecraft:stone_slab": slab,
        "minecraft:old": { registered: false, ranges: [{ before: 2000, to: "minecraft:first" }, { before: 3000, to: "minecraft:last" }] } },
    items: { "minecraft:chain": chain }, entities: {}
};

class DataSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey) => unknown) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<T | undefined> { return this.load(key) as T | undefined; }
}

const sources = [...AssetLoader["_SOURCES"]];
const caches = { blocks: BlockStates["_persistentCache"], models: Models["_persistentCache"] };
test.beforeEach(() => {
    AssetLoader["_SOURCES"] = [];
    Caching.clear();
    const cache = { getOrLoad: async (key, loader) => loader(key) } as PersistentCache;
    BlockStates["_persistentCache"] = cache;
    Models["_persistentCache"] = cache;
});
test.afterEach.always(() => {
    AssetLoader["_SOURCES"] = [...sources];
    BlockStates["_persistentCache"] = caches.blocks;
    Models["_persistentCache"] = caches.models;
    Caching.clear();
});
test.after.always(() => shutdown());

test.serial("rename ranges use exclusive boundaries and reject versions before the base", async t => {
    t.teardown(installMineRenderDataFixtures({ renames }));
    t.is(await Renames.resolve("blocks", "minecraft:chain", 4540), "minecraft:iron_chain");
    t.is(await Renames.resolve("blocks", "minecraft:chain", 4541), undefined);
    t.is(await Renames.resolve("blocks", "minecraft:old", 1451), "minecraft:first");
    t.is(await Renames.resolve("blocks", "minecraft:old", 2000), "minecraft:last");
    t.is(await Renames.resolve("blocks", "minecraft:old", 3000), undefined);
    t.is(await Renames.resolve("blocks", "minecraft:chain", 1450), undefined);
});

test.serial("unversioned renames use the last target and preserve registered and inherited IDs", async t => {
    t.teardown(installMineRenderDataFixtures({ renames }));
    t.is(await Renames.resolve("blocks", "minecraft:old"), "minecraft:last");
    t.is(await Renames.resolve("blocks", "minecraft:stone_slab"), undefined);
    t.is(await Renames.resolve("blocks", "constructor"), undefined);
});

test.serial("published data without renames requests only its manifest", async t => {
    const manifest = mineRenderDataManifest(), calls: string[] = [];
    delete manifest.datasets.renames;
    manifest.unavailable.renames = "not extracted";
    AssetLoader.addSource("data", new DataSource(key => { calls.push(key.path); return manifest; }));
    t.is(await Renames.get(), undefined);
    t.deepEqual(calls, ["manifest"]);
});

test.serial("the real loader rejects malformed rename tables", async t => {
    let data: unknown;
    AssetLoader.addSource("data", new DataSource(key => key.path === "manifest" ? mineRenderDataManifest() : data));
    for (data of [{ ...renames, format: "invalid" }, { ...renames, baseDataVersion: 1.5 }, { ...renames, entities: [] },
        ...[{ registered: false, ranges: [] }, { registered: 1, ranges: chain.ranges },
            { registered: false, ranges: [{ before: 1.5, to: "minecraft:test" }] },
            { registered: false, ranges: [{ before: 2000, to: 1 }] }].map(entry => ({ ...renames, blocks: { "minecraft:chain": entry } }))]) {
        await t.throwsAsync(MineRenderData.get("renames"), { message: /Invalid MineRender renames data/ });
    }
    data = renames;
    t.deepEqual(await MineRenderData.get("renames"), renames);
});

test.serial("blockstates request the replacement first and preserve the asset key fields", async t => {
    const root = "https://assets.example/1.21.11", calls: AssetKey[] = [];
    t.teardown(installMineRenderDataFixtures(requested => { t.is(requested, root); return { renames }; }));
    AssetLoader.addSource("blocks", new DataSource(key => { calls.push(key); return { variants: {} }; }));
    const key = new AssetKey("minecraft", "chain", "blockstates", undefined, "assets", ".json", root);
    const result = await BlockStates.get(key);
    t.deepEqual(result?.key, new AssetKey("minecraft", "iron_chain", "blockstates", undefined, "assets", ".json", root));
    t.deepEqual(calls.map(key => key.path), ["iron_chain"]);
    t.is(key.path, "chain");
});

test.serial("registered block IDs load their own blockstate", async t => {
    t.teardown(installMineRenderDataFixtures({ renames }));
    const calls: string[] = [];
    AssetLoader.addSource("blocks", new DataSource(key => { calls.push(key.path); return { variants: {} }; }));
    t.is((await BlockStates.get(new AssetKey("minecraft", "stone_slab")))?.key.path, "stone_slab");
    t.deepEqual(calls, ["stone_slab"]);
});

test.serial("a missing replacement blockstate falls back to the original ID", async t => {
    t.teardown(installMineRenderDataFixtures({ renames }));
    const calls: string[] = [];
    AssetLoader.addSource("blocks", new DataSource(key => { calls.push(key.path); return key.path === "chain" ? { variants: {} } : undefined; }));
    t.is((await BlockStates.get(new AssetKey("minecraft", "chain")))?.key.path, "chain");
    t.deepEqual(calls, ["iron_chain", "chain"]);
});

test.serial("item keys load the replacement model and report its item ID", async t => {
    t.teardown(installMineRenderDataFixtures({ renames }));
    const calls: string[] = [];
    AssetLoader.addSource("items", new DataSource(key => {
        calls.push(key.path);
        return key.assetType === "items" ? { model: { type: "minecraft:model", model: "minecraft:item/iron_chain" } } : { elements: [] };
    }));
    const model = await Models.getMerged(new AssetKey("minecraft", "chain", "models", "item"));
    t.is(model?.itemId, "minecraft:iron_chain");
    t.true(calls.every(path => path === "iron_chain"));
});
