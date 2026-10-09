import test, { ExecutionContext } from "ava";
import { Mesh, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { BlockStates } from "../src/assets/BlockStates";
import { Models } from "../src/assets/Models";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES, CubeFace } from "../src/CubeFace";
import { Env, EnvProvider } from "../src/Env";
import { isInstanceReference } from "../src/instance/InstanceReference";
import { Materials } from "../src/Materials";
import { BlockState } from "../src/model/block/BlockState";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { Model, TripleArray } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { Ticker } from "../src/Ticker";
import { BatchedExecutor } from "../src/util/BatchedExecutor";
import { UVMapper } from "../src/UVMapper";
import { MineRenderWorld, MineRenderWorldOptions } from "../src/world/MineRenderWorld";
import { ChunkData } from "../src/world/ChunkData";
import { SectionMesh } from "../src/world/SectionMesh";
import { buildSectionGeometry, SectionGeometryInput } from "../src/world/SectionGeometry";
import { SectionWorker } from "../src/world/SectionWorker";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";

function fixture<SectionMeshing extends boolean = false>(t: ExecutionContext, options: MineRenderWorldOptions<SectionMeshing> = {}) {
    const originals = { state: BlockStates.get, defaults: BlockStates.getDefaultState, model: Models.getMerged, atlas: UVMapper.getAtlas, image: Materials.getImage, material: Materials.createShadedCanvasMaterial, provider: Env["_provider"] };
    const scene = new MineRenderScene(), world = new MineRenderWorld<SectionMeshing>(scene, options);
    Env.register({ name: "test", createCanvas: (width, height) => ({
        width, height, getContext: () => ({ drawImage() {} })
    } as unknown as CompatCanvas) } as EnvProvider);
    const material = new MeshBasicMaterial();
    const models = new Map<string, Model>(), atlases = new Map<Model, TextureAtlas>();
    const states = new Map<string, BlockState>();
    Caching.clear();
    BlockStates.get = async key => states.get(key.toNamespacedString());
    BlockStates.getDefaultState = async () => undefined;
    Models.getMerged = async key => models.get(key.toNamespacedString());
    UVMapper.getAtlas = async model => {
        if (model.key?.type === "fluid" && !atlases.has(model)) {
            atlases.set(model, new TextureAtlas(model, { width: 32, height: 16, canvas: {} } as CanvasImage,
                { still: [16, 16], flow: [16, 16] }, { still: [0, 0], flow: [16, 0] }, false, {}, model.key.path === "water"));
        }
        return atlases.get(model);
    };
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    const addModel = (name: string, options: { height?: number; transparent?: boolean; animated?: boolean; cullable?: CubeFace[] } = {}) => {
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
            { side: [16, 16] }, { side: [0, 0] }, options.animated ?? false, {}, options.transparent ?? false));
        states.set(`test:${name}`, { variants: { "": { model: `test:block/${name}` } } });
        return model;
    };
    addModel("cube");
    for (const fluid of ["water", "lava"]) {
        states.set(`minecraft:${fluid}`, { key: AssetKey.parse("blockstates", fluid), variants: { "": { model: `block/${fluid}` } } });
    }
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
        Env["_provider"] = originals.provider;
        for (const atlas of atlases.values()) Ticker.remove(atlas.ticker);
        if (!Ticker.tickers.size) Ticker.stop();
        Caching.clear();
    });
    const place = (position: TripleArray, type = "cube") => world.setBlockAt(position, { type: `test:${type}` });
    return { world, scene, states, addModel, place };
}

