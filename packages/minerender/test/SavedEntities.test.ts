import test, { ExecutionContext } from "ava";
import { Object3D, Vector3 } from "three";
import type { Compound } from "prismarine-nbt";
import { BlockStates } from "../src/assets/BlockStates";
import { Entities } from "../src/assets/Entities";
import { EntityObject } from "../src/entity/scene/EntityObject";
import type { TripleArray } from "../src/model/Model";
import type { MultiBlockEntity, MultiBlockStructure } from "../src/model/multiblock/MultiBlockStructure";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { MineRenderWorld } from "../src/world/MineRenderWorld";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(yes => { resolve = yes; });
    return { promise, resolve };
}

function entity(id = "minecraft:zombie", position: TripleArray = [0.5, 1, 0.5], yaw = 0): MultiBlockEntity {
    const nbt: Compound = { type: "compound", value: {
        id: { type: "string", value: id },
        Rotation: { type: "list", value: { type: "float", value: [yaw, 30] } },
        Pos: { type: "list", value: { type: "double", value: [99, 99, 99] } }
    } };
    return { position, nbt };
}

const structure = (...entities: MultiBlockEntity[]): MultiBlockStructure => ({ size: [16, 16, 16], blocks: [], entities });

function fixture(t: ExecutionContext, renderEntities = true, init?: (object: EntityObject) => Promise<void>) {
    const original = { get: Entities.getEntity, list: Entities.getEntityList, preload: BlockStates.getAll, init: EntityObject.prototype.init,
        dispose: EntityObject.prototype.disposeAndRemoveAllChildren };
    const scene = new MineRenderScene();
    const world = new MineRenderWorld(scene, { renderEntities });
    const requests: string[] = [];
    const initialized: EntityObject[] = [];
    const disposed: EntityObject[] = [];
    const missing = new Set<string>();
    Entities.getEntityList = async () => ["zombie", "cow", "pig", "camel_husk", "shulker", "ender_dragon"];
    Entities.getEntity = async key => {
        requests.push(key.toNamespacedString());
        if (missing.has(key.path)) return undefined;
        return { key, id: key.toNamespacedString(), layer: { texture: [64, 64], root: {
            pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {}
        } } };
    };
    BlockStates.getAll = async () => [];
    EntityObject.prototype.init = async function () {
        initialized.push(this);
        this.add(new Object3D());
        await init?.(this);
    };
    EntityObject.prototype.disposeAndRemoveAllChildren = function () {
        disposed.push(this);
        original.dispose.call(this);
    };
    t.teardown(async () => {
        await world.clear();
        Entities.getEntity = original.get;
        Entities.getEntityList = original.list;
        BlockStates.getAll = original.preload;
        EntityObject.prototype.init = original.init;
        EntityObject.prototype.disposeAndRemoveAllChildren = original.dispose;
    });
    const objects = () => scene.children.filter((child): child is EntityObject => (child as EntityObject).isEntityObject);
    return { world, scene, requests, initialized, disposed, missing, objects };
}

test.serial("saved entities remain data only unless rendering is enabled", async t => {
    const { scene, requests } = fixture(t, false);
    const world = new MineRenderWorld(scene);
    const saved = entity();
    const original = structuredClone(saved);
    await world.placeMultiBlock(structure(saved));
    await world.placeChunk({ x: 0, z: 0, sections: [], entities: [saved] });
    t.deepEqual(requests, []);
    t.deepEqual(scene.children, []);
    t.deepEqual(saved, original);
});

test.serial("saved entities align fractional positions to block corners and turn from +Z towards -X", async t => {
    const { world, scene, objects } = fixture(t);
    const saved = entity("minecraft:zombie", [-16.25, 2, -0.5], 90);
    const original = structuredClone(saved);
    scene.dirty = false;
    await world.placeMultiBlock(structure(saved, entity("cow", [0.5, 1, 0.5], -90)));
    const [zombie, cow] = objects();
    t.deepEqual(zombie.position.toArray(), [-268, 24, -16]);
    t.deepEqual(cow.position.toArray(), [0, 8, 0]);
    t.is(zombie.rotation.y, -Math.PI / 2);
    t.is(cow.rotation.y, Math.PI / 2);
    t.true(new Vector3(0, 0, 1).applyEuler(zombie.rotation).distanceTo(new Vector3(-1, 0, 0)) < 1e-10);
    t.is(zombie.rotation.x, 0);
    t.false(zombie.options.instanceMeshes);
    t.true(scene.dirty);
    t.deepEqual(saved, original);
});

test.serial("unsupported, malformed and missing entities are skipped without changing their NBT", async t => {
    const { world, requests, objects, missing } = fixture(t);
    missing.add("pig");
    const invalidRotation = entity();
    (invalidRotation.nbt as Compound).value.Rotation = { type: "list", value: { type: "float", value: [NaN, 0] } };
    const input = [entity("minecraft:item"), entity("custom:zombie"), { ...entity(), nbt: { id: "minecraft:zombie" } },
        entity("minecraft:zombie", [Infinity, 0, 0]), invalidRotation, entity("minecraft:pig"), entity("minecraft:cow"),
        entity("minecraft:camel_husk"), entity("minecraft:shulker"), entity("minecraft:ender_dragon")];
    const original = structuredClone(input);
    await world.placeMultiBlock(structure(...input));
    t.deepEqual(requests, ["minecraft:pig", "minecraft:cow", "minecraft:camel_husk", "minecraft:shulker", "minecraft:ender_dragon"]);
    t.deepEqual(objects().map(object => object.entity.id), requests.slice(1));
    t.deepEqual(input, original);
});

