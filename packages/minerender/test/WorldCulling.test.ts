import { Logging } from "../src/util/log";
import { installMineRenderDataFixtures, mineRenderDataFixtures } from "./helpers/minerender-data";
import test, { ExecutionContext } from "ava";
import { Color, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { BlockEntities } from "../src/assets/BlockEntities";
import { Biomes } from "../src/assets/Biomes";
import { BlockStates } from "../src/assets/BlockStates";
import { Entities } from "../src/assets/Entities";
import { MineRenderData } from "../src/assets/MineRenderData";
import { Models } from "../src/assets/Models";
import { Caching } from "../src/cache/Caching";
import { CUBE_FACES, CubeFace } from "../src/CubeFace";
import { Env, EnvProvider } from "../src/Env";
import { EntityObject } from "../src/entity/scene/EntityObject";
import { isInstanceReference } from "../src/instance/InstanceReference";
import { Materials } from "../src/Materials";
import { BlockState } from "../src/model/block/BlockState";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { BlockTints } from "../src/model/block/BlockTints";
import { createFluidGeometry, resolveBlockFluidState } from "../src/model/fluid/FluidGeometry";
import { Model, TripleArray } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { Colormaps } from "../src/texture/Colormaps";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { Ticker } from "../src/Ticker";
import { BatchedExecutor } from "../src/util/BatchedExecutor";
import { UVMapper } from "../src/UVMapper";
import { MineRenderWorld, MineRenderWorldOptions } from "../src/world/MineRenderWorld";
import { ChunkData } from "../src/world/ChunkData";
import { Chunk } from "../src/world/Chunk";
import { SectionMesh } from "../src/world/SectionMesh";
import { buildSectionGeometry, SectionGeometryInput } from "../src/world/SectionGeometry";
import { SectionWorker } from "../src/world/SectionWorker";
import type { CanvasImage } from "../src/canvas/CanvasImage";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";

function fixture<SectionMeshing extends boolean = false>(t: ExecutionContext, options: MineRenderWorldOptions<SectionMeshing> = {}) {
    t.teardown(installMineRenderDataFixtures());
    const originals = { state: BlockStates.get, defaults: BlockStates.getDefaultState, entities: BlockEntities.getIndex, model: Models.getMerged, atlas: UVMapper.getAtlas, image: Materials.getImage, material: Materials.createShadedCanvasMaterial, provider: Env["_provider"] };
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
    BlockEntities.getIndex = async () => ({});
    Models.getMerged = async key => models.get(key.toNamespacedString());
    UVMapper.getAtlas = async model => {
        if (model.key?.type === "fluid" && !atlases.has(model)) {
            atlases.set(model, new TextureAtlas(model, { width: 32, height: 16, canvas: {} } as CanvasImage,
                { still: [16, 16], flow: [16, 16] }, { still: [0, 0], flow: [16, 0] }, false, {}, model.key.path === "water"));
        }
        return atlases.get(model);
    };
    Materials.getImage = Materials.createShadedCanvasMaterial = () => material;
    const addModel = (name: string, options: { height?: number; transparent?: boolean; translucent?: boolean; animated?: boolean; cullable?: CubeFace[]; tintindex?: number } = {}) => {
        const model: Model = {
            key: new AssetKey("test", name, "models", "block"), textures: { side: "block/stone" },
            elements: [{ from: [0, 0, 0], to: [16, options.height ?? 16, 16],
                faces: Object.fromEntries(CUBE_FACES.map(face => [face, {
                    texture: "#side", tintindex: options.tintindex,
                    cullface: (options.cullable ?? CUBE_FACES).includes(face) ? face : undefined
                }])),
                mappedUv: CUBE_FACES.flatMap(() => [0, 1, 1, 1, 0, 0, 1, 0]) }]
        };
        models.set(model.key!.toNamespacedString(), model);
        atlases.set(model, new TextureAtlas(model, { width: 16, height: 16, canvas: {} } as CanvasImage,
            { side: [16, 16] }, { side: [0, 0] }, options.animated ?? false, {},
            options.transparent ?? options.translucent ?? false, options.translucent ?? false));
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
        BlockEntities.getIndex = originals.entities;
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
    const part = block.models[index];
    return isInstanceReference(part) ? part.instanceable as ModelObject : part as ModelObject;
}
const geometryOf = (block: BlockObject, index = 0) => (modelOf(block, index).children[0] as Mesh).geometry;
const indexCount = (block: BlockObject, index = 0) => {
    const geometry = geometryOf(block, index);
    return geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0;
};
const cullMaskAt = (world: MineRenderWorld<boolean>, position: TripleArray) => {
    const point = new Vector3(...position);
    const object = world.getBlockAt(point)!.object;
    if (object) return object.cullMask;
    const chunk = world.getChunkAt(point)!;
    const index = Chunk.chunkPosToBlockIndex(chunk.worldPosToChunkPos(point));
    return chunk["sectionBlocks"].get(index)![0].cullMask;
};
const renderedIndexCountAt = (world: MineRenderWorld<boolean>, position: TripleArray) => {
    const point = new Vector3(...position);
    const object = world.getBlockAt(point)!.object;
    if (object) return indexCount(object);
    return world.getChunkAt(point)!["sectionMesh"]!.children.reduce((sum, child) =>
        sum + (child as Mesh).geometry.getIndex()!.count, 0);
};

for (const sectionMeshing of [false, true]) {
    test.serial(`world picking returns the nearest block across negative section boundaries (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, place } = fixture(t, { sectionMeshing });
        await place([-17, -1, -1]);
        await place([-16, -1, -1]);
        const ray = new Raycaster(new Vector3(-232, -16, -16), new Vector3(-1, 0, 0));
        const hit = world.raycast(ray)!;
        t.deepEqual(hit.position.toArray(), [-16, -1, -1]);
        t.deepEqual(hit.point.toArray(), [-248, -16, -16]);
        t.true(hit.normal.equals(new Vector3(1, 0, 0)));
        t.is(hit.distance, 16);
        t.is(hit.block.type, "test:cube");
        hit.block.type = "test:changed";
        t.is(world.getBlockAt(hit.position)!.block.type, "test:cube");
        ray.far = 15;
        t.is(world.raycast(ray), undefined);
        ray.far = Infinity;
        ray.layers.set(1);
        t.is(world.raycast(ray), undefined);
        ray.layers.set(0);
        t.deepEqual(world.raycast(ray)!.position.toArray(), [-16, -1, -1]);
        scene.scale.set(2, 3, 4);
        scene.rotation.z = Math.PI / 2;
        scene.position.set(10, 20, 30);
        ray.set(new Vector3(58, -444, -34), new Vector3(0, -1, 0));
        const transformed = world.raycast(ray)!;
        t.deepEqual(transformed.position.toArray(), [-16, -1, -1]);
        t.true(transformed.point.distanceTo(new Vector3(58, -476, -34)) < 1e-10);
        t.true(transformed.normal.distanceTo(new Vector3(0, 1, 0)) < 1e-10);
        t.true(Math.abs(transformed.distance - 32) < 1e-10);
    });

    test.serial(`world picking uses model geometry and its owning cell for overhangs (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, place, addModel } = fixture(t, { sectionMeshing });
        const model = addModel("overhang", { height: 8, cullable: [] });
        model.elements![0].to = [32, 8, 16];
        await place([-17, -1, -1], "overhang");
        await place([-16, -1, -3]);
        const ray = new Raycaster(new Vector3(-252, -20, 100), new Vector3(0, 0, -1));
        t.deepEqual(world.raycast(ray)!.position.toArray(), [-17, -1, -1]);
        t.deepEqual(world.raycast(ray)!.point.toArray(), [-252, -20, -8]);
        ray.ray.origin.y = -10;
        t.deepEqual(world.raycast(ray)!.position.toArray(), [-16, -1, -3]);
    });

    test.serial(`world picking excludes foreign, hidden, removed and unloaded blocks (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, states, place } = fixture(t, { sectionMeshing });
        const foreign = new MineRenderWorld(scene, { sectionMeshing });
        t.teardown(() => foreign.clear());
        const own = (await place([0, 0, 0]))!;
        await place([0, 0, -4]);
        const other = (await foreign.setBlockAt([0, 0, 2], { type: "test:cube" }))!;
        const standalone = await scene.addBlock(states.get("test:cube")!, { applyDefaultState: false }) as BlockObject;
        standalone.setPosition(new Vector3(0, 0, 64));
        t.teardown(() => standalone.dispose());
        if (!sectionMeshing) t.is(modelOf(own.object!), modelOf(other.object!));
        const ray = new Raycaster(new Vector3(0, 0, 120), new Vector3(0, 0, -1));
        t.deepEqual(world.raycast(ray)!.position.toArray(), [0, 0, 0]);
        t.deepEqual(foreign.raycast(ray)!.position.toArray(), [0, 0, 2]);
        scene.visible = false;
        t.is(world.raycast(ray), undefined);
        scene.visible = true;
        await world.setBlockVisibleAt([0, 0, 0], false);
        t.deepEqual(world.raycast(ray)!.position.toArray(), [0, 0, -4]);
        await world.setBlockVisibleAt([0, 0, 0], true);
        t.deepEqual(world.raycast(ray)!.position.toArray(), [0, 0, 0]);
        await world.setBlockAt([0, 0, 0], undefined);
        t.deepEqual(world.raycast(ray)!.position.toArray(), [0, 0, -4]);
        await world.unloadChunkColumn(0, -1);
        t.is(world.raycast(ray), undefined);
    });

    test.serial(`world picking includes fluid surfaces and block entity geometry (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, states, addModel } = fixture(t, { sectionMeshing });
        await world.setBlockAt([-1, -1, -1], { type: "water", properties: { level: "4" } });
        const ray = new Raycaster(new Vector3(-16, 100, -16), new Vector3(0, -1, 0));
        const water = world.raycast(ray)!;
        t.deepEqual(water.position.toArray(), [-1, -1, -1]);
        t.is(water.block.properties?.level, "4");
        t.true(water.normal.equals(new Vector3(0, 1, 0)));
        t.true(water.point.y > -24 && water.point.y < -8);
        await world.setBlockVisibleAt([-1, -1, -1], false);
        t.is(world.raycast(ray), undefined);

        addModel("entity").elements = [];
        states.set("test:entity", { key: AssetKey.parse("blockstates", "test:entity"), variants: { "": { model: "test:block/entity" } } });
        const getEntity = Entities.getEntity, applyTextures = EntityObject.prototype["applyTextures"];
        BlockEntities.getIndex = async () => ({ "test:entity": { parts: [{ model: "test:entity" }] } });
        Entities.getEntity = async key => ({ id: key.toNamespacedString(), key, transform: [], layer: { texture: [16, 16], root: {
            pose: { offset: [0, 0, 0], rotation: [0, 0, 0] },
            cubes: [{ origin: [0, 0, 0], size: [16, 16, 16], uv: [0, 0] }], children: {}
        } } });
        EntityObject.prototype["applyTextures"] = async () => undefined;
        t.teardown(() => { Entities.getEntity = getEntity; EntityObject.prototype["applyTextures"] = applyTextures; });
        const entity = (await world.setBlockAt([2, 0, 0], { type: "test:entity" }))!;
        ray.ray.origin.set(32, 100, 0);
        t.deepEqual(world.raycast(ray)!.position.toArray(), [2, 0, 0]);
        t.deepEqual(world.raycast(ray)!.point.toArray(), [32, 8, 0]);
        entity.object!.blockEntities[0].visible = false;
        t.is(world.raycast(ray), undefined);
    });
}

function templateOf(world: MineRenderWorld<boolean>, position: TripleArray) {
    const point = new Vector3(...position), chunk = world.getChunkAt(point)!;
    return chunk["sectionBlocks"].get(Chunk.chunkPosToBlockIndex(chunk.worldPosToChunkPos(point)))![0].template;
}

function topCornerColors(world: MineRenderWorld<true>, position: TripleArray): number[] {
    const point = new Vector3(...position), chunk = world.getChunkAt(point)!;
    const geometries = chunk["sectionMesh"]!.children.map(child => (child as Mesh).geometry);
    const [x, y, z] = chunk.worldPosToChunkPos(point).multiplyScalar(16).toArray();
    const colors: { x: number; z: number; color: number }[] = [];
    for (const geometry of geometries) {
        const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
        const color = geometry.getAttribute("color");
        for (let vertex = 0; vertex < positions.count; vertex++) {
            if (normals.getY(vertex) !== 1 || positions.getY(vertex) !== y + 8
                || Math.abs(positions.getX(vertex) - x) !== 8 || Math.abs(positions.getZ(vertex) - z) !== 8) continue;
            colors.push({ x: positions.getX(vertex), z: positions.getZ(vertex), color: color?.getX(vertex) ?? 1 });
        }
    }
    return colors.sort((a, b) => a.x - b.x || a.z - b.z).map(({ color }) => +color.toFixed(4));
}

test.serial("ambient occlusion defaults off and toggles loaded section geometry", async t => {
    const { world, place } = fixture(t, { sectionMeshing: true });
    const target: TripleArray = [0, 0, 0];
    const block = await place(target);
    const chunk = world.getChunkAt(new Vector3(...target))!;
    const build = chunk["buildAmbientOcclusionCells"].bind(chunk);
    let builds = 0;
    chunk["buildAmbientOcclusionCells"] = () => { builds++; return build(); };
    await place([1, 1, 1]);
    t.false(world.ambientOcclusion);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 1]);
    await world.setAmbientOcclusion(false);
    t.is(builds, 0);
    t.is(chunk["ambientOcclusionCells"], undefined);
    await world.setAmbientOcclusion(true);
    t.true(world.ambientOcclusion);
    t.is(world.getBlockAt(target), block);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 0.8]);
    const previousBuilds = builds;
    await world.setAmbientOcclusion(true);
    t.is(builds, previousBuilds);
    await world.setAmbientOcclusion(false);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 1]);
    t.is(chunk["ambientOcclusionCells"], undefined);
    const disabledBuilds = builds;
    await world.setBlockAt([1, 1, 1], undefined);
    t.is(builds, disabledBuilds);
    await t.throwsAsync(world.setAmbientOcclusion(1 as unknown as boolean), { instanceOf: TypeError });
    t.false(world.ambientOcclusion);
});

test.serial("ambient occlusion refreshes signed corner boundaries on visibility, replacement, column reload, and clear", async t => {
    const { world, place, addModel } = fixture(t, { sectionMeshing: true, ambientOcclusion: true });
    addModel("partial", { height: 8 });
    addModel("transparent", { transparent: true });
    const target: TripleArray = [-1, -1, -1], blocker: TripleArray = [0, 0, 0];
    await place(target);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 1]);
    await place(blocker);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 0.8]);
    await world.setBlockVisibleAt(blocker, false);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 1]);
    t.is(world.getBlockAt(blocker)!.block.type, "test:cube");
    await world.setBlockVisibleAt(blocker, true);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 0.8]);
    for (const type of ["partial", "transparent"]) {
        await place(blocker, type);
        t.deepEqual(topCornerColors(world, target), [1, 1, 1, 1]);
    }
    const data = new ChunkData();
    data.set(0, { type: "test:cube" });
    const column = { x: 0, z: 0, sections: [{ y: 0, data }] };
    await world.placeChunk(column);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 0.8]);
    await world.unloadChunkColumn(0, 0);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 1]);
    await world.placeChunk(column);
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 0.8]);
    await world.getChunkAt(new Vector3(...blocker))!.clear();
    t.deepEqual(topCornerColors(world, target), [1, 1, 1, 1]);
});

