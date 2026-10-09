import test from "ava";
import { gzipSync } from "node:zlib";
import { writeUncompressed } from "prismarine-nbt";
import type { Compound, NBT } from "prismarine-nbt";
import { NBTHelper } from "../src/nbt/NBTHelper";
import { LitematicaParser } from "../src/model/multiblock/LitematicaParser";

type Tags = Compound["value"];
const int = (value: number) => ({ type: "int" as const, value });
const string = (value: string) => ({ type: "string" as const, value });
const compound = (value: Tags): Compound => ({ type: "compound", value });
const list = (value: Tags[]) => ({ type: "list" as const, value: { type: "compound" as const, value } });
const position = ([x, y, z]: number[]) => compound({ x: int(x), y: int(y), z: int(z) });
const entityPosition = (value: number[]) => ({ type: "list" as const, value: { type: "double" as const, value } });
const longs = (words: bigint[]) => ({ type: "longArray" as const, value: words.map(word => [
    Number(BigInt.asIntN(32, word >> 32n)), Number(BigInt.asIntN(32, word))
] as [number, number]) });

function region(options: { size?: number[]; pos?: number[]; palette?: Tags[]; words?: bigint[] } = {}): Compound {
    return compound({
        Position: position(options.pos ?? [0, 0, 0]), Size: position(options.size ?? [1, 1, 1]),
        BlockStatePalette: list(options.palette ?? [{ Name: string("minecraft:air") }, { Name: string("minecraft:stone") }]),
        BlockStates: longs(options.words ?? [1n]), TileEntities: list([]), Entities: list([])
    });
}

function schematic(regions: Tags = { Main: region() }, version = 7): NBT {
    return { type: "compound", name: "", value: {
        Version: int(version), SubVersion: int(1), MinecraftDataVersion: int(4671), Regions: compound(regions)
    } };
}

test("Litematica v5–7 decode gzip palettes across signed long boundaries in x/z/y order", async t => {
    const palette = Array.from({ length: 26 }, (_, index): Tags => ({
        Name: string(index ? `example:block_${index}` : "minecraft:air"),
        ...(index === 7 ? { Properties: compound({ axis: string("x") }) } : {})
    }));
    for (const version of [5, 6, 7]) {
        const input = schematic({ Main: region({ size: [13, 2, 2], palette,
            words: [1n | (7n << 5n) | (9n << 60n), 15n, 2n | (1n << 7n), 0n, 0n] }) }, version);
        const decoded = await NBTHelper.fromBuffer(gzipSync(writeUncompressed(input)));
        const parsed = await LitematicaParser.parse(decoded);
        t.is(decoded.compression, "gzip");
        t.is(parsed.dataVersion, 4671);
        t.deepEqual(parsed.size, [13, 2, 2]);
        t.deepEqual(parsed.blocks.map(({ type, position }) => ({ type, position })), [
            { type: "example:block_1", position: [0, 0, 0] },
            { type: "example:block_7", position: [1, 0, 0] },
            { type: "example:block_25", position: [12, 0, 0] },
            { type: "example:block_7", position: [0, 0, 1] },
            { type: "example:block_16", position: [12, 0, 1] },
            { type: "example:block_1", position: [1, 1, 0] }
        ]);
        t.deepEqual(parsed.blocks[1].properties, { axis: "x" });
        parsed.blocks[1].properties!.axis = "z";
        t.is(parsed.blocks[3].properties!.axis, "x");
    }
});

test("Litematica preserves named signed regions and computes bounds from complete region boxes", async t => {
    const parsed = await LitematicaParser.parse(schematic({
        West: region({ size: [-2, -2, -2], pos: [-3, 5, 7], words: [1n | (1n << 14n)] }),
        East: region({ size: [2, 1, 3], pos: [8, 0, -2], words: [0n] })
    }));
    t.deepEqual(parsed.size, [14, 6, 10]);
    t.deepEqual(parsed.blocks.map(block => block.position), [[-4, 4, 6], [-3, 5, 7]]);
    t.deepEqual(parsed.regions.map(({ name, position, signedSize, size, dataVersion }) => ({ name, position, signedSize, size, dataVersion })), [
        { name: "West", position: [-3, 5, 7], signedSize: [-2, -2, -2], size: [2, 2, 2], dataVersion: 4671 },
        { name: "East", position: [8, 0, -2], signedSize: [2, 1, 3], size: [2, 1, 3], dataVersion: 4671 }
    ]);
    t.deepEqual(parsed.regions[0].blocks.map(block => block.position), [[-4, 4, 6], [-3, 5, 7]]);
    t.deepEqual(parsed.regions[1].blocks, []);
});

test("Litematica places block entities from the minimum corner and entities from the region anchor", async t => {
    const area = region({ size: [-2, -2, -2], pos: [10, 20, 30], words: [1n << 14n],
        palette: [{ Name: string("minecraft:air") }, { Name: string("minecraft:chest"), Properties: compound({ facing: string("north") }) }] });
    const tile = { id: string("minecraft:chest"), x: int(1), y: int(1), z: int(1),
        Items: list([{ id: string("minecraft:diamond"), count: int(3) }]) };
    const entity = { id: string("minecraft:armor_stand"), Pos: entityPosition([-0.5, -1, -0.5]), CustomName: string("fixture") };
    area.value.TileEntities = list([tile]);
    area.value.Entities = list([entity]);
    const input = schematic({ Reverse: area });
    const before = structuredClone(input);
    const parsed = await LitematicaParser.parse(input);
    t.deepEqual(parsed.blocks[0].position, [10, 20, 30]);
    t.deepEqual(parsed.blocks[0].nbt, compound({ ...tile, x: int(10), y: int(20), z: int(30) }));
    t.deepEqual(parsed.entities, [{ position: [9.5, 19, 29.5],
        nbt: compound({ ...entity, Pos: entityPosition([9.5, 19, 29.5]) }) }]);
    t.deepEqual(parsed.regions[0].entities, parsed.entities);
    t.deepEqual(input, before);
});

