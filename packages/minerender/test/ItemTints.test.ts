import test from "ava";
import { Color, MeshBasicMaterial } from "three";
import type { Mesh } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Materials } from "../src/Materials";
import { ItemTints } from "../src/model/ItemTints";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
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

test("component tints use indexed RGB values, integer firework averages, and explicit overrides", async t => {
    const model: ItemModel = { tints: [
        { type: "custom_model_data", default: -1 },
        { type: "minecraft:custom_model_data", index: 1, default: -1 },
        { type: "custom_model_data", index: 8, default: [1, 0.5, 0] },
        { type: "minecraft:dye", default: 0x123456 },
        { type: "map_color", default: 0x123456 },
        { type: "minecraft:firework", default: 0x123456 },
        { type: "potion", default: 0x123456 },
        { type: "team", default: 0x123456 }
    ], components: {
        "minecraft:custom_model_data": { colors: [0, [0.6, 0.2, 0.4]] },
        "minecraft:dyed_color": [0.25, 0.5, 0.75],
        "minecraft:map_color": -1,
        "minecraft:firework_explosion": { colors: [0xff0101, 0x000202, 0x010004], fade_colors: [0xffffff] },
        "minecraft:potion_contents": { custom_color: 0, potion: "minecraft:healing" }
    } };
    const original = JSON.stringify(model);
    const expected = { 0: 0, 1: 0x993366, 2: 0xff7f00, 3: 0x3f7fbf, 4: 0xffffff, 5: 0x550102, 6: 0, 7: 0x123456 };
    t.deepEqual(await ItemTints.get(model), expected);
    const overrides = { 1: 0, 5: 0xffffff, 9: 0xabcdef };
    t.deepEqual(await ItemTints.get(model, overrides), { ...expected, ...overrides });
    t.is(JSON.stringify(model), original);
    t.deepEqual(overrides, { 1: 0, 5: 0xffffff, 9: 0xabcdef });
    t.deepEqual(await ItemTints.get({ tints: [{ type: "firework", default: 0xffffff }],
        components: { "minecraft:firework_explosion": { colors: [0] } } } as ItemModel), { 0: 0 });
    for (const [value, expected] of [[[0, 2, 0], 0x00fe00], [[0, 0, 2], 0x0000fe], [[-1, 0, 0], 0x010000]] as const) {
        t.deepEqual(await ItemTints.get({ tints: [{ type: "dye", default: 0 }],
            components: { "minecraft:dyed_color": value } } as ItemModel), { 0: expected });
    }
});

test("empty components and unresolved potion effects retain defaults, while malformed colors reject unless overridden", async t => {
    const model: ItemModel = { tints: [
        { type: "custom_model_data", index: 1, default: 0x123456 },
        { type: "firework", default: 0x123456 },
        { type: "potion", default: 0x123456 }
    ], components: { "minecraft:custom_model_data": { colors: [] }, "minecraft:firework_explosion": {} } };
    for (const potion of ["minecraft:healing", { potion: "minecraft:healing" }, { custom_effects: [{ id: "minecraft:speed" }] }]) {
        model.components!["minecraft:potion_contents"] = potion;
        t.deepEqual(await ItemTints.get(model), { 0: 0x123456, 1: 0x123456, 2: 0x123456 });
    }
    model.components!["minecraft:firework_explosion"] = { colors: [] };
    t.deepEqual(await ItemTints.get(model), { 0: 0x123456, 1: 0x123456, 2: 0x123456 });
    const invalid: Array<[ItemTintSource, string, unknown]> = [
        [{ type: "dye", default: -1 }, "dyed_color", { rgb: 0xffffff }],
        [{ type: "map_color", default: -1 }, "map_color", [1, 0, 0]],
        [{ type: "firework", default: -1 }, "firework_explosion", { colors: [[1, 0, 0]] }],
        [{ type: "potion", default: -1 }, "potion_contents", { custom_color: null }],
        [{ type: "custom_model_data", default: -1 }, "custom_model_data", { colors: 0 }]
    ];
    for (const [source, component, value] of invalid) {
        const malformed: ItemModel = { tints: [source], components: { [`minecraft:${component}`]: value } };
        await t.throwsAsync(ItemTints.get(malformed), { message: /Item tint/ });
        t.deepEqual(await ItemTints.get(malformed, { 0: 0 }), { 0: 0 });
    }
});

test.serial("component colors separate instance palettes through both scene model entry points", async t => {
    const original = { atlas: UVMapper.getAtlas, image: Materials.getImage, shaded: Materials.createShadedCanvasMaterial };
    const material = new MeshBasicMaterial(), scene = new MineRenderScene();
    const model: ItemModel = {
        key: AssetKey.parse("models", "test:item/shared"), tints: [{ type: "dye", default: 0xffffff }],
        elements: [{ from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side", tintindex: 0 }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0]) }]
    };
    const atlas = new TextureAtlas(model, { width: 16, height: 16, canvas: {} } as CanvasImage, { side: [16, 16] }, { side: [0, 0] }, false, {}, false);
    Caching.clear();
    UVMapper.getAtlas = async () => atlas;
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    t.teardown(() => {
        for (const child of scene.children) (child as ModelObject).dispose();
        UVMapper.getAtlas = original.atlas; Materials.getImage = original.image; Materials.createShadedCanvasMaterial = original.shaded;
        material.dispose(); Caching.clear();
    });
    const red = { ...model, components: { "minecraft:dyed_color": 0xff0000 } };
    const blue = { ...model, components: { "minecraft:dyed_color": 0x0000ff } };
    await scene.addModel(red, { instanceMeshes: true });
    await scene.addSceneObject(blue, () => new ModelObject(blue, { instanceMeshes: true }));
    await scene.addSceneObject(red, () => new ModelObject(red, { instanceMeshes: true }));
    await scene.addModel(blue, { instanceMeshes: true, tints: { 0: 0xff0000 } });
    t.is(scene.children.length, 2);
    const [redObject, blueObject] = scene.children as ModelObject[];
    const color = (object: ModelObject) => new Color().fromBufferAttribute((object.children[0] as Mesh).geometry.getAttribute("color"), 0).getHex();
    t.deepEqual([color(redObject), color(blueObject)], [0xff0000, 0x0000ff]);
    t.deepEqual([redObject.instanceCounter, blueObject.instanceCounter], [3, 1]);
    t.is(redObject.textureAtlas, blueObject.textureAtlas);
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