test.serial("ambient occlusion respects model opt-outs and multiplies saved lighting", async t => {
    const { world, addModel } = fixture(t, { sectionMeshing: true, ambientOcclusion: true, savedLighting: true });
    Object.assign(addModel("flat"), { ambientocclusion: false });
    const data = new ChunkData();
    data.set(0, { type: "test:cube" });
    data.set(1 + 16 + 256, { type: "test:cube" });
    data.set(4, { type: "test:flat" });
    data.set(5 + 16 + 256, { type: "test:cube" });
    await world.placeChunk({ x: 0, z: 0, lightValid: true,
        sections: [{ y: 0, data, light: { sky: new Uint8Array(2048).fill(0xaa) } }] });
    t.deepEqual(topCornerColors(world, [0, 0, 0]), [0.3333, 0.3333, 0.3333, 0.2667]);
    t.deepEqual(topCornerColors(world, [4, 0, 0]), [0.3333, 0.3333, 0.3333, 0.3333]);
    await world.setAmbientOcclusion(false);
    t.deepEqual(topCornerColors(world, [0, 0, 0]), [0.3333, 0.3333, 0.3333, 0.3333]);
    t.deepEqual(world.getLightAt(0, 0, 0), { block: 0, sky: 10 });
});

test.serial("a newer ambient-occlusion toggle wins while the earlier section rebuild is pending", async t => {
    const { world, place } = fixture(t, { sectionMeshing: true });
    await place([0, 0, 0]);
    await place([1, 1, 1]);
    const chunk = world.getChunkAt(new Vector3())!, build = SectionMesh.buildAsync;
    let release!: () => void, entered!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let first = true;
    SectionMesh.buildAsync = async (...args) => {
        if (first) { first = false; entered(); await gate; }
        return build.call(SectionMesh, ...args);
    };
    t.teardown(() => { release(); SectionMesh.buildAsync = build; });
    const enabled = world.setAmbientOcclusion(true);
    await started;
    const disabled = world.setAmbientOcclusion(false);
    release();
    await Promise.all([enabled, disabled]);
    t.false(world.ambientOcclusion);
    t.is(chunk["ambientOcclusionCells"], undefined);
    t.deepEqual(topCornerColors(world, [0, 0, 0]), [1, 1, 1, 1]);
});

test.serial("an ambient-occlusion toggle retries a failed section rebuild", async t => {
    const { world, place } = fixture(t, { sectionMeshing: true });
    await place([0, 0, 0]);
    await place([1, 1, 1]);
    const build = SectionMesh.buildAsync;
    let failed = false;
    SectionMesh.buildAsync = async (...args) => {
        if (!failed) { failed = true; throw new Error("section rebuild failed"); }
        return build.call(SectionMesh, ...args);
    };
    t.teardown(() => { SectionMesh.buildAsync = build; });
    await t.throwsAsync(world.setAmbientOcclusion(true), { message: "section rebuild failed" });
    t.deepEqual(topCornerColors(world, [0, 0, 0]), [1, 1, 1, 1]);
    await world.setAmbientOcclusion(true);
    t.deepEqual(topCornerColors(world, [0, 0, 0]), [1, 1, 1, 0.8]);
});

for (const sectionMeshing of [false, true]) {
    for (const batched of [false, true]) {
        test.serial(`biomes survive air-only placement and block edits, then clear with their column (sectionMeshing=${sectionMeshing}, batched=${batched})`, async t => {
            const { world, place } = fixture(t, { sectionMeshing });
            const executor = batched ? new BatchedExecutor(1, 1) : undefined;
            t.teardown(() => executor?.stop());
            const biomes = Array.from({ length: 64 }, (_, index) => `test:biome_${index}`);
            const expected = [...biomes], data = new ChunkData();
            const blocks = new ChunkData();
            blocks.set(0, { type: "test:cube" });
            const column = { x: -2, z: -1, sections: [
                { y: -1, data, biomes },
                { y: 0, data: blocks, biomes: Array(64).fill("minecraft:plains") }
            ] };
            await world.placeChunk(column, executor);
            t.is(world.getChunkAt(new Vector3(-32, -16, -16)), undefined);
            t.is(world.getBlockAt(-32, -16, -16), undefined);
            biomes[0] = "test:changed";
            for (let index = 0; index < 64; index++) {
                const pos = new Vector3(-32 + index % 4 * 4, -16 + Math.floor(index / 16) * 4,
                    -16 + Math.floor(index / 4) % 4 * 4);
                t.is(world.getBiomeAt(pos), expected[index]);
                t.is(world.getBiomeAt(pos.addScalar(3).toArray()), expected[index]);
            }
            t.is(world.getBiomeAt(-32, 0, -16), "minecraft:plains");
            t.is(world.getBlockAt(-32, 0, -16)?.block.type, "test:cube");
            for (const coordinate of [0.5, Number.MAX_SAFE_INTEGER + 1]) {
                for (const invalid of [
                    { ...column, x: coordinate },
                    { ...column, z: coordinate },
                    { ...column, sections: [column.sections[0], { ...column.sections[1], y: coordinate }] }
                ]) {
                    await t.throwsAsync(world.placeChunk(invalid, executor), { instanceOf: RangeError });
                    t.is(world.getBiomeAt(-32, -16, -16), expected[0]);
                    t.is(world.getBiomeAt(-32, 0, -16), "minecraft:plains");
                    t.is(world.getBlockAt(-32, 0, -16)?.block.type, "test:cube");
                }
            }
            t.is(world.getBiomeAt(-33, -1, -1), undefined);
            t.is(world.getBiomeAt(-17, -17, -1), undefined);
            t.is(world.getBiomeAt(-17, -1, 0), undefined);
            for (const pos of [new Vector3(-32.5, -16, -16), new Vector3(NaN, 0, 0)]) {
                t.throws(() => world.getBiomeAt(pos), { instanceOf: RangeError });
            }
            await place([-32, -16, -16]);
            await world.setBlockVisibleAt([-32, -16, -16], false);
            t.is(world.getBiomeAt(-32, -16, -16), expected[0]);
            await world.setBlockAt(-32, -16, -16, undefined);
            t.is(world.getBiomeAt(-32, -16, -16), expected[0]);
            const section = world.getChunkAt(new Vector3(-32, -16, -16))!;
            const replacement = Array(64).fill("test:replacement");
            const replacing = section.setBiomes(replacement);
            replacement[0] = "test:changed";
            await replacing;
            t.is(section.getBiomeAt(-32, -16, -16), "test:replacement");
            for (const invalid of [Array(63).fill("test:biome"), Array(65).fill("test:biome"), Array(64).fill(""), Array<string>(64)]) {
                t.throws(() => section.setBiomes(invalid));
                t.is(section.getBiomeAt(-32, -16, -16), "test:replacement");
            }
            await section.setBiomes(undefined);
            t.is(world.getBiomeAt(-32, -16, -16), undefined);
            await section.setBiomes(expected);
            await section.clear();
            t.is(world.getBiomeAt(-32, -16, -16), undefined);
            await world.placeChunk(column, executor);
            await world.placeChunk({ x: -2, z: -1, sections: [{ y: -1, data }] }, executor);
            t.is(world.getBiomeAt(-32, -16, -16), undefined);
            t.is(world.getBiomeAt(-32, 0, -16), undefined);
            await world.placeChunk(column, executor);
            await world.unloadChunkColumn(-2, -1);
            t.is(world.getBiomeAt(-32, -16, -16), undefined);
            await world.placeChunk(column, executor);
            await world.clear();
            t.is(world.getBiomeAt(-32, -16, -16), undefined);
            for (const invalid of [Array(63).fill("test:biome"), Array(65).fill("test:biome"), Array(64).fill(""), Array<string>(64)]) {
                await t.throwsAsync(world.placeChunk({ x: -2, z: -1, sections: [{ y: -1, data, biomes: invalid }] }, executor), {
                    instanceOf: RangeError, message: "Section biomes must contain 64 nonempty biome IDs"
                });
            }
        });
    }
}

for (const sectionMeshing of [false, true]) {
    for (const batched of [false, true]) {
        test.serial(`saved light survives air-only placement and edits, then clears with its section or column (sectionMeshing=${sectionMeshing}, batched=${batched})`, async t => {
            const { world, place } = fixture(t, { sectionMeshing, savedLighting: sectionMeshing });
            const executor = batched ? new BatchedExecutor(1, 1) : undefined;
            t.teardown(() => executor?.stop());
            const block = Buffer.from(Array.from({ length: 2048 }, (_, index) => index * 13 + 7));
            const sky = Uint8Array.from({ length: 2048 }, (_, index) => index * 7 + 11);
            const expectedBlock = new Uint8Array(block), expectedSky = sky.slice();
            const air = new ChunkData(), blocks = new ChunkData();
            blocks.set(0, { type: "test:cube" });
            const column = { x: -2, z: -1, lightValid: true, sections: [
                { y: -1, data: blocks, light: { block: new Uint8Array(2048).fill(0x43) } },
                { y: -2, data: air, light: { block, sky } },
                { y: 0, data: air }
            ] };
            await world.placeChunk(column, executor);
            t.is(world.getChunkAt(new Vector3(-32, -32, -16)), undefined);
            block.fill(0);
            sky.fill(0);
            for (const index of [0, 1, 15, 16, 255, 256, 2047, 2048, 4094, 4095]) {
                const position = new Vector3(-32 + index % 16, -32 + Math.floor(index / 256), -16 + Math.floor(index / 16) % 16);
                const shift = (index & 1) * 4;
                const expected = { block: (expectedBlock[index >> 1] >> shift) & 15, sky: (expectedSky[index >> 1] >> shift) & 15 };
                t.deepEqual(world.getLightAt(position), expected);
                t.deepEqual(world.getLightAt(position.toArray()), expected);
            }
            t.deepEqual(world.getLightAt(-32, -16, -16), { block: 3, sky: 15 });
            t.deepEqual(world.getLightAt(-31, -16, -16), { block: 4, sky: 15 });
            t.deepEqual(world.getLightAt(-32, 0, -16), { block: 0, sky: 15 });
            t.deepEqual(world.getLightAt(-32, 40, -16), { block: 0, sky: 15 });
            for (const position of [[-33, -32, -16], [-32, -33, -16], [-32, -32, -17]] as TripleArray[]) {
                t.is(world.getLightAt(position), undefined);
            }
            for (const position of [new Vector3(-32.5, -32, -16), new Vector3(NaN, 0, 0)]) {
                t.throws(() => world.getLightAt(position), { instanceOf: RangeError });
            }
            const expected = { block: 7, sky: 11 };
            world.getLightAt(-32, -32, -16)!.block = 0;
            await place([-32, -32, -16]);
            await world.setBlockVisibleAt([-32, -32, -16], false);
            t.deepEqual(world.getLightAt(-32, -32, -16), expected);
            await world.setBlockVisibleAt([-32, -32, -16], true);
            await world.setBlockAt(-32, -32, -16, undefined);
            t.deepEqual(world.getLightAt(-32, -32, -16), expected);
            await world.getChunkAt(new Vector3(-32, -32, -16))!.clear();
            t.is(world.getLightAt(-32, -32, -16), undefined);
            t.deepEqual(world.getLightAt(-32, -16, -16), { block: 3, sky: 0 });
            await world.placeChunk({ x: -2, z: -1, sections: [{ y: -1, data: blocks }] }, executor);
            t.is(world.getLightAt(-32, -16, -16), undefined);
            t.is(world.getLightAt(-32, 0, -16), undefined);
            await world.placeChunk(column, executor);
            await world.unloadChunkColumn(-2, -1);
            t.is(world.getLightAt(-32, -16, -16), undefined);
            t.is(world.getLightAt(-32, -32, -16), undefined);
            await world.placeChunk(column, executor);
            await world.clear();
            t.is(world.getLightAt(-32, -16, -16), undefined);
            t.is(world.getLightAt(-32, -32, -16), undefined);
        });
    }
}

test.serial("blocks above saved sky arrays keep full brightness while block-only columns use ambient light", async t => {
    const { world, scene, place } = fixture(t, { sectionMeshing: true, savedLighting: true, ambientLight: 0.25 });
    const colors = () => {
        const section = scene.children.find(child => child instanceof SectionMesh);
        return Array.from((section!.children[0] as Mesh).geometry.getAttribute("color").array);
    };
    await place([8, 40, 8]);
    const unlit = colors(), data = new ChunkData(), block = new Uint8Array(2048);
    t.true(unlit.some(value => value > 0));
    for (const sky of [new Uint8Array(2048), undefined]) {
        await world.placeChunk({ x: 0, z: 0, lightValid: true, sections: [
            { y: 0, data, light: { block, sky } },
            { y: 2, data, light: { block } }
        ] });
        await place([8, 40, 8]);
        t.deepEqual(world.getLightAt(8, 40, 8), { block: 0, sky: sky ? 15 : 0 });
        t.deepEqual(colors(), sky ? unlit : unlit.map(value => value * 0.25));
    }
});

test.serial("saved light remains available without rendering and invalid replacement arrays preserve the existing column", async t => {
    const { world } = fixture(t);
    t.throws(() => new MineRenderWorld(world.scene, { savedLighting: true }), { instanceOf: TypeError, message: "savedLighting requires sectionMeshing" });
    const expected = { instanceOf: TypeError, message: "ambientOcclusion requires sectionMeshing" };
    t.throws(() => new MineRenderWorld(world.scene, { ambientOcclusion: true }), expected);
    await t.throwsAsync(world.setAmbientOcclusion(true), expected);
    await t.notThrowsAsync(world.setAmbientOcclusion(false));
    t.false(world.ambientOcclusion);
    for (const ambientLight of [-0.1, 1.1, NaN]) {
        t.throws(() => new MineRenderWorld(world.scene, { ambientLight }), {
            instanceOf: RangeError, message: "ambientLight must be a number from 0 to 1"
        });
    }
    const data = new ChunkData();
    data.set(0, { type: "test:cube" });
    const column = { x: 0, z: 0, lightValid: false, sections: [
        { y: 0, data, light: { sky: new Uint8Array(2048).fill(0x87) } }
    ] };
    await world.placeChunk(column);
    t.deepEqual(world.getLightAt(0, 0, 0), { block: 0, sky: 7 });
    const placed = world.getBlockAt(0, 0, 0);
    for (const channel of ["block", "sky"]) {
        for (const bytes of [new Uint8Array(2047), new Uint8Array(2049), Array(2048).fill(0)]) {
            await t.throwsAsync(world.placeChunk({ ...column, sections: [
                { y: 0, data, light: { [channel]: bytes as unknown as Uint8Array } }
            ] }), { instanceOf: RangeError, message: `Section ${channel} light must contain 2048 packed bytes` });
            t.is(world.getBlockAt(0, 0, 0), placed);
            t.deepEqual(world.getLightAt(0, 0, 0), { block: 0, sky: 7 });
        }
    }
});

