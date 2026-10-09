import test, { ExecutionContext } from "ava";
import { BoxGeometry, InstancedMesh, MeshBasicMaterial, Vector3 } from "three";
import type { NBT } from "prismarine-nbt";
import { BlockEntities } from "../src/assets/BlockEntities";
import { BlockStates } from "../src/assets/BlockStates";
import { Models } from "../src/assets/Models";
import { BlockObject } from "../src/model/block/scene/BlockObject";
import { TripleArray } from "../src/model/Model";
import { ModelObject } from "../src/model/scene/ModelObject";
import { SpongeSchematicParser } from "../src/model/multiblock/SpongeSchematicParser";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { ChunkData } from "../src/world/ChunkData";
import { BatchedExecutor } from "../src/util/BatchedExecutor";
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

test.serial("Sponge structures place offset blocks with saved properties and normalized NBT", async t => {
    const { world, scene } = fixture(t);
    const getIndex = BlockEntities.getIndex;
    BlockEntities.getIndex = async () => ({});
    t.teardown(() => { BlockEntities.getIndex = getIndex; });
    const input: NBT = { type: "compound", name: "", value: { Schematic: { type: "compound", value: {
        Version: { type: "int", value: 3 }, DataVersion: { type: "int", value: 4671 },
        Width: { type: "short", value: 2 }, Height: { type: "short", value: 1 }, Length: { type: "short", value: 1 },
        Offset: { type: "intArray", value: [-17, -1, 16] },
        Blocks: { type: "compound", value: {
            Palette: { type: "compound", value: { "test:stone[facing=east]": { type: "int", value: 0 } } },
            Data: { type: "byteArray", value: [0, 0] },
            BlockEntities: { type: "list", value: { type: "compound", value: [{
                Id: { type: "string", value: "test:container" }, Pos: { type: "intArray", value: [1, 0, 0] },
                Data: { type: "compound", value: { CustomName: { type: "string", value: "fixture" } } }
            }] } }
        } }
    } } } };
    await world.placeMultiBlock(await SpongeSchematicParser.parse(input));
    t.deepEqual(world.getBlockAt(-17, -1, 16)!.object.state, { facing: "east" });
    const placed = world.getBlockAt(-16, -1, 16)!;
    t.deepEqual(placed.object.getPosition().toArray(), [-256, -16, 256]);
    t.deepEqual(placed.block, { type: "test:stone", properties: { facing: "east" }, nbt: {
        type: "compound", value: {
            CustomName: { type: "string", value: "fixture" }, id: { type: "string", value: "test:container" },
            x: { type: "int", value: -16 }, y: { type: "int", value: -1 }, z: { type: "int", value: 16 }
        }
    } });
    t.is(scene.stats.instanceCount, 2);
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

test.serial("world placement snapshots block data without changing BlockInfo or render object identity", async t => {
    const { world, scene } = fixture(t);
    const input = { type: "test:stone", properties: { facing: "north" }, nbt: { items: [{ count: 2 }], bytes: new Uint8Array([3, 4]) } };
    const pending = world.setBlockAt(0, 0, 0, input);
    input.properties.facing = "south";
    input.nbt.items[0].count = 99;
    input.nbt.bytes[0] = 99;
    const first = (await pending)!;
    const second = (await world.setBlockAt(1, 0, 0, {
        type: "test:stone", properties: { facing: "north" }, nbt: { items: [{ count: 5 }], bytes: new Uint8Array([6, 7]) }
    }))!;
    t.is(world.getBlockAt(0, 0, 0), first);
    t.is(world.getBlockAt(0, 0, 0)!.object, first.object);
    t.deepEqual(first.object.state, { facing: "north" });
    t.deepEqual(first.block, {
        type: "test:stone", properties: { facing: "north" }, nbt: { items: [{ count: 2 }], bytes: new Uint8Array([3, 4]) }
    });
    const snapshot = first.block;
    snapshot.properties!.facing = "west";
    snapshot.nbt.items[0].count = 88;
    snapshot.nbt.bytes[0] = 88;
    t.deepEqual(first.block.properties, { facing: "north" });
    t.deepEqual(first.block.nbt, { items: [{ count: 2 }], bytes: new Uint8Array([3, 4]) });
    t.deepEqual(second.block, {
        type: "test:stone", properties: { facing: "north" }, nbt: { items: [{ count: 5 }], bytes: new Uint8Array([6, 7]) }
    });
    await world.setBlockAt(0, 0, 0, undefined);
    t.is(world.getBlockAt(1, 0, 0), second);
    t.deepEqual(second.object.getPosition().toArray(), [16, 0, 0]);
    t.is(scene.stats.instanceCount, 1);
});


test.serial("parsed chunk columns replace old sections and preserve signed positions, properties and block NBT", async t => {
    const { world, scene } = fixture(t);
    const preload = BlockStates.getAll;
    BlockStates.getAll = async () => [];
    const executor = new BatchedExecutor(1, 4);
    t.teardown(() => { BlockStates.getAll = preload; executor.stop(); });
    await world.setBlockAt(-32, 100, 48, block);
    const neighbor = await world.setBlockAt(-16, 100, 48, block);
    const data = new ChunkData();
    const value = { ...block, properties: { axis: "x" }, nbt: { id: "test:entity" } };
    data.set(4095, value);
    await world.placeChunk({ x: -2, z: 3, dataVersion: 4671, sections: [{ y: -4, data }] }, executor);
    t.is(world.getBlockAt(-32, 100, 48), undefined);
    t.deepEqual(world.getBlockAt(-17, -49, 63)!.block, value);
    t.deepEqual(world.getBlockAt(-17, -49, 63)!.object.getPosition().toArray(), [-272, -784, 1008]);
    t.is(world.getBlockAt(-16, 100, 48), neighbor);
    t.is(scene.stats.instanceCount, 2);
    await world.placeChunk({ x: -2, z: 3, sections: [] }, executor);
    t.is(world.getBlockAt(-17, -49, 63), undefined);
    t.is(scene.stats.instanceCount, 1);
    t.is(await executor.submit(() => "reusable"), "reusable");
});

test.serial("default bulk placement keeps repeated writes ordered within signed chunks", async t => {
    const { world, scene } = fixture(t);
    await world.placeMultiBlock({ size: [17, 1, 1], blocks: [
        { position: [-1, 0, 0], type: "test:first" },
        { position: [16, 0, 0], type: "test:neighbor" },
        { position: [-1, 0, 0], type: "air" },
        { position: [-1, 0, 0], type: "test:last", properties: { facing: "north" }, nbt: { items: [1] } }
    ] });
    t.deepEqual(world.getBlockAt(-1, 0, 0)!.block,
        { type: "test:last", properties: { facing: "north" }, nbt: { items: [1] } });
    t.deepEqual(world.getBlockAt(-1, 0, 0)!.object.state, { facing: "north" });
    t.is(world.getBlockAt(16, 0, 0)!.block.type, "test:neighbor");
    t.is(scene.stats.instanceCount, 2);
});

test.serial("Chunk.placeBlocks clears failed cells and places the remaining cells before rejecting", async t => {
    const { world, scene, loads } = fixture(t);
    const previous = (await world.setBlockAt(0, 0, 0, block))!;
    const chunk = world.getChunkAt(new Vector3())!;
    const get = BlockStates.get, failure = new Error("block asset failed");
    let failedLoads = 0;
    loads.length = 0;
    BlockStates.get = async key => {
        if (key.path === "failure") { failedLoads++; throw failure; }
        return get(key);
    };
    await t.throwsAsync(chunk.placeBlocks([
        { index: 0, block: { type: "test:failure" } },
        { index: 1, block }, { index: 2, block },
        { index: 3, block: { type: "test:failure" } }
    ]), { is: failure });
    t.is(world.getBlockAt(0, 0, 0), undefined);
    t.is(chunk["data"].get(0), undefined);
    t.is(chunk["data"].get(3), undefined);
    t.deepEqual([world.getBlockAt(1, 0, 0)!.block, world.getBlockAt(2, 0, 0)!.block], [block, block]);
    t.is(previous.object.instanceCounter, 0);
    t.is(scene.stats.instanceCount, 2);
    t.is(failedLoads, 1);
    t.deepEqual(loads, ["test:stone"]);
});
