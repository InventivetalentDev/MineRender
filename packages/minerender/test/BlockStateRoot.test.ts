import test from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { Models } from "../src/assets/Models";
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
