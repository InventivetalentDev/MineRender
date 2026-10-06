import test, { ExecutionContext } from "ava";
import { BoxGeometry, MeshBasicMaterial, Vector3 } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { BlockEntities, BlockEntityIndex } from "../src/assets/BlockEntities";
import { BlockStates } from "../src/assets/BlockStates";
import { Entities } from "../src/assets/Entities";
import { Models } from "../src/assets/Models";
import { AssetSource } from "../src/assets/source/AssetSource";
import { HostedAssetSource } from "../src/assets/source/HostedAssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { EntityObject } from "../src/entity/scene/EntityObject";
import type { EntityModelPart } from "../src/entity/EntityModel";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import type { Maybe } from "../src/util";
import { MineRenderWorld, MineRenderWorldOptions } from "../src/world/MineRenderWorld";

class StubSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey, parser: AssetParser | string) => unknown) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        return this.load(key, parser) as Maybe<T>;
    }
}

const index: BlockEntityIndex = {
    "minecraft:trapped_chest": {
        parts: [
            { model: "minecraft:chest", textureLocation: "minecraft:textures/entity/chest/trapped.png", when: { type: "single" } },
            { model: "minecraft:double_chest_left", layer: "lid", when: { type: "left|right" } }
        ],
        rotation: { property: "facing", degrees: { east: 90, north: 180, south: 0, west: 270 } }
    },
    "minecraft:skeleton_wall_skull": {
        parts: [{ model: "minecraft:skeleton_skull" }],
        rotation: { property: "facing", degrees: { east: 270, north: 0, south: 180, west: 90 } },
        translation: [0, 4, 4]
    },
    "minecraft:oak_sign": { parts: [{ model: "minecraft:sign" }], rotation: { property: "rotation", step: 22.5 } },
    "minecraft:bell": { parts: [{ model: "minecraft:bell" }] }
};

const originalRoot = AssetLoader.ROOT;
const originalSources = [...AssetLoader["_SOURCES"]];
test.beforeEach(() => Caching.clear());
test.afterEach.always(() => {
    AssetLoader.ROOT = originalRoot;
    AssetLoader["_SOURCES"] = [...originalSources];
    Caching.clear();
});

test.serial("the block index is cached per root and read from next to the namespace directories", async t => {
    const keys: AssetKey[] = [];
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        t.is(parser, AssetParser.JSON);
        keys.push(key);
        return key.root === "https://example.test/old" ? undefined : index;
    }));
    AssetLoader.ROOT = "https://example.test/1.21.11";
    t.is(await BlockEntities.getIndex(), index);
    t.is(await BlockEntities.getIndex(), index);
    t.is(keys.length, 1);
    const hosted = new HostedAssetSource(AssetLoader.ROOT);
    t.is(hosted.assetBasePath(keys[0]) + keys[0].path + keys[0].extension, "https://example.test/1.21.11/entity-models/blocks.json");

    // Versions without an index have no block entities, and are asked only once.
    t.deepEqual(await BlockEntities.getIndex("https://example.test/old"), {});
    t.deepEqual(await BlockEntities.getIndex("https://example.test/old"), {});
    t.is(keys.length, 2);
    t.is(hosted.assetBasePath(keys[1]), "https://example.test/old/entity-models/");

    AssetLoader.ROOT = "https://example.test/1.21.10";
    await BlockEntities.getIndex();
    t.is(keys.length, 3);
});

test.serial("a failed index load yields no block entities instead of an error", async t => {
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args) => warnings.push(args);
    t.teardown(() => console.warn = warn);
    let calls = 0;
    AssetLoader["_SOURCES"] = [];
    AssetLoader.addSource("test", new StubSource(() => { calls++; throw new Error("offline"); }));
    t.deepEqual(await BlockEntities.getIndex(), {});
    t.deepEqual(await BlockEntities.getIndex(), {});
    t.deepEqual([calls, warnings.length], [1, 1]);
});

