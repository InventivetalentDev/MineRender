import { installMineRenderDataFixtures } from "./helpers/minerender-data";
import test from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { Models } from "../src/assets/Models";
import { AssetLoader } from "../src/assets/AssetLoader";
import { BlockStates } from "../src/assets/BlockStates";
import { MineRenderData } from "../src/assets/MineRenderData";
import { HostedAssetSource } from "../src/assets/source/HostedAssetSource";
import { Caching } from "../src/cache/Caching";
import type { PersistentCache } from "../src/cache/PersistentCache";
import { Requests } from "../src/request/Requests";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import type { BlockState } from "../src/model/block/BlockState";

async function modelKeyFor(blockState: BlockState): Promise<AssetKey> {
    const original = Models.getMerged;
    const keys: AssetKey[] = [];
    Models.getMerged = async key => {
        keys.push(key);
        throw new Error("stop after resolving the key");
    };
    try {
        const block = new BlockObject(blockState, { applyDefaultState: false });
        await block.init().catch(() => undefined);
    } finally {
        Models.getMerged = original;
    }
    return keys[0];
}

test.serial("variant models resolve against the blockstate's asset root", async t => {
    const root = "https://assets.example/1.16.5";
    const key = await modelKeyFor({
        key: new AssetKey("minecraft", "furnace", "blockstates", undefined, "assets", ".json", root),
        variants: { "": { model: "minecraft:block/furnace" } }
    });
    t.is(key.root, root);
    t.is(key.serialize(), `${root}/assets/models/block/minecraft/furnace`);
});

test.serial("variant models without a blockstate root keep the default root", async t => {
    const key = await modelKeyFor({
        key: new AssetKey("minecraft", "furnace", "blockstates"),
        variants: { "": { model: "minecraft:block/furnace" } }
    });
    t.is(key.root, undefined);
    t.is(key.path, "furnace");
    t.is(key.type, "block");
});

test.serial("rootless blockstates use the highest-priority hosted source while explicit roots take precedence", async t => {
    const sources = [...AssetLoader["_SOURCES"]], request = Requests.mcAssetRequest, cache = BlockStates["_persistentCache"];
    t.teardown(() => {
        AssetLoader["_SOURCES"] = sources;
        Requests.mcAssetRequest = request;
        BlockStates["_persistentCache"] = cache;
        Caching.clear();
    });
    Caching.clear();
    BlockStates["_persistentCache"] = { getOrLoad: async (key, loader) => loader(key) } as PersistentCache;
    AssetLoader.addSource("hosted-pack", new HostedAssetSource("https://pack.example/1.21.11", { retryDefaults: false }));
    const urls: string[] = [];
    Requests.mcAssetRequest = async config => {
        urls.push(config.url);
        return { data: { variants: { "": { model: "minecraft:block/stone" } } }, status: 200, statusText: "OK", headers: new Headers(), url: config.url };
    };
    await BlockStates.get(new AssetKey("minecraft", "stone", "blockstates"));
    await BlockStates.get(new AssetKey("minecraft", "stone", "blockstates", undefined, "assets", ".json", "https://explicit.example/1.16.5"));
    t.deepEqual(urls, ["https://pack.example/1.21.11/assets/minecraft/blockstates/stone.json",
        "https://explicit.example/1.16.5/assets/minecraft/blockstates/stone.json"]);
});

test.serial("block initialization rejects a version change while fluid rules load", async t => {
    const root = AssetLoader.ROOT, get = MineRenderData.get;
    t.teardown(() => { AssetLoader.ROOT = root; MineRenderData.get = get; });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    MineRenderData.get = async (dataset, requestedRoot) => { await waiting; return get(dataset, requestedRoot); };
    const block = new BlockObject({ key: new AssetKey("minecraft", "stone", "blockstates"), variants: {} }, { applyDefaultState: false });
    const pending = block.init();
    AssetLoader.ROOT = "https://assets.example/1.16.5";
    release();
    await t.throwsAsync(pending, { message: /Asset sources changed while loading a block/ });
});

let restoreData: () => void;
test.before(() => { restoreData = installMineRenderDataFixtures(); });
test.after.always(() => restoreData());
