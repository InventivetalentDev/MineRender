import test from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { ItemTints } from "../src/model/ItemTints";
import type { ExtractableImageData } from "../src/ExtractableImageData";
import type { ItemModel, ItemTintSource } from "../src/model/Model";

test("item tint sources retain their indices and decode vanilla RGB defaults without overriding caller colors", async t => {
    const model: ItemModel = { tints: [
        { type: "minecraft:constant", value: -1 },
        { type: "minecraft:dye", default: -6265536 },
        { type: "potion", default: -13083194 },
        { type: "minecraft:map_color", default: 4603950 },
        { type: "firework", default: -7697782 },
        { type: "minecraft:custom_model_data", index: 2, default: [1, 0.5, 0] },
        { type: "team", default: [0, 0, 1] },
        { type: "constant", value: [0.6, 0.2, 0.4] }
    ] };
    const overrides = { 1: 0, 8: 0xabcdef };
    const original = JSON.stringify([model, overrides]);
    t.deepEqual(await ItemTints.get(model), {
        0: 0xffffff, 1: 0xa06540, 2: 0x385dc6, 3: 0x46402e,
        4: 0x8a8a8a, 5: 0xff7f00, 6: 0x0000ff, 7: 0x993366
    });
    t.deepEqual(await ItemTints.get(model, overrides), {
        0: 0xffffff, 1: 0, 2: 0x385dc6, 3: 0x46402e,
        4: 0x8a8a8a, 5: 0xff7f00, 6: 0x0000ff, 7: 0x993366, 8: 0xabcdef
    });
    t.is(JSON.stringify([model, overrides]), original);
    const unsupported: ItemModel = { tints: [{ type: "custom:unknown" } as unknown as ItemTintSource] };
    await t.throwsAsync(ItemTints.get(unsupported), { message: "Unsupported item tint source custom:unknown" });
});

test.serial("grass tints sample each definition's climate and cache by pixel and asset root", async t => {
    const original = ModelTextures.get;
    Caching.clear();
    t.teardown(() => { ModelTextures.get = original; Caching.clear(); });
    const keys: AssetKey[] = [], samples: number[][] = [];
    ModelTextures.get = async key => {
        keys.push(key);
        return { width: 256, height: 256, data: { getImageData: (x: number, y: number) => {
            samples.push([x, y]);
            return { data: new Uint8ClampedArray([x, y, 127, 255]) };
        } } } as ExtractableImageData;
    };
    const model: ItemModel = {
        key: new AssetKey("custom", "grass", "models", "item", "assets", ".json", "https://pack.example/first"),
        tints: [
            { type: "minecraft:grass", temperature: 0.5, downfall: 1 },
            { type: "grass", temperature: 0.25, downfall: 0.5 },
            { type: "grass", temperature: 0.6, downfall: 1 }
        ]
    };
    const overrides = { 0: 0, 1: 0, 2: 0 };
    t.deepEqual(await ItemTints.get(model, overrides), overrides);
    t.is(keys.length, 0);
    const expected = { 0: 0x7f7f7f, 1: 0xbfdf7f, 2: 0x65657f };
    t.deepEqual(await ItemTints.get(model), expected);
    t.deepEqual(await ItemTints.get(model), expected);
    t.deepEqual(samples, [[127, 127], [191, 223], [101, 101]]);
    t.true(keys.every(key => key.toNamespacedString() === "minecraft:colormap/grass" && key.root === model.key!.root));
    const other = { ...model, key: new AssetKey("custom", "grass", "models", "item", "assets", ".json", "https://pack.example/second") };
    t.deepEqual(await ItemTints.get(other), expected);
    t.is(keys.length, 6);
    Caching.clear();
    t.deepEqual(await ItemTints.get(model), expected);
    t.is(keys.length, 9);
});
