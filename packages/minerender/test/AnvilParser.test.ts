import test from "ava";
import type { Compound, NBT } from "prismarine-nbt";
import { writeUncompressed } from "prismarine-nbt";
import { deflateSync, gzipSync } from "node:zlib";
import { AnvilParser } from "../src/world/AnvilParser";
import { NBTHelper } from "../src/nbt/NBTHelper";

type Tags = Compound["value"];
const int = (value: number) => ({ type: "int" as const, value });
const string = (value: string) => ({ type: "string" as const, value });
const bytes = (value: number[]) => ({ type: "byteArray" as const, value });
const compound = (value: Tags): Compound => ({ type: "compound", value });
const list = (value: Tags[]) => ({ type: "list" as const, value: { type: "compound" as const, value } });
const longs = (words: bigint[]) => ({ type: "longArray" as const, value: words.map(word => [
    Number(BigInt.asIntN(32, word >> 32n)), Number(BigInt.asIntN(32, word))
] as [number, number]) });

function chunk(sections: Tags[], options: { x?: number; z?: number; modern?: boolean; version?: number | null; extra?: Tags } = {}): NBT {
    const modern = options.modern ?? true;
    const level: Tags = {
        xPos: int(options.x ?? -1), zPos: int(options.z ?? -2),
        [modern ? "sections" : "Sections"]: list(sections), ...options.extra
    };
    return {
        name: "", type: "compound", value: {
            ...(options.version === null ? {} : { DataVersion: int(options.version ?? 2865) }),
            ...(modern ? level : { Level: compound(level) })
        }
    };
}

