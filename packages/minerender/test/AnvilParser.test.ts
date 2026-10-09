import test from "ava";
import type { Compound, NBT } from "prismarine-nbt";
import { writeUncompressed } from "prismarine-nbt";
import { deflateSync, gzipSync } from "node:zlib";
import { AnvilParser } from "../src/world/AnvilParser";

type Tags = Compound["value"];
const int = (value: number) => ({ type: "int" as const, value });
const string = (value: string) => ({ type: "string" as const, value });
const compound = (value: Tags): Compound => ({ type: "compound", value });
const list = (value: Tags[]) => ({ type: "list" as const, value: { type: "compound" as const, value } });
const strings = (value: string[]) => ({ type: "list" as const, value: { type: "string" as const, value } });
const longs = (words: bigint[]) => ({ type: "longArray" as const, value: words.map(word => [
    Number(BigInt.asIntN(32, word >> 32n)), Number(BigInt.asIntN(32, word))
] as [number, number]) });

function chunk(sections: Tags[], options: { x?: number; modern?: boolean; version?: number | null; extra?: Tags } = {}): NBT {
    const modern = options.modern ?? true;
    const level: Tags = {
        xPos: int(options.x ?? -1), zPos: int(-2),
        [modern ? "sections" : "Sections"]: list(sections), ...options.extra
    };
    return {
        name: "", type: "compound", value: {
            ...(options.version === null ? {} : { DataVersion: int(options.version ?? 2865) }),
            ...(modern ? level : { Level: compound(level) })
        }
    };
}

function region(...chunks: { x?: number; nbt: NBT; compression?: number }[]): Buffer {
    const header = Buffer.alloc(8192);
    const sectors: Buffer[] = [];
    let sector = 2;
    for (const entry of chunks) {
        const compression = entry.compression ?? 2;
        const raw = writeUncompressed(entry.nbt);
        const payload = compression === 1 ? gzipSync(raw) : compression === 2 ? deflateSync(raw) : raw;
        const count = Math.ceil((payload.length + 5) / 4096);
        const data = Buffer.alloc(count * 4096);
        data.writeUInt32BE(payload.length + 1);
        data[4] = compression;
        payload.copy(data, 5);
        header.writeUInt32BE((sector << 8) | count, ((entry.x ?? 31) + 30 * 32) * 4);
        sectors.push(data);
        sector += count;
    }
    return Buffer.concat([header, ...sectors]);
}

function uniform(name = "minecraft:stone"): Tags {
    return { Y: { type: "byte", value: -4 }, block_states: compound({ palette: list([{ Name: string(name) }]) }) };
}

test("Anvil lists local chunks and loads gzip, zlib and raw NBT with signed chunk and section coordinates", async t => {
    const bytes = region(...[1, 2, 3].map((compression, x) => ({
        x, compression, nbt: chunk([uniform()], { x: -32 + x })
    })));
    const padded = Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(3)]);
    const view = padded.subarray(7, 7 + bytes.length);
    t.deepEqual(AnvilParser.getChunkList(view), [{ x: 0, z: 30 }, { x: 1, z: 30 }, { x: 2, z: 30 }]);
    t.is(await AnvilParser.parseChunk(view, 3, 30), undefined);
    const selected = (await AnvilParser.parseChunk(view, 1, 30))!;
    t.is(selected.x, -31);
    t.is(selected.z, -2);
    t.is(selected.dataVersion, 2865);
    t.is(selected.sections[0].y, -4);
    t.deepEqual(selected.sections[0].data.get(4095), { type: "minecraft:stone" });
    const all = await AnvilParser.parse(Uint8Array.from(bytes).buffer);
    t.deepEqual(all.chunks.map(({ x, z }) => [x, z]), [[-32, -2], [-31, -2], [-30, -2]]);
    t.true(all.chunks.every(value => value.sections[0].data.get(0)?.type === "minecraft:stone"));
});