function assertFluidPositions(t: ExecutionContext, world: MineRenderWorld<boolean>, scene: MineRenderScene, positions: TripleArray[]): number[] {
    const origin = new Vector3(...positions[0]).divideScalar(16).floor().multiplyScalar(256);
    const section = scene.children.find(child => child instanceof SectionMesh && child.position.equals(origin));
    const mesh = section?.children.at(-1) as Mesh | undefined;
    const actual = Array.from(mesh?.geometry.getAttribute("position").array ?? []);
    const expected: number[] = [];
    for (const position of positions) {
        const center = new Vector3(...position);
        if (!world.getChunkAt(center)?.isBlockVisibleAt(center)) continue;
        const block = world.getBlockAt(center)!.block;
        const fluid = resolveBlockFluidState(AssetKey.parse("blockstates", block.type), block.properties, mineRenderDataFixtures.fluids)!;
        const geometry = createFluidGeometry(fluid.kind, (x, y, z) => {
            const neighbor = center.clone().add(new Vector3(x, y, z));
            const chunk = world.getChunkAt(neighbor);
            if (!chunk?.isBlockVisibleAt(neighbor)) return {};
            const block = world.getBlockAt(neighbor)!.block;
            const fluid = resolveBlockFluidState(AssetKey.parse("blockstates", block.type), block.properties, mineRenderDataFixtures.fluids);
            return { fluid: fluid?.kind, level: fluid?.level, solid: chunk.isOccludingAt(neighbor) };
        });
        geometry.translate(center.x * 16 - origin.x, center.y * 16 - origin.y, center.z * 16 - origin.z);
        expected.push(...geometry.getAttribute("position").array);
        geometry.dispose();
    }
    t.is(actual.length, expected.length);
    // Section offsets are applied before coordinates are stored as Float32 values.
    t.true(actual.every((value, index) => Math.abs(value - expected[index]) < 0.00002));
    return actual;
}

