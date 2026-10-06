import test, { ExecutionContext } from "ava";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { BlockStates } from "../src/assets/BlockStates";
import { Models } from "../src/assets/Models";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES, CubeFace } from "../src/CubeFace";
import { isInstanceReference } from "../src/instance/InstanceReference";
import { Materials } from "../src/Materials";
import { BlockState } from "../src/model/block/BlockState";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { Model, TripleArray } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { BatchedExecutor } from "../src/util/BatchedExecutor";
import { UVMapper } from "../src/UVMapper";
import { MineRenderWorld } from "../src/world/MineRenderWorld";
import type { CanvasImage } from "../src/canvas/CanvasImage";

function fixture(t: ExecutionContext) {
    const originals = { state: BlockStates.get, defaults: BlockStates.getDefaultState, model: Models.getMerged, atlas: UVMapper.getAtlas, image: Materials.getImage, material: Materials.createShadedCanvasMaterial };
    const scene = new MineRenderScene(), world = new MineRenderWorld(scene);
    const material = new MeshBasicMaterial();
    const models = new Map<string, Model>(), atlases = new Map<Model, TextureAtlas>();
    const states = new Map<string, BlockState>();
    Caching.clear();
    BlockStates.get = async key => states.get(key.toNamespacedString());
    BlockStates.getDefaultState = async () => undefined;
    Models.getMerged = async key => models.get(key.toNamespacedString());
    UVMapper.getAtlas = async model => atlases.get(model);
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    const addModel = (name: string, options: { height?: number; transparent?: boolean; cullable?: CubeFace[] } = {}) => {
        const model: Model = {
            key: new AssetKey("test", name, "models", "block"), textures: { side: "block/stone" },
            elements: [{ from: [0, 0, 0], to: [16, options.height ?? 16, 16],
                faces: Object.fromEntries(CUBE_FACES.map(face => [face, {
                    texture: "#side", cullface: (options.cullable ?? CUBE_FACES).includes(face) ? face : undefined
                }])),
                mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0]) }]
        };
        models.set(model.key!.toNamespacedString(), model);
        atlases.set(model, new TextureAtlas(model, { width: 16, height: 16, canvas: {} } as CanvasImage,
            { side: [16, 16] }, { side: [0, 0] }, false, {}, options.transparent ?? false));
        states.set(`test:${name}`, { variants: { "": { model: `test:block/${name}` } } });
        return model;
    };
    addModel("cube");
    t.teardown(async () => {
        await world.clear();
        scene.traverse(object => { if ((object as Mesh).isMesh) (object as Mesh).geometry.dispose(); });
        for (const owner of [...scene.children]) (owner as ModelObject).dispose();
        material.dispose();
        BlockStates.get = originals.state;
        BlockStates.getDefaultState = originals.defaults;
        Models.getMerged = originals.model;
        UVMapper.getAtlas = originals.atlas;
        Materials.getImage = originals.image;
        Materials.createShadedCanvasMaterial = originals.material;
        Caching.clear();
    });
    const place = (position: TripleArray, type = "cube") => world.setBlockAt(position, { type: `test:${type}` });
    return { world, scene, states, addModel, place };
}

function modelOf(block: BlockObject): ModelObject {
    const part = block["_models"][0];
    return isInstanceReference(part) ? part.instanceable as ModelObject : part as ModelObject;
}
const geometryOf = (block: BlockObject) => (modelOf(block).children[0] as Mesh).geometry;
const indexCount = (block: BlockObject) => {
    const geometry = geometryOf(block);
    return geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
};

test.serial("opaque neighbors cull shared faces across signed chunk borders and restore them when cleared or replaced", async t => {
    const { world, place, addModel } = fixture(t);
    addModel("partial", { height: 8 });
    addModel("transparent", { transparent: true });
    const left = (await place([-17, -1, -1]))!;
    const right = (await place([-16, -1, -1]))!;
    t.deepEqual([indexCount(left.object), indexCount(right.object)], [30, 30]);
    t.true(left.object.isOccluding);
    t.is(world.getBlockAt(-17, -1, -1), left);
    const object = left.object;
    for (const type of ["partial", "transparent"]) {
        const replacement = (await place([-16, -1, -1], type))!;
        t.false(replacement.object.isOccluding);
        t.is(indexCount(left.object), 36);
        t.is(left.object, object);
    }
    await place([-16, -1, -1]);
    t.is(indexCount(left.object), 30);
    await world.getChunkAt(new Vector3(-16, -1, -1))!.clear();
    t.is(world.getBlockAt(-16, -1, -1), undefined);
    t.is(indexCount(left.object), 36);
    t.is(world.getBlockAt(-17, -1, -1), left);
});

