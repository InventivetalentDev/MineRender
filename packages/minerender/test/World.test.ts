import test, { ExecutionContext } from "ava";
import { BoxGeometry, InstancedMesh, MeshBasicMaterial, Vector3 } from "three";
import { BlockStates } from "../src/assets/BlockStates";
import { Models } from "../src/assets/Models";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { TripleArray } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { MineRenderWorld } from "../src/world/MineRenderWorld";

const block = { type: "test:stone" };

function fixture(t: ExecutionContext) {
    const originals = { state: BlockStates.get, defaults: BlockStates.getDefaultState, model: Models.getMerged, init: ModelObject.prototype.init };
    const geometry = new BoxGeometry(16, 16, 16);
    const material = new MeshBasicMaterial();
    const scene = new MineRenderScene();
    const world = new MineRenderWorld(scene);
    const loads: string[] = [];
    const owners: ModelObject[] = [];
    BlockStates.get = async key => {
        loads.push(key.toNamespacedString());
        return { key, variants: { "": { model: "test:block/shared" } } };
    };
    BlockStates.getDefaultState = async () => undefined;
    Models.getMerged = async key => ({ key });
    ModelObject.prototype.init = async function () {
        this.add(this["createInstancedMesh"](undefined, geometry, material, this.options.maxInstanceCount));
        owners.push(this);
    };
    t.teardown(async () => {
        await world.clear();
        BlockStates.get = originals.state;
        BlockStates.getDefaultState = originals.defaults;
        Models.getMerged = originals.model;
        ModelObject.prototype.init = originals.init;
        for (const owner of owners) owner.dispose();
        geometry.dispose();
        material.dispose();
    });
    return { world, scene, loads, owners };
}

test.serial("world coordinates cross signed chunk boundaries through every overload without debug geometry", async t => {
    const { world, scene, owners } = fixture(t);
    const positions: TripleArray[] = [[-17, -1, 65], [-16, -16, 80], [-1, -17, -65], [0, 0, 0], [15, 15, 15], [16, 16, 16]];
    for (const [i, pos] of positions.entries()) {
        const vector = new Vector3(...pos);
        const info = i % 3 === 0 ? await world.setBlockAt(...pos, block)
            : i % 3 === 1 ? await world.setBlockAt(vector, block) : await world.setBlockAt(pos, block);
        t.truthy(info);
        t.is(world.getBlockAt(...pos), info);
        t.is(world.getBlockAt(vector), info);
        t.is(world.getBlockAt(pos), info);
        const chunk = world.getChunkAt(vector)!;
        t.deepEqual([chunk.x, chunk.y, chunk.z], pos.map(axis => Math.floor(axis / 16)));
        t.deepEqual(info!.object.getPosition().toArray(), pos.map(axis => axis * 16));
    }
    t.deepEqual(scene.children, owners);
    t.is(owners.length, 1);
    t.false(owners[0].options.wireframe);
    t.is(owners[0].children.length, 1);
    t.is(owners[0].children[0].children.length, 0);
    t.is(scene.stats.instanceCount, positions.length);
});

test.serial("invalid world and local coordinates cannot alias another block", async t => {
    const { world, loads } = fixture(t);
    for (const pos of [new Vector3(0.5, 0, 0), new Vector3(0, NaN, 0), new Vector3(0, 0, Infinity)]) {
        t.throws(() => world.getBlockAt(pos), { instanceOf: RangeError });
        await t.throwsAsync(world.setBlockAt(pos, block), { instanceOf: RangeError });
    }
    t.is(loads.length, 0);
    const info = await world.setBlockAt(0, 0, 1, block);
    const chunk = world.getChunkAt(new Vector3())!;
    for (const pos of [new Vector3(16, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0.5, 0)]) {
        await t.throwsAsync(chunk.setBlockInChunkAt(pos, block), { instanceOf: RangeError });
    }
    t.is(world.getBlockAt(0, 0, 1), info);
    t.is(loads.length, 1);
});

test.serial("replacement, removal and world clearing release only their own shared model slots", async t => {
    const { world, scene, owners } = fixture(t);
    const first = await world.setBlockAt(-1, 0, 0, block);
    await world.setBlockAt(16, 0, 0, block);
    const unrelated = await scene.addBlock({ variants: { "": { model: "test:block/shared" } } }, { applyDefaultState: false }) as BlockObject;
    unrelated.setPosition(new Vector3(1000, 2000, 3000));
    const owner = owners[0];
    const mesh = owner.children[0] as InstancedMesh;
    const capacity = mesh.instanceMatrix.count;
    const oldChunk = world.getChunkAt(new Vector3(-1, 0, 0));
    const replacement = await world.setBlockAt([-1, 0, 0], { type: "test:replacement" });
    t.not(replacement!.object, first!.object);
    t.is(first!.object.instanceCounter, 0);
    t.is(owner.instanceCounter, 3);
    t.is(await world.setBlockAt(new Vector3(16, 0, 0), undefined), undefined);
    t.is(world.getBlockAt(16, 0, 0), undefined);
    t.is(owner.instanceCounter, 2);
    await world.clear();
    await world.clear();
    t.is(world.getChunkAt(new Vector3(-1, 0, 0)), undefined);
    t.is(world.getBlockAt(-1, 0, 0), undefined);
    t.is(oldChunk!.getBlockAt(-1, 0, 0), undefined);
    t.deepEqual([owner.instanceCounter, scene.stats.instanceCount], [1, 1]);
    t.deepEqual(unrelated.getPosition().toArray(), [1000, 2000, 3000]);
    await world.setBlockAt(-1, 0, 0, block);
    t.not(world.getChunkAt(new Vector3(-1, 0, 0)), oldChunk);
    t.is(owners.length, 1);
    t.is(owner.children[0], mesh);
    t.is(mesh.instanceMatrix.count, capacity);
    t.deepEqual([owner.instanceCounter, scene.stats.instanceCount], [2, 2]);
    t.deepEqual(unrelated.getPosition().toArray(), [1000, 2000, 3000]);
});

test.serial("vanilla air removes blocks without loading assets or creating empty chunks", async t => {
    const { world, loads, scene } = fixture(t);
    await world.setBlockAt(0, 0, 0, block);
    for (const type of ["air", "minecraft:air", "cave_air", "minecraft:cave_air", "void_air", "minecraft:void_air"]) {
        t.is(await world.setBlockAt(0, 0, 0, { type }), undefined);
        t.is(await world.setBlockAt(-100, -100, -100, { type }), undefined);
    }
    t.is(await world.setBlockAt(100, 100, 100, undefined), undefined);
    t.is(world.getBlockAt(0, 0, 0), undefined);
    t.is(world.getChunkAt(new Vector3(-100, -100, -100)), undefined);
    t.is(world.getChunkAt(new Vector3(100, 100, 100)), undefined);
    t.deepEqual(loads, ["test:stone"]);
    t.is(scene.stats.instanceCount, 0);
    t.truthy(await world.setBlockAt(0, 0, 0, { type: "custom:air" }));
    t.deepEqual(loads, ["test:stone", "custom:air"]);
});