test("block states select parts by multipart conditions", t => {
    const single = BlockEntities.resolve(index, "minecraft:trapped_chest", { type: "single", facing: "east" })!;
    t.deepEqual(single.parts.map(part => part.model), ["minecraft:chest"]);
    t.deepEqual([single.rotation, single.translation], [90, [0, 0, 0]]);
    for (const type of ["left", "right"]) {
        const double = BlockEntities.resolve(index, "minecraft:trapped_chest", { type, facing: "west" })!;
        t.deepEqual(double.parts, [index["minecraft:trapped_chest"].parts[1]]);
        t.is(double.rotation, 270);
    }
    t.is(BlockEntities.resolve(index, "minecraft:trapped_chest", { facing: "east" }), undefined);
    // Default states carry upper-case enum names and non-string values.
    const defaults = { type: "SINGLE", facing: "EAST", waterlogged: false } as unknown as Record<string, string>;
    t.deepEqual(BlockEntities.resolve(index, "minecraft:trapped_chest", defaults), single);
    t.is(BlockEntities.resolve(index, "minecraft:oak_sign", { rotation: 4 } as unknown as Record<string, string>)!.rotation, 90);
    t.is(BlockEntities.resolve(index, "minecraft:stone"), undefined);
    t.is(BlockEntities.resolve(index, "toString"), undefined);
    t.is(BlockEntities.resolve(index, "minecraft:bell")!.rotation, 0);
});

test("rotations come from a degrees table or a numeric step, and default to zero", t => {
    const sign = (rotation?: string) => BlockEntities.resolve(index, "minecraft:oak_sign", rotation === undefined ? {} : { rotation })!.rotation;
    t.deepEqual([sign("0"), sign("4"), sign("15"), sign(), sign("x")], [0, 90, 337.5, 0, 0]);
    t.is(BlockEntities.resolve(index, "minecraft:skeleton_wall_skull", { facing: "up" })!.rotation, 0);
});

test("placement turns the translated model about the block's vertical centre axis", t => {
    const skull = BlockEntities.resolve(index, "minecraft:skeleton_wall_skull", { facing: "east" })!;
    t.deepEqual(skull.translation, [0, 4, 4]);
    const matrix = BlockEntities.matrix(skull);
    const round = (v: Vector3) => v.toArray().map(n => Math.round(n * 1e6) / 1e6 + 0);
    // Facing east, the skull hangs on the block to its west and looks east.
    t.deepEqual(round(new Vector3(8, 0, 8).applyMatrix4(matrix)), [4, 4, 8]);
    t.deepEqual(round(new Vector3(0, 0, -1).transformDirection(matrix)), [1, 0, 0]);
    t.deepEqual(round(new Vector3(3, 2, 1).applyMatrix4(BlockEntities.matrix({ parts: [], rotation: 0, translation: [0, 0, 0] }))), [3, 2, 1]);
});

function fixture(t: ExecutionContext, options?: Partial<MineRenderWorldOptions<boolean>>) {
    const originals = {
        state: BlockStates.get, defaults: BlockStates.getDefaultState, model: Models.getMerged, init: ModelObject.prototype.init,
        index: BlockEntities.getIndex, entity: Entities.getEntity, textures: EntityObject.prototype["applyTextures"], warn: console.warn
    };
    const geometry = new BoxGeometry(16, 16, 16);
    const material = new MeshBasicMaterial();
    const scene = new MineRenderScene();
    const world = new MineRenderWorld(scene, options);
    const models: ModelObject[] = [];
    const requests: { model: string; texture?: string; layer?: string }[] = [];
    const missing = new Set<string>();
    const part: EntityModelPart = { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} };
    BlockStates.get = async key => ({ key, variants: { "": { model: key.path === "bell" ? "test:block/frame" : "test:block/empty" } } });
    BlockStates.getDefaultState = async () => undefined;
    Models.getMerged = async key => key.path === "frame" ? { key, elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: {} }] } : { key };
    ModelObject.prototype.init = async function () {
        this.add(this["createInstancedMesh"](undefined, geometry, material, this.options.maxInstanceCount));
        models.push(this);
    };
    BlockEntities.getIndex = async () => index;
    Entities.getEntity = async (key, texture, entityOptions) => {
        requests.push({ model: key.toNamespacedString(), texture: texture?.serialize(), layer: entityOptions?.layer });
        if (missing.has(key.path)) return undefined;
        return { id: key.toNamespacedString(), key, layer: { texture: [64, 64], root: structuredClone(part) }, transform: [{ translate: [8, 0, 8] }] };
    };
    EntityObject.prototype["applyTextures"] = async () => undefined;
    console.warn = () => undefined;
    t.teardown(async () => {
        await world.clear();
        BlockStates.get = originals.state;
        BlockStates.getDefaultState = originals.defaults;
        Models.getMerged = originals.model;
        ModelObject.prototype.init = originals.init;
        BlockEntities.getIndex = originals.index;
        Entities.getEntity = originals.entity;
        EntityObject.prototype["applyTextures"] = originals.textures;
        console.warn = originals.warn;
        for (const model of models) model.dispose();
        geometry.dispose();
        material.dispose();
    });
    const entities = () => scene.children.filter((child): child is EntityObject => (child as EntityObject).isEntityObject);
    return { world, scene, models, requests, missing, entities };
}