for (const sectionMeshing of [false, true]) {
    test.serial(`untinted blocks do not request biome definitions or colors (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, states } = fixture(t, { sectionMeshing });
        const originals = { get: Biomes.get, color: Biomes.getColor };
        Biomes.get = async () => { throw new Error("Untinted blocks must not load biome definitions"); };
        Biomes.getColor = async () => { throw new Error("Untinted blocks must not load biome colors"); };
        t.teardown(() => { Biomes.get = originals.get; Biomes.getColor = originals.color; });
        states.set("minecraft:stone", { key: AssetKey.parse("blockstates", "stone"), variants: { "": { model: "test:block/cube" } } });
        const data = new ChunkData();
        data.set(0, { type: "stone" });
        await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:biome") }] });
        const placed = world.getBlockAt(0, 0, 0)!;
        await world.getChunkAt(new Vector3())!.setBiomes(Array(64).fill("test:replacement"));
        t.is(world.getBlockAt(0, 0, 0)!.block.type, "minecraft:stone");
        t.is(world.getBiomeAt(0, 0, 0), "test:replacement");
        t.is(world.getBlockAt(0, 0, 0), placed);
    });

    test.serial(`biomes color shared block states independently and refresh after replacement (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, states, addModel } = fixture(t, { sectionMeshing });
        const originals = { get: Biomes.get, color: Biomes.getColor };
        const calls: Parameters<typeof Biomes.getColor>[] = [];
        Biomes.get = async id => id === "test:missing" ? undefined : { temperature: 0.8, downfall: 0.4, effects: {} };
        Biomes.getColor = async (...args) => {
            calls.push(args);
            return args[0] === "test:first" ? 0x123456 : args[0] === "test:second" ? 0xabcdef : undefined;
        };
        t.teardown(() => { Biomes.get = originals.get; Biomes.getColor = originals.color; });
        addModel("tinted", { tintindex: 0 });
        const blockKey = AssetKey.parse("blockstates", "oak_leaves");
        const blockState = { key: blockKey, variants: { "": { model: "test:block/tinted" } } };
        states.set("minecraft:oak_leaves", blockState);
        const data = new ChunkData();
        data.set(0, { type: "oak_leaves" });
        data.set(8, { type: "oak_leaves" });
        const biomes = Array(64).fill("test:first");
        biomes[2] = "test:second";
        const column = { x: -2, z: -1, sections: [{ y: -1, data, biomes }] };
        const colorsAt = (x: number) => {
            const object = world.getBlockAt(x, -16, -16)?.object;
            if (object) {
                const colors = geometryOf(object).getAttribute("color");
                return [...new Set(Array.from({ length: colors.count }, (_, index) => new Color().fromBufferAttribute(colors, index).getHex()))];
            }
            const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === -512)!;
            const result = new Set<number>(), localX = (x + 32) * 16;
            for (const child of section?.children ?? []) {
                const geometry = (child as Mesh).geometry, positions = geometry.getAttribute("position"), colors = geometry.getAttribute("color");
                for (let index = 0; index < positions.count; index++) {
                    if (Math.abs(positions.getX(index) - localX) <= 8) result.add(new Color().fromBufferAttribute(colors, index).getHex());
                }
            }
            return [...result];
        };
        await world.placeChunk(column);
        t.deepEqual(colorsAt(-32), [0x123456]);
        t.deepEqual(colorsAt(-24), [0xabcdef]);
        t.true(calls.some(([id, kind, origin, x, z]) => id === "test:first" && kind === "foliage" && origin === blockKey && x === -32 && z === -16));
        t.true(calls.some(([id, kind, origin, x, z]) => id === "test:second" && kind === "foliage" && origin === blockKey && x === -24 && z === -16));
        t.is(world.getBlockAt(-32, -16, -16)!.object === undefined, sectionMeshing);
        const secondObject = world.getBlockAt(-24, -16, -16)!.object;
        if (secondObject) t.not(modelOf(world.getBlockAt(-32, -16, -16)!.object!), modelOf(secondObject));
        await world.unloadChunkColumn(-2, -1);
        await world.placeChunk(column);
        t.deepEqual(colorsAt(-32), [0x123456]);
        t.deepEqual(colorsAt(-24), [0xabcdef]);

        const chunk = world.getChunkAt(new Vector3(-32, -16, -16))!;
        await world.setBlockVisibleAt([-32, -16, -16], false);
        scene.dirty = false;
        const changed = Array(64).fill("test:second");
        changed[2] = "test:missing";
        const replacing = chunk.setBiomes(changed);
        changed[0] = "test:first";
        await replacing;
        t.true(scene.dirty);
        t.false(chunk.isBlockVisibleAt(new Vector3(-32, -16, -16)));
        t.deepEqual(world.getBlockAt(-32, -16, -16)!.block, { type: "minecraft:oak_leaves" });
        t.deepEqual(colorsAt(-24), [0x48b518]);
        await world.setBlockVisibleAt([-32, -16, -16], true);
        t.deepEqual(colorsAt(-32), [0xabcdef]);
        t.deepEqual(colorsAt(-24), [0x48b518]);
        await chunk.setBiomes(undefined);
        t.deepEqual(colorsAt(-32), [0x48b518]);
        t.deepEqual(colorsAt(-24), [0x48b518]);
        await world.placeChunk(column);
        t.deepEqual(colorsAt(-32), [0x123456]);
        t.deepEqual(colorsAt(-24), [0xabcdef]);
    });

    test.serial(`waterlogged foliage and water keep distinct biome colors through neighbor edits (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, states, addModel } = fixture(t, { sectionMeshing });
        const originals = { get: Biomes.get, color: Biomes.getColor };
        Biomes.get = async id => id === "test:missing" ? undefined : { temperature: 0.8, downfall: 0.4, effects: {} };
        Biomes.getColor = async (id, kind) => kind === "water" ? id === "test:first" ? 0x123456 : 0xabcdef : 0x246824;
        t.teardown(() => { Biomes.get = originals.get; Biomes.getColor = originals.color; });
        addModel("leaves", { tintindex: 0, transparent: true });
        states.set("minecraft:oak_leaves", { key: AssetKey.parse("blockstates", "oak_leaves"),
            variants: { "": { model: "test:block/leaves" } } });
        const data = new ChunkData();
        data.set(0, { type: "oak_leaves", properties: { waterlogged: "true" } });
        data.set(1, { type: "water" });
        data.set(8, { type: "water" });
        const biomes = Array(64).fill("test:first");
        biomes[2] = "test:second";
        await world.placeChunk({ x: -2, z: -1, sections: [{ y: -1, data, biomes }] });
        const color = (x: number, part = 0) => {
            if (!sectionMeshing) return new Color().fromBufferAttribute(geometryOf(world.getBlockAt(x, -16, -16)!.object!, part).getAttribute("color"), 0).getHex();
            if (x === -32 && part === 0) return new Color().fromBufferAttribute(templateOf(world, [x, -16, -16]).geometry.getAttribute("color"), 0).getHex();
            const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === -512)!;
            const geometry = (section.children.at(-1) as Mesh).geometry;
            const positions = geometry.getAttribute("position"), normals = geometry.getAttribute("normal"), colors = geometry.getAttribute("color");
            for (let index = 0; index < positions.count; index += 4) {
                if (normals.getY(index) <= 0) continue;
                const centerX = Array.from({ length: 4 }, (_, corner) => positions.getX(index + corner)).reduce((sum, value) => sum + value, 0) / 4;
                if (Math.abs(centerX - (x + 32) * 16) > 0.001) continue;
                const color = new Color().fromBufferAttribute(colors, index).getHex();
                for (let corner = 1; corner < 4; corner++) t.is(new Color().fromBufferAttribute(colors, index + corner).getHex(), color);
                return color;
            }
            t.fail(`No fluid surface at x=${x}`);
        };
        t.deepEqual([color(-32), color(-32, 1), color(-31), color(-24)], [0x246824, 0x123456, 0x123456, 0xabcdef]);
        if (!sectionMeshing) t.not(modelOf(world.getBlockAt(-31, -16, -16)!.object!), modelOf(world.getBlockAt(-24, -16, -16)!.object!));
        else for (const x of [-32, -31, -24]) t.is(world.getBlockAt(x, -16, -16)!.object, undefined);
        await world.setBlockAt(-31, -16, -16, undefined);
        t.deepEqual([color(-32), color(-32, 1), color(-24)], [0x246824, 0x123456, 0xabcdef]);
        await world.setBlockVisibleAt([-24, -16, -16], false);
        await world.getChunkAt(new Vector3(-32, -16, -16))!.setBiomes(Array(64).fill("test:second"));
        t.false(world.getChunkAt(new Vector3(-24, -16, -16))!.isBlockVisibleAt(new Vector3(-24, -16, -16)));
        await world.setBlockVisibleAt([-24, -16, -16], true);
        t.deepEqual([color(-32), color(-32, 1), color(-24)], [0x246824, 0xabcdef, 0xabcdef]);
        await world.getChunkAt(new Vector3(-32, -16, -16))!.setBiomes(undefined);
        t.deepEqual([color(-32), color(-32, 1), color(-24)], [0x48b518, 0x3f76e4, 0x3f76e4]);
        biomes[2] = "test:missing";
        await world.unloadChunkColumn(-2, -1);
        await world.placeChunk({ x: -2, z: -1, sections: [{ y: -1, data, biomes }] });
        t.deepEqual([color(-32), color(-32, 1), color(-24)], [0x246824, 0x123456, 0x3f76e4]);
    });
}

for (const sectionMeshing of [false, true]) test.serial(`untinted resource-pack models skip biome colors (sectionMeshing=${sectionMeshing})`, async t => {
    const { world, states, addModel } = fixture(t, { sectionMeshing });
    const originals = { get: Biomes.get, color: Biomes.getColor, grass: Colormaps.grassColor };
    Biomes.get = async () => ({ temperature: 0.8, downfall: 0.4, effects: {} });
    Biomes.getColor = async () => { throw new Error("Untinted models must not request biome colors"); };
    Colormaps.grassColor = async () => { throw new Error("Untinted models must not request colormaps"); };
    t.teardown(() => { Biomes.get = originals.get; Biomes.getColor = originals.color; Colormaps.grassColor = originals.grass; });
    addModel("untinted_leaves", { transparent: true });
    states.set("minecraft:grass_block", { key: AssetKey.parse("blockstates", "grass_block"),
        variants: { "": { model: "test:block/cube" } } });
    states.set("minecraft:oak_leaves", { key: AssetKey.parse("blockstates", "oak_leaves"),
        variants: { "": { model: "test:block/untinted_leaves" } } });
    const data = new ChunkData();
    data.set(0, { type: "grass_block" });
    data.set(2, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:biome") }] });
    for (const x of [0, 2]) t.is(world.getBlockAt(x, 0, 0)!.object === undefined, sectionMeshing);
});

test.serial("palette placement resolves each foliage biome once before filling a section", async t => {
    const { world, scene, states, addModel } = fixture(t, { sectionMeshing: true });
    const originals = { state: BlockStates.get, get: Biomes.get, color: Biomes.getColor };
    let statesLoaded = 0, definitionsLoaded = 0, colorsLoaded = 0;
    BlockStates.get = async key => { statesLoaded++; return originals.state(key); };
    Biomes.get = async () => { definitionsLoaded++; return { temperature: 0.8, downfall: 0.4, effects: {} }; };
    Biomes.getColor = async id => { colorsLoaded++; return id === "test:first" ? 0x123456 : 0xabcdef; };
    t.teardown(() => { BlockStates.get = originals.state; Biomes.get = originals.get; Biomes.getColor = originals.color; });
    addModel("leaves", { tintindex: 0 });
    states.set("minecraft:oak_leaves", { key: AssetKey.parse("blockstates", "oak_leaves"),
        variants: { "": { model: "test:block/leaves" } } });
    const data = new ChunkData();
    for (let index = 0; index < 4096; index++) data.set(index, { type: "oak_leaves" });
    const biomes = Array.from({ length: 64 }, (_, index) => index % 4 < 2 ? "test:first" : "test:second");
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes }] });
    t.deepEqual([statesLoaded, definitionsLoaded, colorsLoaded], [1, 2, 2]);
    const section = scene.children.find(child => child instanceof SectionMesh)!;
    const colors = (section.children[0] as Mesh).geometry.getAttribute("color");
    t.deepEqual(new Set(Array.from({ length: colors.count }, (_, index) => new Color().fromBufferAttribute(colors, index).getHex())),
        new Set([0x123456, 0xabcdef]));
    t.is(world.getBlockAt(15, 15, 15)!.object, undefined);
});

for (const sectionMeshing of [false, true]) test.serial(`worlds without biome samples skip biome tint rules (sectionMeshing=${sectionMeshing})`, async t => {
    const { world, place } = fixture(t, { sectionMeshing });
    const source = BlockTints.biomeSource;
    BlockTints.biomeSource = async () => { throw new Error("No biome rules are needed without biome samples"); };
    t.teardown(() => { BlockTints.biomeSource = source; });
    await place([0, 0, 0]);
    const data = new ChunkData();
    data.set(0, { type: "test:cube" });
    await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data }] });
    t.truthy(world.getBlockAt(0, 0, 0));
    t.truthy(world.getBlockAt(16, 0, 0));
});

test.serial("upper tall plants sample the lower block's biome across a section boundary", async t => {
    const { world, states, addModel } = fixture(t, { sectionMeshing: true });
    const originals = { get: Biomes.get, color: Biomes.getColor, grass: Colormaps.grassColor };
    Biomes.get = async () => ({ temperature: 0.8, downfall: 0.4, effects: {} });
    Biomes.getColor = async id => id === "test:lower" ? 0x123456 : 0xabcdef;
    Colormaps.grassColor = async () => 0x654321;
    t.teardown(() => { Biomes.get = originals.get; Biomes.getColor = originals.color; Colormaps.grassColor = originals.grass; });
    addModel("plant", { tintindex: 0, height: 12, transparent: true });
    for (const type of ["tall_grass", "large_fern"]) {
        states.set(`minecraft:${type}`, { key: AssetKey.parse("blockstates", type), variants: { "": { model: "test:block/plant" } } });
    }
    const lower = new ChunkData(), upper = new ChunkData();
    for (const [x, type] of ["tall_grass", "large_fern"].entries()) {
        lower.set(15 * 256 + x * 4, { type, properties: { half: "lower" } });
        upper.set(x * 4, { type, properties: { half: "upper" } });
    }
    await world.placeChunk({ x: -1, z: -1, sections: [
        { y: 0, data: upper, biomes: Array(64).fill("test:upper") },
        { y: -1, data: lower, biomes: Array(64).fill("test:lower") }
    ] });
    const assertColors = (color: number) => {
        for (const x of [-16, -12]) {
            for (const y of [-1, 0]) {
                const geometry = templateOf(world, [x, y, -16]).geometry;
                t.is(new Color().fromBufferAttribute(geometry.getAttribute("color"), 0).getHex(), color);
            }
        }
    };
    assertColors(0x123456);
    await world.setBlockVisibleAt([-12, 0, -16], false);
    const upperChunk = world.getChunkAt(new Vector3(-12, 0, -16))!;
    const lowerChunk = world.getChunkAt(new Vector3(-16, -1, -16))!;
    await lowerChunk.setBiomes(Array(64).fill("test:high"));
    assertColors(0xabcdef);
    t.false(upperChunk.isBlockVisibleAt(new Vector3(-12, 0, -16)));
    await lowerChunk.setBiomes(undefined);
    assertColors(0x654321);
    t.false(upperChunk.isBlockVisibleAt(new Vector3(-12, 0, -16)));
    await world.setBlockVisibleAt([-12, 0, -16], true);
    t.true(upperChunk.isBlockVisibleAt(new Vector3(-12, 0, -16)));
    await world.placeChunk({ x: -1, z: -1, sections: [
        { y: 0, data: upper }, { y: -1, data: lower, biomes: Array(64).fill("test:lower") }
    ] });
    assertColors(0x123456);
    await world.setBlockVisibleAt([-12, 0, -16], false);
    await world.getChunkAt(new Vector3(-16, -1, -16))!.clear();
    for (const x of [-16, -12]) {
        const geometry = templateOf(world, [x, 0, -16]).geometry;
        t.is(new Color().fromBufferAttribute(geometry.getAttribute("color"), 0).getHex(), 0x654321);
        t.is(world.getBlockAt(x, -1, -16), undefined);
    }
    t.false(world.getChunkAt(new Vector3(-12, 0, -16))!.isBlockVisibleAt(new Vector3(-12, 0, -16)));
});

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

const sameBlockCulling = {
    profiles: [{ type: "same_block" }], blocks: { "test:glass": 0, "test:tinted_glass": 0 }
};

for (const sectionMeshing of [false, true]) {
    test.serial(`same transparent cubes cull shared faces within and across chunks (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: sameBlockCulling }));
        addModel("glass", { transparent: true });
        await place([-1, 0, 0], "glass");
        await place([0, 0, 0], "glass");
        t.deepEqual([-1, 0].map(x => cullMaskAt(world, [x, 0, 0])), [1, 2]);
        t.deepEqual([-1, 0].map(x => renderedIndexCountAt(world, [x, 0, 0])), [30, 30]);
        await world.setBlockAt(0, 0, 0, undefined);
        t.is(cullMaskAt(world, [-1, 0, 0]), 0);
        t.is(renderedIndexCountAt(world, [-1, 0, 0]), 36);
        await place([2, 0, 0], "glass");
        await place([3, 0, 0], "glass");
        t.deepEqual([2, 3].map(x => cullMaskAt(world, [x, 0, 0])), [1, 2]);
        t.is(renderedIndexCountAt(world, [2, 0, 0]), sectionMeshing ? 60 : 30);
    });

    test.serial(`different transparent cube types keep shared faces (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: sameBlockCulling }));
        addModel("glass", { transparent: true });
        addModel("tinted_glass", { transparent: true });
        await place([0, 0, 0], "glass");
        await place([1, 0, 0], "tinted_glass");
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [0, 0]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 72 : 36);
    });

    test.serial(`opaque cubes hide transparent faces but keep their own (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: sameBlockCulling }));
        addModel("glass", { transparent: true });
        await place([0, 0, 0], "glass");
        await place([1, 0, 0]);
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [1, 0]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 66 : 30);
        if (!sectionMeshing) t.is(renderedIndexCountAt(world, [1, 0, 0]), 36);
    });

    test.serial(`hidden transparent cubes stop hiding their neighbor (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: sameBlockCulling }));
        addModel("glass", { transparent: true });
        await place([0, 0, 0], "glass");
        await place([1, 0, 0], "glass");
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [1, 2]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 60 : 30);
        await world.setBlockVisibleAt([1, 0, 0], false);
        t.is(cullMaskAt(world, [0, 0, 0]), 0);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), 36);
        await world.setBlockVisibleAt([1, 0, 0], true);
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [1, 2]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 60 : 30);
    });

    test.serial(`cutout leaves keep shared faces (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: {
            profiles: [{ type: "leaves" }], blocks: { "test:oak_leaves": 0 }
        } }));
        addModel("oak_leaves", { transparent: true });
        await place([0, 0, 0], "oak_leaves");
        await place([1, 0, 0], "oak_leaves");
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [0, 0]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 72 : 36);
    });

    test.serial(`unlisted transparent cubes keep shared faces (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: { profiles: [], blocks: {} } }));
        addModel("glass", { transparent: true });
        await place([0, 0, 0], "glass");
        await place([1, 0, 0], "glass");
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [0, 0]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 72 : 36);
    });

    test.serial(`same_block rules apply to partial models (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: {
            profiles: [{ type: "same_block" }], blocks: { "test:partial": 0 }
        } }));
        addModel("partial", { transparent: true, height: 8 });
        await place([0, 0, 0], "partial");
        await place([1, 0, 0], "partial");
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [1, 2]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 60 : 30);
    });

    test.serial(`vertical rules only hide stacked faces (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: {
            profiles: [{ type: "same_block_vertical" }], blocks: { "test:roots": 0 }
        } }));
        addModel("roots", { transparent: true });
        for (const position of [[0, 0, 0], [0, 1, 0], [1, 0, 0]] as TripleArray[]) await place(position, "roots");
        t.deepEqual([[0, 0, 0], [0, 1, 0], [1, 0, 0]].map(p => cullMaskAt(world, p as TripleArray)), [4, 8, 0]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 96 : 30);
    });

    test.serial(`connected rules require facing properties or stacked blocks (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: {
            profiles: [{ type: "connected" }], blocks: { "test:pane": 0 }
        } }));
        addModel("pane", { transparent: true });
        await place([15, 0, 0], "pane");
        await world.setBlockAt([16, 0, 0], { type: "test:pane", properties: { west: "true" } });
        t.deepEqual([15, 16].map(x => cullMaskAt(world, [x, 0, 0])), [0, 0]);
        await world.setBlockAt([15, 0, 0], { type: "test:pane", properties: { east: true } });
        t.deepEqual([15, 16].map(x => cullMaskAt(world, [x, 0, 0])), [1, 2]);
        t.is(renderedIndexCountAt(world, [15, 0, 0]), 30);
        await place([16, 0, 0], "pane");
        t.deepEqual([15, 16].map(x => cullMaskAt(world, [x, 0, 0])), [0, 0]);
        await place([15, 1, 0], "pane");
        t.deepEqual([0, 1].map(y => cullMaskAt(world, [15, y, 0])), [4, 8]);
        t.is(renderedIndexCountAt(world, [15, 0, 0]), sectionMeshing ? 60 : 30);
    });

    test.serial(`missing culling dataset permits placement without shared-face rules (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, addModel, place } = fixture(t, { sectionMeshing });
        t.teardown(installMineRenderDataFixtures({ blockCulling: {
            profiles: [{ type: "same_block" }], blocks: { "test:glass": 0 }
        } }));
        const resolve = MineRenderData.resolve;
        MineRenderData.resolve = async root => {
            const resolved = await resolve(root);
            delete resolved.manifest.datasets.blockCulling;
            return resolved;
        };
        t.teardown(() => { MineRenderData.resolve = resolve; });
        addModel("glass", { transparent: true });
        await place([0, 0, 0], "glass");
        await place([1, 0, 0], "glass");
        t.deepEqual([0, 1].map(x => cullMaskAt(world, [x, 0, 0])), [0, 0]);
        t.is(renderedIndexCountAt(world, [0, 0, 0]), sectionMeshing ? 72 : 36);
    });
}

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

test.serial("weighted models and rotations agree across rendering modes and reversed chunk reloads", async t => {
    const { world, scene, states, addModel } = fixture(t, { sectionMeshing: true });
    const individual = new MineRenderWorld(scene);
    t.teardown(() => individual.clear());
    addModel("alternative");
    states.set("test:weighted", { variants: { "": [
        { model: "test:block/cube" }, { model: "test:block/alternative", x: 90, y: 90, uvlock: true, weight: 3 },
        { model: "test:block/alternative", y: 180, weight: 2 }
    ] } });
    const positions = Array.from({ length: 32 }, (_, index) =>
        [index - 20, -17 + index % 3 * 16, -33 + index % 5 * 16] as TripleArray);
    const blocks = positions.map(position => ({ position, type: "test:weighted" }));
    const vertices = (geometry: ReturnType<typeof geometryOf>) =>
        Array.from(geometry.getAttribute("position").array, value => Math.abs(value) < 1e-6 ? 0 : +value.toFixed(5));
    const sectionSelection = (position: TripleArray) => {
        const template = templateOf(world, position);
        return { model: template.atlas.model.key!.toNamespacedString(), vertices: vertices(template.geometry) };
    };
    const individualSelection = (position: TripleArray) => {
        const block = individual.getBlockAt(position)!.object;
        const geometry = geometryOf(block).clone();
        geometry.applyMatrix4(block["getModelMatrix"](block["_models"][0]).setPosition(0, 0, 0));
        const selection = { model: modelOf(block).originalModel.key!.toNamespacedString(), vertices: vertices(geometry) };
        geometry.dispose();
        return selection;
    };
    await world.placeMultiBlock({ size: [32, 48, 80], blocks });
    await individual.placeMultiBlock({ size: [32, 48, 80], blocks: [...blocks].reverse() });
    const selected = positions.map(sectionSelection);
    t.deepEqual(positions.map(individualSelection), selected);
    t.true(new Set(selected.map(selection => JSON.stringify(selection))).size > 1);
    const position = [...positions[0]] as TripleArray, expected = templateOf(world, position);
    const different = positions.find(value => templateOf(world, value) !== expected)!;
    const pending = world["sectionModels"]!.get(states.get("test:weighted")!, {}, position);
    position.splice(0, 3, ...different);
    t.is((await pending)![0], expected);
    for (const [x, , z] of positions) {
        await world.unloadChunkColumn(Math.floor(x / 16), Math.floor(z / 16));
        await individual.unloadChunkColumn(Math.floor(x / 16), Math.floor(z / 16));
    }
    await world.placeMultiBlock({ size: [32, 48, 80], blocks: [...blocks].reverse() });
    await individual.placeMultiBlock({ size: [32, 48, 80], blocks });
    t.deepEqual(positions.map(sectionSelection), selected);
    t.deepEqual(positions.map(individualSelection), selected);
    for (const [index, position] of positions.entries()) {
        const [x, y, z] = position.map(axis => Math.floor(axis / 16));
        const data = new ChunkData();
        data.set((position[1] - y * 16) * 256 + (position[2] - z * 16) * 16 + position[0] - x * 16,
            { type: "test:weighted" });
        const column = { x, z, sections: [{ y, data }] };
        await world.placeChunk(column);
        await individual.placeChunk(column);
        t.deepEqual(sectionSelection(position), selected[index]);
        t.deepEqual(individualSelection(position), selected[index]);
    }
});

test.serial("visibility changes preserve the originally selected weighted model", async t => {
    const { world, states, place, addModel } = fixture(t);
    addModel("alternative");
    states.set("test:weighted", { variants: { "": [{ model: "test:block/cube" }, { model: "test:block/alternative" }] } });
    const weighted = (await place([0, 0, 0], "weighted"))!;
    const selected = modelOf(weighted.object).originalModel;
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
        addModel("alternative");
        states.set("test:weighted", { variants: { "": [{ model: "test:block/cube" }, { model: "test:block/alternative" }] } });
        const value = { type: "test:weighted", properties: { axis: "x" }, nbt: { items: [1] } };
        const left = (await world.setBlockAt([-17, -1, -1], value))!;
        const right = (await place([-16, -1, -1]))!;
        const object = left.object, model = object?.["_models"][0];
        const template = sectionMeshing ? templateOf(world, [-17, -1, -1]) : undefined;
        const count = (x: number) => {
            if (!sectionMeshing) {
                const block = world.getBlockAt(x, -1, -1)?.object;
                return block?.visible ? indexCount(block) : 0;
            }
            const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === Math.floor(x / 16) * 256);
            return section?.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0) ?? 0;
        };
        t.deepEqual([count(-17), count(-16)], [30, 30]);
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
        if (sectionMeshing) t.is(templateOf(world, [-17, -1, -1]), template);
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
        const { world, scene } = fixture(t, { sectionMeshing });
        const left = (await world.setBlockAt([-17, -1, -1], { type: "water", properties: { level: "0" } }))!;
        const right = (await world.setBlockAt([-16, -1, -1], { type: "water", properties: { level: "4" } }))!;
        if (sectionMeshing) {
            t.deepEqual([left.object, right.object], [undefined, undefined]);
            t.is(assertFluidPositions(t, world, scene, [[-17, -1, -1]]).length, 60);
            t.is(assertFluidPositions(t, world, scene, [[-16, -1, -1]]).length, 60);
            await world.setBlockVisibleAt([-17, -1, -1], false);
            t.deepEqual(assertFluidPositions(t, world, scene, [[-17, -1, -1]]), []);
            t.is(assertFluidPositions(t, world, scene, [[-16, -1, -1]]).length, 72);
            t.is(world.getBlockAt(-17, -1, -1), left);
            await world.setBlockVisibleAt([-17, -1, -1], true);
            t.is(assertFluidPositions(t, world, scene, [[-17, -1, -1]]).length, 60);
            t.is(assertFluidPositions(t, world, scene, [[-16, -1, -1]]).length, 60);
            t.deepEqual(left.block, { type: "minecraft:water", properties: { level: "0" } });
            return;
        }
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

test.serial("column batches match sequential meshes across signed fluid, lighting, AO, and biome boundaries", async t => {
    const { world, scene, colorAt } = biomeBlendFixture(t, 1, { savedLighting: true, ambientOcclusion: true });
    const left = new ChunkData(), right = new ChunkData(), north = new ChunkData(), diagonal = new ChunkData();
    left.set(15 + 12 * 16, { type: "test:cube" });
    left.set(15 + 8 * 16, { type: "oak_leaves" });
    left.set(255, { type: "water", properties: { level: "4" } });
    right.set(12 * 16, { type: "test:cube" });
    right.set(12 * 16 + 256, { type: "test:cube" });
    right.set(13 * 16 + 256, { type: "test:cube" });
    right.set(15 * 16, { type: "water" });
    north.set(15, { type: "water", properties: { level: "4" } });
    diagonal.set(0, { type: "water" });
    const columns = [
        { x: -1, z: -1, data: left, biome: "test:red", light: 0xaa },
        { x: 0, z: -1, data: right, biome: "test:blue", light: 0x44 },
        { x: -1, z: 0, data: north, biome: "test:red", light: 0x77 },
        { x: 0, z: 0, data: diagonal, biome: "test:blue", light: 0xee }
    ].map(({ x, z, data, biome, light }) => ({ x, z, lightValid: true, sections: [
        { y: 0, data, biomes: Array(64).fill(biome), light: { sky: new Uint8Array(2048).fill(light) } }
    ] }));
    const meshState = () => scene.children.filter(child => child instanceof SectionMesh).flatMap(section =>
        section.children.flatMap(child => {
            const geometry = (child as Mesh).geometry;
            const attributes = ["position", "normal", "color", "shade"].map(name => geometry.getAttribute(name));
            return Array.from({ length: geometry.getAttribute("position").count / 4 }, (_, quad) =>
                JSON.stringify([section.position.toArray(), ...attributes.map(attribute =>
                    Array.from(attribute.array.slice(quad * 4 * attribute.itemSize, (quad + 1) * 4 * attribute.itemSize)))]));
        })).sort();
    let isolatedColor: number | undefined;
    for (const [index, column] of columns.entries()) {
        await world.placeChunk(column);
        if (index === 0) isolatedColor = colorAt([-1, 0, -8]);
    }
    const expected = meshState(), corners = topCornerColors(world, [-1, 0, -4]);
    const fluidPositions: TripleArray[] = [[-1, 0, -1], [0, 0, -1], [-1, 0, 0], [0, 0, 0]];
    const fluids = fluidPositions.map(position => assertFluidPositions(t, world, scene, [position]));
    const color = colorAt([-1, 0, -8]);
    t.not(color, isolatedColor);
    t.true(new Set(corners).size > 1);
    t.is(cullMaskAt(world, [-1, 0, -4]), 1);
    await world.clear();
    const build = SectionMesh.buildAsync;
    let builds = 0;
    SectionMesh.buildAsync = async function (...args) { builds++; return build.apply(this, args); };
    t.teardown(() => { SectionMesh.buildAsync = build; });
    await world.placeChunks(columns);
    t.is(builds, 4);
    t.deepEqual(meshState(), expected);
    t.deepEqual(topCornerColors(world, [-1, 0, -4]), corners);
    t.is(colorAt([-1, 0, -8]), color);
    t.is(cullMaskAt(world, [-1, 0, -4]), 1);
    for (const [index, position] of fluidPositions.entries()) {
        t.deepEqual(assertFluidPositions(t, world, scene, [position]), fluids[index]);
    }
    t.deepEqual(world.getLightAt(-1, 0, -4), { block: 0, sky: 10 });
    t.is(world.getBiomeAt(-1, 0, -8), "test:red");
    t.is(world.getBiomeAt(0, 0, -8), "test:blue");
});

for (const failure of [new Error("column asset failed"), undefined]) {
    test.serial(`column batches flush partial writes before rejecting and leave later columns untouched (${String(failure)})`, async t => {
        const { world, scene, place } = fixture(t, { sectionMeshing: true });
        const survivor = await place([15, 0, 0]), untouched = await place([48, 0, 0]);
        const first = new ChunkData(), broken = new ChunkData(), later = new ChunkData();
        first.set(0, { type: "test:cube" });
        broken.set(0, { type: "test:failure" });
        broken.set(1, { type: "test:cube" });
        later.set(1, { type: "test:cube" });
        const get = BlockStates.get, build = SectionMesh.buildAsync;
        BlockStates.get = async key => { if (key.path === "failure") throw failure; return get(key); };
        if (failure === undefined) SectionMesh.buildAsync = async () => { throw new Error("later section flush failed"); };
        t.teardown(() => { BlockStates.get = get; SectionMesh.buildAsync = build; });
        let rejected = false, caught: unknown;
        try {
            await world.placeChunks([
                { x: 1, z: 0, sections: [{ y: 0, data: first }] },
                { x: 2, z: 0, sections: [{ y: 0, data: broken }] },
                { x: 3, z: 0, sections: [{ y: 0, data: later }] }
            ]);
        } catch (error) { rejected = true; caught = error; }
        t.true(rejected);
        t.is(caught, failure);
        SectionMesh.buildAsync = build;
        if (failure === undefined) await world.unloadChunkColumns([{ x: 99, z: 99 }]);
        t.is(world.getBlockAt(15, 0, 0), survivor);
        t.is(world.getBlockAt(48, 0, 0), untouched);
        t.is(world.getBlockAt(49, 0, 0), undefined);
        t.is(world.getBlockAt(32, 0, 0), undefined);
        t.is(world.getBlockAt(33, 0, 0)!.block.type, "test:cube");
        t.is(renderedIndexCountAt(world, [15, 0, 0]), 30);
        t.is(renderedIndexCountAt(world, [16, 0, 0]), 30);
        t.is(renderedIndexCountAt(world, [33, 0, 0]), 36);
        t.is(broken.get(0)!.type, "test:failure");
        await world.unloadChunkColumns([{ x: 1, z: 0 }, { x: 2, z: 0 }]);
        t.is(world.getBlockAt(16, 0, 0), undefined);
        t.is(world.getBlockAt(33, 0, 0), undefined);
        t.is(renderedIndexCountAt(world, [15, 0, 0]), 36);
        t.is(scene.children.filter(child => child instanceof SectionMesh).length, 2);
    });
}

test.serial("parsed columns match single edits for section geometry and per-block cull masks", async t => {
    const { world, scene, states, place } = fixture(t, { sectionMeshing: true });
    states.set("test:entity", { key: AssetKey.parse("blockstates", "test:entity"),
        variants: { "": { model: "test:block/cube" } } });
    BlockEntities.getIndex = async () => ({ "test:entity": { parts: [] } });
    const blocks = [
        { position: [14, 15, 0] as TripleArray, type: "test:entity" },
        { position: [15, 15, 0] as TripleArray, type: "test:cube" },
        { position: [15, 16, 0] as TripleArray, type: "test:cube" }
    ];
    const counts = () => scene.children.filter(child => child instanceof SectionMesh)
        .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y)
        .map(section => section.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0));
    await place([16, 15, 0]);
    for (const { position, type } of blocks) await world.setBlockAt(position, { type });
    const expected = counts(), mask = world.getBlockAt(14, 15, 0)!.object!["_cullMask"];
    t.is(mask, 1);
    await world.clear();
    await place([16, 15, 0]);
    const lower = new ChunkData(), upper = new ChunkData();
    for (const { position: [x, y, z], type } of blocks) {
        (y < 16 ? lower : upper).set((y % 16) * 256 + z * 16 + x, { type });
    }
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data: lower }, { y: 1, data: upper }] });
    t.deepEqual(counts(), expected);
    t.is(world.getBlockAt(14, 15, 0)!.object!["_cullMask"], mask);
});

for (const sectionMeshing of [false, true]) test.serial(`parsed columns refresh adjacent faces and diagonal water heights on load and unload (sectionMeshing=${sectionMeshing})`, async t => {
    const { world, scene, place } = fixture(t, { sectionMeshing });
    const water = (await world.setBlockAt([15, 0, 15], { type: "water", properties: { level: "4" } }))!;
    await world.setBlockAt([15, 0, 16], { type: "water", properties: { level: "4" } });
    const cube = (await place([20, 0, 15]))!;
    const positions = () => sectionMeshing ? assertFluidPositions(t, world, scene, [[15, 0, 15]])
        : Array.from(geometryOf(water.object!).getAttribute("position").array);
    const count = () => {
        if (cube.object) return indexCount(cube.object);
        const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === 256 && child.position.z === 0)!;
        return section.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0);
    };
    const isolated = positions();
    t.is(count(), 36);
    const data = new ChunkData();
    data.set(0, { type: "water" });
    data.set(4, { type: "test:cube" });
    await world.placeChunk({ x: 1, z: 1, sections: [{ y: 0, data }] });
    const joined = positions();
    t.true(joined.some((value, index) => index % 3 === 1 && value > isolated[index]));
    t.is(count(), 30);
    await world.unloadChunkColumn(1, 1);
    t.deepEqual(positions(), isolated);
    t.is(count(), 36);
    t.is(world.getBlockAt(15, 0, 15), water);
    t.is(world.getBlockAt(20, 0, 15), cube);
});

test.serial("section marking preserves pending single-edit indices in neighboring and distant sections", async t => {
    const { world, place } = fixture(t, { sectionMeshing: true });
    for (const position of [[0, 0, 0], [20, 4, 4], [40, 4, 4]] as TripleArray[]) await place(position);
    const changed = world.getChunkAt(new Vector3())!;
    const neighbor = world.getChunkAt(new Vector3(20, 4, 4))!, distant = world.getChunkAt(new Vector3(40, 4, 4))!;
    const neighborIndices = new Set([4 * 256 + 4 * 16 + 4]), distantIndices = new Set([4 * 256 + 4 * 16 + 8]);
    world["pendingCulling"].set(neighbor, neighborIndices);
    world["pendingCulling"].set(distant, distantIndices);
    world["markSectionChanged"](changed);
    t.is(world["pendingCulling"].get(changed), "all");
    t.is(world["pendingCulling"].get(neighbor), neighborIndices);
    t.true(neighborIndices.has(4 * 256 + 4 * 16 + 4));
    t.is(neighborIndices.size, 257);
    t.is(world["pendingCulling"].get(distant), distantIndices);
    t.deepEqual([...distantIndices], [4 * 256 + 4 * 16 + 8]);
    await world["updateCulling"]([]);
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
        const water = new ChunkData(), above = new ChunkData();
        water.set(15 * 256 + 15 * 16, { type: "water" });
        above.set(15 * 16, { type: "water" });
        const column = { x: -1, z: -1, sections: [{ y: -1, data: water }, { y: 0, data: above }] };
        if (sectionMeshing) {
            const isolated = assertFluidPositions(t, world, scene, [[-17, -1, -1]]);
            t.is(isolated.length, 72);
            await world.placeChunk(column);
            const joined = assertFluidPositions(t, world, scene, [[-17, -1, -1]]);
            t.is(joined.length, 60);
            t.true(joined[7] > isolated[7]);
            assertFluidPositions(t, world, scene, [[-16, -1, -1]]);
            assertFluidPositions(t, world, scene, [[-16, 0, -1]]);
            await world.unloadChunkColumn(-1, -1);
            t.is(world.getBlockAt(-17, -1, -1), left);
            t.is(left.object, undefined);
            t.deepEqual(assertFluidPositions(t, world, scene, [[-17, -1, -1]]), isolated);
            await world.placeChunk(column);
            t.deepEqual(assertFluidPositions(t, world, scene, [[-17, -1, -1]]), joined);
            t.is(scene.stats.instanceCount, 0);
            return;
        }
        const object = left.object!, baseline = modelOf(object);
        const height = () => geometryOf(object).getAttribute("position").getY(2);
        const isolatedHeight = height();
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
        t.is(scene.stats.instanceCount, 2);
        t.throws(() => reference.getPosition(), { message: "Instance has been removed" });
        await world.placeChunk(column);
        t.is(indexCount(object), 30);
        t.is(height(), joinedHeight);
        t.is(scene.stats.instanceCount, 6);
    });
}

test.serial("unloading a chunk column rejects noninteger coordinates", async t => {
    const { world } = fixture(t);
    for (const value of [0.5, NaN, Infinity]) {
        await t.throwsAsync(world.unloadChunkColumn(value, 0), { instanceOf: RangeError });
        await t.throwsAsync(world.unloadChunkColumn(0, value), { instanceOf: RangeError });
    }
});

test.serial("bulk unloading skips meshes in removed columns and rebuilds a surviving border once", async t => {
    const { world, scene, place } = fixture(t, { sectionMeshing: true });
    for (const x of [15, 16, 31, 32]) await place([x, 0, 0]);
    const survivor = world.getBlockAt(32, 0, 0);
    const removed = [15, 16].map(x => world.getChunkAt(new Vector3(x, 0, 0))!["sectionMesh"]!);
    t.is(renderedIndexCountAt(world, [32, 0, 0]), 30);
    const build = SectionMesh.buildAsync;
    let builds = 0;
    SectionMesh.buildAsync = async function (...args) { builds++; return build.apply(this, args); };
    t.teardown(() => { SectionMesh.buildAsync = build; });
    await world.unloadChunkColumns([{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 0 }]);
    t.is(builds, 1);
    t.is(renderedIndexCountAt(world, [32, 0, 0]), 36);
    t.is(world.getBlockAt(32, 0, 0), survivor);
    t.true(removed.every(section => section.parent === null && section.children.length === 0));
    t.is(scene.children.filter(child => child instanceof SectionMesh).length, 1);
    await world.unloadChunkColumns([{ x: 2, z: 0 }]);
    t.is(builds, 1);
    t.is(scene.children.filter(child => child instanceof SectionMesh).length, 0);
});

test.serial("bulk unloading retries a failed surviving neighbor rebuild on the next unload", async t => {
    const { world, place } = fixture(t, { sectionMeshing: true });
    for (const x of [15, 16, 31, 32]) await place([x, 0, 0]);
    const survivor = world.getChunkAt(new Vector3(32, 0, 0))!;
    const geometry = () => survivor["sectionMesh"]!.children.map(child => {
        const geometry = (child as Mesh).geometry;
        return {
            indices: Array.from(geometry.index!.array),
            positions: Array.from(geometry.getAttribute("position").array),
            normals: Array.from(geometry.getAttribute("normal").array),
            colors: Array.from(geometry.getAttribute("color").array)
        };
    });
    const columns = [{ x: 0, z: 0 }, { x: 1, z: 0 }];
    await world.unloadChunkColumns(columns);
    const expected = geometry();
    for (const x of [15, 16, 31]) await place([x, 0, 0]);
    const previous = geometry();
    t.notDeepEqual(previous, expected);
    const build = SectionMesh.buildAsync, failure = new Error("neighbor rebuild failed");
    let builds = 0;
    SectionMesh.buildAsync = async function (...args) {
        if (++builds === 1) throw failure;
        return build.apply(this, args);
    };
    t.teardown(() => { SectionMesh.buildAsync = build; });
    await t.throwsAsync(world.unloadChunkColumns(columns), { is: failure });
    t.is(builds, 1);
    t.deepEqual(geometry(), previous);
    t.is(world.getBlockAt(15, 0, 0), undefined);
    t.is(world.getBlockAt(16, 0, 0), undefined);
    await world.unloadChunkColumns(columns);
    t.is(builds, 2);
    t.deepEqual(geometry(), expected);
});

test.serial("bulk unloading restores surviving fluid surfaces, saved lighting, and ambient occlusion in one rebuild", async t => {
    const { world, scene } = fixture(t, { sectionMeshing: true, savedLighting: true, ambientOcclusion: true });
    const data = new ChunkData();
    data.set(15 + 12 * 16, { type: "test:cube" });
    data.set(15 + 15 * 16, { type: "water", properties: { level: "4" } });
    await world.placeChunk({ x: 0, z: 0, lightValid: true, sections: [
        { y: 0, data, light: { sky: new Uint8Array(2048).fill(0xaa) } }
    ] });
    const survivor = world.getBlockAt(15, 0, 15);
    const fluidPositions = () => assertFluidPositions(t, world, scene, [[15, 0, 15]]);
    const colors = () => world.getChunkAt(new Vector3(15, 0, 12))!["sectionMesh"]!.children.map(child =>
        Array.from((child as Mesh).geometry.getAttribute("color").array));
    const isolatedFluid = fluidPositions(), isolatedColors = colors(), isolatedCorners = topCornerColors(world, [15, 0, 12]);
    const east = new ChunkData(), diagonal = new ChunkData();
    east.set(12 * 16 + 256, { type: "test:cube" });
    east.set(13 * 16 + 256, { type: "test:cube" });
    east.set(15 * 16, { type: "water" });
    diagonal.set(0, { type: "water" });
    for (const [z, neighbor] of [[0, east], [1, diagonal]] as const) {
        await world.placeChunk({ x: 1, z, lightValid: true, sections: [
            { y: 0, data: neighbor, light: { sky: new Uint8Array(2048).fill(0x44) } }
        ] });
    }
    t.notDeepEqual(fluidPositions(), isolatedFluid);
    t.notDeepEqual(topCornerColors(world, [15, 0, 12]), isolatedCorners);
    const build = SectionMesh.buildAsync;
    let builds = 0;
    SectionMesh.buildAsync = async function (...args) { builds++; return build.apply(this, args); };
    t.teardown(() => { SectionMesh.buildAsync = build; });
    await world.unloadChunkColumns([{ x: 1, z: 0 }, { x: 1, z: 1 }]);
    t.is(builds, 1);
    t.deepEqual(fluidPositions(), isolatedFluid);
    t.deepEqual(colors(), isolatedColors);
    t.deepEqual(topCornerColors(world, [15, 0, 12]), isolatedCorners);
    t.deepEqual(world.getLightAt(15, 0, 12), { block: 0, sky: 10 });
    t.is(world.getLightAt(16, 0, 12), undefined);
    t.is(world.getLightAt(16, 0, 16), undefined);
    t.is(world.getBlockAt(15, 0, 15), survivor);
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

for (const translucent of [false, true]) {
    test.serial(`parallel chunk placement keeps delayed non-occluding section meshes visible (translucent=${translucent})`, async t => {
        const { world, scene, addModel } = fixture(t, { sectionMeshing: true });
        addModel("delayed", { transparent: true, translucent });
        addModel("glass", { translucent: true });
        let release!: () => void, started!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const loading = new Promise<void>(resolve => { started = resolve; });
        const get = Models.getMerged;
        Models.getMerged = async (key, options) => {
            if (key.path === "delayed") { started(); await gate; }
            return get(key, options);
        };
        t.teardown(() => { release(); });
        const left = new ChunkData(), right = new ChunkData();
        left.set(15, { type: "test:delayed" });
        right.set(0, { type: "test:glass" });
        const pending = world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data: left }] });
        await loading;
        await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data: right }] });
        release();
        await pending;
        const count = (x: number) => {
            const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === x);
            return section?.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0) ?? 0;
        };
        t.deepEqual([count(0), count(256)], [36, 36]);
        t.is(world.getBlockAt(15, 0, 0)?.block.type, "test:delayed");
        t.is(world.getBlockAt(16, 0, 0)?.block.type, "test:glass");
    });
}

test.serial("section meshes restore border faces without changing block snapshots or weighted selections", async t => {
    const { world, scene, states, place, addModel } = fixture(t, { sectionMeshing: true });
    addModel("alternative");
    states.set("test:weighted", { variants: { "": [{ model: "test:block/cube" }, { model: "test:block/alternative" }] } });
    const value = { type: "test:weighted", properties: { axis: "x" }, nbt: { items: [1] } };
    const left = (await world.setBlockAt([-17, -1, -1], value))!;
    const template = templateOf(world, [-17, -1, -1]);
    t.is(left.object, undefined);
    left.block.properties!.axis = "z";
    left.block.nbt.items[0] = 9;
    t.deepEqual(left.block, value);
    const count = (x: number) => {
        const group = scene.children.find(child => child instanceof SectionMesh && child.position.x === x) as SectionMesh | undefined;
        return group?.children.reduce((sum, child) => sum + (child as Mesh).geometry.getIndex()!.count, 0) ?? 0;
    };
    const right = (await place([-16, -1, -1]))!;
    t.is(right.object, undefined);
    t.deepEqual([count(-512), count(-256)], [30, 30]);
    t.is(scene.stats.instanceCount, 0);
    await world.getChunkAt(new Vector3(-16, -1, -1))!.clear();
    t.deepEqual([count(-512), count(-256)], [36, 0]);
    t.is(templateOf(world, [-17, -1, -1]), template);
    t.is(world.getBlockAt(-17, -1, -1), left);
    await world.clear();
    t.is(scene.children.length, 0);
});

test.serial("section meshing merges partial, transparent, animated and multipart blocks", async t => {
    const { world, scene, states, place, addModel } = fixture(t, { sectionMeshing: true });
    addModel("partial", { height: 8 });
    addModel("transparent", { transparent: true });
    addModel("animated", { animated: true });
    states.set("test:multipart", { multipart: [
        { apply: { model: "test:block/cube" } }, { apply: { model: "test:block/cube", x: 90 } }
    ] });
    for (const [index, type] of ["partial", "transparent", "animated", "multipart"].entries()) {
        const info = (await place([index * 2, 0, 0], type))!;
        t.is(info.object, undefined);
    }
    t.is((await place([8, 0, 0]))!.object, undefined);
    t.is(scene.stats.instanceCount, 0);
    t.is(scene.children.filter(child => child instanceof SectionMesh).length, 1);
    t.is((await place([4, 0, 0]))!.object, undefined);
    t.is(scene.stats.instanceCount, 0);
    t.is(world.getBlockAt(2, 0, 0)!.object, undefined);
});

for (const kelp of [false, true]) test.serial(`section meshes merge model and water quads for ${kelp ? "animated kelp" : "waterlogged blocks"}`, async t => {
    const { world, scene, states, addModel } = fixture(t, { sectionMeshing: true });
    const name = kelp ? "kelp" : "waterlogged", type = kelp ? "minecraft:kelp" : "test:waterlogged";
    addModel(name, { height: 8, animated: kelp, transparent: kelp });
    states.set(type, { key: AssetKey.parse("blockstates", type), variants: { "": { model: `test:block/${name}` } } });
    const info = (await world.setBlockAt([2, 3, 4], { type, properties: kelp ? undefined : { waterlogged: "true" } }))!;
    t.is(info.object, undefined);
    t.is(scene.stats.instanceCount, 0);
    const section = scene.children.find(child => child instanceof SectionMesh)!;
    t.deepEqual(section.children.map(child => (child as Mesh).geometry.getIndex()!.count), [36, 36]);
    assertFluidPositions(t, world, scene, [[2, 3, 4]]);
});

test.serial("waterlogged block entities keep their own fluid outside section meshes", async t => {
    const { world, scene, states, addModel, place } = fixture(t, { sectionMeshing: true });
    addModel("entity", { height: 8 });
    states.set("test:entity", { key: AssetKey.parse("blockstates", "test:entity"), variants: { "": { model: "test:block/entity" } } });
    const getEntity = Entities.getEntity, applyTextures = EntityObject.prototype["applyTextures"];
    BlockEntities.getIndex = async () => ({ "test:entity": { parts: [{ model: "test:entity" }] } });
    Entities.getEntity = async key => ({ id: key.toNamespacedString(), key, layer: { texture: [16, 16], root: {
        pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {}
    } } });
    EntityObject.prototype["applyTextures"] = async () => undefined;
    t.teardown(() => { Entities.getEntity = getEntity; EntityObject.prototype["applyTextures"] = applyTextures; });
    const entity = (await world.setBlockAt([0, 0, 0], { type: "test:entity", properties: { waterlogged: "true" } }))!;
    await place([2, 0, 0]);
    t.true(entity.object!.isBlockObject);
    t.is(entity.object!.blockEntities.length, 1);
    t.is(entity.object!.fluidKind, "water");
    t.is(indexCount(entity.object!, 1), 36);
    const section = scene.children.find(child => child instanceof SectionMesh)!;
    t.deepEqual(section.children.map(child => (child as Mesh).geometry.getIndex()!.count), [36]);
    t.is((section.children[0] as Mesh).geometry.boundingBox!.min.x, 24);
    await world.setBlockAt([1, 0, 0], { type: "water", properties: { level: "4" } });
    const joined = assertFluidPositions(t, world, scene, [[1, 0, 0]]);
    t.is(indexCount(entity.object!, 1), 30);
    await world.setBlockVisibleAt([0, 0, 0], false);
    t.notDeepEqual(assertFluidPositions(t, world, scene, [[1, 0, 0]]), joined);
    await world.setBlockVisibleAt([0, 0, 0], true);
    t.deepEqual(assertFluidPositions(t, world, scene, [[1, 0, 0]]), joined);
});

test.serial("changing water levels across a chunk border rebuilds both section surfaces", async t => {
    const { world, scene } = fixture(t, { sectionMeshing: true });
    await world.setBlockAt([15, 0, 0], { type: "water", properties: { level: "0" } });
    await world.setBlockAt([16, 0, 0], { type: "water", properties: { level: "4" } });
    const left = assertFluidPositions(t, world, scene, [[15, 0, 0]]);
    const right = assertFluidPositions(t, world, scene, [[16, 0, 0]]);
    const sections = scene.children.filter(child => child instanceof SectionMesh);
    await world.setBlockAt([16, 0, 0], { type: "water", properties: { level: "7" } });
    t.notDeepEqual(assertFluidPositions(t, world, scene, [[15, 0, 0]]), left);
    t.notDeepEqual(assertFluidPositions(t, world, scene, [[16, 0, 0]]), right);
    t.true(sections.every(section => section.parent === null));
    t.is(scene.stats.instanceCount, 0);
});

test.serial("a merged half-height block does not hide its full-cube neighbor's shared face", async t => {
    const { scene, place, addModel } = fixture(t, { sectionMeshing: true });
    addModel("partial", { height: 8 });
    t.is((await place([15, 0, 0], "partial"))!.object, undefined);
    t.is((await place([16, 0, 0]))!.object, undefined);
    const sections = scene.children.filter(child => child instanceof SectionMesh).sort((a, b) => a.position.x - b.position.x);
    t.deepEqual(sections.map(section => section.children.reduce((sum, child) =>
        sum + (child as Mesh).geometry.getIndex()!.count, 0)), [30, 36]);
});

test.serial("multipart section blocks keep every part at one cell and cull each part's quads", async t => {
    const { world, scene, states, place, addModel } = fixture(t, { sectionMeshing: true });
    addModel("partial", { height: 8 });
    states.set("test:multipart", { multipart: [
        { apply: { model: "test:block/cube" } }, { apply: { model: "test:block/partial" } }
    ] });
    t.is((await place([0, 0, 0], "multipart"))!.object, undefined);
    const entries = world.getChunkAt(new Vector3())!["sectionBlocks"].get(0)!;
    t.deepEqual(entries.map(entry => entry.index), [0, 0]);
    t.deepEqual(entries.map(entry => entry.template.atlas.model.key!.path), ["cube", "partial"]);
    const section = scene.children.find(child => child instanceof SectionMesh)!;
    const geometry = (section.children[0] as Mesh).geometry;
    t.is(geometry.getIndex()!.count, 72);
    const positions = geometry.getAttribute("position");
    t.true(Array.from({ length: positions.count }, (_, i) => positions.getY(i)).includes(0));
    t.deepEqual(geometry.boundingBox!.max.toArray(), [8, 8, 8]);
    await place([1, 0, 0]);
    t.deepEqual(entries.map(entry => entry.cullMask), [1, 1]);
    const rebuilt = scene.children.find(child => child instanceof SectionMesh)!;
    t.is((rebuilt.children[0] as Mesh).geometry.getIndex()!.count, 90);
});

test.serial("section models omit absent faces from every element", async t => {
    const { scene, place, addModel } = fixture(t, { sectionMeshing: true });
    const model = addModel("open", { height: 8 });
    const lower = model.elements![0];
    delete lower.faces.east;
    model.elements!.push({ ...lower, from: [0, 8, 0], to: [16, 16, 16] });
    t.is((await place([0, 0, 0], "open"))!.object, undefined);
    const section = scene.children.find(child => child instanceof SectionMesh)!;
    const geometry = (section.children[0] as Mesh).geometry;
    t.is(geometry.getIndex()!.count, 60);
    t.is(geometry.getAttribute("position").count, 40);
    t.false(Array.from(geometry.getIndex()!.array).some(vertex => geometry.getAttribute("normal").getX(vertex) === 1));
    t.deepEqual(geometry.boundingBox!.min.toArray(), [-8, -8, -8]);
    t.deepEqual(geometry.boundingBox!.max.toArray(), [8, 8, 8]);
});

for (const transform of ["rotated cullface", "uvlock", "element rotation"]) {
    test.serial(`section templates preserve ${transform} from individual block geometry`, async t => {
        const { world, scene, states, addModel, place } = fixture(t, { sectionMeshing: true });
        const individual = new MineRenderWorld(scene);
        t.teardown(() => individual.clear());
        const model = addModel("transformed", { height: 8,
            cullable: transform === "rotated cullface" ? [CubeFace.UP] : undefined });
        if (transform === "element rotation") {
            model.elements![0].rotation = { origin: [4, 6, 10], axis: "z", angle: 22.5 };
        }
        states.set("test:transformed", { variants: { "": {
            model: "test:block/transformed", x: transform === "rotated cullface" ? 180 : 90,
            y: transform === "rotated cullface" ? 0 : 90, uvlock: transform === "uvlock"
        } } });
        await place([0, 0, 0], "transformed");
        const block = (await individual.setBlockAt([0, 0, 0], { type: "test:transformed" }))!.object;
        const entry = world.getChunkAt(new Vector3())!["sectionBlocks"].get(0)![0];
        const template = entry.template;
        const expected = geometryOf(block).clone();
        t.teardown(() => expected.dispose());
        expected.applyMatrix4(block["getModelMatrix"](block["_models"][0]).setPosition(0, 0, 0));
        const values = (geometry: typeof expected, attribute: string) =>
            Array.from(geometry.getAttribute(attribute).array, value => Math.abs(value) < 1e-6 ? 0 : +value.toFixed(5));
        for (const attribute of ["position", "normal", "uv", "uvBounds"]) {
            t.deepEqual(values(template.geometry, attribute), values(expected, attribute), attribute);
        }
        t.false(template.occludes);
        if (transform === "uvlock") {
            t.notDeepEqual(Array.from(template.geometry.getAttribute("uv").array), model.elements![0].mappedUv);
        }
        const section = SectionMesh.build([{ index: 0, template, cullMask: 0 }]);
        t.teardown(() => section.dispose());
        const geometry = (section.children[0] as Mesh).geometry;
        t.deepEqual(values(geometry, "position"), values(expected, "position"));
        t.deepEqual(values(geometry, "uv"), values(expected, "uv"));
        if (transform === "rotated cullface") {
            t.deepEqual(Array.from(template.cullFaces), [0, 0, 8, 0, 0, 0]);
            for (const y of [1, -1]) {
                await place([0, y, 0]);
                await individual.setBlockAt([0, y, 0], { type: "test:cube" });
                const culled = SectionMesh.build([entry]);
                t.teardown(() => culled.dispose());
                const geometry = (culled.children[0] as Mesh).geometry;
                t.is(entry.cullMask, y === 1 ? 4 : 12);
                t.is(geometry.getIndex()!.count, y === 1 ? 36 : 30);
                t.is(geometry.getIndex()!.count, indexCount(block));
                if (y === -1) {
                    t.true(Array.from(geometry.getIndex()!.array).every(vertex =>
                        geometry.getAttribute("normal").getY(vertex) > -0.999));
                }
            }
        }
    });
}

test.serial("section meshing puts translucent blocks in a separate transparent mesh", async t => {
    const { scene, place, addModel } = fixture(t, { sectionMeshing: true });
    Materials.createShadedCanvasMaterial = (_canvas, transparent) => new MeshBasicMaterial({ transparent });
    addModel("translucent", { translucent: true });
    t.is((await place([0, 0, 0], "translucent"))!.object, undefined);
    await place([2, 0, 0]);
    const section = scene.children.find(child => child instanceof SectionMesh)!;
    const meshes = section.children as Mesh[];
    t.deepEqual(meshes.map(mesh => (mesh.material as MeshBasicMaterial).transparent), [false, true]);
    t.deepEqual(meshes.map(mesh => mesh.geometry.getIndex()!.count), [36, 36]);
});

for (const sectionMeshing of [false, true]) {
    test.serial(`fluid surfaces refresh across section borders, diagonals and heights (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, place } = fixture(t, { sectionMeshing });
        const water = async (position: TripleArray, level = "0") => (await world.setBlockAt(position, { type: "water", properties: { level } }))!.object!;
        const left = await water([-17, -1, -1]), right = await water([-16, -1, -1], "4");
        const matching = await water([15, -1, 10]);
        await water([16, -1, 10], "4");
        if (sectionMeshing) {
            t.deepEqual([left, right, matching], [undefined, undefined, undefined]);
            const baseline = assertFluidPositions(t, world, scene, [[-17, -1, -1]]);
            const matchingPositions = assertFluidPositions(t, world, scene, [[15, -1, 10]]);
            t.is(baseline.length, 60);
            assertFluidPositions(t, world, scene, [[-16, -1, -1]]);
            await water([-16, -1, 0]);
            const diagonal = assertFluidPositions(t, world, scene, [[-17, -1, -1]]);
            t.true(diagonal[7] > baseline[7]);
            assertFluidPositions(t, world, scene, [[-16, -1, -1]]);
            t.deepEqual(assertFluidPositions(t, world, scene, [[15, -1, 10]]), matchingPositions);
            await water([-16, 0, 0]);
            t.true(assertFluidPositions(t, world, scene, [[-17, -1, -1]])[7] > diagonal[7]);
            await world.setBlockAt(-16, 0, 0, undefined);
            t.deepEqual(assertFluidPositions(t, world, scene, [[-17, -1, -1]]), diagonal);
            await world.setBlockAt(-16, -1, 0, undefined);
            t.deepEqual(assertFluidPositions(t, world, scene, [[-17, -1, -1]]), baseline);
            await place([-17, -1, -2]);
            t.is(assertFluidPositions(t, world, scene, [[-17, -1, -1]]).length, 48);
            await world.setBlockAt(-17, -1, -2, undefined);
            t.deepEqual(assertFluidPositions(t, world, scene, [[-17, -1, -1]]), baseline);
            await world.setBlockAt(-16, -1, -1, undefined);
            t.is(assertFluidPositions(t, world, scene, [[-17, -1, -1]]).length, 72);
            t.is(scene.stats.instanceCount, 0);
            return;
        }
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
        t.is(scene.stats.instanceCount, 8);
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
        if (sectionMeshing) {
            t.is(logged, undefined);
            assertFluidPositions(t, world, scene, [[-17, 0, 0]]);
            const water = (await world.setBlockAt([-16, 0, 0], { type: "water" }))!;
            t.is(water.object, undefined);
            t.is(assertFluidPositions(t, world, scene, [[-17, 0, 0]]).length, 60);
            assertFluidPositions(t, world, scene, [[-16, 0, 0]]);
            await place([-18, 0, 0]);
            t.is(assertFluidPositions(t, world, scene, [[-17, 0, 0]]).length, 48);
            await world.setBlockAt(-18, 0, 0, undefined);
            t.is(assertFluidPositions(t, world, scene, [[-17, 0, 0]]).length, 60);
            const dry = (await world.setBlockAt([-17, 0, 0], { ...value, properties: { waterlogged: "false" } }))!;
            t.is(dry.object, undefined);
            const section = scene.children.find(child => child instanceof SectionMesh && child.position.x === -512)!;
            t.deepEqual(section.children.map(child => (child as Mesh).geometry.getIndex()!.count), [36]);
            await world.setBlockAt(-17, 0, 0, undefined);
            t.is(assertFluidPositions(t, world, scene, [[-16, 0, 0]]).length, 72);
            t.is(scene.stats.instanceCount, 0);
            return;
        }
        t.truthy(logged);
        t.is(logged["_models"].length, 3);
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
        t.is(scene.stats.instanceCount, sectionMeshing ? 1 : 3);
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
    let positions: TripleArray[] = [];
    for (const [index, [type, properties]] of cases.entries()) {
        states.set(`minecraft:${type}`, { key: AssetKey.parse("blockstates", type), variants: { "": { model: "test:block/plant" } } });
        const x = index * 4;
        const block = (await world.setBlockAt([x, 0, 0], { type, properties: { level: "7", ...properties } }))!;
        t.is(block.object, undefined);
        const chunk = world.getChunkAt(new Vector3(x, 0, 0))!;
        t.is(chunk.fluidByteIndex(x % 16), 16);
        const entries = chunk["sectionBlocks"].get(x % 16) ?? [];
        t.is(entries.length, type === "bubble_column" ? 0 : 1);
        if (entries.length) t.is(entries[0].template.atlas.model, plant);
        const water = (await world.setBlockAt([x + 1, 0, 0], { type: "water" }))!;
        t.is(water.object, undefined);
        positions.push([x, 0, 0], [x + 1, 0, 0]);
        assertFluidPositions(t, world, scene, positions.filter(pos => Math.floor(pos[0] / 16) === Math.floor(x / 16)));
        await world.setBlockAt(x, 0, 0, undefined);
        positions = positions.filter(pos => pos[0] !== x);
        assertFluidPositions(t, world, scene, positions.filter(pos => Math.floor(pos[0] / 16) === Math.floor(x / 16)));
    }
    for (const [index, type] of ["test:kelp", "minecraft:water_cauldron"].entries()) {
        states.set(type, { key: AssetKey.parse("blockstates", type), variants: { "": { model: "test:block/plant" } } });
        const block = (await world.setBlockAt([40 + index * 4, 0, 0], { type }))!;
        t.is(block.object, undefined);
    }
    await world.clear();
    t.is(scene.stats.instanceCount, 0);
});

