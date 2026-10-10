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
    t.not(data["indices"][0], retainedId);
    t.true(data["palette"].length <= 4);
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

test("intern deduplicates normalized states without assigning cells and reserves zero for air", t => {
    const data = new ChunkData();
    const block = { type: "oak_log", properties: { waterlogged: "false", axis: "y" } };
    const id = data.intern(block);
    t.is(data.intern({ type: "minecraft:oak_log", properties: { axis: "y", waterlogged: "false" } }), id);
    t.is(data["palette"][id]!.references, 0);
    t.false(data["freeIds"].includes(id));
    t.is(data.idAt(0), 0);
    t.is(data.stateAt(0), undefined);
    block.properties.axis = "x";
    const state = data.stateAt(id)!;
    t.deepEqual(state, { type: "minecraft:oak_log", properties: { axis: "y", waterlogged: "false" } });
    t.true(Object.isFrozen(state));
    t.true(Object.isFrozen(state.properties));
    for (const block of [undefined, { type: "air" }, { type: "minecraft:cave_air" }, { type: "void_air" }]) {
        t.is(data.intern(block), 0);
    }
    data.assign(4095, id);
    t.is(data.idAt(4095), id);
    t.deepEqual(data.get(4095), state);
    for (const index of [-1, 4096, 0.5, NaN]) {
        t.throws(() => data.idAt(index), { instanceOf: RangeError });
        t.throws(() => data.assign(index, id), { instanceOf: RangeError });
    }
});

test("assign moves references, reclaims unused states, and replaces cell NBT", t => {
    const data = new ChunkData();
    const chest = data.intern({ type: "chest" });
    const stone = data.intern({ type: "stone" });
    data.assign(0, chest, { count: 1 });
    data.assign(1, chest);
    t.is(data["palette"][chest]!.references, 2);
    data.assign(0, chest, { count: 2 });
    t.is(data["palette"][chest]!.references, 2);
    t.deepEqual(data.get(0)?.nbt, { count: 2 });
    data.assign(0, stone);
    t.is(data.get(0)?.nbt, undefined);
    t.is(data["palette"][chest]!.references, 1);
    t.is(data["palette"][stone]!.references, 1);
    data.assign(1, 0, { count: 3 });
    t.is(data.get(1), undefined);
    t.false(data["nbt"].has(1));
    t.is(data.stateAt(chest), undefined);
    t.false(data["paletteIds"].has(ChunkData.paletteKey({ type: "chest" })));
    t.is(data.intern({ type: "dirt" }), chest);
    t.deepEqual(data.stateAt(stone), { type: "minecraft:stone" });
});

test("fill normalizes palette entries, counts references, validates indices, and clears NBT", t => {
    const data = new ChunkData();
    data.set(0, { type: "chest", nbt: { items: ["stone"] } });
    const palette = [undefined, { type: "cave_air" }, { type: "stone" }, { type: "minecraft:stone" }, { type: "dirt" }];
    const indices = new Uint16Array(4096);
    indices[0] = 2;
    indices[1] = 3;
    indices[2] = 1;
    indices[4095] = 4;
    data.fill(palette, indices);
    const stone = data.idAt(0), dirt = data.idAt(4095);
    t.is(data.idAt(1), stone);
    t.is(data["palette"][stone]!.references, 2);
    t.is(data["palette"][dirt]!.references, 1);
    t.is(data.idAt(2), 0);
    t.is(data.idAt(3), 0);
    t.deepEqual(data.get(0), { type: "minecraft:stone" });
    t.deepEqual(data.get(4095), { type: "minecraft:dirt" });
    t.is(data["nbt"].size, 0);
    data.assign(0, 0);
    t.is(data["palette"][stone]!.references, 1);
    data.assign(1, 0);
    t.is(data.stateAt(stone), undefined);
    const invalid = new Uint16Array(4096);
    invalid[4095] = palette.length;
    for (const indices of [new Uint16Array(4095), new Uint16Array(4097), invalid]) {
        t.throws(() => data.fill(palette, indices), {
            instanceOf: RangeError, message: "Section fill needs 4096 valid palette indices"
        });
    }
});

test("copyFrom makes independent cells, frozen palette entries, reference counts, and NBT", t => {
    const source = new ChunkData();
    source.set(0, { type: "chest", properties: { facing: "north" }, nbt: { items: [{ count: 2 }], bytes: new Uint8Array([3]) } });
    source.set(1, { type: "stone" });
    source.set(1, undefined);
    source.intern({ type: "dirt" });
    source.set(2, { type: "sand" });
    source.set(2, undefined);
    const expected = source.get(0);
    const copy = new ChunkData();
    copy.set(4, { type: "stone", nbt: { count: 1 } });
    copy.copyFrom(source);
    const id = source.idAt(0);
    t.deepEqual(copy.get(0), expected);
    t.is(copy.get(4), undefined);
    t.not(copy.stateAt(id), source.stateAt(id));
    t.not(copy.stateAt(id)?.properties, source.stateAt(id)?.properties);
    t.true(Object.isFrozen(copy.stateAt(id)));
    t.true(Object.isFrozen(copy.stateAt(id)?.properties));
    t.deepEqual(copy["palette"], source["palette"]);
    t.deepEqual(copy["paletteIds"], source["paletteIds"]);
    t.deepEqual(copy["freeIds"], source["freeIds"]);
    (source["nbt"].get(0) as { items: { count: number }[] }).items[0].count = 9;
    t.deepEqual(copy.get(0), expected);
    copy.assign(0, 0);
    t.is(copy.stateAt(id), undefined);
    t.deepEqual(source.stateAt(id), { type: "minecraft:chest", properties: { facing: "north" } });
    copy.set(3, { type: "gravel" });
    t.is(source.get(3), undefined);
    source.copyFrom(source);
    t.is(source.get(0)?.nbt.items[0].count, 9);
});