test("Anvil decodes dense and padded five-bit palettes across long boundaries without losing signed high bits", async t => {
    const palette = Array.from({ length: 18 }, (_, index): Tags => ({
        Name: string(index ? `test:block_${index}` : "minecraft:air"),
        ...(index === 7 ? { Properties: compound({ axis: string("x") }) } : {})
    }));
    const dense = Array<bigint>(320).fill(0n);
    dense[0] = 1n | (1n << 60n);
    dense[1] = 15n;
    dense[319] = 1n << 63n;
    const padded = Array<bigint>(342).fill(0n);
    padded[0] = 1n;
    padded[1] = 241n;
    padded[341] = 1n << 19n;
    for (const [version, modernRoot, modernSection] of [[2526, false, false], [2527, false, false], [2832, false, true], [2865, true, true]] as const) {
        const values = { palette: list(palette), data: longs(version < 2527 ? dense : padded) };
        const section = {
            Y: int(2), ...(modernSection ? { block_states: compound(values) } : { Palette: values.palette, BlockStates: values.data })
        };
        const parsed = (await AnvilParser.parseChunk(region({ nbt: chunk([section], { version, modern: modernRoot }) }), 31, 30))!;
        const data = parsed.sections[0].data;
        t.is(data.get(0)?.type, "test:block_1");
        t.is(data.get(12)?.type, "test:block_17");
        t.deepEqual(data.get(13), { type: "test:block_7", properties: { axis: "x" } });
        t.is(data.get(4095)?.type, "test:block_16");
        t.is(data.get(1), undefined);
        t.is(data.get(14), undefined);
    }
});

for (const [bits, padded] of [[4, true], [5, true], [5, false]] as const) {
    test(`Anvil decodes every index in a ${padded ? "padded" : "dense"} ${bits}-bit section`, async t => {
        const palette = Array.from({ length: 1 << bits }, (_, index) => ({ Name: string(`test:block_${index}`) }));
        const expected = Array.from({ length: 4096 }, (_, index) => (index * 13 + 7) % palette.length);
        const perLong = Math.floor(64 / bits);
        const words = Array<bigint>(padded ? Math.ceil(4096 / perLong) : 4096 * bits / 64).fill(0n);
        for (const [index, value] of expected.entries()) {
            const word = padded ? Math.floor(index / perLong) : Math.floor(index * bits / 64);
            const shift = padded ? (index % perLong) * bits : (index * bits) % 64;
            words[word] |= BigInt(value) << BigInt(shift);
            if (!padded && shift + bits > 64) words[word + 1] |= BigInt(value) >> BigInt(64 - shift);
        }
        const section = padded
            ? { Y: int(0), block_states: compound({ palette: list(palette), data: longs(words) }) }
            : { Y: int(0), Palette: list(palette), BlockStates: longs(words) };
        const parsed = (await AnvilParser.parseChunk(region({ nbt: chunk([section], {
            modern: padded, version: padded ? 2865 : 2526
        }) }), 31, 30))!;
        t.deepEqual(expected.map((_, index) => parsed.sections[0].data.get(index)?.type),
            expected.map(index => `test:block_${index}`));
    });
}

test("Anvil reads vanilla string palettes and mixed palettes with wrapped defaults and lowercase state fields", async t => {
    const palettes = [
        {
            palette: { type: "list" as const, value: { type: "string" as const, value: ["minecraft:air", "minecraft:stone"] } },
            word: 1n << 4n,
            expected: [undefined, { type: "minecraft:stone" }, undefined]
        },
        {
            palette: list([
                { "": string("minecraft:air") },
                { id: string("minecraft:oak_log"), properties: compound({ axis: string("x") }) },
                { "": string("minecraft:stone") }
            ]),
            word: (1n << 4n) | (2n << 8n),
            expected: [undefined, { type: "minecraft:oak_log", properties: { axis: "x" } }, { type: "minecraft:stone" }]
        }
    ];
    for (const { palette, word, expected } of palettes) {
        const section = { Y: int(-1), block_states: compound({ palette, data: longs([word, ...Array<bigint>(255).fill(0n)]) }) };
        const parsed = (await AnvilParser.parseChunk(region({ nbt: chunk([section], { version: 5023 }) }), 31, 30))!;
        t.is(parsed.dataVersion, 5023);
        t.deepEqual([0, 1, 2].map(index => parsed.sections[0].data.get(index)), expected);
    }
});