function biomeBlendFixture(t: ExecutionContext, radius = 0, options: MineRenderWorldOptions<true> = {}) {
    const setup = fixture(t, { sectionMeshing: true, biomeBlendRadius: radius, ...options });
    setup.addModel("blend_leaves", { tintindex: 0, transparent: true });
    setup.states.set("minecraft:oak_leaves", { key: AssetKey.parse("blockstates", "oak_leaves"),
        variants: { "": { model: "test:block/blend_leaves" } } });
    const originals = { get: Biomes.get, color: Biomes.getColor };
    Biomes.get = async id => id === "test:missing" ? undefined : { temperature: 0.8, downfall: 0.4, effects: {} };
    Biomes.getColor = async (id, kind) => id === "test:missing" ? undefined
        : kind === "water" ? id === "test:red" ? 0x00ff00 : 0x0000ff
            : id === "test:red" ? 0xff0000 : 0x0000ff;
    t.teardown(() => { Biomes.get = originals.get; Biomes.getColor = originals.color; });
    const colorAt = (position: TripleArray, part = 0) => {
        const chunk = setup.world.getChunkAt(new Vector3(...position))!;
        const local = chunk.worldPosToChunkPos(new Vector3(...position)).multiplyScalar(16);
        const matches: { height: number; color: number }[] = [];
        for (const mesh of chunk["sectionMesh"]!.children as Mesh[]) {
            const positions = mesh.geometry.getAttribute("position"), normals = mesh.geometry.getAttribute("normal"), colors = mesh.geometry.getAttribute("color");
            for (let index = 0; index < positions.count; index += 4) {
                if (normals.getY(index) <= 0) continue;
                const x = [0, 1, 2, 3].reduce((sum, offset) => sum + positions.getX(index + offset), 0) / 4;
                const z = [0, 1, 2, 3].reduce((sum, offset) => sum + positions.getZ(index + offset), 0) / 4;
                if (Math.abs(x - local.x) > 0.001 || Math.abs(z - local.z) > 0.001) continue;
                matches.push({ height: positions.getY(index), color: new Color().fromBufferAttribute(colors, index).getHex() });
            }
        }
        return matches.sort((a, b) => b.height - a.height)[part]?.color;
    };
    return { ...setup, colorAt };
}

