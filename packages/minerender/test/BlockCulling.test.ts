import test from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { AssetSource } from "../src/assets/source/AssetSource";
import { Caching } from "../src/cache/Caching";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import type { Block } from "../src/model/block/Block";
import { shutdown } from "../src/shutdown";
import { BlockCullingData, blockCullingRule, loadBlockCulling, skipsBlockFace } from "../src/world/_culling/BlockCulling";
import { mineRenderDataManifest } from "./helpers/minerender-data";

test("rules use block IDs, face direction, groups and facing connection flags", t => {
    const data: BlockCullingData = {
        profiles: [{ type: "same_block" }, { type: "same_block_vertical" }, { type: "connected", group: "bars" }],
        blocks: { "minecraft:glass": 0, "minecraft:roots": 1, "minecraft:iron_bars": 2 },
        groups: { bars: ["minecraft:iron_bars", "minecraft:copper_bars"] }
    };
    t.is(blockCullingRule(data, "glass"), data.profiles[0]);
    t.is(blockCullingRule(data, "minecraft:glass"), data.profiles[0]);
    t.is(blockCullingRule(data, "unlisted"), undefined);
    t.is(blockCullingRule(data, "constructor"), undefined);
    const inherited = { ...data, blocks: Object.create({ "minecraft:constructor": 0 }) };
    t.is(blockCullingRule(inherited, "constructor"), undefined);
    const glass = { type: "glass" }, same = { type: "minecraft:glass" }, other = { type: "tinted_glass" };
    const iron = { type: "iron_bars", properties: { east: "true" } };
    const copper = { type: "minecraft:copper_bars", properties: { west: true } };
    const rows: [string, Block, Block, number, boolean][] = [
        ["same_block", glass, same, 0, true], ["same_block", glass, other, 0, false],
        ["same_block_vertical", glass, same, 2, true], ["same_block_vertical", glass, same, 3, true],
        ["same_block_vertical", glass, same, 0, false], ["same_block_vertical", glass, other, 2, false],
        ["connected", glass, same, 2, true], ["connected", glass, other, 3, false],
        ["connected", iron, copper, 0, true], ["connected", copper, iron, 1, true],
        ["connected", iron, { ...copper, type: "iron_bars" }, 0, true],
        ["connected", iron, { ...copper, type: "glass_pane" }, 0, false],
        ["connected", iron, { type: "iron_bars" }, 0, false],
        ["connected", { ...iron, properties: { east: false } }, copper, 0, false],
        ["connected", iron, { ...copper, properties: { west: "false" } }, 0, false],
        ["connected", iron, copper, 2, false],
        ["leaves", glass, same, 0, false], ["fluid", glass, same, 2, false],
        ["unknown", glass, same, 0, false]
    ];
    for (const [type, block, neighbor, face, expected] of rows) {
        t.is(skipsBlockFace(data, { type, group: "bars" }, block, neighbor, face), expected, JSON.stringify([type, block, neighbor, face]));
    }
    t.false(skipsBlockFace(data, { type: "connected" }, iron, copper, 0));
    t.false(skipsBlockFace({ ...data, groups: undefined }, data.profiles[2], iron, copper, 0));
});

class DataSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey) => unknown) { super(); }
    get cacheId(): string { return "culling-test"; }
    async get<T extends MinecraftAsset>(key: AssetKey): Promise<T | undefined> { return this.load(key) as T | undefined; }
}

let sources: typeof AssetLoader["_SOURCES"];
test.beforeEach(() => {
    sources = AssetLoader["_SOURCES"];
    AssetLoader["_SOURCES"] = [];
    Caching.clear();
});
test.afterEach.always(() => { AssetLoader["_SOURCES"] = sources; Caching.clear(); });
test.after.always(() => shutdown());

test.serial("absent culling data requests only the manifest", async t => {
    const manifest = mineRenderDataManifest();
    delete manifest.datasets.blockCulling;
    const calls: string[] = [];
    AssetLoader.addSource("data", new DataSource(key => { calls.push(key.path); return manifest; }));
    t.is(await loadBlockCulling("https://assets.example/1.21.11"), undefined);
    t.deepEqual(calls, ["manifest"]);
});

test.serial("the loader validates culling tables and accepts unknown profile types", async t => {
    let data: unknown;
    AssetLoader.addSource("data", new DataSource(key => key.path === "manifest" ? mineRenderDataManifest() : data));
    for (data of [{ profiles: {}, blocks: {} }, { profiles: [{ type: "same_block" }], blocks: { "minecraft:glass": 1 } },
        { profiles: [], blocks: {}, groups: { bars: "minecraft:iron_bars" } }]) {
        Caching.clear();
        await t.throwsAsync(loadBlockCulling("https://assets.example/1.21.11"), { message: /Invalid MineRender blockCulling data/ });
    }
    Caching.clear();
    data = { profiles: [{ type: "future_rule" }], blocks: { "minecraft:glass": 0 } };
    t.deepEqual(await loadBlockCulling("https://assets.example/1.21.11"), data);
});