test("Anvil attaches typed block-entity NBT to the correct negative-height cell and preserves entity positions", async t => {
    const blockEntity = { id: string("minecraft:chest"), x: int(-15), y: int(-63), z: int(-31), CustomName: string("fixture") };
    const entity = { id: string("minecraft:pig"), Pos: { type: "list" as const, value: { type: "double" as const, value: [-15.5, -62, -30] } } };
    for (const modern of [true, false]) {
        const section = uniform("minecraft:chest");
        const parsed = (await AnvilParser.parseChunk(region({ nbt: chunk([section], { modern, extra: {
            [modern ? "block_entities" : "TileEntities"]: list([blockEntity]),
            [modern ? "entities" : "Entities"]: list([entity])
        } }) }), 31, 30))!;
        const data = parsed.sections[0].data;
        t.deepEqual(data.get(273)?.nbt, compound(blockEntity));
        t.is(data.get(272)?.nbt, undefined);
        t.deepEqual(parsed.entities, [{ position: [-15.5, -62, -30], nbt: compound(entity) }]);
        data.get(273)!.nbt.value.CustomName.value = "changed";
        t.is(data.get(273)!.nbt.value.CustomName.value, "fixture");
    }
});

test("Anvil rejects truncated sectors, invalid lengths and unsupported compression without reading adjacent payloads", async t => {
    t.throws(() => AnvilParser.getChunkList(new Uint8Array(8191)), { message: /header is truncated/ });
    const valid = region({ nbt: chunk([uniform()]) });
    const badSector = Buffer.from(valid);
    badSector.writeUInt32BE((1 << 8) | 1, (31 + 30 * 32) * 4);
    t.throws(() => AnvilParser.getChunkList(badSector), { message: /sector allocation/ });
    t.throws(() => AnvilParser.getChunkList(valid.subarray(0, valid.length - 1)), { message: /sector allocation/ });
    const badLength = Buffer.from(valid);
    badLength.writeUInt32BE(4093, 8192);
    await t.throwsAsync(() => AnvilParser.parse(badLength), { message: /payload length/ });
    for (const compression of [4, 99, 130]) {
        const bytes = Buffer.from(valid);
        bytes[8196] = compression;
        await t.throwsAsync(() => AnvilParser.parse(bytes), { message: compression === 130 ? /External.*mcc/ : /Unsupported.*compression/ });
    }
    await t.throwsAsync(() => AnvilParser.parseChunk(valid, -1, 0), { instanceOf: RangeError });
});

test("Anvil rejects numeric sections and malformed palettes instead of silently replacing them with air", async t => {
    const palette = list([{ Name: string("minecraft:air") }, { Name: string("minecraft:stone") }]);
    const invalid = [
        { section: { Y: int(0), Blocks: { type: "byteArray" as const, value: [1] } }, message: /before Minecraft 1.13/ },
        { section: { Y: int(0), Palette: list([]) }, message: /without a palette/ },
        { section: { Y: int(0), block_states: int(0) }, message: /block_states must be a compound/ },
        { section: { Y: int(0), block_states: compound({ palette }) }, message: /missing.*long array/ },
        { section: { Y: int(0), block_states: compound({ palette, data: longs([0n]) }) }, message: /array length/ },
        { section: { Y: int(0), block_states: compound({ palette, data: longs([3n, ...Array<bigint>(255).fill(0n)]) }) }, message: /palette index 3/ }
    ];
    for (const { section, message } of invalid) {
        await t.throwsAsync(() => AnvilParser.parse(region({ nbt: chunk([section]) })), { message });
    }
    const unknownVersion = chunk([{ Y: int(0), Palette: list(Array.from({ length: 17 }, () => ({ Name: string("minecraft:stone") }))),
        BlockStates: longs(Array<bigint>(342).fill(0n)) }], { modern: false, version: null });
    await t.throwsAsync(() => AnvilParser.parse(region({ nbt: unknownVersion })), { message: /DataVersion is required/ });
    const lightingOnly = await AnvilParser.parse(region({ nbt: chunk([{ Y: int(0), BlockLight: { type: "byteArray", value: [0] } }]) }));
    t.is(lightingOnly.chunks[0].sections[0].data.get(0), undefined);
});