test.serial("bulk unloading refreshes biome colors in each surviving section with one rebuild", async t => {
    const { world, colorAt } = biomeBlendFixture(t, 1);
    for (const z of [0, 1]) {
        const data = new ChunkData();
        data.set(15 + (z === 0 ? 15 : 0) * 16, { type: "oak_leaves" });
        await world.placeChunk({ x: 0, z, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
        const neighbor = new ChunkData();
        neighbor.set((z === 0 ? 15 : 0) * 16, { type: "test:cube" });
        await world.placeChunk({ x: 1, z, sections: [{ y: 0, data: neighbor, biomes: Array(64).fill("test:blue") }] });
    }
    t.is(colorAt([15, 0, 15]), 0xaa0055);
    t.is(colorAt([15, 0, 16]), 0xaa0055);
    const build = SectionMesh.buildAsync;
    const builds = new Map<number, number>();
    SectionMesh.buildAsync = async function (...args) {
        const key = args[0][0].index;
        builds.set(key, (builds.get(key) ?? 0) + 1);
        return build.apply(this, args);
    };
    t.teardown(() => { SectionMesh.buildAsync = build; });
    await world.unloadChunkColumns([{ x: 1, z: 0 }, { x: 1, z: 1 }]);
    t.deepEqual([...builds].sort((a, b) => a[0] - b[0]), [[15, 1], [255, 1]]);
    t.is(colorAt([15, 0, 15]), 0xff0000);
    t.is(colorAt([15, 0, 16]), 0xff0000);
    t.is(world.getBiomeAt(16, 0, 8), undefined);
    t.is(world.getBiomeAt(16, 0, 24), undefined);
});

test.serial("a biome setter joining bulk unloading waits for the resulting geometry", async t => {
    t.timeout(3000);
    const { world, colorAt } = biomeBlendFixture(t, 1);
    const data = new ChunkData();
    data.set(15 + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data: new ChunkData(), biomes: Array(64).fill("test:blue") }] });
    const color = Biomes.getColor, build = SectionMesh.buildAsync;
    let releaseColor!: () => void, colorStarted!: () => void, releaseBuild!: () => void, buildStarted!: () => void;
    const colorGate = new Promise<void>(resolve => { releaseColor = resolve; });
    const beganColor = new Promise<void>(resolve => { colorStarted = resolve; });
    const buildGate = new Promise<void>(resolve => { releaseBuild = resolve; });
    const beganBuild = new Promise<void>(resolve => { buildStarted = resolve; });
    Biomes.getColor = async (...args) => { colorStarted(); await colorGate; return color(...args); };
    SectionMesh.buildAsync = async function (...args) { buildStarted(); await buildGate; return build.apply(this, args); };
    t.teardown(() => {
        releaseColor(); releaseBuild();
        Biomes.getColor = color;
        SectionMesh.buildAsync = build;
    });
    const unloading = world.unloadChunkColumns([{ x: 1, z: 0 }]);
    await beganColor;
    let changed = false;
    const changing = world.setBiomeBlendRadius(1).then(() => { changed = true; });
    releaseColor();
    await beganBuild;
    await new Promise<void>(resolve => setImmediate(resolve));
    t.false(changed);
    t.is(colorAt([15, 0, 8]), 0xaa0055);
    releaseBuild();
    await Promise.all([unloading, changing]);
    t.true(changed);
    t.is(colorAt([15, 0, 8]), 0xff0000);
});

