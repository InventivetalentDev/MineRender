import test from "ava";
import type { Compound, NBT } from "prismarine-nbt";
import { writeUncompressed } from "prismarine-nbt";
import { deflateSync, gzipSync } from "node:zlib";
import { AnvilParser } from "../src/world/AnvilParser";
import { NBTHelper } from "../src/nbt/NBTHelper";

type Tags = Compound["value"];
const int = (value: number) => ({ type: "int" as const, value });
const string = (value: string) => ({ type: "string" as const, value });
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

function region(...chunks: { x?: number; z?: number; nbt: NBT; compression?: number; external?: boolean }[]): Buffer {
    const header = Buffer.alloc(8192);
    const sectors: Buffer[] = [];
    let sector = 2;
    for (const entry of chunks) {
        const compression = entry.compression ?? 2;
        const raw = writeUncompressed(entry.nbt);
        const payload = entry.external ? Buffer.alloc(0) : compression === 1 ? gzipSync(raw) : compression === 2 ? deflateSync(raw) : raw;
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
    const both = Buffer.from(bytes);
    both.writeUInt32BE(2, 8192);
    await t.throwsAsync(() => AnvilParser.parse(both, options), { message: /payload length of 1/ });
    for (const compression of [0, 4, 99, 127]) {
        const unsupported = Buffer.from(bytes);
        unsupported[8196] = compression | 128;
        await t.throwsAsync(() => AnvilParser.parse(unsupported, options), { message: new RegExp(`Unsupported Anvil compression ${compression}`) });
    }
    t.is(reads, 0);
    await t.throwsAsync(() => AnvilParser.parse(bytes, options), { message: /c\.-1\.-2\.mcc is missing/ });
    t.is(reads, 1);
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