function region(...chunks: { x?: number; z?: number; nbt: NBT; compression?: number; external?: boolean; payload?: Buffer }[]): Buffer {
    const header = Buffer.alloc(8192);
    const sectors: Buffer[] = [];
    let sector = 2;
    for (const entry of chunks) {
        const compression = entry.compression ?? 2;
        const raw = writeUncompressed(entry.nbt);
        const payload = entry.external ? Buffer.alloc(0) : entry.payload ?? (compression === 1 ? gzipSync(raw) : compression === 2 ? deflateSync(raw) : raw);
        const count = Math.ceil((payload.length + 5) / 4096);
        const data = Buffer.alloc(count * 4096);
        data.writeUInt32BE(payload.length + 1);
        data[4] = compression | (entry.external ? 128 : 0);
        payload.copy(data, 5);
        header.writeUInt32BE((sector << 8) | count, ((entry.x ?? 31) + (entry.z ?? 30) * 32) * 4);
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

test("Anvil reads external gzip, zlib and raw payloads at absolute signed chunk coordinates", async t => {
    const fixtures = [
        { compression: 1, x: -64, z: 95, localX: 0, localZ: 31 },
        { compression: 2, x: -1, z: -2, localX: 31, localZ: 30 },
        { compression: 3, x: 65, z: -32, localX: 1, localZ: 0 }
    ];
    for (const { compression, x, z, localX, localZ } of fixtures) {
        const nbt = chunk([uniform()], { x, z });
        const raw = writeUncompressed(nbt);
        const compressed = compression === 1 ? gzipSync(raw) : compression === 2 ? deflateSync(raw) : raw;
        const padded = Buffer.concat([Buffer.alloc(7), compressed, Buffer.alloc(3)]);
        const bytes = region({ nbt, x: localX, z: localZ, compression, external: true });
        const signal = new AbortController().signal;
        let reads = 0;
        const options = {
            region: { x: Math.floor(x / 32), z: Math.floor(z / 32) }, signal,
            readExternalChunk: async (readX: number, readZ: number, readSignal?: AbortSignal) => {
                reads++;
                t.deepEqual([readX, readZ], [x, z]);
                t.is(readSignal, signal);
                return compression === 3 ? Uint8Array.from(compressed).buffer : padded.subarray(7, 7 + compressed.length);
            }
        };
        t.deepEqual(AnvilParser.getChunkList(bytes), [{ x: localX, z: localZ }]);
        t.is(await AnvilParser.parseChunk(bytes, (localX + 1) % 32, localZ, options), undefined);
        t.is(reads, 0);
        const parsed = (await AnvilParser.parseChunk(bytes, localX, localZ, options))!;
        t.deepEqual([parsed.x, parsed.z, parsed.dataVersion], [x, z, 2865]);
        t.deepEqual(parsed.sections[0].data.get(4095), { type: "minecraft:stone" });
        t.is(reads, 1);
    }
});

test("Anvil parses regions with internal and external chunks without requiring a reader for internal payloads", async t => {
    const external = chunk([uniform("minecraft:dirt")], { x: -2 });
    const bytes = region({ nbt: chunk([uniform()]) }, { x: 30, nbt: external, external: true });
    const reads: number[][] = [];
    const options = {
        region: { x: -1, z: -1 },
        readExternalChunk: async (x: number, z: number) => {
            reads.push([x, z]);
            return deflateSync(writeUncompressed(external));
        }
    };
    const parsed = await AnvilParser.parse(bytes, options);
    t.deepEqual(parsed.chunks.map(value => [value.x, value.z, value.sections[0].data.get(0)?.type]), [
        [-2, -2, "minecraft:dirt"], [-1, -2, "minecraft:stone"]
    ]);
    t.deepEqual(reads, [[-2, -2]]);
    const internal = (await AnvilParser.parseChunk(bytes, 31, 30))!;
    t.is(internal.sections[0].data.get(0)?.type, "minecraft:stone");
});

test("Anvil reads external payloads larger than the region sector limit", async t => {
    const nbt = chunk([uniform()], { extra: { padding: { type: "byteArray", value: Array<number>(1024 * 1024).fill(0) } } });
    const payload = writeUncompressed(nbt);
    t.true(payload.byteLength > 1024 * 1024);
    const bytes = region({ nbt, compression: 3, external: true });
    t.is(bytes.byteLength, 3 * 4096);
    const parsed = await AnvilParser.parse(bytes, {
        region: { x: -1, z: -1 }, readExternalChunk: async () => payload
    });
    t.is(parsed.chunks[0].sections[0].data.get(4095)?.type, "minecraft:stone");
});

test("Anvil validates external stubs, compression and region coordinates before reading a file", async t => {
    const bytes = region({ nbt: chunk([uniform()]), external: true });
    let reads = 0;
    const readExternalChunk = async () => { reads++; return undefined; };
    await t.throwsAsync(() => AnvilParser.parse(bytes), { message: /require region coordinates and readExternalChunk/ });
    await t.throwsAsync(() => AnvilParser.parse(bytes, { region: { x: -1, z: -1 } }), { message: /readExternalChunk/ });
    await t.throwsAsync(() => AnvilParser.parse(bytes, { readExternalChunk }), { message: /region coordinates/ });
    for (const region of [{ x: NaN, z: 0 }, { x: 0, z: 0.5 }, { x: Infinity, z: 0 }, { x: Number.MAX_SAFE_INTEGER, z: 0 }]) {
        await t.throwsAsync(() => AnvilParser.parse(bytes, { region, readExternalChunk }), { instanceOf: RangeError, message: /safe integers/ });
    }
    const options = { region: { x: -1, z: -1 }, readExternalChunk };
    for (const compression of [0, 99, 127]) {
        const unsupported = Buffer.from(bytes);
        unsupported[8196] = compression | 128;
        await t.throwsAsync(() => AnvilParser.parse(unsupported, options), { message: new RegExp(`Unsupported Anvil compression ${compression}`) });
    }
    t.is(reads, 0);
    await t.throwsAsync(() => AnvilParser.parse(bytes, options), { message: /c\.-1\.-2\.mcc is missing/ });
    t.is(reads, 1);
});

test("Anvil reads the external payload when a chunk has both internal and external streams", async t => {
    const bytes = region({ nbt: chunk([uniform("minecraft:dirt")]) });
    bytes[8196] |= 128;
    const parsed = await AnvilParser.parse(bytes, {
        region: { x: -1, z: -1 },
        readExternalChunk: async () => deflateSync(writeUncompressed(chunk([uniform()])))
    });
    t.is(parsed.chunks[0].sections[0].data.get(0)?.type, "minecraft:stone");
});

test("Anvil rejects external payloads for a different absolute chunk even when the region-local coordinates match", async t => {
    const bytes = region({ nbt: chunk([uniform()]), compression: 3, external: true });
    for (const coordinates of [{ x: 31, z: -2 }, { x: -1, z: 30 }]) {
        await t.throwsAsync(() => AnvilParser.parse(bytes, {
            region: { x: -1, z: -1 },
            readExternalChunk: async () => writeUncompressed(chunk([uniform()], coordinates))
        }), { message: /coordinates do not match external file c\.-1\.-2\.mcc/ });
    }
    const failure = new Error("file read failed");
    await t.throwsAsync(() => AnvilParser.parse(bytes, {
        region: { x: -1, z: -1 }, readExternalChunk: async () => { throw failure; }
    }), { is: failure });
});

test.serial("Anvil aborts pending external reads and ignores their late payloads", async t => {
    t.timeout(3000);
    const bytes = region({ nbt: chunk([uniform()]), external: true });
    const controller = new AbortController(), reason = new Error("external read cancelled");
    let finish!: (data: Uint8Array) => void;
    let reads = 0, decodes = 0;
    const original = NBTHelper.fromBuffer;
    NBTHelper.fromBuffer = async (...args) => { decodes++; return original(...args); };
    t.teardown(() => { NBTHelper.fromBuffer = original; });
    const options = {
        region: { x: -1, z: -1 }, signal: controller.signal,
        readExternalChunk: (_x: number, _z: number, signal?: AbortSignal) => {
            reads++;
            t.is(signal, controller.signal);
            return new Promise<Uint8Array>(resolve => { finish = resolve; });
        }
    };
    const pending = AnvilParser.parse(bytes, options);
    controller.abort(reason);
    await t.throwsAsync(pending, { is: reason });
    t.is(reads, 1);
    finish(deflateSync(writeUncompressed(chunk([uniform()]))));
    await new Promise(resolve => setImmediate(resolve));
    t.is(decodes, 0);
    await t.throwsAsync(() => AnvilParser.parse(bytes, options), { is: reason });
    await t.throwsAsync(() => AnvilParser.parseChunk(bytes, 31, 30, options), { is: reason });
    t.is(reads, 1);
});

test.serial("Anvil checks cancellation after NBT decoding", async t => {
    const bytes = region({ nbt: chunk([uniform()]), compression: 3, external: true });
    const controller = new AbortController(), reason = new Error("decode cancelled");
    const original = NBTHelper.fromBuffer;
    NBTHelper.fromBuffer = async (...args) => {
        const nbt = await original(...args);
        controller.abort(reason);
        return nbt;
    };
    t.teardown(() => { NBTHelper.fromBuffer = original; });
    await t.throwsAsync(() => AnvilParser.parseChunk(bytes, 31, 30, {
        region: { x: -1, z: -1 }, signal: controller.signal,
        readExternalChunk: async () => writeUncompressed(chunk([uniform()]))
    }), { is: reason });
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

test("Anvil reads internal and external Java LZ4 blocks across NBT and input-view boundaries", async t => {
    for (const [name, fixture] of Object.entries(lz4Fixtures)) {
        const payload = Buffer.from(fixture, "base64");
        const paddedPayload = Uint8Array.from(Buffer.concat([Buffer.alloc(7), payload, Buffer.alloc(3)]));
        for (const external of [false, true]) {
            const bytes = region({ nbt: chunk([]), compression: 4, payload, external });
            const padded = Uint8Array.from(Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(3)]));
            const view = padded.subarray(7, 7 + bytes.length);
            const signal = new AbortController().signal;
            let reads = 0;
            const parsed = (await AnvilParser.parseChunk(view, 31, 30, {
                region: { x: -1, z: -1 }, signal,
                readExternalChunk: async (x, z, readSignal) => {
                    reads++;
                    t.deepEqual([x, z], [-1, -2]);
                    t.is(readSignal, signal);
                    return paddedPayload.subarray(7, 7 + payload.length);
                }
            }))!;
            t.is(reads, external ? 1 : 0, name);
            t.is(parsed.x, -1, name);
            t.is(parsed.z, -2, name);
            t.is(parsed.dataVersion, 2865, name);
            t.is(parsed.sections.length, name === "raw" ? 0 : 1, name);
            if (name !== "raw") {
                t.is(parsed.sections[0].y, -4, name);
                t.deepEqual(parsed.sections[0].data.get(4095), { type: "minecraft:stone" }, name);
            }
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

test("Anvil reads entity regions with gzip, zlib and raw NBT while preserving typed entity data", async t => {
    const entity = {
        id: string("minecraft:pig"),
        Pos: { type: "list" as const, value: { type: "double" as const, value: [-15.5, -62, -30] } },
        Rotation: { type: "list" as const, value: { type: "float" as const, value: [90, -20] } },
        CustomName: string("fixture"), UUID: { type: "intArray" as const, value: [1, -2, 3, -4] }
    };
    for (const compression of [1, 2, 3]) {
        const nbt: NBT = { name: "", type: "compound", value: {
            Position: { type: "intArray", value: [-1, -2] }, DataVersion: int(4325), Entities: list([entity])
        } };
        const bytes = region({ nbt, compression });
        const padded = Buffer.concat([Buffer.alloc(7), bytes, Buffer.alloc(3)]);
        const input = compression === 3 ? Uint8Array.from(bytes).buffer : padded.subarray(7, 7 + bytes.length);
        t.deepEqual(AnvilParser.getChunkList(input), [{ x: 31, z: 30 }]);
        t.is(await AnvilParser.parseEntityChunk(input, 0, 30), undefined);
        t.deepEqual(await AnvilParser.parseEntityChunk(input, 31, 30), {
            x: -1, z: -2, dataVersion: 4325,
            entities: [{ position: [-15.5, -62, -30], nbt: compound(entity) }]
        });
    }
});

test("Anvil entity regions allow missing or empty entity lists and missing data versions", async t => {
    for (const extra of [{}, { Entities: list([]) }]) {
        const nbt: NBT = { name: "", type: "compound", value: {
            Position: { type: "intArray", value: [63, 94] }, ...extra
        } };
        t.deepEqual(await AnvilParser.parseEntityChunk(region({ nbt }), 31, 30), {
            x: 63, z: 94, dataVersion: undefined, entities: []
        });
    }
});

test("Anvil entity regions reject malformed positions, entity lists and mismatched chunk locations", async t => {
    const position = { type: "intArray" as const, value: [-1, -2] };
    const invalid: { value: Tags; message: RegExp }[] = [
        { value: {}, message: /Position must contain two integers/ },
        { value: { Position: string("-1,-2") }, message: /Position must contain two integers/ },
        { value: { Position: { ...position, value: [-1] } }, message: /Position must contain two integers/ },
        { value: { Position: { ...position, value: [-1, -2, 0] } }, message: /Position must contain two integers/ },
        { value: { Position: { ...position, value: [0, -2] } }, message: /coordinates do not match/ },
        { value: { Position: { ...position, value: [-1, 0] } }, message: /coordinates do not match/ },
        { value: { Position: position, Entities: int(1) }, message: /entities must be a compound list/ },
        { value: { Position: position, Entities: { type: "list", value: { type: "string", value: ["pig"] } } },
            message: /entities must be a compound list/ }
    ];
    for (const Pos of [undefined, int(1),
        { type: "list" as const, value: { type: "float" as const, value: [0, 1, 2] } },
        ...[[0, 1], [0, 1, 2, 3], [0, NaN, 2], [0, 1, Infinity]].map(value => ({
            type: "list" as const, value: { type: "double" as const, value }
        }))]) {
        invalid.push({ value: { Position: position, Entities: list([{ id: string("minecraft:pig"), ...(Pos ? { Pos } : {}) }]) },
            message: /entity Pos must contain three coordinates/ });
    }
    for (const { value, message } of invalid) {
        const nbt: NBT = { name: "", type: "compound", value };
        await t.throwsAsync(() => AnvilParser.parseEntityChunk(region({ nbt }), 31, 30), { message });
    }
    for (const [x, z] of [[-1, 0], [0, 32], [0.5, 0], [0, NaN]]) {
        await t.throwsAsync(() => AnvilParser.parseEntityChunk(new Uint8Array(8192), x, z), { instanceOf: RangeError });
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
    await t.throwsAsync(() => AnvilParser.parseEntityChunk(badLength, 31, 30), { message: /payload length/ });
    for (const compression of [99, 130, 132]) {
        const bytes = Buffer.from(valid);
        bytes[8196] = compression;
        await t.throwsAsync(() => AnvilParser.parse(bytes), { message: compression & 128 ? /External.*mcc/ : /Unsupported.*compression/ });
        await t.throwsAsync(() => AnvilParser.parseEntityChunk(bytes, 31, 30), {
            message: compression & 128 ? /External.*mcc/ : /Unsupported.*compression/
        });
    }
    await t.throwsAsync(() => AnvilParser.parseChunk(valid, -1, 0), { instanceOf: RangeError });
});

test("Anvil reads numeric sections in x/z/y order and preserves legacy entities and DataVersion", async t => {
    const blocks = Array<number>(4096).fill(0), data = Array<number>(2048).fill(0);
    blocks[0] = 17;
    blocks[1] = 35;
    blocks[16] = 1;
    blocks[256] = -1;
    blocks[273] = 54;
    blocks[4095] = -48;
    data[0] = -28;
    data[136] = 0x20;
    const second = Array<number>(4096).fill(0);
    second[0] = 3;
    const blockEntity = { id: string("Chest"), x: int(-15), y: int(-15), z: int(-31), CustomName: string("legacy") };
    const entity = { id: string("Pig"), Pos: { type: "list" as const, value: { type: "double" as const, value: [-15.5, -14, -30] } } };
    const parsed = (await AnvilParser.parseChunk(region({ nbt: chunk([
        { Y: int(-1), Blocks: bytes(blocks), Data: bytes(data) }, { Y: int(2), Blocks: bytes(second) }
    ], { modern: false, version: 1343, extra: { TileEntities: list([blockEntity]), Entities: list([entity]) } }) }), 31, 30))!;
    t.deepEqual([parsed.x, parsed.z, parsed.dataVersion], [-1, -2, 1343]);
    t.deepEqual(parsed.sections.map(section => section.y), [-1, 2]);
    const cells = parsed.sections[0].data;
    t.deepEqual(cells.get(0), { type: "minecraft:oak_log", properties: { axis: "x" } });
    t.is(cells.get(1)?.type, "minecraft:red_wool");
    t.is(cells.get(16)?.type, "minecraft:stone");
    t.deepEqual(cells.get(256), { type: "minecraft:structure_block", properties: { mode: "save" } });
    t.deepEqual(cells.get(273), {
        type: "minecraft:chest", properties: { facing: "north", type: "single" }, nbt: compound(blockEntity)
    });
    t.is(cells.get(4095)?.type, "minecraft:dirt_path");
    t.is(cells.get(2), undefined);
    t.is(parsed.sections[1].data.get(0)?.type, "minecraft:dirt");
    t.deepEqual(parsed.entities, [{ position: [-15.5, -14, -30], nbt: compound(entity) }]);
});

test("Anvil decodes both Add nibbles and applies custom mappings before exact bundled mappings", async t => {
    const blocks = Array<number>(4096).fill(0), data = Array<number>(2048).fill(0), add = Array<number>(2048).fill(0);
    blocks[0] = 1;
    blocks[1] = -1;
    blocks[16] = 1;
    blocks[256] = 1;
    data[0] = -29;
    data[8] = 1;
    add[0] = -14;
    const nbt = chunk([{ Y: int(0), Blocks: bytes(blocks), Data: bytes(data), Add: bytes(add) }], { modern: false });
    const input = region({ nbt });
    const legacyMappings = Object.freeze({
        "513:3": "test:custom[facing=east,active=true]", "4095:14": "minecraft:air", "1:0": "minecraft:diamond_block"
    });
    const parsed = await AnvilParser.parse(input, { legacyMappings });
    const cells = parsed.chunks[0].sections[0].data;
    t.deepEqual(cells.get(0), { type: "test:custom", properties: { facing: "east", active: "true" } });
    t.is(cells.get(1), undefined);
    t.is(cells.get(16)?.type, "minecraft:granite");
    t.is(cells.get(256)?.type, "minecraft:diamond_block");
    await t.throwsAsync(() => AnvilParser.parse(input), { message: /513:3.*section 0.*index 0/ });
    const external = (await AnvilParser.parseChunk(region({ nbt, external: true }), 31, 30, {
        legacyMappings, region: { x: -1, z: -1 }, readExternalChunk: async () => deflateSync(writeUncompressed(nbt))
    }))!;
    t.deepEqual(external.sections[0].data.get(0), cells.get(0));
});

test("Anvil maps suspended legacy tripwire states while preserving powered, attached and disarmed flags", async t => {
    const blocks = Array<number>(4096).fill(0), data = Array<number>(2048).fill(0);
    blocks.fill(-124, 0, 16);
    data.splice(0, 8, 0x10, 0x32, 0x54, 0x76, -104, -70, -36, -2);
    const cells = (await AnvilParser.parse(region({ nbt: chunk([
        { Y: int(0), Blocks: bytes(blocks), Data: bytes(data) }
    ], { modern: false }) }))).chunks[0].sections[0].data;
    for (let metadata = 0; metadata < 16; metadata++) {
        t.deepEqual(cells.get(metadata), { type: "minecraft:tripwire", properties: {
            attached: String(!!(metadata & 4)), disarmed: String(!!(metadata & 8)), powered: String(!!(metadata & 1)),
            east: "false", west: "false", north: "false", south: "false"
        } });
    }
});

test("Anvil defaults missing numeric Data and Add to zero without requiring DataVersion", async t => {
    const blocks = Array<number>(4096).fill(0);
    blocks[4095] = 1;
    for (const optional of [{}, { Data: bytes(Array<number>(2048).fill(0)) }, { Add: bytes(Array<number>(2048).fill(0)) }]) {
        const parsed = await AnvilParser.parse(region({ nbt: chunk([
            uniform(), { Y: int(0), Blocks: bytes(blocks), ...optional }
        ], { modern: false, version: null }) }));
        t.is(parsed.chunks[0].dataVersion, undefined);
        t.is(parsed.chunks[0].sections[0].data.get(0)?.type, "minecraft:stone");
        t.is(parsed.chunks[0].sections[1].data.get(4095)?.type, "minecraft:stone");
        t.is(parsed.chunks[0].sections[1].data.get(0), undefined);
    }
});

test("Anvil lenient numeric mappings retain exact matches, try metadata zero and skip unknown IDs", async t => {
    const blocks = Array<number>(4096).fill(0), data = Array<number>(2048).fill(0), add = Array<number>(2048).fill(0);
    blocks.splice(0, 5, 1, 1, 1, -1, 1);
    data[0] = -15;
    data[1] = 0x23;
    data[2] = 15;
    add[1] = -14;
    const input = region({ nbt: chunk([{ Y: int(-2), Blocks: bytes(blocks), Data: bytes(data), Add: bytes(add) }], { modern: false }) });
    const legacyMappings = { "1:0": "minecraft:diamond_block", "513:0": "test:extended" };
    await t.throwsAsync(() => AnvilParser.parse(input, { legacyMappings }), { message: /1:15.*section -2.*index 1/ });
    const cells = (await AnvilParser.parse(input, { legacyMappings, lenient: true })).chunks[0].sections[0].data;
    t.deepEqual([0, 1, 2, 3, 4].map(index => cells.get(index)?.type), [
        "minecraft:granite", "minecraft:diamond_block", "test:extended", undefined, "minecraft:diamond_block"
    ]);
    t.is((await AnvilParser.parse(input, { lenient: true })).chunks[0].sections[0].data.get(1)?.type, "minecraft:stone");
});

test("Anvil validates numeric array types and sizes and rejects mixed section encodings even when lenient", async t => {
    const valid = { Y: int(0), Blocks: bytes(Array<number>(4096).fill(0)) };
    const invalid: Tags[] = [
        { Y: int(0), Data: bytes(Array<number>(2048).fill(0)) },
        { Y: int(0), Add: bytes(Array<number>(2048).fill(0)) }
    ];
    for (const [name, length] of [["Blocks", 4096], ["Data", 2048], ["Add", 2048]] as const) {
        for (const value of [int(0), bytes(Array<number>(length - 1).fill(0)), bytes(Array<number>(length + 1).fill(0))]) {
            invalid.push({ ...valid, [name]: value });
        }
    }
    for (const extra of [{ Palette: list([{ Name: string("minecraft:stone") }]) }, { BlockStates: longs([0n]) },
        { block_states: compound({ palette: list([{ Name: string("minecraft:stone") }]) }) }]) {
        invalid.push({ ...valid, ...extra });
    }
    for (const section of invalid) {
        for (const lenient of [false, true]) {
            await t.throwsAsync(() => AnvilParser.parse(region({ nbt: chunk([section], { modern: false }) }), { lenient }), {
                name: "MineRenderError"
            });
        }
    }
});

test("Anvil rejects malformed palettes instead of silently replacing them with air", async t => {
    const palette = list([{ Name: string("minecraft:air") }, { Name: string("minecraft:stone") }]);
    const invalid = [
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
