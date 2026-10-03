import test from "ava";
import { AssetKey } from "../src";

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