test.serial("instance pools separate cull masks while matching masks retain shared geometry and atlas data", async t => {
    const { world, scene, place } = fixture(t);
    const first = (await place([0, 0, 0]))!, neighbor = (await place([1, 0, 0]))!;
    const matching = (await place([10, 0, 0]))!;
    await place([11, 0, 0]);
    const isolated = (await place([20, 0, 0]))!;
    t.is(modelOf(first.object), modelOf(matching.object));
    t.not(modelOf(first.object), modelOf(neighbor.object));
    t.not(modelOf(first.object), modelOf(isolated.object));
    t.is(modelOf(first.object).textureAtlas, modelOf(isolated.object).textureAtlas);
    const source = JSON.stringify(modelOf(first.object).originalModel);
    const isolatedGeometry = geometryOf(isolated.object);
    await world.setBlockAt(1, 0, 0, undefined);
    t.is(world.getBlockAt(0, 0, 0), first);
    t.is(modelOf(first.object), modelOf(isolated.object));
    t.is(geometryOf(isolated.object), isolatedGeometry);
    t.deepEqual([indexCount(first.object), indexCount(matching.object), indexCount(isolated.object)], [36, 30, 36]);
    t.is(JSON.stringify(modelOf(first.object).originalModel), source);
    t.is(scene.stats.instanceCount, 4);
});

test.serial("a surrounded cube has no fallback geometry and regains only the newly exposed face", async t => {
    const { world, scene, place } = fixture(t);
    const center = (await place([0, 0, 0]))!;
    for (const position of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as TripleArray[]) await place(position);
    t.is(indexCount(center.object), 0);
    t.true(center.object.isOccluding);
    t.is(scene.stats.instanceCount, 7);
    await world.setBlockAt(1, 0, 0, undefined);
    t.is(indexCount(center.object), 6);
    const geometry = geometryOf(center.object), normals = geometry.getAttribute("normal");
    t.true(Array.from(geometry.index!.array).every(vertex => normals.getX(vertex) === 1));
    t.is(world.getBlockAt(0, 0, 0), center);
});

test.serial("variant rotation maps cullface directions into world space and leaves untagged faces visible", async t => {
    const { states, place, addModel } = fixture(t);
    addModel("oriented", { cullable: [CubeFace.EAST] });
    states.set("test:oriented", { variants: { "": { model: "test:block/oriented", y: 90 } } });
    const rotated = (await place([0, 0, 0], "oriented"))!;
    await place([0, 0, 1]);
    await place([-1, 0, 0]);
    t.is(indexCount(rotated.object), 30);
    const geometry = geometryOf(rotated.object), normals = geometry.getAttribute("normal");
    t.false(Array.from(geometry.index!.array).some(vertex => normals.getX(vertex) === 1));
    t.true(Array.from(geometry.index!.array).some(vertex => normals.getZ(vertex) === 1));
});

test.serial("batched adjacent placements settle with consistent shared-face visibility", async t => {
    const { world, scene } = fixture(t);
    const executor = new BatchedExecutor(1, 3);
    t.teardown(() => executor.stop());
    await world.placeMultiBlock({ size: [3, 1, 1], blocks: [-1, 0, 1].map(x => ({ position: [x, 0, 0], type: "test:cube" })) }, true, executor);
    t.deepEqual([-1, 0, 1].map(x => indexCount(world.getBlockAt(x, 0, 0)!.object)), [30, 24, 30]);
    t.is(scene.stats.instanceCount, 3);
    await world.setBlockAt(0, 0, 0, undefined);
    t.deepEqual([-1, 1].map(x => indexCount(world.getBlockAt(x, 0, 0)!.object)), [36, 36]);
});

test.serial("visibility changes preserve the originally selected weighted model", async t => {
    const { world, states, place, addModel } = fixture(t);
    addModel("alternative");
    states.set("test:weighted", { variants: { "": [{ model: "test:block/cube" }, { model: "test:block/alternative" }] } });
    const random = Math.random;
    t.teardown(() => { Math.random = random; });
    Math.random = () => 0;
    const weighted = (await place([0, 0, 0], "weighted"))!;
    const selected = modelOf(weighted.object).originalModel;
    Math.random = () => 0.99;
    await place([1, 0, 0]);
    t.is(indexCount(weighted.object), 30);
    t.is(modelOf(weighted.object).originalModel, selected);
    await world.setBlockAt(1, 0, 0, undefined);
    t.is(indexCount(weighted.object), 36);
    t.is(modelOf(weighted.object).originalModel, selected);
    t.is(world.getBlockAt(0, 0, 0), weighted);
});
