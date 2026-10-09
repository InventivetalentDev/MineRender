import test, { ExecutionContext } from "ava";
import { Mesh, MeshBasicMaterial } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Models } from "../src/assets/Models";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Geometries } from "../src/Geometries";
import { Materials } from "../src/Materials";
import { ModelGenerator } from "../src/model/ModelGenerator";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { ItemModel, Model } from "../src/model/Model";

function fixture(t: ExecutionContext) {
    const originals = { model: Models.prototype.getMerged, atlas: UVMapper.getAtlas, material: Materials.getImage, shaded: Materials.createShadedCanvasMaterial };
    const material = new MeshBasicMaterial();
    const scene = new MineRenderScene();
    Caching.clear();
    t.teardown(() => {
        Models.prototype.getMerged = originals.model;
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.material;
        Materials.createShadedCanvasMaterial = originals.shaded;
        scene.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
        material.dispose();
        Caching.clear();
    });
    const indices = [0, 1, 2, -1, undefined, 3];
    const model: Model = {
        key: new AssetKey("test", "tinted_cube", "models", "block"),
        textures: { side: "block/stone" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map((name, i) => [name, { texture: "#side", tintindex: indices[i] }])),
            mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0])
        }]
    };
    const image = { width: 16, height: 16, canvas: {} } as CanvasImage;
    const atlas = new TextureAtlas(model, image, { side: [16, 16] }, { side: [0, 0] }, false, {}, false);
    Models.prototype.getMerged = async () => model;
    UVMapper.getAtlas = async () => atlas;
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    return { scene, model, atlas };
}

function attribute(model: ModelObject, name: string): number[] {
    return Array.from((model.children[0] as Mesh).geometry.getAttribute(name).array);
}

test.serial("face tints support black and linear colors without changing uncolored faces or cached geometry", async t => {
    const { scene, model, atlas } = fixture(t);
    const base = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: model.elements![0].mappedUv });
    const baseUvs = Array.from(base.getAttribute("uv").array);
    const original = JSON.stringify([model, atlas.positions, atlas.sizes]);
    const tinted = await scene.addModel(model, {
        instanceMeshes: false, tints: { 0: 0, 1: 0x808080, 3: 0xff0000, [-1]: 0x0000ff }
    }) as ModelObject;

    const gray = [0.215861, 0.215861, 0.215861];
    const expected = [[0, 0, 0], gray, [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 0, 0]];
    t.deepEqual(attribute(tinted, "color").map(value => Number(value.toFixed(6))),
        expected.flatMap(rgb => [...rgb, ...rgb, ...rgb, ...rgb]));
    t.is(base.getAttribute("color"), undefined);
    t.deepEqual(Array.from(base.getAttribute("uv").array), baseUvs);
    t.is(JSON.stringify([model, atlas.positions, atlas.sizes]), original);
    t.is(tinted.textureAtlas, atlas);

    const plain = await scene.addModel(model, { instanceMeshes: false }) as ModelObject;
    const plainColor = (plain.children[0] as Mesh).geometry.getAttribute("color");
    t.true(!plainColor || Array.from(plainColor.array).every(value => value === 1));
});

test.serial("block palettes separate instance pools by color values and compose with UV locking", async t => {
    const { scene, atlas } = fixture(t);
    const first = { 0: 0xff0000, 1: 0x808080 };
    const same: Record<number, number> = {};
    same[1] = 0x808080;
    same[0] = 0xff0000;
    const different = { 0: 0x0000ff, 1: 0x808080 };
    const add = (tints: Record<number, number>, uvlock = false) => scene.addBlock({
        variants: { "": { model: "test:block/tinted_cube", y: 90, uvlock } }
    }, { applyDefaultState: false, tints });
    await add(first);
    await add(different);
    t.is(scene.children.length, 2);
    const red = scene.children[0] as ModelObject;
    const blue = scene.children[1] as ModelObject;
    await add(same);
    t.is(scene.children.length, 2);
    t.is(red.instanceCounter, 2);
    t.is(blue.instanceCounter, 1);
    t.notDeepEqual(attribute(red, "color"), attribute(blue, "color"));

    await add(first, true);
    const locked = scene.children[2] as ModelObject;
    await add(same, true);
    t.is(scene.children.length, 3);
    t.is(locked.instanceCounter, 2);
    t.deepEqual(attribute(locked, "color"), attribute(red, "color"));
    t.notDeepEqual(attribute(locked, "uv"), attribute(red, "uv"));
    t.is(locked.textureAtlas, atlas);
});

test.serial("item defaults separate instance palettes while sharing the atlas and preserving explicit black", async t => {
    const { scene, model, atlas } = fixture(t);
    model.key = AssetKey.parse("models", "test:item/shared");
    const red = { ...model, tints: [{ type: "minecraft:constant", value: 0xff0000 }] } as ItemModel;
    const blue = { ...model, tints: [{ type: "minecraft:constant", value: 0x0000ff }] } as ItemModel;
    const override = { 0: 0 };
    const original = JSON.stringify([red, blue, override, atlas.model]);
    const base = Geometries.getBox({ width: 16, height: 16, depth: 16, uv: model.elements![0].mappedUv });
    await scene.addModel(red);
    await scene.addModel(blue);
    await scene.addModel(red);
    await scene.addModel(red, { tints: override });
    t.is(scene.children.length, 3);
    const [redObject, blueObject, blackObject] = scene.children as ModelObject[];
    t.deepEqual([redObject.instanceCounter, blueObject.instanceCounter, blackObject.instanceCounter], [2, 1, 1]);
    for (const [object, color] of [[redObject, [1, 0, 0]], [blueObject, [0, 0, 1]], [blackObject, [0, 0, 0]]] as const) {
        t.deepEqual(attribute(object, "color"), [color, ...Array(5).fill([1, 1, 1])].flatMap(rgb => [...rgb, ...rgb, ...rgb, ...rgb]));
        t.is(object.textureAtlas, atlas);
    }
    t.false(base.hasAttribute("color"));
    t.is(JSON.stringify([red, blue, override, atlas.model]), original);
});

test("generated item front and back faces retain the tint index of each texture layer", t => {
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) };
    for (const [index, layer] of ModelGenerator.ITEM_LAYERS.entries()) {
        const element = ModelGenerator.generateItemModel(pixels, layer)[0];
        t.deepEqual([element.faces.north?.tintindex, element.faces.south?.tintindex], [index, index]);
        t.deepEqual([element.faces.north?.texture, element.faces.south?.texture], [`#${layer}`, `#${layer}`]);
    }
});
