import type { Compound, Tags, TagType } from "prismarine-nbt";
import { MineRenderError } from "../error/MineRenderError";
import { Block } from "../model/block/Block";
import { MultiBlockEntity } from "../model/multiblock/MultiBlockStructure";
import { resolveLegacyBlock } from "../model/multiblock/LegacyBlocks";
import { NBTHelper } from "../nbt/NBTHelper";
import { ChunkData } from "./ChunkData";
import { decodeAnvilLz4 } from "./_compression/Lz4";

type CompoundValue = Compound["value"];
type NBTTag = Tags[TagType] | undefined;
type RegionInput = Uint8Array | ArrayBuffer;

/** Reads `c.<x>.<z>.mcc` at absolute chunk coordinates, or returns `undefined` when the file is missing. */
export type AnvilExternalChunkReader = (x: number, z: number, signal?: AbortSignal) => Promise<Uint8Array | ArrayBuffer | undefined>;

export interface AnvilParseOptions {
    /** Overrides numeric `id:metadata` mappings with block states such as `minecraft:oak_log[axis=x]`. */
    legacyMappings?: Readonly<Record<string, string>>;
    /** For numeric blocks, tries metadata 0 for unmapped states and skips unknown IDs. Defaults to false. */
    lenient?: boolean;
    /** Region coordinates from `r.<x>.<z>.mca`, required when reading external chunks. */
    region?: { x: number; z: number };
    /** Reads external chunk payloads without their region-file header. */
    readExternalChunk?: AnvilExternalChunkReader;
    /** Cancels parsing and forwards the signal to external chunk reads. */
    signal?: AbortSignal;
}

interface ChunkLocation {
    x: number;
    z: number;
    offset: number;
    length: number;
}

/** Chunk columns decoded from an Anvil region file. */
export interface AnvilRegion {
    chunks: AnvilChunk[];
}

/** A decoded chunk column. `x` and `z` are absolute chunk coordinates, and section `y` is a section coordinate. */
export interface AnvilChunk {
    x: number;
    z: number;
    dataVersion?: number;
    /** DataVersion of the separate entity-region record; `dataVersion` belongs to the terrain. */
    entityDataVersion?: number;
    sections: {
        y: number;
        data: ChunkData;
        /** 64 saved biome IDs, indexed by x + z * 4 + y * 16 at 4-block resolution. */
        biomes?: readonly string[];
    }[];
    entities?: MultiBlockEntity[];
}

/** Entities decoded from an entity region, with absolute chunk coordinates. */
export interface AnvilEntityChunk {
    x: number;
    z: number;
    dataVersion?: number;
    entities: MultiBlockEntity[];
}

/** Reads numeric and paletted Java terrain and entity `.mca` regions without data-version migration. */
export class AnvilParser {

    /** Lists occupied chunk positions within the region, using local coordinates from 0 to 31. */
    public static getChunkList(data: RegionInput): { x: number; z: number }[] {
        return this.locations(this.bytes(data)).map(({ x, z }) => ({ x, z }));
    }

    /** Decodes all stored chunks. Gzip, zlib, LZ4, and uncompressed payloads are supported. */
    public static async parse(data: RegionInput, options: AnvilParseOptions = {}): Promise<AnvilRegion> {
        options.signal?.throwIfAborted();
        const bytes = this.bytes(data);
        const chunks: AnvilChunk[] = [];
        for (const location of this.locations(bytes)) {
            chunks.push(await this.abortable(this.readChunk(bytes, location, options), options.signal));
        }
        return { chunks };
    }

    /**
     * Decodes one chunk for {@link MineRenderWorld.placeChunk}.
     * @param localX - Chunk x within the region, from 0 to 31.
     * @param localZ - Chunk z within the region, from 0 to 31.
     * @returns The chunk with absolute coordinates, or `undefined` if the region has no chunk there.
     */
    public static async parseChunk(data: RegionInput, localX: number, localZ: number, options: AnvilParseOptions = {}): Promise<AnvilChunk | undefined> {
        options.signal?.throwIfAborted();
        const bytes = this.bytes(data);
        const location = this.location(bytes, localX, localZ);
        return location ? this.abortable(this.readChunk(bytes, location, options), options.signal) : undefined;
    }

