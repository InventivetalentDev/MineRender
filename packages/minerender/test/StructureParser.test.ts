import test from "ava";
import { gzipSync } from "node:zlib";
import { comp, int, list, string, writeUncompressed } from "prismarine-nbt";
import type { NBT } from "prismarine-nbt";
import { NBTHelper } from "../src/nbt/NBTHelper";
import { StructureParser } from "../src/model/multiblock/StructureParser";

const palette = (name: string) => list(comp([{ Name: string(name), Properties: comp({ axis: string("x") }) }]));
function fixture(): NBT {
    return comp({
        DataVersion: int(4671),
        size: list(int([2, 1, 1])),
        palette: palette("minecraft:oak_log"),
        blocks: list(comp([{ pos: list(int([1, 0, 0])), state: int(0), nbt: comp({ id: string("test:block") }) }])),
        entities: {
            type: "list", value: { type: "compound", value: [{
                pos: { type: "list", value: { type: "double", value: [1.5, 0, 0.5] } },
                blockPos: list(int([1, 0, 0])),
                nbt: comp({ id: string("minecraft:pig") })
            }] }
        }
    }, "") as NBT;
}

test("NBT loading retains endian, compression and byte metadata without changing the root tag", async t => {
    for (const format of ["big", "little"] as const) {
        const raw = writeUncompressed(fixture(), format);
        for (const compressed of [false, true]) {
            const input = compressed ? gzipSync(raw) : raw;
            const storage = new Uint8Array(input.length + 8);
            storage.set(input, 3);
            const result = await NBTHelper.fromBuffer(storage.subarray(3, 3 + input.length), format);
            t.is(result.type, "compound");
            t.is(result.format, format);
            t.is(result.compression, compressed ? "gzip" : "none");
            t.is(result.metadata!.size, raw.length);
            t.deepEqual([...result.metadata!.buffer], [...raw]);
            t.deepEqual([...writeUncompressed(result, format)], [...raw]);
        }
    }
});

test("structure parsing preserves block/entity NBT, positions and DataVersion", async t => {
    const nbt = await NBTHelper.fromBuffer(gzipSync(writeUncompressed(fixture())));
    const structure = await StructureParser.parse(nbt);
    t.is(structure.dataVersion, 4671);
    t.deepEqual(structure.size, [2, 1, 1]);
    t.deepEqual(structure.blocks, [{
        type: "minecraft:oak_log", properties: { axis: "x" }, position: [1, 0, 0],
        nbt: { type: "compound", value: { id: string("test:block") } }
    }]);
    t.deepEqual(structure.entities, [{
        position: [1.5, 0, 0.5], blockPosition: [1, 0, 0], nbt: { type: "compound", value: { id: string("minecraft:pig") } }
    }]);
});

test("structure palettes use the selected nested NBT list and reject missing entries", async t => {
    const nbt = fixture();
    delete nbt.value.palette;
    nbt.value.palettes = { type: "list", value: { type: "list", value: [palette("minecraft:stone").value, palette("minecraft:dirt").value] } } as NBT["value"][string];
    t.is((await StructureParser.parse(nbt)).blocks[0].type, "minecraft:stone");
    t.is((await StructureParser.parse(nbt, 1)).blocks[0].type, "minecraft:dirt");
    await t.throwsAsync(StructureParser.parse(nbt, 2), { message: /palette 2 does not exist/ });
    nbt.value.blocks = list(comp([{ pos: list(int([0, 0, 0])), state: int(1) }])) as NBT["value"][string];
    await t.throwsAsync(StructureParser.parse(nbt), { message: /palette index 1 does not exist/ });
});
