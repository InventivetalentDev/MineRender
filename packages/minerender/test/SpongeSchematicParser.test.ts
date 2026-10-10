import test from "ava";
import { gzipSync } from "node:zlib";
import { writeUncompressed } from "prismarine-nbt";
import type { Compound, NBT } from "prismarine-nbt";
import { NBTHelper } from "../src/nbt/NBTHelper";
import { SpongeSchematicParser } from "../src/model/multiblock/SpongeSchematicParser";

type Tags = Compound["value"];
const int = (value: number) => ({ type: "int" as const, value });
const string = (value: string) => ({ type: "string" as const, value });
const compound = (value: Tags): Compound => ({ type: "compound", value });
const list = (value: Tags[]) => ({ type: "list" as const, value: { type: "compound" as const, value } });
const position = (value: number[]) => ({ type: "intArray" as const, value });
const entityPosition = (value: number[]) => ({ type: "list" as const, value: { type: "double" as const, value } });

function schematic(version: 2 | 3, options: {
    size?: number[]; palette?: Record<string, number>; data?: number[]; offset?: number[];
} = {}): NBT {
    const blocks: Tags = {
        Palette: compound(Object.fromEntries(Object.entries(options.palette ?? { "minecraft:stone": 0 })
            .map(([name, index]) => [name, int(index)]))),
        [version === 2 ? "BlockData" : "Data"]: { type: "byteArray", value: options.data ?? [0] }
    };
    const [width, height, length] = options.size ?? [1, 1, 1];
    const short = (value: number) => ({ type: "short" as const, value: value > 32767 ? value - 65536 : value });
    const value: Tags = {
        Version: int(version), DataVersion: int(4671),
        Width: short(width), Height: short(height), Length: short(length),
        ...(options.offset ? { Offset: position(options.offset) } : {}),
        ...(version === 2 ? blocks : { Blocks: compound(blocks) })
    };
    return { type: "compound", name: version === 2 ? "Schematic" : "", value: version === 2 ? value : { Schematic: compound(value) } };
}

function tags(input: NBT): Tags {
    return input.value.Schematic?.type === "compound" ? input.value.Schematic.value : input.value;
}

function blocks(input: NBT): Tags {
    const root = tags(input);
    return root.Blocks?.type === "compound" ? root.Blocks.value : root;
}

test("Sponge v2 and v3 gzip files decode sparse varints, states and offsets in x/z/y order", async t => {
    for (const version of [2, 3] as const) {
        const input = schematic(version, {
            size: [2, 2, 2], offset: [-3, 5, 7],
            palette: {
                "minecraft:air": 0, "minecraft:cave_air": 1, "minecraft:void_air": 2,
                stone: 3, "minecraft:oak_log[axis=x]": 4,
                "example:machine[active=true,facing=east]": 5, "minecraft:chest[facing=north]": 129
            },
            data: [0, -127, 1, 1, 2, 3, 4, -127, 1, 5]
        });
        const decoded = await NBTHelper.fromBuffer(gzipSync(writeUncompressed(input)));
        const parsed = await SpongeSchematicParser.parse(decoded);
        t.is(decoded.compression, "gzip");
        t.is(parsed.dataVersion, 4671);
        t.deepEqual(parsed.size, [2, 2, 2]);
        t.deepEqual(parsed.blocks.map(({ type, properties, position }) => ({ type, properties, position })), [
            { type: "minecraft:chest", properties: { facing: "north" }, position: [-2, 5, 7] },
            { type: "minecraft:stone", properties: {}, position: [-3, 6, 7] },
            { type: "minecraft:oak_log", properties: { axis: "x" }, position: [-2, 6, 7] },
            { type: "minecraft:chest", properties: { facing: "north" }, position: [-3, 6, 8] },
            { type: "example:machine", properties: { active: "true", facing: "east" }, position: [-2, 6, 8] }
        ]);
        parsed.blocks[0].properties!.facing = "south";
        t.is(parsed.blocks[3].properties!.facing, "north");
    }
});

test("Sponge entity payloads become vanilla NBT with offset coordinates without changing the source", async t => {
    const inventory = { Items: list([{ id: string("minecraft:diamond"), count: int(3), Slot: { type: "byte" as const, value: 0 } }]) };
    const entityData = { CustomName: string("fixture"), Invisible: { type: "byte" as const, value: 1 } };
    for (const version of [2, 3] as const) {
        const input = schematic(version, { size: [2, 1, 1], data: [0, 1], offset: [-2, 3, 4],
            palette: { "minecraft:air": 0, "minecraft:chest": 1 } });
        blocks(input).BlockEntities = list([{
            Id: string("chest"), Pos: position([1, 0, 0]),
            ...(version === 2 ? inventory : { Data: compound(inventory) })
        }]);
        tags(input).Entities = list([{
            Id: string("minecraft:armor_stand"), Pos: entityPosition([1.5, 0, 0.5]),
            ...(version === 2 ? entityData : { Data: compound(entityData) })
        }]);
        const before = structuredClone(input);
        const parsed = await SpongeSchematicParser.parse(input);
        t.deepEqual(parsed.blocks[0].position, [-1, 3, 4]);
        t.deepEqual(parsed.blocks[0].nbt, compound({ ...inventory, id: string("minecraft:chest"), x: int(-1), y: int(3), z: int(4) }));
        t.deepEqual(parsed.entities, [{
            position: [-0.5, 3, 4.5],
            nbt: compound({ ...entityData, id: string("minecraft:armor_stand"), Pos: entityPosition([-0.5, 3, 4.5]) })
        }]);
        t.deepEqual(input, before);
    }
});

