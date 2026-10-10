import test from "ava";
import { parseUncompressed, writeUncompressed } from "prismarine-nbt";
import type { Compound, NBT } from "prismarine-nbt";
import { SchematicParser } from "../src/model/multiblock/SchematicParser";
import { MineRenderData } from "../src/assets/MineRenderData";
import { AssetLoader } from "../src/assets/AssetLoader";
import { installMineRenderDataFixtures } from "./helpers/minerender-data";

let restoreData: () => void;
test.before(() => { restoreData = installMineRenderDataFixtures(); });
test.after.always(() => restoreData());

function schematic(blocks: number[], data = blocks.map(() => 0), size = [blocks.length, 1, 1]): NBT {
    return {
        type: "compound", name: "Schematic", value: {
            Materials: { type: "string", value: "Alpha" },
            Width: { type: "short", value: size[0] },
            Height: { type: "short", value: size[1] },
            Length: { type: "short", value: size[2] },
            Blocks: { type: "byteArray", value: blocks },
            Data: { type: "byteArray", value: data }
        }
    };
}

test("legacy IDs and metadata become modern block states in x/z/y order", async t => {
    const input = schematic(
        [1, 0, 17, 35, 54, -1, 31, -48, 63, 68, 118, 118],
        [0, 0, 4, 14, 2, 0, 1, 0, 3, 5, 0, 2],
        [2, 2, 3]
    );
    const parsed = await SchematicParser.parse(parseUncompressed(writeUncompressed(input)));
    t.deepEqual(parsed.size, [2, 2, 3]);
    t.deepEqual(parsed.blocks.map(({ type, properties, position }) => ({ type, properties, position })), [
        { type: "minecraft:stone", properties: {}, position: [0, 0, 0] },
        { type: "minecraft:oak_log", properties: { axis: "x" }, position: [0, 0, 1] },
        { type: "minecraft:red_wool", properties: {}, position: [1, 0, 1] },
        { type: "minecraft:chest", properties: { facing: "north", type: "single" }, position: [0, 0, 2] },
        { type: "minecraft:structure_block", properties: { mode: "save" }, position: [1, 0, 2] },
        { type: "minecraft:short_grass", properties: {}, position: [0, 1, 0] },
        { type: "minecraft:dirt_path", properties: {}, position: [1, 1, 0] },
        { type: "minecraft:oak_sign", properties: { rotation: "3" }, position: [0, 1, 1] },
        { type: "minecraft:oak_wall_sign", properties: { facing: "east" }, position: [1, 1, 1] },
        { type: "minecraft:cauldron", properties: {}, position: [0, 1, 2] },
        { type: "minecraft:water_cauldron", properties: { level: "2" }, position: [1, 1, 2] }
    ]);
});

test.serial("legacy schematics preserve active asset sources and explicit mapping roots", async t => {
    const originalRoot = AssetLoader.ROOT;
    AssetLoader.ROOT = "https://assets.example/1.21.11";
    t.teardown(() => { AssetLoader.ROOT = originalRoot; });
    t.teardown(installMineRenderDataFixtures(root => ({ legacyBlocks: { blocks: {
        "31:1": root.endsWith("/1.16.5") ? "minecraft:grass" : "minecraft:short_grass"
    } } })));
    const get = MineRenderData.get, roots: (string | undefined)[] = [];
    MineRenderData.get = (dataset, root) => { roots.push(root); return get(dataset, root); };
    await SchematicParser.parse(schematic([31], [1]));
    for (const [version, name] of [["1.16.5", "grass"], ["1.21.11", "short_grass"]]) {
        const parsed = await SchematicParser.parse(schematic([31], [1]), {}, { root: `https://assets.example/${version}` });
        t.is(parsed.blocks[0].type, `minecraft:${name}`);
    }
    t.deepEqual(roots, [undefined, "https://assets.example/1.16.5", "https://assets.example/1.21.11"]);
});

test("schematics retain tile entities, free entities and DataVersion without changing their NBT", async t => {
    const input = schematic([0, 54], [0, 2]);
    const chest: Compound["value"] = {
        id: { type: "string", value: "Chest" },
        x: { type: "int", value: 1 }, y: { type: "int", value: 0 }, z: { type: "int", value: 0 },
        Items: { type: "list", value: { type: "compound", value: [{
            id: { type: "short", value: 264 }, Count: { type: "byte", value: 3 }, Slot: { type: "byte", value: 0 }
        }] } }
    };
    const entity: Compound["value"] = {
        id: { type: "string", value: "ArmorStand" },
        Pos: { type: "list", value: { type: "double", value: [0.5, 1, 0.75] } },
        Invisible: { type: "byte", value: 1 }
    };
    input.value.TileEntities = { type: "list", value: { type: "compound", value: [chest] } };
    input.value.Entities = { type: "list", value: { type: "compound", value: [entity] } };
    input.value.DataVersion = { type: "int", value: 1343 };
    const before = structuredClone(input);
    const parsed = await SchematicParser.parse(input);
    t.is(parsed.dataVersion, 1343);
    t.deepEqual(parsed.blocks[0].nbt, { type: "compound", value: chest });
    t.deepEqual(parsed.entities, [{ position: [0.5, 1, 0.75], nbt: { type: "compound", value: entity } }]);
    t.deepEqual(input, before);
});