test.serial("biome blend radius validates before mutation and defaults to an idle unblended path", async t => {
    const { world, scene, place } = fixture(t);
    t.is(world.biomeBlendRadius, 0);
    t.is(world["biomeBlend"], undefined);
    await place([0, 0, 0]);
    const object = world.getBlockAt(0, 0, 0)!.object;
    for (const radius of [-1, 8, 0.5, NaN, Infinity, "2" as unknown as number]) {
        t.throws(() => new MineRenderWorld(scene, { biomeBlendRadius: radius }), { instanceOf: RangeError });
        await t.throwsAsync(world.setBiomeBlendRadius(radius), { instanceOf: RangeError });
        t.is(world.biomeBlendRadius, 0);
        t.is(world.getBlockAt(0, 0, 0)!.object, object);
    }
    t.throws(() => new MineRenderWorld(scene, { biomeBlendRadius: 1 }), {
        instanceOf: TypeError, message: "biomeBlendRadius requires sectionMeshing"
    });
    await t.throwsAsync(world.setBiomeBlendRadius(1), {
        instanceOf: TypeError, message: "biomeBlendRadius requires sectionMeshing"
    });
    await world.setBiomeBlendRadius(0);
    t.is(world.getBlockAt(0, 0, 0)!.object, object);
    t.is(world["biomeBlend"], undefined);
});

test.serial(`biome blending refreshes signed borders on air-only loads, replacement and unload`, async t => {
    const { world, colorAt } = biomeBlendFixture(t, 1);
    const data = new ChunkData();
    data.set(15 + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: -1, z: -1, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    const position: TripleArray = [-1, 0, -8];
    t.is(colorAt(position), 0xff0000);
    const neighbor = { x: 0, z: -1, sections: [{ y: 0, data: new ChunkData(), biomes: Array(64).fill("test:blue") }] };
    await world.placeChunk(neighbor);
    t.is(colorAt(position), 0xaa0055);
    t.is(world.getBiomeAt(position), "test:red");
    t.is(world.getChunkAt(new Vector3(0, 0, -8)), undefined);
    await world.placeChunk({ ...neighbor, sections: [{ ...neighbor.sections[0], biomes: Array(64).fill("test:red") }] });
    t.is(colorAt(position), 0xff0000);
    await world.placeChunk(neighbor);
    t.is(colorAt(position), 0xaa0055);
    await world.unloadChunkColumn(0, -1);
    t.is(colorAt(position), 0xff0000);
    await world.placeChunk(neighbor);
    t.is(colorAt(position), 0xaa0055);
    await world.clear();
    t.is(world["biomeBlend"]!["tiles"].size, 0);
});

test.serial(`biome radius toggles preserve hidden blocks, raw samples and unrelated objects`, async t => {
    const { world, colorAt } = biomeBlendFixture(t);
    const data = new ChunkData();
    data.set(7 + 8 * 16, { type: "oak_leaves" });
    data.set(0, { type: "test:cube" });
    const biomes = Array.from({ length: 64 }, (_, index) => index % 4 < 2 ? "test:red" : "test:blue");
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes }] });
    const position: TripleArray = [7, 0, 8], chunk = world.getChunkAt(new Vector3(...position))!;
    const unrelated = world.getBlockAt(0, 0, 0)!.object;
    t.is(colorAt(position), 0xff0000);
    await world.setBlockVisibleAt(position, false);
    await world.setBiomeBlendRadius(1);
    t.false(chunk.isBlockVisibleAt(new Vector3(...position)));
    t.deepEqual(world.getBlockAt(position)!.block, { type: "minecraft:oak_leaves" });
    await world.setBlockVisibleAt(position, true);
    t.is(colorAt(position), 0xaa0055);
    const template = templateOf(world, position);
    await world.setBiomeBlendRadius(7);
    t.is(colorAt(position), 0x880077);
    t.is(templateOf(world, position), template);
    for (let repeat = 0; repeat < 3; repeat++) {
        await world.setBiomeBlendRadius(0);
        t.is(colorAt(position), 0xff0000);
        t.is(world["biomeBlend"], undefined);
        await world.setBiomeBlendRadius(1);
        t.is(colorAt(position), 0xaa0055);
    }
    await Promise.all([world.setBiomeBlendRadius(2), world.setBiomeBlendRadius(0), world.setBiomeBlendRadius(1)]);
    t.is(world.biomeBlendRadius, 1);
    t.is(colorAt(position), 0xaa0055);
    const before = world.getBlockAt(position)!.object, section = chunk["sectionMesh"];
    await world.setBiomeBlendRadius(1);
    t.is(world.getBlockAt(position)!.object, before);
    t.is(chunk["sectionMesh"], section);
    t.is(world.getBlockAt(0, 0, 0)!.object, unrelated);
    t.is(world.getBiomeAt(position), "test:red");
});