test("Litematica resolves overlaps in returned region order, including air replacement", async t => {
    const parsed = await LitematicaParser.parse(schematic({
        Base: region({ size: [3, 1, 1], words: [21n] }),
        Overlay: region({ size: [3, 1, 1], pos: [1, 0, 0], words: [36n], palette: [
            { Name: string("minecraft:cave_air") }, { Name: string("minecraft:gold_block") }, { Name: string("minecraft:void_air") }
        ] })
    }));
    t.deepEqual(parsed.blocks.map(({ type, position }) => ({ type, position })), [
        { type: "minecraft:stone", position: [0, 0, 0] },
        { type: "minecraft:gold_block", position: [2, 0, 0] }
    ]);
    t.is(parsed.regions[0].blocks.length, 3);
    t.is(parsed.regions[1].blocks.length, 1);
});

test("Litematica accepts absent data versions, empty regions and empty end-tag lists", async t => {
    const input = schematic({ Main: region({ palette: [{ Name: string("minecraft:stone") }], words: [0n] }) }, 5);
    delete input.value.MinecraftDataVersion;
    const main = (input.value.Regions as Compound).value.Main as Compound;
    main.value.Entities = { type: "list", value: { type: "end", value: [] } };
    main.value.TileEntities = { type: "list", value: { type: "end", value: [] } };
    const parsed = await LitematicaParser.parse(input);
    t.is(parsed.dataVersion, undefined);
    t.is(parsed.regions[0].dataVersion, undefined);
    t.deepEqual(parsed.entities, []);
    t.is(parsed.blocks[0].type, "minecraft:stone");
    const empty = await LitematicaParser.parse(schematic({}));
    t.deepEqual({ size: empty.size, blocks: empty.blocks, entities: empty.entities, regions: empty.regions },
        { size: [0, 0, 0], blocks: [], entities: [], regions: [] });
});

test("Litematica rejects unsupported versions, malformed regions and zero or overflowing dimensions", async t => {
    for (const fields of [
        { Version: int(4) }, { Version: int(8) }, { Version: string("7") },
        { MinecraftDataVersion: string("4671") }, { Regions: int(1) }, { Regions: compound({ Main: int(1) }) }
    ]) {
        const input = schematic();
        Object.assign(input.value, fields);
        await t.throwsAsync(LitematicaParser.parse(input), { name: "MineRenderError" });
    }
    for (const fields of [
        { Size: position([0, 1, 1]) }, { Size: position([2147483648, 1, 1]) },
        { Size: position([2147483647, 2147483647, 2147483647]) },
        { Position: position([0, 0.5, 0]) }, { Position: compound({ x: int(0), y: int(0) }) }
    ]) {
        const main = region();
        Object.assign(main.value, fields);
        await t.throwsAsync(LitematicaParser.parse(schematic({ Main: main })), { name: "MineRenderError" });
    }
});

test("Litematica rejects missing, truncated, extra, malformed and unmapped packed block data", async t => {
    for (const fields of [
        { BlockStates: longs([]) }, { BlockStates: longs([1n, 0n]) }, { BlockStates: longs([2n]) },
        { BlockStates: { type: "longArray" as const, value: [[0, 1.5] as [number, number]] } },
        { BlockStates: { type: "longArray" as const, value: [[4294967296, 0] as [number, number]] } },
        { BlockStates: { type: "byteArray" as const, value: [1] } }
    ]) {
        const main = region();
        Object.assign(main.value, fields);
        await t.throwsAsync(LitematicaParser.parse(schematic({ Main: main })), { name: "MineRenderError" });
    }
    const missing = region();
    delete missing.value.BlockStates;
    await t.throwsAsync(LitematicaParser.parse(schematic({ Main: missing })), { name: "MineRenderError" });
});

test("Litematica validates palette states and entity records", async t => {
    for (const palette of [[], [{}], [{ Name: int(1) }], [{ Name: string("bad name") }],
        [{ Name: string("minecraft:stone"), Properties: compound({ axis: int(1) }) }]]) {
        await t.throwsAsync(LitematicaParser.parse(schematic({ Main: region({ palette, words: [0n] }) })), { name: "MineRenderError" });
    }
    for (const tile of [
        { id: string("minecraft:chest"), x: int(1), y: int(0), z: int(0) },
        { id: string("minecraft:chest"), x: int(0), y: int(0) }
    ]) {
        const main = region();
        main.value.TileEntities = list([tile]);
        await t.throwsAsync(LitematicaParser.parse(schematic({ Main: main })), { name: "MineRenderError" });
    }
    for (const entity of [
        { id: string("minecraft:pig"), Pos: entityPosition([0, Infinity, 0]) },
        { id: string("minecraft:pig"), Pos: entityPosition([0, 0]) }
    ]) {
        const main = region();
        main.value.Entities = list([entity]);
        await t.throwsAsync(LitematicaParser.parse(schematic({ Main: main })), { name: "MineRenderError" });
    }
});