function modelOf(block: BlockObject, index = 0): ModelObject {
    const part = block["_models"][index];
    return isInstanceReference(part) ? part.instanceable as ModelObject : part as ModelObject;
}
const geometryOf = (block: BlockObject, index = 0) => (modelOf(block, index).children[0] as Mesh).geometry;
const indexCount = (block: BlockObject, index = 0) => {
    const geometry = geometryOf(block, index);
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

test.serial("cull-mask replacements preserve manually managed model matrices", async t => {
    const { scene, states } = fixture(t);
    const block = await scene.addBlock(states.get("test:cube")!, { instanceMeshes: false }) as BlockObject;
    const position = new Vector3(32, 16, -48);
    block.setPosition(position);
    const original = modelOf(block);
    original.updateMatrix();
    original.matrixAutoUpdate = false;
    await block.setCullMask(1);
    const replacement = modelOf(block);
    t.not(replacement, original);
    t.false(replacement.matrixAutoUpdate);
    t.deepEqual(replacement.getWorldPosition(new Vector3()), position);
    t.is(indexCount(block), 30);
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
    const executor = new BatchedExecutor(1, 1);
    const original = BlockObject.prototype.setCullMask;
    const updates = new Map<BlockObject, number>();
    BlockObject.prototype.setCullMask = async function (mask) {
        updates.set(this, (updates.get(this) ?? 0) + 1);
        await original.call(this, mask);
    };
    t.teardown(() => { executor.stop(); BlockObject.prototype.setCullMask = original; });
    await world.placeMultiBlock({ size: [3, 1, 1], blocks: [-1, 0, 1].map(x => ({ position: [x, 0, 0], type: "test:cube" })) }, true, executor);
    t.deepEqual([-1, 0, 1].map(x => indexCount(world.getBlockAt(x, 0, 0)!.object)), [30, 24, 30]);
    t.is(scene.stats.instanceCount, 3);
    t.deepEqual([...updates.values()], [1, 1, 1]);
    await world.setBlockAt(0, 0, 0, undefined);
    t.deepEqual([-1, 1].map(x => indexCount(world.getBlockAt(x, 0, 0)!.object)), [36, 36]);
});

test.serial("default bulk placement yields to the event loop and places every block across four sections", async t => {
    const { world, scene } = fixture(t, { sectionMeshing: true });
    const blocks = Array.from({ length: 4 * 4096 }, (_, index) => ({ type: "test:cube",
        position: [index % 16, Math.floor(index / 256), Math.floor(index / 16) % 16] as TripleArray }));
    let yielded = false;
    const timer = setTimeout(() => { yielded = true; }, 0);
    t.teardown(() => clearTimeout(timer));
    await world.placeMultiBlock({ size: [16, 64, 16], blocks });
    t.true(yielded);
    t.true(blocks.every(block => world.getBlockAt(block.position)?.block.type === block.type));
    t.is(scene.children.filter(child => child instanceof SectionMesh).length, 4);
    t.is(scene.children.reduce((sum, section) => sum + section.children.reduce((count, child) =>
        count + (child as Mesh).geometry.getIndex()!.count, 0), 0), (16 * 16 * 2 + 16 * 64 * 4) * 6);
});

test.serial("section rebuilds discard stale results and results completed after clearing the world", async t => {
    const { world, scene, place } = fixture(t, { sectionMeshing: true });
    const worker = SectionWorker["instance"], initialized = SectionWorker["initialized"];
    const buildAsync = SectionMesh.buildAsync;
    const built: { section: SectionMesh; disposals: number }[] = [];
    SectionMesh.buildAsync = async function (...args) {
        const section = await buildAsync.apply(this, args);
        const result = { section, disposals: 0 };
        for (const child of section.children) {
            (child as Mesh).geometry.addEventListener("dispose", () => { result.disposals++; });
        }
        built.push(result);
        return section;
    };
    const target = new EventTarget(), releases: (() => void)[] = [];
    let posted!: () => void;
    const firstPosted = new Promise<void>(resolve => { posted = resolve; });
    SectionWorker["instance"] = undefined;
    SectionWorker["initialized"] = false;
    Env.register({ ...Env.provider, createWorker: () => Object.assign(target, {
        postMessage({ id, input }: { id: number; input: SectionGeometryInput }) {
            releases.push(() => target.dispatchEvent(new MessageEvent("message", {
                data: { id, type: "pages", pages: buildSectionGeometry(input) }
            })));
            posted();
        },
        terminate() {}
    }) as unknown as Worker });
    t.teardown(() => {
        SectionWorker["instance"]?.terminate();
        SectionWorker["instance"] = worker;
        SectionWorker["initialized"] = initialized;
        SectionMesh.buildAsync = buildAsync;
    });

    let placed = false;
    const first = place([0, 0, 0]).then(() => { placed = true; });
    await firstPosted;
    t.false(placed);
    const chunk = world.getChunkAt(new Vector3())!;
    // The world's culling drain serializes rebuilds; direct chunk edits allow overlapping builds.
    await chunk.placeBlocks([{ index: 2, block: { type: "test:cube" } }]);
    const second = chunk.rebuildSectionMesh();
    t.is(releases.length, 2);
    releases[1]();
    await second;
    t.false(placed);
    releases[0]();
    await first;
    t.deepEqual(scene.children.filter(child => child instanceof SectionMesh), [built[0].section]);
    const geometry = (built[0].section.children[0] as Mesh).geometry;
    t.is(geometry.getIndex()!.count, 72);
    t.deepEqual(geometry.boundingBox!.min.toArray(), [-8, -8, -8]);
    t.deepEqual(geometry.boundingBox!.max.toArray(), [40, 8, 8]);
    t.deepEqual(built.map(result => result.disposals), [0, 1]);

    await chunk.placeBlocks([{ index: 4, block: { type: "test:cube" } }]);
    const pending = chunk.rebuildSectionMesh();
    t.is(releases.length, 3);
    await world.clear();
    releases[2]();
    await pending;
    t.is(scene.children.filter(child => child instanceof SectionMesh).length, 0);
    t.deepEqual(built.map(result => result.disposals), [1, 1, 1]);
});

test.serial("default bulk placement starts distinct block-state resolutions concurrently", async t => {
    t.timeout(3000);
    const { world, scene, addModel } = fixture(t, { sectionMeshing: true });
    addModel("second");
    addModel("third");
    const types = ["test:cube", "test:second", "test:third"], requested: string[] = [];
    const releases: (() => void)[] = [];
    const gates = types.map(() => new Promise<void>(resolve => { releases.push(resolve); }));
    const get = BlockStates.get, getAll = BlockStates.getAll;
    // Bypass world preloads so this test measures the chunk's resolution pass.
    BlockStates.getAll = async () => [];
    BlockStates.get = async key => {
        const type = key.toNamespacedString();
        requested.push(type);
        await gates[types.indexOf(type)];
        return get(key);
    };
    const pending = world.placeMultiBlock({ size: [3, 1, 1], blocks: types.map((type, x) => ({ type, position: [x, 0, 0] })) });
    t.teardown(async () => {
        BlockStates.getAll = getAll;
        for (const release of releases) release();
        await pending;
    });
    await new Promise(resolve => setTimeout(resolve, 0));
    t.deepEqual(requested, types);
    t.is(scene.children.length, 0);
    for (const release of releases) release();
    await pending;
    t.true(types.every((type, x) => world.getBlockAt(x, 0, 0)?.block.type === type));
});

test.serial("default bulk placement selects weighted section templates separately for each block", async t => {
    const { world, scene, states, addModel } = fixture(t, { sectionMeshing: true });
    addModel("unculled", { cullable: [] });
    states.set("test:weighted", { variants: { "": [{ model: "test:block/cube" }, { model: "test:block/unculled" }] } });
    await world["sectionModels"]!.get(states.get("test:weighted")!);
    const random = Math.random;
    let choices = 0;
    Math.random = () => choices++ % 2 === 0 ? 0 : 0.99;
    t.teardown(() => { Math.random = random; });
    await world.placeMultiBlock({ size: [2, 1, 1], blocks: [
        { position: [0, 0, 0], type: "test:weighted" }, { position: [1, 0, 0], type: "test:weighted" }
    ] });
    const section = scene.children.find(child => child instanceof SectionMesh)!;
    t.is(section.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0), 66);
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

for (const sectionMeshing of [false, true]) {
    test.serial(`hidden blocks retain their data and reveal neighboring faces across chunk borders (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, states, addModel, place } = fixture(t, { sectionMeshing });
        addModel("unculled", { cullable: [] });
        states.set("test:weighted", { variants: { "": [{ model: "test:block/cube" }, { model: "test:block/unculled" }] } });
        const random = Math.random;
        t.teardown(() => { Math.random = random; });
        Math.random = () => 0;
        const value = { type: "test:weighted", properties: { axis: "x" }, nbt: { items: [1] } };
        const left = (await world.setBlockAt([-17, -1, -1], value))!;
        const right = (await place([-16, -1, -1]))!;
        const object = left.object, model = object?.["_models"][0];
        const count = (x: number) => {
            if (!sectionMeshing) {
                const block = world.getBlockAt(x, -1, -1)?.object;
                return block?.visible ? indexCount(block) : 0;
            }
            const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === Math.floor(x / 16) * 256);
            return section?.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0) ?? 0;
        };
        t.deepEqual([count(-17), count(-16)], [30, 30]);
        Math.random = () => 0.99;
        scene.dirty = false;
        await world.setBlockVisibleAt([-17, -1, -1], false);
        t.true(scene.dirty);
        t.deepEqual([count(-17), count(-16)], [0, 36]);
        t.is(world.getBlockAt(-17, -1, -1), left);
        t.is(left.object, object);
        t.deepEqual(left.block, value);
        await world.setBlockVisibleAt(new Vector3(-17, -1, -1), true);
        t.deepEqual([count(-17), count(-16)], [30, 30]);
        t.is(left.object?.["_models"][0], model);
        t.is(world.getBlockAt(-16, -1, -1), right);

        await world.setBlockVisibleAt(-17, -1, -1, false);
        await place([-17, -1, -1]);
        t.deepEqual([count(-17), count(-16)], [30, 30]);
        await world.setBlockVisibleAt(-17, -1, -1, false);
        await world.setBlockAt(-17, -1, -1, undefined);
        await world.setBlockVisibleAt(-17, -1, -1, false);
        await place([-17, -1, -1]);
        t.deepEqual([count(-17), count(-16)], [30, 30]);
        await world.setBlockVisibleAt([256, 0, 0], false);
        t.is(world.getChunkAt(new Vector3(256, 0, 0)), undefined);
    });

    test.serial(`hidden water reveals neighboring fluid surfaces and restores them when shown (sectionMeshing=${sectionMeshing})`, async t => {
        const { world } = fixture(t, { sectionMeshing });
        const left = (await world.setBlockAt([-17, -1, -1], { type: "water", properties: { level: "0" } }))!;
        const right = (await world.setBlockAt([-16, -1, -1], { type: "water", properties: { level: "4" } }))!;
        const object = left.object!, model = object["_models"][0];
        const surface = modelOf(right.object!);
        t.deepEqual([indexCount(object), indexCount(right.object!)], [30, 30]);
        await world.setBlockVisibleAt([-17, -1, -1], false);
        t.false(object.visible);
        t.is(indexCount(right.object!), 36);
        t.not(modelOf(right.object!), surface);
        t.is(left.object, object);
        t.is(object["_models"][0], model);
        await world.setBlockVisibleAt([-17, -1, -1], true);
        t.true(object.visible);
        t.is(modelOf(right.object!), surface);
        t.is(object["_models"][0], model);
        t.deepEqual([indexCount(object), indexCount(right.object!)], [30, 30]);
        t.deepEqual(left.block, { type: "minecraft:water", properties: { level: "0" } });
    });
}


for (const useExecutor of [false, true]) test.serial(`failed bulk placement updates successful writes and neighbors of removed blocks before rejecting (executor=${useExecutor})`, async t => {
    const { world, scene, place } = fixture(t);
    await place([14, 0, 0]);
    await place([15, 0, 0]);
    const get = BlockStates.get, getAll = BlockStates.getAll;
    const failure = new Error("block asset failed");
    BlockStates.getAll = async () => [];
    BlockStates.get = async key => {
        if (key.path === "failure") throw failure;
        return get(key);
    };
    const executor = useExecutor ? new BatchedExecutor(1, 4) : undefined;
    t.teardown(() => { BlockStates.getAll = getAll; executor?.stop(); });
    await t.throwsAsync(world.placeMultiBlock({ size: [4, 1, 1], blocks: [
        { position: [15, 0, 0], type: "air" },
        { position: [16, 0, 0], type: "test:cube" },
        { position: [17, 0, 0], type: "test:cube" },
        { position: [18, 0, 0], type: "test:failure" }
    ] }, true, executor), { is: failure });
    t.deepEqual([14, 16, 17].map(x => indexCount(world.getBlockAt(x, 0, 0)!.object)), [36, 30, 30]);
    t.is(world.getBlockAt(15, 0, 0), undefined);
    t.is(world.getBlockAt(18, 0, 0), undefined);
    t.is(scene.stats.instanceCount, 3);
});

test.serial("chunk column placement culls across sections and empty replacement restores the neighboring column", async t => {
    const { world, scene, place } = fixture(t);
    const neighbor = (await place([16, 15, 0]))!;
    const lower = new ChunkData(), upper = new ChunkData();
    lower.set(15 + 15 * 256, { type: "test:cube" });
    upper.set(15, { type: "test:cube" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data: lower }, { y: 1, data: upper }] });
    t.deepEqual([indexCount(world.getBlockAt(15, 15, 0)!.object),
        indexCount(world.getBlockAt(15, 16, 0)!.object), indexCount(neighbor.object)], [24, 30, 30]);
    t.is(scene.stats.instanceCount, 3);
    await world.placeChunk({ x: 0, z: 0, sections: [] });
    t.is(world.getBlockAt(15, 15, 0), undefined);
    t.is(world.getBlockAt(15, 16, 0), undefined);
    t.is(world.getBlockAt(16, 15, 0), neighbor);
    t.is(indexCount(neighbor.object), 36);
    t.is(scene.stats.instanceCount, 1);
});

for (const sectionMeshing of [false, true]) {
    test.serial(`unloading a signed chunk column releases every section and allows reloading (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, place } = fixture(t, { sectionMeshing });
        const neighbor = (await place([-16, -1, -1]))!;
        const lower = new ChunkData(), upper = new ChunkData();
        lower.set(4095, { type: "test:cube", nbt: { items: [1] } });
        upper.set(255, { type: "test:cube" });
        const column = { x: -2, z: -1, sections: [{ y: -1, data: lower }, { y: 1, data: upper }] };
        await world.placeChunk(column);
        const positions = [new Vector3(-17, -1, -1), new Vector3(-17, 16, -1)];
        const sections = positions.map(pos => world.getChunkAt(pos)!);
        const blocks = positions.map(pos => world.getBlockAt(pos)!);
        const references = blocks.flatMap(block => block.object?.["_models"] ?? []);
        const meshes = scene.children.filter(child => child instanceof SectionMesh && child.position.x === -512);
        const geometries = sectionMeshing ? meshes.flatMap(mesh => mesh.children.map(child => (child as Mesh).geometry))
            : blocks.map(block => geometryOf(block.object!));
        let disposals = 0;
        for (const geometry of new Set(geometries)) geometry.addEventListener("dispose", () => { disposals++; });
        const neighborCount = () => {
            if (neighbor.object) return indexCount(neighbor.object);
            const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === -256)!;
            return section.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0);
        };
        t.is(neighborCount(), 30);
        scene.dirty = false;
        await world.unloadChunkColumn(-2, -1);
        t.true(scene.dirty);
        t.deepEqual(positions.map(pos => world.getChunkAt(pos)), [undefined, undefined]);
        t.deepEqual(positions.map(pos => world.getBlockAt(pos)), [undefined, undefined]);
        t.is(world.getBlockAt(-16, -1, -1), neighbor);
        t.is(neighborCount(), 36);
        t.is(scene.stats.instanceCount, sectionMeshing ? 0 : 1);
        t.is(disposals, sectionMeshing ? 2 : 0);
        t.true(meshes.every(mesh => mesh.parent === null && mesh.children.length === 0));
        for (const reference of references) t.throws(() => reference.getPosition(), { message: "Instance has been removed" });
        scene.dirty = false;
        await world.unloadChunkColumn(-2, -1);
        t.false(scene.dirty);
        await world.placeChunk(column);
        t.true(positions.every((pos, i) => world.getChunkAt(pos) !== sections[i] && world.getBlockAt(pos) !== blocks[i]));
        t.deepEqual(world.getBlockAt(positions[0])!.block, lower.get(4095));
        t.is(neighborCount(), 30);
        t.is(scene.stats.instanceCount, sectionMeshing ? 0 : 3);
    });

    test.serial(`unloading a column restores neighboring fluid surfaces and heights (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene } = fixture(t, { sectionMeshing });
        const left = (await world.setBlockAt([-17, -1, -1], { type: "water", properties: { level: "4" } }))!;
        const object = left.object!, baseline = modelOf(object);
        const height = () => geometryOf(object).getAttribute("position").getY(2);
        const isolatedHeight = height();
        const water = new ChunkData(), above = new ChunkData();
        water.set(15 * 256 + 15 * 16, { type: "water" });
        above.set(15 * 16, { type: "water" });
        const column = { x: -1, z: -1, sections: [{ y: -1, data: water }, { y: 0, data: above }] };
        await world.placeChunk(column);
        const joinedHeight = height();
        const reference = world.getBlockAt(-16, -1, -1)!.object!["_models"][0];
        t.is(indexCount(object), 30);
        t.true(joinedHeight > isolatedHeight);
        await world.unloadChunkColumn(-1, -1);
        t.is(world.getBlockAt(-17, -1, -1), left);
        t.is(left.object, object);
        t.is(indexCount(object), 36);
        t.is(height(), isolatedHeight);
        t.is(modelOf(object), baseline);
        t.is(scene.stats.instanceCount, 1);
        t.throws(() => reference.getPosition(), { message: "Instance has been removed" });
        await world.placeChunk(column);
        t.is(indexCount(object), 30);
        t.is(height(), joinedHeight);
        t.is(scene.stats.instanceCount, 3);
    });
}

test.serial("unloading a chunk column rejects noninteger coordinates", async t => {
    const { world } = fixture(t);
    for (const value of [0.5, NaN, Infinity]) {
        await t.throwsAsync(world.unloadChunkColumn(value, 0), { instanceOf: RangeError });
        await t.throwsAsync(world.unloadChunkColumn(0, value), { instanceOf: RangeError });
    }
});

test.serial("standalone edits finish culling while another bulk placement is waiting for an asset", async t => {
    const { world, place, addModel } = fixture(t);
    addModel("delayed");
    const left = (await place([0, 0, 0]))!;
    await place([1, 0, 0]);
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const loading = new Promise<void>(resolve => { started = resolve; });
    const get = BlockStates.get, getAll = BlockStates.getAll;
    BlockStates.getAll = async () => [];
    BlockStates.get = async key => {
        if (key.path === "delayed") { started(); await gate; }
        return get(key);
    };
    t.teardown(() => { release(); BlockStates.getAll = getAll; });
    const pending = world.placeMultiBlock({ size: [1, 1, 1], blocks: [
        { position: [2, 0, 0], type: "test:delayed" }
    ] });
    await loading;
    await world.setBlockAt(1, 0, 0, undefined);
    t.is(indexCount(left.object), 36);
    release();
    await pending;
    t.is(indexCount(world.getBlockAt(2, 0, 0)!.object), 36);
});

test.serial("section meshes restore border faces without changing block snapshots or weighted selections", async t => {
    const { world, scene, states, place, addModel } = fixture(t, { sectionMeshing: true });
    addModel("unculled", { cullable: [] });
    states.set("test:weighted", { variants: { "": [{ model: "test:block/cube" }, { model: "test:block/unculled" }] } });
    const random = Math.random;
    t.teardown(() => { Math.random = random; });
    Math.random = () => 0;
    const value = { type: "test:weighted", properties: { axis: "x" }, nbt: { items: [1] } };
    const left = (await world.setBlockAt([-17, -1, -1], value))!;
    t.is(left.object, undefined);
    left.block.properties!.axis = "z";
    left.block.nbt.items[0] = 9;
    t.deepEqual(left.block, value);
    const count = (x: number) => {
        const group = scene.children.find(child => child instanceof SectionMesh && child.position.x === x) as SectionMesh | undefined;
        return group?.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0) ?? 0;
    };
    Math.random = () => 0.99;
    const right = (await place([-16, -1, -1]))!;
    t.is(right.object, undefined);
    t.deepEqual([count(-512), count(-256)], [30, 30]);
    t.is(scene.stats.instanceCount, 0);
    await world.getChunkAt(new Vector3(-16, -1, -1))!.clear();
    t.deepEqual([count(-512), count(-256)], [36, 0]);
    t.is(world.getBlockAt(-17, -1, -1), left);
    await world.clear();
    t.is(scene.children.length, 0);
});

test.serial("section meshing retains render objects for partial, transparent, animated and multipart blocks", async t => {
    const { world, scene, states, place, addModel } = fixture(t, { sectionMeshing: true });
    addModel("partial", { height: 8 });
    addModel("transparent", { transparent: true });
    addModel("animated", { animated: true });
    states.set("test:multipart", { multipart: [
        { apply: { model: "test:block/cube" } }, { apply: { model: "test:block/cube", x: 90 } }
    ] });
    for (const [index, type] of ["partial", "transparent", "animated", "multipart"].entries()) {
        const info = (await place([index * 2, 0, 0], type))!;
        t.true(info.object?.isBlockObject);
    }
    t.is((await place([8, 0, 0]))!.object, undefined);
    t.is(scene.stats.instanceCount, 5);
    t.is(scene.children.filter(child => child instanceof SectionMesh).length, 1);
    t.is((await place([0, 0, 0]))!.object, undefined);
    t.is(scene.stats.instanceCount, 4);
    t.is(world.getBlockAt(2, 0, 0)!.object?.isBlockObject, true);
});

for (const sectionMeshing of [false, true]) {
    test.serial(`fluid surfaces refresh across section borders, diagonals and heights (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, place } = fixture(t, { sectionMeshing });
        const water = async (position: TripleArray, level = "0") => (await world.setBlockAt(position, { type: "water", properties: { level } }))!.object!;
        const left = await water([-17, -1, -1]), right = await water([-16, -1, -1], "4");
        const matching = await water([15, -1, 10]);
        await water([16, -1, 10], "4");
        const original = modelOf(left), baseline = geometryOf(left).getAttribute("position");
        t.is(original, modelOf(matching));
        t.deepEqual([indexCount(left), indexCount(right)], [30, 30]);
        t.is(baseline.getY(2), geometryOf(right).getAttribute("position").getY(1));
        t.false(left.isOccluding);
        await water([-16, -1, 0]);
        const diagonalHeight = geometryOf(left).getAttribute("position").getY(2);
        t.true(diagonalHeight > baseline.getY(2));
        t.is(diagonalHeight, geometryOf(right).getAttribute("position").getY(1));
        t.is(modelOf(matching), original);
        await water([-16, 0, 0]);
        t.true(Math.abs(geometryOf(left).getAttribute("position").getY(2) - 7.984) < 1e-6);
        await world.setBlockAt(-16, 0, 0, undefined);
        t.is(geometryOf(left).getAttribute("position").getY(2), diagonalHeight);
        await world.setBlockAt(-16, -1, 0, undefined);
        t.is(modelOf(left), original);
        await place([-17, -1, -2]);
        t.is(indexCount(left), 24);
        await world.setBlockAt(-17, -1, -2, undefined);
        t.is(modelOf(left), original);
        t.deepEqual(left.getPosition().toArray(), [-272, -16, -16]);
        t.is(scene.stats.instanceCount, 4);
        await world.setBlockAt(-16, -1, -1, undefined);
        t.is(indexCount(left), 36);
        t.is(world.getBlockAt(-17, -1, -1)!.object, left);
    });
}