test.serial("structure entities unload by signed position while clear preserves caller-owned objects", async t => {
    const { world, scene, objects, disposed } = fixture(t);
    await world.placeMultiBlock(structure(entity("minecraft:zombie", [-0.1, 1, -16.1]), entity("minecraft:cow", [0, 1, 0])));
    const [zombie, cow] = objects();
    const callerOwned = new EntityObject(cow.entity);
    scene.add(callerOwned);
    const otherWorld = new MineRenderWorld(scene, { renderEntities: true });
    t.teardown(() => otherWorld.clear());
    await otherWorld.placeMultiBlock(structure(entity("minecraft:pig")));
    const otherEntity = objects()[3];
    scene.dirty = false;
    await world.unloadChunkColumn(-1, -2);
    t.deepEqual(objects(), [cow, callerOwned, otherEntity]);
    t.deepEqual(disposed, [zombie]);
    t.is(zombie.children.length, 0);
    t.true(scene.dirty);
    await world.clear();
    t.deepEqual(objects(), [callerOwned, otherEntity]);
    t.deepEqual(disposed, [zombie, cow]);
    await otherWorld.clear();
    t.deepEqual(objects(), [callerOwned]);
    callerOwned.removeFromScene();
    callerOwned.dispose();
});

test.serial("empty chunk columns replace and own entities independently of their positions", async t => {
    const { world, objects, disposed } = fixture(t);
    const column = { x: -2, z: 3, sections: [] };
    await world.placeChunk({ ...column, entities: [entity()] });
    const zombie = objects()[0];
    await world.unloadChunkColumn(0, 0);
    t.deepEqual(objects(), [zombie]);
    await world.placeChunk({ ...column, entities: [entity("minecraft:cow")] });
    const cow = objects()[0];
    t.deepEqual(objects().map(object => object.entity.id), ["minecraft:cow"]);
    t.deepEqual(disposed, [zombie]);
    await world.placeChunk(column);
    t.deepEqual(objects(), []);
    t.deepEqual(disposed, [zombie, cow]);
});

test.serial("an entity initialization failure skips the failed entity and keeps the rest", async t => {
    t.timeout(3000);
    const gate = deferred(), started = deferred();
    const failure = new Error("texture decode failed");
    const warn = console.warn, warnings: unknown[][] = [];
    console.warn = (...args) => { warnings.push(args); };
    t.teardown(() => { console.warn = warn; });
    const { world, objects, initialized, disposed } = fixture(t, true, async object => {
        if (object.entity.id === "minecraft:cow") started.resolve();
        if (object.entity.id === "minecraft:pig") {
            await gate.promise;
            throw failure;
        }
    });
    t.teardown(() => gate.resolve());
    await world.placeMultiBlock(structure(entity()));
    const previous = objects()[0];
    const pending = world.placeChunk({ x: -2, z: 3, sections: [], entities: [entity("minecraft:pig"), entity("minecraft:cow")] });
    await started.promise;
    t.deepEqual(initialized.map(object => object.entity.id), ["minecraft:zombie", "minecraft:pig", "minecraft:cow"]);
    gate.resolve();
    await pending;
    t.deepEqual(objects(), [previous, initialized[2]]);
    t.deepEqual(disposed, [initialized[1]]);
    t.deepEqual(warnings, [["Could not draw saved entity minecraft:pig, skipping it", failure]]);
    t.true(disposed.every(object => object.parent === null && object.children.length === 0));
});

for (const operation of ["clear", "unload"] as const) {
    test.serial(`${operation} prevents a pending entity initialization from attaching`, async t => {
        t.timeout(3000);
        const gate = deferred(), started = deferred();
        const { world, objects, initialized, disposed } = fixture(t, true, async () => {
            started.resolve();
            await gate.promise;
        });
        t.teardown(() => gate.resolve());
        const pending = world.placeChunk({ x: -2, z: 3, sections: [], entities: [entity()] });
        await started.promise;
        if (operation === "clear") await world.clear();
        else await world.unloadChunkColumn(-2, 3);
        const replacement = world.placeChunk({ x: -2, z: 3, sections: [], entities: [entity("minecraft:cow")] });
        gate.resolve();
        await Promise.all([pending, replacement]);
        t.deepEqual(objects().map(object => object.entity.id), ["minecraft:cow"]);
        t.is(initialized.length, 2);
        t.deepEqual(disposed, [initialized[0]]);
        t.is(initialized[0].children.length, 0);
    });

    test.serial(`${operation} also invalidates entity placement while structure blocks are still loading`, async t => {
        t.timeout(3000);
        const gate = deferred(), started = deferred();
        const { world, objects, requests } = fixture(t);
        world["placeBlock"] = async () => { started.resolve(); await gate.promise; return undefined; };
        t.teardown(() => gate.resolve());
        const input = structure(entity("minecraft:zombie", [-0.5, 1, -0.5]));
        input.blocks.push({ type: "minecraft:stone", position: [-1, 0, -1] });
        const pending = world.placeMultiBlock(input, false);
        await started.promise;
        if (operation === "clear") await world.clear();
        else await world.unloadChunkColumn(-1, -1);
        gate.resolve();
        await pending;
        t.deepEqual(objects(), []);
        t.deepEqual(requests, []);
    });
}