    /**
     * Decodes one chunk from an `entities/r.x.z.mca` file without migrating its NBT.
     * @param localX - Chunk x within the region, from 0 to 31.
     * @param localZ - Chunk z within the region, from 0 to 31.
     * @returns The entities with absolute chunk coordinates, or `undefined` if no chunk is stored there.
     */
    public static async parseEntityChunk(data: RegionInput, localX: number, localZ: number, options: AnvilParseOptions = {}): Promise<AnvilEntityChunk | undefined> {
        options.signal?.throwIfAborted();
        const bytes = this.bytes(data);
        const location = this.location(bytes, localX, localZ);
        if (!location) return undefined;
        const { root, expected } = await this.abortable(this.readNBT(bytes, location, options), options.signal);
        options.signal?.throwIfAborted();
        const position = root.Position;
        if (position?.type !== "intArray" || position.value.length !== 2 || !position.value.every(Number.isInteger)) {
            throw new MineRenderError("Anvil entity chunk Position must contain two integers");
        }
        const [x, z] = position.value;
        if (((x % 32) + 32) % 32 !== localX || ((z % 32) + 32) % 32 !== localZ) {
            throw new MineRenderError("Anvil entity chunk coordinates do not match its region location");
        }
        if (expected && (x !== expected.x || z !== expected.z)) {
            throw new MineRenderError(`Anvil entity chunk coordinates do not match external file c.${expected.x}.${expected.z}.mcc`);
        }
        return {
            x, z, dataVersion: root.DataVersion?.type === "int" ? root.DataVersion.value : undefined,
            entities: this.entities(root.Entities)
        };
    }

    private static location(data: Uint8Array, localX: number, localZ: number): ChunkLocation | undefined {
        if (![localX, localZ].every(value => Number.isInteger(value) && value >= 0 && value < 32)) {
            throw new RangeError("Region-local chunk coordinates must be integers from 0 to 31");
        }
        return this.locations(data).find(({ x, z }) => x === localX && z === localZ);
    }

