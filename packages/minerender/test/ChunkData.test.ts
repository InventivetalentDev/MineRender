import test from "ava";
import { ChunkData } from "../src/world/ChunkData";

test("section cells share canonical states regardless of property order and reserve zero for air", t => {
    const data = new ChunkData();
    const indices = data["indices"];
    t.true(indices instanceof Uint16Array);
    t.is(indices.length, 4096);
    t.is(indices.byteLength, 8192);
    data.set(0, { type: "oak_log", properties: { axis: "y", waterlogged: "false" } });
    data.set(1, { type: "minecraft:oak_log", properties: { waterlogged: "false", axis: "y" } });
    data.set(2, { type: "oak_log", properties: { axis: "x", waterlogged: "false" } });
    data.set(3, { type: "stone" });
    data.set(4, { type: "minecraft:stone", properties: {} });
    t.not(indices[0], 0);
    t.is(indices[0], indices[1]);
    t.not(indices[0], indices[2]);
    t.is(indices[3], indices[4]);
    t.deepEqual(data.get(0), { type: "minecraft:oak_log", properties: { axis: "y", waterlogged: "false" } });
    for (const type of ["air", "minecraft:cave_air", "void_air"]) {
        data.set(0, { type });
        t.is(indices[0], 0);
        t.is(data.get(0), undefined);
    }
    data.set(0, { type: "custom:air" });
    t.not(indices[0], 0);
    t.deepEqual(data.get(0), { type: "custom:air" });
    t.deepEqual(data.get(1)?.properties, { axis: "y", waterlogged: "false" });
});

test("state and NBT snapshots are detached and survive palette reuse or clearing", t => {
    const data = new ChunkData();
    const input = { type: "chest", properties: { facing: "north" }, nbt: { items: [{ id: "stone", count: 2 }], bytes: new Uint8Array([3, 4]) } };
    data.set(0, input);
    data.set(1, { ...input, nbt: { items: [{ id: "dirt", count: 5 }], bytes: new Uint8Array([6, 7]) } });
    t.is(data["indices"][0], data["indices"][1]);
    const snapshot = data.snapshot(0)!;
    input.properties.facing = "south";
    input.nbt.items[0].count = 99;
    input.nbt.bytes[0] = 99;
    const read = data.get(0)!;
    read.properties!.facing = "west";
    read.nbt.items[0].count = 88;
    read.nbt.bytes[0] = 88;
    const expected = { type: "minecraft:chest", properties: { facing: "north" }, nbt: { items: [{ id: "stone", count: 2 }], bytes: new Uint8Array([3, 4]) } };
    t.deepEqual(data.get(0), expected);
    t.deepEqual(data.get(1), { type: "minecraft:chest", properties: { facing: "north" }, nbt: { items: [{ id: "dirt", count: 5 }], bytes: new Uint8Array([6, 7]) } });
    data.clear();
    data.set(0, { type: "dirt" });
    t.deepEqual(snapshot(), expected);
    snapshot().nbt.bytes[0] = 77;
    t.deepEqual(snapshot(), expected);
    t.is(data.snapshot(1), undefined);
    for (const nbt of [false, 0, null]) {
        data.set(2, { type: "stone", nbt });
        t.deepEqual(data.get(2), { type: "minecraft:stone", nbt });
    }
    const previous = data.get(2);
    t.throws(() => data.set(2, { type: "dirt", nbt: () => {} }), { name: "DataCloneError" });
    t.deepEqual(data.get(2), previous);
});

test("freed palette entries are reused through repeated replacements without changing live cells", t => {
    const data = new ChunkData();
    data.set(0, { type: "test:first" });
    data.set(1, { type: "test:retained" });
    const releasedId = data["indices"][0], retainedId = data["indices"][1];
    data.set(0, undefined);
    data.set(2, { type: "test:replacement" });
    t.is(data["indices"][2], releasedId);
    data.set(2, undefined);
    for (let i = 0; i < 65540; i++) data.set(0, { type: `test:state_${i}` });
    t.deepEqual(data.get(0), { type: "test:state_65539" });
    t.deepEqual(data.get(1), { type: "test:retained" });
    t.is(data["indices"][1], retainedId);
    t.is(data["indices"][0], releasedId);
    t.true(data["palette"].length <= 3);
});

test("a full section stores distinct states, rejects invalid indices and resets cleanly", t => {
    const data = new ChunkData();
    for (let i = 0; i < 4096; i++) data.set(i, { type: `test:block_${i}` });
    t.is(new Set(data["indices"]).size, 4096);
    t.false(data["indices"].includes(0));
    t.deepEqual(data.get(0), { type: "test:block_0" });
    t.deepEqual(data.get(4095), { type: "test:block_4095" });
    for (const index of [-1, 4096, 0.5, NaN]) {
        t.throws(() => data.get(index), { instanceOf: RangeError });
        t.throws(() => data.set(index, undefined), { instanceOf: RangeError });
    }
    data.clear();
    t.true(data["indices"].every(id => id === 0));
    t.is(data.get(4095), undefined);
    data.set(4095, { type: "stone" });
    t.deepEqual(data.get(4095), { type: "minecraft:stone" });
    t.true(data["palette"].length <= 2);
});