test("Sponge accepts direct and wrapped roots and defaults the offset to zero", async t => {
    for (const version of [2, 3] as const) {
        const original = schematic(version);
        for (const value of [tags(original), { Schematic: compound(tags(original)) }]) {
            const parsed = await SpongeSchematicParser.parse({ type: "compound", name: "", value });
            t.deepEqual(parsed.blocks[0].position, [0, 0, 0]);
        }
    }
});

test("Sponge dimensions use unsigned NBT shorts and v3 permits entity-only schematics", async t => {
    const input = schematic(2, { size: [32768, 1, 1],
        palette: { "minecraft:air": 0, "minecraft:stone": 1 }, data: [...Array<number>(32767).fill(0), 1] });
    const parsed = await SpongeSchematicParser.parse(await NBTHelper.fromBuffer(gzipSync(writeUncompressed(input))));
    t.deepEqual(parsed.size, [32768, 1, 1]);
    t.deepEqual(parsed.blocks.map(block => block.position), [[32767, 0, 0]]);
    const entitiesOnly = schematic(3);
    delete tags(entitiesOnly).Blocks;
    tags(entitiesOnly).Entities = list([{ Id: string("minecraft:pig"), Pos: entityPosition([0.5, 0, 0.5]) }]);
    const result = await SpongeSchematicParser.parse(entitiesOnly);
    t.deepEqual(result.blocks, []);
    t.deepEqual(result.entities?.[0].nbt, compound({ id: string("minecraft:pig"), Pos: entityPosition([0.5, 0, 0.5]) }));
});

test("Sponge rejects unsupported versions and malformed dimensions, offsets and DataVersion", async t => {
    const invalid: Tags[] = [
        { Version: int(1) }, { Version: int(4) }, { Version: string("3") },
        { Width: { type: "short", value: 0 } }, { Height: int(1) }, { Length: { type: "short", value: 65536 } },
        { Offset: position([0, 1]) }, { Offset: entityPosition([0, 0, 0]) },
        { DataVersion: string("4671") }
    ];
    for (const fields of invalid) {
        const input = schematic(3);
        Object.assign(tags(input), fields);
        await t.throwsAsync(SpongeSchematicParser.parse(input), { name: "MineRenderError" });
    }
    const input = schematic(2);
    delete tags(input).DataVersion;
    await t.throwsAsync(SpongeSchematicParser.parse(input), { name: "MineRenderError" });
});

test("Sponge validates local palettes, indices and block state syntax", async t => {
    for (const palette of [
        { "minecraft:stone": -1 }, { "minecraft:stone": 2147483648 },
        { "minecraft:stone": 0, "minecraft:dirt": 0 }, { "minecraft:oak_log[axis]": 0 },
        { "minecraft:oak_log[axis=x,axis=y]": 0 }
    ]) {
        await t.throwsAsync(SpongeSchematicParser.parse(schematic(3, { palette })), { name: "MineRenderError" });
    }
    for (const version of [2, 3] as const) {
        const input = schematic(version);
        delete blocks(input).Palette;
        await t.throwsAsync(SpongeSchematicParser.parse(input), { name: "MineRenderError" });
    }
    const bounded = schematic(2, { palette: { "minecraft:stone": 129 }, data: [-127, 1] });
    tags(bounded).PaletteMax = int(130);
    t.is((await SpongeSchematicParser.parse(bounded)).blocks[0].type, "minecraft:stone");
    tags(bounded).PaletteMax = int(129);
    await t.throwsAsync(SpongeSchematicParser.parse(bounded), { name: "MineRenderError" });
});

test("Sponge rejects truncated, overflowing, missing, extra and unmapped block varints", async t => {
    for (const version of [2, 3] as const) {
        for (const data of [[], [-128], [-128, -128, -128, -128, -128, 0], [-128, -128, -128, -128, 8], [0, 0], [1], [256]]) {
            await t.throwsAsync(SpongeSchematicParser.parse(schematic(version, { data })), { name: "MineRenderError" });
        }
    }
});

test("Sponge validates entity positions, IDs and v3 payload compounds", async t => {
    for (const version of [2, 3] as const) {
        for (const entry of [
            { Id: string("minecraft:chest"), Pos: position([1, 0, 0]) },
            { Id: string("minecraft:chest"), Pos: position([0, 0]) },
            { Pos: position([0, 0, 0]) }
        ]) {
            const input = schematic(version);
            blocks(input).BlockEntities = list([entry]);
            await t.throwsAsync(SpongeSchematicParser.parse(input), { name: "MineRenderError" });
        }
        for (const entry of [
            { Id: string("minecraft:pig"), Pos: entityPosition([0, Infinity, 0]) },
            { Id: string("minecraft:pig"), Pos: position([0, 0, 0]) },
            { Pos: entityPosition([0, 0, 0]) }
        ]) {
            const input = schematic(version);
            tags(input).Entities = list([entry]);
            await t.throwsAsync(SpongeSchematicParser.parse(input), { name: "MineRenderError" });
        }
    }
    const input = schematic(3);
    blocks(input).BlockEntities = list([{ Id: string("minecraft:chest"), Pos: position([0, 0, 0]), Data: int(1) }]);
    await t.throwsAsync(SpongeSchematicParser.parse(input), { name: "MineRenderError" });
});