    private static async abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
        if (!signal) return promise;
        let abort!: () => void;
        const cancelled = new Promise<never>((_, reject) => {
            abort = () => reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
            if (signal.aborted) abort();
        });
        try {
            return await Promise.race([promise, cancelled]);
        } finally {
            signal.removeEventListener("abort", abort);
        }
    }

    private static bytes(data: RegionInput): Uint8Array {
        return data instanceof Uint8Array ? data : new Uint8Array(data);
    }

    private static locations(data: Uint8Array): ChunkLocation[] {
        if (data.byteLength < 8192) throw new MineRenderError("Anvil region header is truncated");
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const locations: ChunkLocation[] = [];
        for (let index = 0; index < 1024; index++) {
            const entry = view.getUint32(index * 4);
            if (entry === 0) continue;
            const sector = entry >>> 8;
            const count = entry & 255;
            if (sector < 2 || count === 0 || (sector + count) * 4096 > data.byteLength) {
                throw new MineRenderError(`Invalid Anvil sector allocation at chunk ${index % 32},${Math.floor(index / 32)}`);
            }
            const offset = sector * 4096;
            const length = view.getUint32(offset);
            if (length < 1 || length + 4 > count * 4096) {
                throw new MineRenderError(`Invalid Anvil chunk payload length at sector ${sector}`);
            }
            locations.push({ x: index % 32, z: Math.floor(index / 32), offset, length });
        }
        return locations;
    }

    private static async readNBT(data: Uint8Array, location: ChunkLocation, options: AnvilParseOptions): Promise<{ root: CompoundValue; expected?: { x: number; z: number } }> {
        options.signal?.throwIfAborted();
        const format = data[location.offset + 4];
        const external = (format & 128) !== 0;
        const compression = format & 127;
        if (compression !== 1 && compression !== 2 && compression !== 3 && compression !== 4) {
            throw new MineRenderError(`Unsupported Anvil compression ${compression}`);
        }
        let payload = data.subarray(location.offset + 5, location.offset + 4 + location.length);
        let expected: { x: number; z: number } | undefined;
        if (external) {
            if (!options.region || !options.readExternalChunk) {
                throw new MineRenderError("External Anvil .mcc chunks require region coordinates and readExternalChunk");
            }
            if (![options.region.x, options.region.z].every(Number.isSafeInteger)) {
                throw new RangeError("Anvil region coordinates must be safe integers");
            }
            expected = { x: options.region.x * 32 + location.x, z: options.region.z * 32 + location.z };
            if (![expected.x, expected.z].every(Number.isSafeInteger)) {
                throw new RangeError("External Anvil chunk coordinates must be safe integers");
            }
            const externalData = await options.readExternalChunk(expected.x, expected.z, options.signal);
            options.signal?.throwIfAborted();
            if (externalData === undefined) throw new MineRenderError(`External Anvil chunk c.${expected.x}.${expected.z}.mcc is missing`);
            payload = this.bytes(externalData);
        }
        if (compression === 4) {
            payload = decodeAnvilLz4(payload);
        } else if (compression !== 3) {
            const stream = new Blob([payload]).stream()
                .pipeThrough(new DecompressionStream(compression === 1 ? "gzip" : "deflate"));
            payload = new Uint8Array(await new Response(stream).arrayBuffer());
        }
        options.signal?.throwIfAborted();
        const nbt = await NBTHelper.fromBuffer(payload, "big");
        options.signal?.throwIfAborted();
        return { root: nbt.value, expected };
    }

    private static async readChunk(data: Uint8Array, location: ChunkLocation, options: AnvilParseOptions): Promise<AnvilChunk> {
        const { root, expected } = await this.readNBT(data, location, options);
        const level = root.Level?.type === "compound" ? root.Level.value : root;
        const dataVersion = root.DataVersion?.type === "int" ? root.DataVersion.value : undefined;
        const chunk: AnvilChunk = {
            x: this.integer(level.xPos, "xPos"), z: this.integer(level.zPos, "zPos"),
            dataVersion, sections: []
        };
        if (((chunk.x % 32) + 32) % 32 !== location.x || ((chunk.z % 32) + 32) % 32 !== location.z) {
            throw new MineRenderError("Anvil chunk coordinates do not match its region location");
        }
        if (expected && (chunk.x !== expected.x || chunk.z !== expected.z)) {
            throw new MineRenderError(`Anvil chunk coordinates do not match external file c.${expected.x}.${expected.z}.mcc`);
        }
        const numericStates = new Map<number, Block | undefined>();
        for (const section of this.compounds(level.sections ?? level.Sections, "sections")) {
            const y = this.integer(section.Y, "section Y");
            let data: ChunkData;
            if (section.Blocks || section.Data || section.Add) {
                if (section.Palette || section.BlockStates || section.block_states) {
                    throw new MineRenderError(`Anvil section ${y} mixes numeric and paletted block states`);
                }
                data = this.numericSection(section, y, options, numericStates);
            } else {
                if (section.block_states && section.block_states.type !== "compound") {
                    throw new MineRenderError("Anvil block_states must be a compound");
                }
                const modern = section.block_states?.type === "compound" ? section.block_states.value : undefined;
                const paletteTag = modern ? modern.palette : section.Palette;
                const palette = paletteTag?.type === "list" && paletteTag.value.type === "string"
                    ? paletteTag.value.value as string[] : this.compounds(paletteTag, "block palette");
                data = new ChunkData();
                if (palette.length) {
                    const states = palette.map(entry => this.block(entry));
                    const indices = this.unpack(modern ? modern.data : section.BlockStates, states.length, !!modern, dataVersion);
                    for (let index = 0; index < 4096; index++) {
                        const state = states[indices[index]];
                        if (!state) throw new MineRenderError(`Anvil palette index ${indices[index]} is out of range`);
                        if (!ChunkData.isAir(state)) data.set(index, state);
                    }
                } else if (modern || section.Palette || section.BlockStates) {
                    throw new MineRenderError("Anvil section has block states without a palette");
                }
            }
            if (chunk.sections.some(section => section.y === y)) throw new MineRenderError(`Duplicate Anvil section Y ${y}`);
            const biomes = this.biomes(section.biomes);
            chunk.sections.push({ y, data, ...(biomes ? { biomes } : {}) });
        }
        for (const entry of this.compounds(level.block_entities ?? level.TileEntities, "block entities")) {
            const x = this.integer(entry.x, "block entity x") - chunk.x * 16;
            const y = this.integer(entry.y, "block entity y");
            const z = this.integer(entry.z, "block entity z") - chunk.z * 16;
            const sectionY = Math.floor(y / 16);
            const section = chunk.sections.find(section => section.y === sectionY);
            if (!section || x < 0 || x >= 16 || z < 0 || z >= 16) continue;
            const index = x + z * 16 + (y - sectionY * 16) * 256;
            const block = section.data.get(index);
            if (block) section.data.set(index, { ...block, nbt: { type: "compound", value: entry } });
        }
        const entities = this.entities(level.entities ?? level.Entities);
        if (entities.length) chunk.entities = entities;
        return chunk;
    }

    private static numericSection(section: CompoundValue, y: number, options: AnvilParseOptions, states: Map<number, Block | undefined>): ChunkData {
        const bytes = (name: string, length: number, optional = false): number[] | undefined => {
            const tag = section[name];
            if (!tag && optional) return undefined;
            if (tag?.type !== "byteArray" || !Array.isArray(tag.value) || tag.value.length !== length) {
                throw new MineRenderError(`Anvil section ${y} ${name} must contain ${length} bytes`);
            }
            return tag.value;
        };
        const ids = bytes("Blocks", 4096)!;
        const metadata = bytes("Data", 2048, true);
        const extra = bytes("Add", 2048, true);
        const data = new ChunkData();
        for (let index = 0; index < 4096; index++) {
            // Anvil stores metadata and extended IDs in low-nibble-first pairs, in x/z/y order.
            const shift = (index & 1) * 4;
            const id = (ids[index] & 255) | ((((extra?.[index >> 1] ?? 0) >> shift) & 15) << 8);
            const value = ((metadata?.[index >> 1] ?? 0) >> shift) & 15;
            const key = id * 16 + value;
            if (!states.has(key)) states.set(key, resolveLegacyBlock(id, value, options.legacyMappings, options.lenient));
            const block = states.get(key);
            if (!block && !options.lenient) {
                throw new MineRenderError(`Unsupported legacy block ${id}:${value} at Anvil section ${y} index ${index}`);
            }
            if (block && !ChunkData.isAir(block)) data.set(index, block);
        }
        return data;
    }

    private static entities(tag: NBTTag): MultiBlockEntity[] {
        return this.compounds(tag, "entities").map(value => {
            const position = value.Pos;
            if (position?.type !== "list" || position.value.type !== "double"
                || position.value.value.length !== 3 || !position.value.value.every(Number.isFinite)) {
                throw new MineRenderError("Anvil entity Pos must contain three coordinates");
            }
            return { position: [...position.value.value] as [number, number, number], nbt: { type: "compound", value } };
        });
    }

    private static biomes(tag: NBTTag): string[] | undefined {
        if (!tag) return undefined;
        if (tag.type !== "compound") throw new MineRenderError("Anvil biomes must be a compound");
        const { palette, data } = tag.value;
        if (palette?.type !== "list" || palette.value.type !== "string"
            || palette.value.value.length < 1 || palette.value.value.length > 64
            || !palette.value.value.every(id => typeof id === "string" && id.length > 0)) {
            throw new MineRenderError("Anvil biome palette must contain 1 to 64 nonempty biome IDs");
        }
        const ids = palette.value.value as string[];
        if (ids.length === 1 && (!data || (data.type === "longArray" && data.value.length === 0))) {
            return Array<string>(64).fill(ids[0]);
        }
        if (data?.type !== "longArray") throw new MineRenderError("Anvil biomes are missing their long array");
        const bits = Math.max(1, Math.ceil(Math.log2(ids.length)));
        const perLong = Math.floor(64 / bits);
        const expected = ids.length === 1 ? 0 : Math.ceil(64 / perLong);
        if (data.value.length !== expected) throw new MineRenderError(`Invalid Anvil biome array length: expected ${expected}`);
        const mask = (1 << bits) - 1;
        const biomes: string[] = [];
        for (let index = 0; index < 64; index++) {
            const [high, low] = data.value[Math.floor(index / perLong)];
            const shift = (index % perLong) * bits;
            let value = shift < 32 ? low >>> shift : high >>> (shift - 32);
            if (shift < 32 && shift + bits > 32) value += (high >>> 0) * 2 ** (32 - shift);
            const id = value & mask;
            if (id >= ids.length) throw new MineRenderError(`Anvil biome palette index ${id} is out of range`);
            biomes.push(ids[id]);
        }
        return biomes;
    }

    private static compounds(tag: NBTTag, name: string): CompoundValue[] {
        if (!tag) return [];
        if (tag.type !== "list" || (tag.value.type !== "compound" && tag.value.value.length !== 0)) {
            throw new MineRenderError(`Anvil ${name} must be a compound list`);
        }
        return tag.value.value as CompoundValue[];
    }

    private static integer(tag: NBTTag, name: string): number {
        if (!tag || typeof tag.value !== "number" || !Number.isInteger(tag.value)) {
            throw new MineRenderError(`Anvil ${name} must be an integer`);
        }
        return tag.value;
    }

    private static block(entry: CompoundValue | string): Block {
        if (typeof entry === "string") entry = { id: { type: "string", value: entry } };
        // Mixed NBT lists wrap scalar entries in a compound with an empty key.
        if (Object.keys(entry).length === 1 && entry[""]?.type === "string") entry = { id: entry[""] };
        const name = entry.id ?? entry.Name;
        const properties = entry.properties ?? entry.Properties;
        if (name?.type !== "string" || !name.value) throw new MineRenderError("Anvil palette entry has no block name");
        const block: Block = { type: name.value };
        if (properties?.type === "compound") {
            block.properties = {};
            for (const [key, value] of Object.entries(properties.value)) {
                if (value?.type !== "string") throw new MineRenderError("Anvil block properties must be strings");
                block.properties[key] = value.value;
            }
        }
        return block;
    }

    private static unpack(tag: NBTTag, paletteSize: number, modern: boolean, dataVersion?: number): Uint16Array {
        const indices = new Uint16Array(4096);
        if (paletteSize === 1 && (!tag || (tag.type === "longArray" && tag.value.length === 0))) return indices;
        if (tag?.type !== "longArray") throw new MineRenderError("Anvil section is missing its block-state long array");
        const bits = Math.max(4, Math.ceil(Math.log2(paletteSize)));
        if (paletteSize > 4096) throw new MineRenderError("Anvil block palette exceeds 4096 entries");
        if (!modern && dataVersion === undefined && 64 % bits !== 0) {
            throw new MineRenderError("Anvil DataVersion is required to decode this block-state layout");
        }
        // DataVersion 2527 added padding so each block-state index fits within one long.
        const padded = modern || (dataVersion ?? 0) >= 2527;
        const perLong = Math.floor(64 / bits);
        const expected = padded ? Math.ceil(4096 / perLong) : Math.ceil(4096 * bits / 64);
        if (tag.value.length !== expected) throw new MineRenderError(`Invalid Anvil block-state array length: expected ${expected}`);
        const words = tag.value.map(([high, low]) => [high >>> 0, low >>> 0]);
        const mask = (1 << bits) - 1;
        for (let index = 0; index < 4096; index++) {
            const bitPos = index * bits;
            const word = padded ? Math.floor(index / perLong) : bitPos >>> 6;
            const shift = padded ? (index % perLong) * bits : bitPos & 63;
            const [high, low] = words[word];
            let value = shift < 32 ? low >>> shift : high >>> (shift - 32);
            if (shift < 32 && shift + bits > 32) value += high * 2 ** (32 - shift);
            if (!padded && shift + bits > 64) value += words[word + 1][1] * 2 ** (64 - shift);
            indices[index] = value & mask;
        }
        return indices;
    }

}