for (const sectionMeshing of [false, true]) {
    test.serial(`waterlogged blocks retain models and source water through neighbor edits and removal (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, states, place } = fixture(t, { sectionMeshing });
        states.set("test:logged", { key: AssetKey.parse("blockstates", "test:logged"),
            variants: { "": { model: "test:block/cube", y: 90 } } });
        const value = { type: "test:logged", properties: { waterlogged: "true", level: "7" } };
        const logged = (await world.setBlockAt([-17, 0, 0], value))!.object!;
        t.truthy(logged);
        t.is(logged["_models"].length, 2);
        t.is(logged.fluidLevel, 0);
        const ordinary = logged["_models"][0];
        const pose = [ordinary.getPosition().toArray(), ordinary.getRotation().toArray()];
        const fluidRotation = logged["_models"][1].getRotation();
        t.is(Math.abs(fluidRotation.x) + Math.abs(fluidRotation.y) + Math.abs(fluidRotation.z), 0);
        const water = (await world.setBlockAt([-16, 0, 0], { type: "water" }))!.object!;
        t.is(logged["_models"][0], ordinary);
        t.deepEqual([ordinary.getPosition().toArray(), ordinary.getRotation().toArray()], pose);
        t.deepEqual([indexCount(logged), indexCount(logged, 1), indexCount(water)], [36, 30, 30]);
        t.true(Math.abs(geometryOf(water).getAttribute("position").getY(0) - ((80 / 99 - 0.001) * 16 - 8)) < 1e-6);
        await place([-18, 0, 0]);
        t.is(indexCount(logged), 30);
        t.deepEqual([logged["_models"][0].getPosition().toArray(), logged["_models"][0].getRotation().toArray()], pose);
        await world.setBlockAt(-18, 0, 0, undefined);
        t.is(indexCount(logged), 36);
        const fluid = logged["_models"][1];
        const dry = (await world.setBlockAt([-17, 0, 0], { ...value, properties: { ...value.properties, waterlogged: "false" } }))!;
        t.is(logged["_models"].length, 0);
        t.throws(() => fluid.getPosition(), { message: "Instance has been removed" });
        t.is(dry.object?.fluidKind, undefined);
        t.is(scene.stats.instanceCount, sectionMeshing ? 1 : 2);
        await world.setBlockAt(-17, 0, 0, undefined);
        t.is(indexCount(water), 36);
        await world.clear();
        t.is(scene.stats.instanceCount, 0);
    });
}

test.serial("implicit water retains aquatic plants, hides bubble-column models and joins neighboring water", async t => {
    const { world, scene, states, addModel } = fixture(t, { sectionMeshing: true });
    const plant = addModel("plant", { height: 12, transparent: true });
    const cases: Array<[string, Record<string, string>]> = [
        ["kelp", {}], ["kelp_plant", {}], ["seagrass", {}],
        ["tall_seagrass", { half: "lower" }], ["tall_seagrass", { half: "upper" }],
        ["bubble_column", { drag_down: "false" }], ["bubble_column", { drag_down: "true" }]
    ];
    for (const [index, [type, properties]] of cases.entries()) {
        states.set(`minecraft:${type}`, { key: AssetKey.parse("blockstates", type), variants: { "": { model: "test:block/plant" } } });
        const x = index * 4, fluidIndex = type === "bubble_column" ? 0 : 1;
        const block = (await world.setBlockAt([x, 0, 0], { type, properties: { level: "7", ...properties } }))!.object!;
        t.deepEqual([block.fluidKind, block.fluidLevel, block["_models"].length], ["water", 0, fluidIndex + 1]);
        if (fluidIndex) t.is(modelOf(block).originalModel, plant);
        t.is(modelOf(block, fluidIndex).originalModel.key!.type, "fluid");
        const water = (await world.setBlockAt([x + 1, 0, 0], { type: "water" }))!.object!;
        t.deepEqual([indexCount(block, fluidIndex), indexCount(water)], [30, 30]);
        await world.setBlockAt(x, 0, 0, undefined);
        t.is(block["_models"].length, 0);
        t.is(indexCount(water), 36);
    }
    for (const [index, type] of ["test:kelp", "minecraft:water_cauldron"].entries()) {
        states.set(type, { key: AssetKey.parse("blockstates", type), variants: { "": { model: "test:block/plant" } } });
        const block = (await world.setBlockAt([40 + index * 4, 0, 0], { type }))!.object!;
        t.deepEqual([block.fluidKind, block["_models"].length], [undefined, 1]);
    }
    await world.clear();
    t.is(scene.stats.instanceCount, 0);
});