test("Anvil preserves uniform biome IDs in air-only sections and leaves absent or legacy biome data unknown", async t => {
    const sections = [
        { Y: int(-4), biomes: compound({ palette: strings(["test:underground/deep"]) }) },
        { Y: int(-3), biomes: compound({ palette: strings(["minecraft:plains"]), data: longs([]) }) },
        { Y: int(-2) }
    ];
    const parsed = (await AnvilParser.parseChunk(region({ nbt: chunk(sections) }), 31, 30))!;
    t.deepEqual(parsed.sections.map(section => section.y), [-4, -3, -2]);
    t.deepEqual(parsed.sections[0].biomes, Array(64).fill("test:underground/deep"));
    t.deepEqual(parsed.sections[1].biomes, Array(64).fill("minecraft:plains"));
    t.is(parsed.sections[2].biomes, undefined);
    t.true(parsed.sections.every(section => section.data.get(0) === undefined));
    const legacy = (await AnvilParser.parseChunk(region({ nbt: chunk([{ Y: int(0) }], {
        modern: false, version: 2527, extra: { Biomes: { type: "intArray", value: Array(1024).fill(1) } }
    }) }), 31, 30))!;
    t.is(legacy.sections[0].biomes, undefined);
});

for (const paletteSize of [2, 5, 64]) {
    test(`Anvil decodes all 64 biome samples from a padded ${paletteSize}-entry palette`, async t => {
        const palette = Array.from({ length: paletteSize }, (_, index) => `test:biome_${index}`);
        const expected = Array.from({ length: 64 }, (_, index) => (index * 13 + 7) % paletteSize);
        const bits = Math.ceil(Math.log2(paletteSize)), perLong = Math.floor(64 / bits);
        const words = Array<bigint>(Math.ceil(64 / perLong)).fill(0n);
        for (const [index, value] of expected.entries()) {
            words[Math.floor(index / perLong)] |= BigInt(value) << BigInt(index % perLong * bits);
        }
        const section = { Y: int(-1), biomes: compound({ palette: strings(palette), data: longs(words) }) };
        const parsed = (await AnvilParser.parseChunk(region({ nbt: chunk([section]) }), 31, 30))!;
        t.deepEqual(parsed.sections[0].biomes, expected.map(index => palette[index]));
    });
}

test("Anvil rejects malformed biome containers, palettes and packed indices", async t => {
    const palette = strings(["minecraft:plains", "minecraft:desert", "test:caves"]);
    const invalid = [
        int(0),
        compound({}),
        compound({ palette: strings([]) }),
        compound({ palette: list([{ Name: string("minecraft:plains") }]) }),
        compound({ palette: strings([""]) }),
        compound({ palette: strings(Array(65).fill("minecraft:plains")) }),
        compound({ palette }),
        compound({ palette, data: { type: "intArray", value: [0, 0] } }),
        compound({ palette, data: longs([0n]) }),
        compound({ palette, data: longs([0n, 0n, 0n]) }),
        compound({ palette, data: longs([0n, 3n << 62n]) }),
        compound({ palette: strings(["minecraft:plains"]), data: longs([0n]) })
    ];
    for (const biomes of invalid) {
        await t.throwsAsync(() => AnvilParser.parse(region({ nbt: chunk([{ Y: int(0), biomes }]) })), { message: /biome/i });
    }
});
