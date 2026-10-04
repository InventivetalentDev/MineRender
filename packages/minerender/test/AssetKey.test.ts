import test from "ava";
import { AssetKey, AssetLoader, DEFAULT_ROOT } from "../src";

test("AssetKey#new", t => {
    let k = new AssetKey("minecraft", "textures/block/stone.png");
    console.log(k);
    t.is(k.namespace, "minecraft");
    t.is(k.rootType, "assets");
    t.is(k.assetType, undefined);
    t.is(k.type, undefined);
    console.log(k.toString())
    console.log(k.toNamespacedString());
    t.is(k.toNamespacedString(), "minecraft:textures/block/stone.png");
});

test("AssetKey#parse", t => {
    let k = AssetKey.parse("textures", "block/stone.png");
    console.log(k);
    t.is(k.namespace, "minecraft");
    t.is(k.rootType, "assets");
    t.is(k.assetType, "textures");
    t.is(k.type, "block");
    t.is(k.path, "stone.png");
    console.log(k.toString());
    console.log(k.toNamespacedString());
    // t.is(k.toNamespacedString(), "minecraft:textures/block/stone.png");
})

test("AssetKey#custom", t => {
    let k = AssetKey.parse("json", "minerender:blockstates/defaultBlockStates.json")
    console.log(k);
    t.is(k.namespace, "minerender");
    t.is(k.type, "blockstates");
    t.is(k.path, "defaultBlockStates.json");
    console.log(k.toNamespacedString());
    t.is(k.toNamespacedString(), "minerender:blockstates/defaultBlockStates.json");
})

test.serial("cache keys include the selected root and isolate older default assets", t => {
    const key = new AssetKey("minecraft", "stone", "models", "block");
    const originalRoot = AssetLoader.ROOT;
    try {
        AssetLoader.ROOT = DEFAULT_ROOT;
        const current = key.serialize();
        t.true(current.startsWith(DEFAULT_ROOT + "/"));
        t.false(current.startsWith("__root__/"));
        t.is(current, new AssetKey("minecraft", "stone", "models", "block", "assets", ".json", DEFAULT_ROOT).serialize());

        AssetLoader.ROOT = "https://assets.mcasset.cloud/1.17.1";
        t.not(key.serialize(), current);
        t.true(key.serialize().startsWith(AssetLoader.ROOT + "/"));
    } finally {
        AssetLoader.ROOT = originalRoot;
    }
});
