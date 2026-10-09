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

function region(...chunks: { x?: number; nbt: NBT; compression?: number; payload?: Buffer }[]): Buffer {
    const header = Buffer.alloc(8192);
    const sectors: Buffer[] = [];
    let sector = 2;
    for (const entry of chunks) {
        const compression = entry.compression ?? 2;
        const raw = writeUncompressed(entry.nbt);
        const payload = entry.payload ?? (compression === 1 ? gzipSync(raw) : compression === 2 ? deflateSync(raw) : raw);
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

// Generated with lz4-java 1.8.0 LZ4BlockOutputStream; mixed flushes after seven NBT bytes.
const lz4Fixtures = {
    compressed: "TFo0QmxvY2smjwAAAIgCAAA4yukL8hUKAAADAAtEYXRhVmVyc2lvbgAACzEDAAR4UG9z/////wMABHoLAPEg/gkACHNlY3Rpb25zCgAAAAEBAAFZ/AoADGJsb2NrX3N0YXRlcwkAB3BhbGV0dGUjAPANCAAETmFtZQAPbWluZWNyYWZ0OnN0b25lAAAAByoAn2RkaW5nAAACAAEA/+pQAAAAAABMWjRCbG9jaxYAAAAAAAAAAAAAAAA=",
    raw: "TFo0QmxvY2sWPAAAADwAAAC9LPEDCgAAAwALRGF0YVZlcnNpb24AAAsxAwAEeFBvc/////8DAAR6UG9z/////gkACHNlY3Rpb25zCgAAAAAATFo0QmxvY2sWAAAAAAAAAAAAAAAA",
    mixed: "TFo0QmxvY2sWBwAAAAcAAABoHccOCgAAAwALRExaNEJsb2NrJogAAACBAgAASmEFAPIOYXRhVmVyc2lvbgAACzEDAAR4UG9z/////wMABHoLAPEg/gkACHNlY3Rpb25zCgAAAAEBAAFZ/AoADGJsb2NrX3N0YXRlcwkAB3BhbGV0dGUjAPANCAAETmFtZQAPbWluZWNyYWZ0OnN0b25lAAAAByoAn2RkaW5nAAACAAEA/+pQAAAAAABMWjRCbG9jaxYAAAAAAAAAAAAAAAA="
};

function lz4Region(payload: Buffer): Buffer {
    return region({ nbt: chunk([]), compression: 4, payload });
}

test("Anvil reads Java LZ4 compressed, raw and mixed blocks across NBT and input-view boundaries", async t => {
    for (const [name, fixture] of Object.entries(lz4Fixtures)) {
        const bytes = lz4Region(Buffer.from(fixture, "base64"));
        const padded = Uint8Array.from(Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(3)]));
        const view = padded.subarray(7, 7 + bytes.length);
        const parsed = (await AnvilParser.parseChunk(view, 31, 30))!;
        t.is(parsed.x, -1, name);
        t.is(parsed.z, -2, name);
        t.is(parsed.dataVersion, 2865, name);
        t.is(parsed.sections.length, name === "raw" ? 0 : 1, name);
        if (name !== "raw") {
            t.is(parsed.sections[0].y, -4, name);
            t.deepEqual(parsed.sections[0].data.get(4095), { type: "minecraft:stone" }, name);
        }
    }
});

test("Anvil rejects malformed Java LZ4 headers, checksums and incomplete streams", async t => {
    const compressed = Buffer.from(lz4Fixtures.compressed, "base64");
    const raw = Buffer.from(lz4Fixtures.raw, "base64");
    const mixed = Buffer.from(lz4Fixtures.mixed, "base64");
    const mutations: [string, Buffer, (value: Buffer) => void][] = [
        ["magic", compressed, value => { value[0] ^= 1; }],
        ["method", compressed, value => { value[8] = 0x36; }],
        ["raw length", raw, value => value.writeUInt32LE(59, 13)],
        ["block limit", compressed, value => value.writeUInt32LE(65537, 13)],
        ["zero compressed length", compressed, value => value.writeUInt32LE(0, 9)],
        ["zero decoded length", compressed, value => value.writeUInt32LE(0, 13)],
        ["compressed checksum", compressed, value => { value[17] ^= 1; }],
        ["raw checksum", raw, value => { value[17] ^= 1; }],
        ["second block checksum", mixed, value => { value[45] ^= 1; }],
        ["end checksum", compressed, value => { value[value.length - 4] = 1; }],
        ["end length", compressed, value => { value[value.length - 12] = 1; }]
    ];
    for (const [name, original, change] of mutations) {
        const payload = Buffer.from(original);
        change(payload);
        await t.throwsAsync(() => AnvilParser.parse(lz4Region(payload)), { message: /Anvil LZ4/ }, name);
    }
    for (const payload of [
        compressed.subarray(0, 8),
        compressed.subarray(0, compressed.length - 22),
        compressed.subarray(0, compressed.length - 21),
        compressed.subarray(0, compressed.length - 1),
        Buffer.concat([compressed, Buffer.of(0)])
    ]) {
        await t.throwsAsync(() => AnvilParser.parse(lz4Region(payload)), { message: /Anvil LZ4/ });
    }
});

test("Anvil rejects invalid LZ4 literal lengths, match offsets and output overruns before checking the checksum", async t => {
    const fixture = Buffer.from(lz4Fixtures.compressed, "base64");
    const invalid = [
        [0xf0],
        [0xf0, 0xff],
        [0x50, 1, 2],
        [0x10, 1, 0, 0, 0x50, 0, 0, 0, 0, 0],
        [0x10, 1, 2, 0, 0x50, 0, 0, 0, 0, 0],
        [0x1f, 1, 1, 0],
        [0x1f, 1, 1, 0, 0xff, 0, 0x50, 0, 0, 0, 0, 0]
    ];
    for (const tokens of invalid) {
        const header = Buffer.from(fixture.subarray(0, 21));
        header.writeUInt32LE(tokens.length, 9);
        header.writeUInt32LE(64, 13);
        const payload = Buffer.concat([header, Buffer.from(tokens), fixture.subarray(-21)]);
        const error = await t.throwsAsync(() => AnvilParser.parse(lz4Region(payload)), { message: /Anvil LZ4/ });
        t.notRegex(error!.message, /checksum/i);
    }
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
    for (const compression of [99, 130, 132]) {
        const bytes = Buffer.from(valid);
        bytes[8196] = compression;
        await t.throwsAsync(() => AnvilParser.parse(bytes), { message: compression & 128 ? /External.*mcc/ : /Unsupported.*compression/ });
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