test("custom mappings extend and override defaults for one parse, including AddBlocks IDs", async t => {
    const input = schematic([1, 1, 1, 35, 35], [3, 0, 1, 14, 1]);
    input.value.AddBlocks = { type: "byteArray", value: [0x02] };
    const mappings = Object.freeze({
        "513:3": "example:custom_block[facing=east,active=true]",
        "1:0": "minecraft:diamond_block",
        "35:1": "minecraft:air"
    });
    const parsed = await SchematicParser.parse(input, mappings);
    t.deepEqual(parsed.blocks.map(({ type, properties }) => ({ type, properties })), [
        { type: "example:custom_block", properties: { facing: "east", active: "true" } },
        { type: "minecraft:diamond_block", properties: {} },
        { type: "minecraft:granite", properties: {} },
        { type: "minecraft:red_wool", properties: {} }
    ]);
    t.is((await SchematicParser.parse(schematic([1]))).blocks[0].type, "minecraft:stone");
    await t.throwsAsync(SchematicParser.parse(input), { message: /Unsupported legacy block 513:3/ });
});

test("AddBlocks uses the low nibble for even cells and the high nibble for odd cells", async t => {
    for (const [extra, expected] of [[0x02, 513], [0x30, 803], [-16, 3875]]) {
        const input = schematic([1, 35], [0, 14]);
        input.value.AddBlocks = { type: "byteArray", value: [extra] };
        await t.throwsAsync(SchematicParser.parse(input), { message: new RegExp(`Unsupported legacy block ${expected}:`) });
    }
    const input = schematic([1, 35, 1], [0, 14, 1]);
    input.value.AddBlocks = { type: "byteArray", value: [0] };
    t.deepEqual((await SchematicParser.parse(input)).blocks.map(block => block.type), [
        "minecraft:stone", "minecraft:red_wool", "minecraft:granite"
    ]);
    await t.throwsAsync(SchematicParser.parse(schematic([1], [15])), { message: /Unsupported legacy block 1:15/ });
});

test("lenient parsing accepts missing or non-Alpha Materials without changing strict defaults", async t => {
    for (const materials of [undefined, { type: "string" as const, value: "Classic" }]) {
        const input = schematic([1]);
        if (materials) {
            input.value.Materials = materials;
        } else {
            delete input.value.Materials;
        }
        await t.throwsAsync(SchematicParser.parse(input), { message: /Materials must be Alpha/ });
        t.is((await SchematicParser.parse(input, {}, { lenient: true })).blocks[0].type, "minecraft:stone");
    }
});

test("lenient mappings prefer exact matches, fall back to metadata zero and skip unknown IDs", async t => {
    const input = schematic([1, 1, 35, 1, 1, 1, 54], [1, 15, 31, 3, 2, 0, 2]);
    input.value.AddBlocks = { type: "byteArray", value: [0, 0, 0xf2] };
    const mappings = {
        "1:0": "minecraft:diamond_block",
        "1:3": "minecraft:gold_block",
        "513:0": "example:custom_block[facing=east]"
    };
    const parsed = await SchematicParser.parse(input, mappings, { lenient: true });
    t.deepEqual(parsed.blocks.map(({ type, properties, position }) => ({ type, properties, position })), [
        { type: "minecraft:granite", properties: {}, position: [0, 0, 0] },
        { type: "minecraft:diamond_block", properties: {}, position: [1, 0, 0] },
        { type: "minecraft:white_wool", properties: {}, position: [2, 0, 0] },
        { type: "minecraft:gold_block", properties: {}, position: [3, 0, 0] },
        { type: "example:custom_block", properties: { facing: "east" }, position: [4, 0, 0] },
        { type: "minecraft:chest", properties: { facing: "north", type: "single" }, position: [6, 0, 0] }
    ]);
    await t.throwsAsync(SchematicParser.parse(input, mappings, { lenient: false }), { message: /Unsupported legacy block 1:15/ });
});

test("schematic dimensions, array lengths and tile positions are checked before conversion", async t => {
    const invalid = [
        schematic([1], [0], [0, 1, 1]),
        schematic([1], [0], [2, 1, 1]),
        schematic([1], []),
        schematic([1])
    ];
    invalid[3].value.Materials = { type: "string", value: "Classic" };
    for (const input of invalid) {
        await t.throwsAsync(SchematicParser.parse(input), { name: "MineRenderError" });
    }
    for (const input of invalid.slice(0, 3)) {
        await t.throwsAsync(SchematicParser.parse(input, {}, { lenient: true }), { name: "MineRenderError" });
    }
    const input = schematic([54], [2]);
    input.value.TileEntities = { type: "list", value: { type: "compound", value: [{
        x: { type: "int", value: 1 }, y: { type: "int", value: 0 }, z: { type: "int", value: 0 }
    }] } };
    await t.throwsAsync(SchematicParser.parse(input), { message: /TileEntities.*position/ });
    await t.throwsAsync(SchematicParser.parse(input, {}, { lenient: true }), { message: /TileEntities.*position/ });
});