test.serial(`blended waterlogged foliage uses separate tint kinds and refreshes setBiomes`, async t => {
    const { world, colorAt } = biomeBlendFixture(t, 1);
    const data = new ChunkData();
    data.set(7 + 8 * 16, { type: "oak_leaves", properties: { waterlogged: "true" } });
    data.set(7 + 10 * 16, { type: "water" });
    const biomes = Array.from({ length: 64 }, (_, index) => index % 4 < 2 ? "test:red" : "test:blue");
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes }] });
    t.is(colorAt([7, 0, 8]), 0xaa0055);
    t.is(colorAt([7, 0, 8], 1), 0x00aa55);
    t.is(colorAt([7, 0, 10]), 0x00aa55);
    await world.getChunkAt(new Vector3())!.setBiomes(Array(64).fill("test:blue"));
    t.is(colorAt([7, 0, 8]), 0x0000ff);
    t.is(colorAt([7, 0, 8], 1), 0x0000ff);
    await world.getChunkAt(new Vector3())!.setBiomes(undefined);
    t.is(colorAt([7, 0, 8]), 0x48b518);
    t.is(colorAt([7, 0, 8], 1), 0x3f76e4);
});

test.serial("blended worlds color atlas fallback objects with their own biome", async t => {
    const { world } = biomeBlendFixture(t, 1, { maxAtlasSize: 8 });
    const data = new ChunkData();
    data.set(15, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    const object = world.getBlockAt(15, 0, 0)!.object!;
    t.truthy(object);
    t.is(new Color().fromBufferAttribute(geometryOf(object).getAttribute("color"), 0).getHex(), 0xff0000);
    await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data: new ChunkData(), biomes: Array(64).fill("test:blue") }] });
    t.is(world.getBlockAt(15, 0, 0)!.object, object);
    t.is(new Color().fromBufferAttribute(geometryOf(object).getAttribute("color"), 0).getHex(), 0xff0000);
    await world.getChunkAt(new Vector3())!.setBiomes(Array(64).fill("test:blue"));
    const refreshed = world.getBlockAt(15, 0, 0)!.object!;
    t.is(new Color().fromBufferAttribute(geometryOf(refreshed).getAttribute("color"), 0).getHex(), 0x0000ff);
});

test.serial("blended worlds refresh individual objects only when their own biome changes", async t => {
    const { world, states, addModel } = biomeBlendFixture(t, 1);
    addModel("entity", { height: 8 });
    states.set("test:entity", { key: AssetKey.parse("blockstates", "test:entity"), variants: { "": { model: "test:block/entity" } } });
    const getEntity = Entities.getEntity, applyTextures = EntityObject.prototype["applyTextures"];
    BlockEntities.getIndex = async () => ({ "test:entity": { parts: [{ model: "test:entity" }] } });
    Entities.getEntity = async key => ({ id: key.toNamespacedString(), key, layer: { texture: [16, 16], root: {
        pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {}
    } } });
    EntityObject.prototype["applyTextures"] = async () => undefined;
    t.teardown(() => { Entities.getEntity = getEntity; EntityObject.prototype["applyTextures"] = applyTextures; });
    const data = new ChunkData();
    data.set(15, { type: "test:entity", properties: { waterlogged: "true" } });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    const object = world.getBlockAt(15, 0, 0)!.object!;
    t.is(new Color().fromBufferAttribute(geometryOf(object, 1).getAttribute("color"), 0).getHex(), 0x00ff00);
    await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data: new ChunkData(), biomes: Array(64).fill("test:blue") }] });
    t.is(world.getBlockAt(15, 0, 0)!.object, object);
    t.is(new Color().fromBufferAttribute(geometryOf(object, 1).getAttribute("color"), 0).getHex(), 0x00ff00);
    await world.getChunkAt(new Vector3())!.setBiomes(Array(64).fill("test:blue"));
    const refreshed = world.getBlockAt(15, 0, 0)!.object!;
    t.is(new Color().fromBufferAttribute(geometryOf(refreshed, 1).getAttribute("color"), 0).getHex(), 0x0000ff);
});

test.serial(`enabled biome blending skips untinted replacement models`, async t => {
    const { world, states, addModel } = fixture(t, { sectionMeshing: true, biomeBlendRadius: 7 });
    addModel("plain");
    states.set("minecraft:oak_leaves", { key: AssetKey.parse("blockstates", "oak_leaves"), variants: { "": { model: "test:block/plain" } } });
    const originals = { get: Biomes.get, color: Biomes.getColor };
    Biomes.get = Biomes.getColor = async () => { throw new Error("Untinted replacement must not sample biome colors"); };
    t.teardown(() => { Biomes.get = originals.get; Biomes.getColor = originals.color; });
    const data = new ChunkData();
    data.set(0, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    await world.setBiomeBlendRadius(1);
    t.truthy(world.getBlockAt(0, 0, 0));
    t.is(world["biomeBlend"]!["tiles"].size, 0);
});

test.serial(`failed biome radius refresh retains blocks and retries the requested radius`, async t => {
    const { world, colorAt } = biomeBlendFixture(t);
    const data = new ChunkData();
    data.set(7 + 8 * 16, { type: "oak_leaves" });
    const biomes = Array.from({ length: 64 }, (_, index) => index % 4 < 2 ? "test:red" : "test:blue");
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes }] });
    const color = Biomes.getColor;
    Biomes.getColor = async () => { throw new Error("Biome color failed"); };
    await t.throwsAsync(world.setBiomeBlendRadius(1), { message: "Biome color failed" });
    t.deepEqual(world.getBlockAt(7, 0, 8)!.block, { type: "minecraft:oak_leaves" });
    Biomes.getColor = color;
    await world.setBiomeBlendRadius(1);
    t.is(world.biomeBlendRadius, 1);
    t.is(colorAt([7, 0, 8]), 0xaa0055);
});


test.serial(`biome radius changes wait for pending column placement`, async t => {
    const { world, colorAt } = biomeBlendFixture(t, 1);
    const originalColor = Biomes.getColor;
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    Biomes.getColor = async (...args) => { started(); await waiting; return originalColor(...args); };
    const data = new ChunkData();
    data.set(7 + 8 * 16, { type: "oak_leaves" });
    const placing = world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data,
        biomes: Array.from({ length: 64 }, (_, index) => index % 4 < 2 ? "test:red" : "test:blue") }] });
    await began;
    const changing = world.setBiomeBlendRadius(0);
    release();
    await Promise.all([placing, changing]);
    t.is(world.biomeBlendRadius, 0);
    t.is(colorAt([7, 0, 8]), 0xff0000);
});

test.serial(`edits during biome refresh preserve the replacement block`, async t => {
    const { world } = biomeBlendFixture(t);
    const data = new ChunkData();
    data.set(7 + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data,
        biomes: Array.from({ length: 64 }, (_, index) => index % 4 < 2 ? "test:red" : "test:blue") }] });
    const originalColor = Biomes.getColor;
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    Biomes.getColor = async (...args) => { started(); await waiting; return originalColor(...args); };
    const changing = world.setBiomeBlendRadius(1);
    await began;
    let edited = false;
    const editing = world.setBlockAt([7, 0, 8], { type: "test:cube", nbt: { kept: true } }).then(() => { edited = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    t.false(edited);
    t.is(world.getBlockAt(7, 0, 8)!.block.type, "minecraft:oak_leaves");
    release();
    await Promise.all([changing, editing]);
    t.deepEqual(world.getBlockAt(7, 0, 8)!.block, { type: "test:cube", nbt: { kept: true } });
});


test.serial(`visibility changes during biome refresh survive color replacement`, async t => {
    const { world } = biomeBlendFixture(t);
    const data = new ChunkData();
    data.set(7 + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data,
        biomes: Array.from({ length: 64 }, (_, index) => index % 4 < 2 ? "test:red" : "test:blue") }] });
    const originalColor = Biomes.getColor;
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const began = new Promise<void>(resolve => { started = resolve; });
    Biomes.getColor = async (...args) => { started(); await waiting; return originalColor(...args); };
    const changing = world.setBiomeBlendRadius(1);
    await began;
    const hiding = world.setBlockVisibleAt([7, 0, 8], false);
    release();
    await Promise.all([changing, hiding]);
    const chunk = world.getChunkAt(new Vector3(7, 0, 8))!;
    t.false(chunk.isBlockVisibleAt(new Vector3(7, 0, 8)));
    t.is(world.getBlockAt(7, 0, 8)!.block.type, "minecraft:oak_leaves");
});

test.serial("failed neighbor biomes do not reject column operations or distant biome edits", async t => {
    const { world, colorAt, place } = biomeBlendFixture(t, 1);
    const data = new ChunkData();
    data.set(15 + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    const original = Biomes.getColor, failure = new Error("biome color failed");
    Biomes.getColor = async (id, ...args) => {
        if (id === "test:bad") throw failure;
        return original(id, ...args);
    };
    const neighbor = new ChunkData();
    neighbor.set(0, { type: "test:cube" });
    await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data: neighbor, biomes: Array(64).fill("test:bad") }] });
    t.is(colorAt([15, 0, 8]), 0xff0000);
    // A failing center stays queued while unrelated operations complete.
    await t.throwsAsync(world.getChunkAt(new Vector3())!.setBiomes(Array(64).fill("test:bad")), { is: failure });
    const warnings: unknown[][] = [];
    Logging.setHandler((level, namespace, args) => { warnings.push(args); });
    t.teardown(() => { Logging.setHandler(); });
    await world.placeChunk({ x: 5, z: 5, sections: [{ y: 0, data: neighbor, biomes: Array(64).fill("test:red") }] });
    t.truthy(world.getBlockAt(80, 0, 80));
    await world.unloadChunkColumn(5, 5);
    t.is(world.getBlockAt(80, 0, 80), undefined);
    await place([160, 0, 160]);
    await world.getChunkAt(new Vector3(160, 0, 160))!.setBiomes(Array(64).fill("test:blue"));
    t.is(world.getBiomeAt(160, 0, 160), "test:blue");
    t.is(colorAt([15, 0, 8]), 0xff0000);
    t.is(warnings.length, 2);
    t.true(warnings.every(args => args[1] === failure));
});

test.serial("clear and column operations during a failing radius refresh take effect", async t => {
    const { world, place } = biomeBlendFixture(t);
    const data = new ChunkData();
    data.set(7 + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    await place([144, 0, 144]);
    const original = Biomes.getColor;
    let fail!: (error: Error) => void, started!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    Biomes.getColor = () => { started(); return new Promise<number>((_, reject) => { fail = reject; }); };
    const changing = t.throwsAsync(world.setBiomeBlendRadius(1), { message: "biome failed" });
    await began;
    const clearing = world.clear();
    const placing = world.placeChunk({ x: 5, z: 5, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    const unloading = world.unloadChunkColumn(9, 9);
    Biomes.getColor = original;
    fail(new Error("biome failed"));
    await Promise.all([changing, clearing, placing, unloading]);
    t.is(world.getBlockAt(7, 0, 8), undefined);
    t.truthy(world.getBlockAt(87, 0, 88));
    t.is(world.getBlockAt(144, 0, 144), undefined);
});

test.serial("column refreshes skip uniform colors and replace only changed border cells", async t => {
    const { world, colorAt } = biomeBlendFixture(t, 2);
    const data = new ChunkData();
    for (let x = 0; x < 16; x++) data.set(x + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    await world.placeChunk({ x: -1, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    const chunk = world.getChunkAt(new Vector3())!, distant = world.getChunkAt(new Vector3(-16, 0, 0))!;
    const mesh = chunk["sectionMesh"], distantMesh = distant["sectionMesh"];
    const replaced: number[] = [], replace = chunk["replaceBlocks"].bind(chunk);
    chunk["replaceBlocks"] = async (blocks, preserve) => {
        replaced.push(...blocks.map(block => block.index));
        return replace(blocks, preserve);
    };
    const neighbor = { x: 1, z: 0, sections: [{ y: 0, data: new ChunkData(), biomes: Array(64).fill("test:red") }] };
    await world.placeChunk(neighbor);
    t.deepEqual(replaced, []);
    t.is(chunk["sectionMesh"], mesh);
    t.is(distant["sectionMesh"], distantMesh);
    await world.placeChunk({ ...neighbor, sections: [{ ...neighbor.sections[0], biomes: Array(64).fill("test:blue") }] });
    t.deepEqual(replaced, [14 + 8 * 16, 15 + 8 * 16]);
    t.is(colorAt([13, 0, 8]), 0xff0000);
    t.is(colorAt([14, 0, 8]), 0xcc0033);
    t.is(colorAt([15, 0, 8]), 0x990066);
    t.is(distant["sectionMesh"], distantMesh);
    replaced.length = 0;
    await world.unloadChunkColumn(1, 0);
    t.deepEqual(replaced, [14 + 8 * 16, 15 + 8 * 16]);
    t.is(colorAt([15, 0, 8]), 0xff0000);
});

test.serial("section biome edits refresh tinted cells in adjacent columns", async t => {
    const { world, colorAt } = biomeBlendFixture(t, 1);
    const data = new ChunkData();
    data.set(15 + 8 * 16, { type: "oak_leaves" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    await world.getChunkAt(new Vector3(16, 0, 0))!.setBiomes(Array(64).fill("test:blue"));
    t.is(colorAt([15, 0, 8]), 0xaa0055);
    t.is(colorAt([31, 0, 8]), 0x0000ff);
});

test.serial("blended tall plant upper halves sample the section below", async t => {
    const { world, states, colorAt } = biomeBlendFixture(t, 1);
    const grass = Colormaps.grassColor;
    Colormaps.grassColor = async () => 0x654321;
    t.teardown(() => { Colormaps.grassColor = grass; });
    states.set("minecraft:tall_grass", { key: AssetKey.parse("blockstates", "tall_grass"),
        variants: { "": { model: "test:block/blend_leaves" } } });
    const upper = new ChunkData();
    upper.set(15 + 8 * 16, { type: "tall_grass", properties: { half: "upper" } });
    await world.placeChunk({ x: 0, z: 0, sections: [
        { y: 0, data: new ChunkData(), biomes: Array(64).fill("test:red") },
        { y: 1, data: upper, biomes: Array(64).fill("test:blue") }
    ] });
    t.is(colorAt([15, 16, 8]), 0xff0000);
    await world.placeChunk({ x: 1, z: 0, sections: [{ y: 0, data: new ChunkData(), biomes: Array(64).fill("test:blue") }] });
    t.is(colorAt([15, 16, 8]), 0xaa0055);
});

test.serial("default blended water does not allocate a water tint buffer", async t => {
    const { world } = biomeBlendFixture(t, 1);
    Biomes.getColor = async () => 0x3f76e4;
    const data = new ChunkData();
    data.set(0, { type: "water" });
    await world.placeChunk({ x: 0, z: 0, sections: [{ y: 0, data, biomes: Array(64).fill("test:red") }] });
    t.is(world.getChunkAt(new Vector3())!["waterTints"], undefined);
});
