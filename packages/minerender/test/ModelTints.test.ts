import { installMineRenderDataFixtures } from "./helpers/minerender-data";
import test, { ExecutionContext } from "ava";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { Models } from "../src/assets/Models";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES } from "../src/CubeFace";
import { Geometries } from "../src/Geometries";
import { Materials } from "../src/Materials";
import { ModelGenerator } from "../src/model/ModelGenerator";
import { ModelObject } from "../src/model/scene/ModelObject";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { FluidModelObject } from "../src/model/fluid/FluidModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { UVMapper } from "../src/UVMapper";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { ItemModel, Model } from "../src/model/Model";

function fixture(t: ExecutionContext) {
    const originals = { model: Models.getMerged, atlas: UVMapper.getAtlas, material: Materials.getImage, shaded: Materials.createShadedCanvasMaterial };
    const material = new MeshBasicMaterial();
    const scene = new MineRenderScene();
    Caching.clear();
    t.teardown(() => {
        Models.getMerged = originals.model;
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
    Models.getMerged = async () => model;
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

test.serial("saved light composes with tints, separates instance pools and preserves hidden block transforms on refresh", async t => {
    const { scene } = fixture(t);
    const light = [5, 0, 5, 10, 15, 10, 255];
    const add = (levels?: readonly number[]) => scene.addBlock({ variants: { "": { model: "test:block/tinted_cube", y: 90 } } }, {
        applyDefaultState: false, light: levels, tints: { 0: 0xff0000 }
    }) as Promise<BlockObject>;
    const block = await add(light);
    const shared = await add([...light]);
    const lit = scene.children[0] as ModelObject;
    t.is(lit.instanceCounter, 2);
    t.deepEqual(lit.options.light, [5, 10, 15, 10, 15, 5, 0]);
    t.deepEqual(attribute(lit, "color").slice(0, 3), Array.from(new Float32Array([1 / 3, 0, 0])));
    t.deepEqual(attribute(lit, "color").slice(-3), [0, 0, 0]);
    light.fill(0);
    t.deepEqual(block.options.light, [5, 0, 5, 10, 15, 10, 15]);
    block.setPosition(new Vector3(16, 32, 48));
    block.setVisible(false);
    const oldMatrix = block["_models"][0]["getMatrix"]();
    await block.setLight([15, 15, 15, 15, 15, 15, 15]);
    t.is(lit.instanceCounter, 1);
    const bright = scene.children[1] as ModelObject;
    t.is(bright.options.light, undefined);
    t.deepEqual(block["_models"][0]["getMatrix"](), oldMatrix);
    t.false(block.visible);
    await add();
    t.is(bright.instanceCounter, 2);
    t.is(scene.children.length, 2);
    await shared.setLight([255, 255, 255, 255, 255, 255, 255]);
    t.is(bright.instanceCounter, 3);
    t.is(lit.instanceCounter, 0);
});

test.serial("inset model faces use center light without changing the shared atlas", async t => {
    const { scene, model, atlas } = fixture(t);
    model.elements![0].from = [4, 4, 4];
    model.elements![0].to = [12, 12, 12];
    const object = await scene.addModel(model, { instanceMeshes: false, light: [5, 15, 15, 15, 15, 15, 15] }) as ModelObject;
    t.true(attribute(object, "color").every(value => Math.abs(value - 1 / 9) < 1e-7));
    t.is(object.textureAtlas, atlas);
    for (const light of [[0], [0, 0, 0, 0, 0, 0, 16], [0, 0, 0, 0, 0, 0, 0.5], Array<number>(7)]) {
        await t.throwsAsync(scene.addModel(model, { light }), { instanceOf: RangeError });
    }
});

test.serial("per-block fluid light samples the brighter vertical cell and keeps the saved water tint", async t => {
    const { scene, atlas } = fixture(t);
    atlas.positions.still = atlas.positions.flow = [0, 0];
    atlas.sizes.still = atlas.sizes.flow = [16, 16];
    const object = new FluidModelObject("water", (x, y, z) => x === 0 && y === 0 && z === 0 ? { fluid: "water" } : {},
        undefined, { instanceMeshes: false, light: [5, 15, 15, 10, 0, 15, 15], tints: { 0: 0xff0000 } });
    object.scene = scene;
    await object.init();
    t.teardown(() => object.dispose());
    const mesh = object.children[0] as Mesh;
    const colors = mesh.geometry.getAttribute("color"), normals = mesh.geometry.getAttribute("normal");
    for (let vertex = 0; vertex < normals.count; vertex++) {
        const expected = normals.getY(vertex) < 0 ? 1 / 9 : 1 / 3;
        t.true(Math.abs(colors.getX(vertex) - expected) < 1e-7);
        t.is(colors.getY(vertex), 0);
        t.is(colors.getZ(vertex), 0);
    }
});

test.serial("a failed fluid light refresh retries the same profile without replacing unchanged model instances", async t => {
    const { scene, atlas } = fixture(t);
    atlas.positions.still = atlas.positions.flow = [0, 0];
    atlas.sizes.still = atlas.sizes.flow = [16, 16];
    const block = await scene.addBlock({ variants: { "": { model: "test:block/tinted_cube" } } }, {
        applyDefaultState: false, initialState: { waterlogged: "true" }
    }) as BlockObject;
    const updateFluid = block.updateFluid;
    let attempts = 0;
    block.updateFluid = async function (sample) {
        if (++attempts === 1) throw new Error("fluid texture unavailable");
        return updateFluid.call(this, sample);
    };
    const light = [5, 5, 5, 10, 0, 5, 5];
    await t.throwsAsync(block.setLight(light), { message: "fluid texture unavailable" });
    const model = block["_models"][0];
    await block.setLight(light);
    t.is(attempts, 2);
    t.is(block["_models"][0], model);
    t.deepEqual(block.options.light, light);
    const fluid = block["_fluidModel"]!;
    t.deepEqual(("instanceable" in fluid ? fluid.instanceable : fluid).options.light, light);
    await block.setLight(light);
    t.is(attempts, 2);
});

for (const action of ["remove", "new light", "original light"] as const) {
    test.serial(`an awaited light refresh cannot override ${action}`, async t => {
        const { scene } = fixture(t);
        const original = Array(7).fill(5);
        const block = await scene.addBlock({ variants: { "": { model: "test:block/tinted_cube" } } }, {
            applyDefaultState: false, light: original
        }) as BlockObject;
        const addModel = scene.addModel;
        let release!: () => void, started!: () => void;
        const waiting = new Promise<void>(resolve => { release = resolve; });
        const ready = new Promise<void>(resolve => { started = resolve; });
        scene.addModel = async function (model, options) {
            if (options?.light?.[0] === 10) { started(); await waiting; }
            return addModel.call(this, model, options);
        };
        t.teardown(release);
        const pending = block.setLight(Array(7).fill(10));
        await ready;
        if (action === "remove") block.removeFromScene();
        else await block.setLight(action === "new light" ? Array(7).fill(12) : original);
        release();
        await pending;
        t.deepEqual(block.options.light, action === "new light" ? Array(7).fill(12) : original);
        t.is(block["_models"].length, action === "remove" ? 0 : 1);
        t.is(scene.stats.instanceCount, action === "remove" ? 0 : 1);
        t.is(scene.children.length, action === "remove" ? 0 : 1);
    });
}

test.serial("pruning light pools preserves live references, previews and shared atlases", async t => {
    const { scene, model, atlas } = fixture(t);
    const first = await scene.addModel(model, { light: Array(7).fill(5) });
    const live = await scene.addModel(model, { light: Array(7).fill(10) });
    const preview = await scene.addModel(model);
    first.removeFromScene();
    preview.removeFromScene();
    t.is(scene.pruneLightingInstances(), 1);
    t.is(scene.children.length, 2);
    t.is(scene.stats.instanceCount, 1);
    t.deepEqual(live.getPosition(), new Vector3());
    const replacement = await scene.addModel(model, { light: Array(7).fill(5) });
    t.not(replacement, first);
    t.is(scene.children.length, 3);
    t.is((scene.children[2] as ModelObject).textureAtlas, atlas);
});

test("generated item front and back faces retain the tint index of each texture layer", t => {
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([255, 255, 255, 255]) };
    for (const [index, layer] of ModelGenerator.ITEM_LAYERS.entries()) {
        const element = ModelGenerator.generateItemModel(pixels, layer)[0];
        t.deepEqual([element.faces.north?.tintindex, element.faces.south?.tintindex], [index, index]);
        t.deepEqual([element.faces.north?.texture, element.faces.south?.texture], [`#${layer}`, `#${layer}`]);
    }
});

let restoreData: () => void;
test.before(() => { restoreData = installMineRenderDataFixtures(); });
test.after.always(() => restoreData());