for (const sectionMeshing of [false, true]) {
    test.serial(`world blocks own their entity models through placement, replacement and clearing (sectionMeshing=${sectionMeshing})`, async t => {
        const { world, scene, models, requests, entities } = fixture(t, { sectionMeshing });
        const chest = await world.setBlockAt(1, 0, -2, { type: "minecraft:trapped_chest", properties: { type: "single", facing: "east" } });
        const object = chest!.object as BlockObject;
        t.deepEqual(requests, [{
            model: "minecraft:chest", layer: undefined,
            texture: AssetKey.parse("textures", "minecraft:entity/chest/trapped").serialize()
        }]);
        // The geometry-less block model is not drawn, so no placeholder cube appears.
        t.is(models.length, 0);
        t.deepEqual(entities(), [...object.blockEntities]);
        const entity = object.blockEntities[0];
        // Block models are centred on (16, 0, -32); the entity sits on the block's bottom centre, turned 90 degrees.
        t.deepEqual(entity.position.toArray().map(Math.round), [8, -8, -24]);
        t.true(Math.abs(entity.rotation.y - Math.PI / 2) < 1e-9);
        t.deepEqual(new Vector3(8, 0, 8).applyMatrix4(entity.matrixWorld.identity().compose(entity.position, entity.quaternion, entity.scale))
            .toArray().map(Math.round), [16, -8, -32]);

        object.setPosition(new Vector3(160, 16, 0));
        t.deepEqual(entity.position.toArray().map(Math.round), [152, 8, 8]);

        scene.dirty = false;
        const stone = await world.setBlockAt(1, 0, -2, { type: "minecraft:stone" });
        t.true(scene.dirty);
        t.deepEqual([entities().length, object.blockEntities.length, entity.parent], [0, 0, null]);
        t.is((stone?.object as Maybe<BlockObject>)?.blockEntities.length ?? 0, 0);

        await world.setBlockAt(0, 0, 0, { type: "minecraft:trapped_chest", properties: { type: "left", facing: "south" } });
        await world.setBlockAt(2, 0, 0, { type: "minecraft:oak_sign", properties: { rotation: "8" } });
        t.is(requests[1].layer, "lid");
        t.is(entities().length, 2);
        t.is(await world.setBlockAt(2, 0, 0, undefined), undefined);
        t.is(entities().length, 1);
        await world.clear();
        t.is(entities().length, 0);
    });
}

test.serial("block models with geometry stay next to the entity, and blocks without a loadable entity keep their block model", async t => {
    const { scene, models, missing, entities } = fixture(t);
    const state = async (name: string) => (await BlockStates.get(AssetKey.parse("blockstates", `minecraft:${name}`)))!;
    const bell = await scene.addBlock(await state("bell")) as BlockObject;
    t.deepEqual([bell.blockEntities.length, models.length], [1, 1]);
    bell.removeFromScene();
    t.deepEqual([entities().length, bell.blockEntities.length], [0, 0]);

    missing.add("sign");
    const sign = await scene.addBlock(await state("oak_sign"), { initialState: { rotation: "4" } }) as BlockObject;
    t.deepEqual([sign.blockEntities.length, entities().length, models.length], [0, 0, 2]);

    missing.clear();
    await sign.setState("rotation", "12");
    t.is(sign.blockEntities.length, 1);
    t.true(Math.abs(sign.blockEntities[0].rotation.y + Math.PI / 2) < 1e-9);
    const previous = sign.blockEntities[0];
    await sign.setState("rotation", "0");
    t.is(previous.parent, null);
    t.deepEqual(entities(), [...sign.blockEntities]);
    sign.dispose();
    t.is(entities().length, 0);
});
