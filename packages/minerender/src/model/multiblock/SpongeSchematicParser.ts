import type { Compound, NBT } from "prismarine-nbt";
import { MineRenderError } from "../../error/MineRenderError";
import { TripleArray } from "../Model";
import { BlockStateProperties } from "../block/BlockStateProperties";
import { MultiBlockBlock, MultiBlockStructure } from "./MultiBlockStructure";

/** Converts Sponge v2/v3 `.schem` NBT into blocks and preserved entity data. */
export class SpongeSchematicParser {

    /**
     * Parses decoded NBT with a local block palette, omitting air blocks.
     * Applies Offset to block and entity positions; size remains the source dimensions.
     * Biomes and metadata are not imported, and DataVersion does not trigger migration.
     */
    public static async parse(nbt: NBT): Promise<MultiBlockStructure> {
        const tags = nbt.value.Schematic === undefined ? nbt.value : compound(nbt.value.Schematic, "Schematic");
        const version = integer(tags.Version, "Version");
        if (version !== 2 && version !== 3) {
            throw new MineRenderError(`Unsupported Sponge schematic version ${version}; expected 2 or 3`);
        }
        const dataVersion = integer(tags.DataVersion, "DataVersion");
        const size = ["Width", "Height", "Length"].map(name => {
            const tag = tags[name];
            if (tag?.type !== "short" || !Number.isInteger(tag.value) ||
                tag.value < -32768 || tag.value > 65535 || tag.value === 0) {
                throw new MineRenderError(`Sponge schematic ${name} must be a positive unsigned short`);
            }
            return tag.value & 0xffff;
        }) as TripleArray;
        const offset = tags.Offset === undefined ? [0, 0, 0] as TripleArray : intPosition(tags.Offset, "Offset");
        const blocks: MultiBlockBlock[] = [];
        const container = version === 2 ? tags : tags.Blocks === undefined ? undefined : compound(tags.Blocks, "Blocks");
        if (container) {
            const paletteTag = container.Palette;
            if (!paletteTag) throw new MineRenderError("Sponge schematic requires a local Palette; global block IDs are not supported");
            const palette = new Map<number, { type: string; properties: BlockStateProperties }>();
            const paletteMax = version === 2 && tags.PaletteMax !== undefined ? integer(tags.PaletteMax, "PaletteMax") : undefined;
            if (paletteMax !== undefined && paletteMax <= 0) throw new MineRenderError("Sponge schematic PaletteMax must be positive");
            for (const [state, tag] of Object.entries(compound(paletteTag, "Palette"))) {
                const id = integer(tag, "Palette index");
                if (id < 0 || palette.has(id) || (paletteMax !== undefined && id >= paletteMax)) {
                    throw new MineRenderError(`Invalid or duplicate Sponge schematic palette index ${id}`);
                }
                palette.set(id, blockState(state));
            }
            const [width, height, length] = size;
            const volume = width * height * length;
            const data = container[version === 2 ? "BlockData" : "Data"];
            if (data?.type !== "byteArray" || !Array.isArray(data.value) || data.value.length < volume) {
                throw new MineRenderError(`Sponge schematic block data must contain ${volume} varints`);
            }
            const blockEntities = new Map<number, Compound>();
            for (const entity of compoundList(container, "BlockEntities")) {
                const pos = intPosition(entity.Pos, "BlockEntities Pos");
                if (pos.some((value, axis) => value < 0 || value >= size[axis])) {
                    throw new MineRenderError("Sponge schematic block entity position is outside its dimensions");
                }
                const index = pos[0] + pos[2] * width + pos[1] * width * length;
                if (blockEntities.has(index)) throw new MineRenderError(`Duplicate Sponge schematic block entity at index ${index}`);
                const value = entityData(entity, version);
                for (const [axis, name] of ["x", "y", "z"].entries()) {
                    value[name] = { type: "int", value: pos[axis] + offset[axis] };
                }
                blockEntities.set(index, { type: "compound", value });
            }
            let cursor = 0;
            for (let index = 0; index < volume; index++) {
                let id = 0;
                for (let shift = 0; ; shift += 7) {
                    const byte = data.value[cursor++];
                    if (!Number.isInteger(byte) || byte < -128 || byte > 255) {
                        throw new MineRenderError(`Invalid or truncated Sponge schematic varint at index ${index}`);
                    }
                    const unsigned = byte & 0xff;
                    if (shift === 28 && unsigned > 7) {
                        throw new MineRenderError(`Sponge schematic varint exceeds a nonnegative int at index ${index}`);
                    }
                    id += (unsigned & 0x7f) * 2 ** shift;
                    if ((unsigned & 0x80) === 0) break;
                }
                const state = palette.get(id);
                if (!state) throw new MineRenderError(`Sponge schematic palette index ${id} does not exist`);
                if (["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].includes(state.type)) continue;
                blocks.push({
                    type: state.type, properties: { ...state.properties },
                    position: [index % width + offset[0], Math.floor(index / (width * length)) + offset[1],
                        Math.floor(index / width) % length + offset[2]],
                    nbt: blockEntities.get(index)
                });
            }
            if (cursor !== data.value.length) throw new MineRenderError("Sponge schematic block data has trailing bytes");
        }
        const entities = compoundList(tags, "Entities").map(entity => {
            const pos = entity.Pos;
            if (pos?.type !== "list" || pos.value.type !== "double" || pos.value.value.length !== 3 ||
                !pos.value.value.every(Number.isFinite)) {
                throw new MineRenderError("Sponge schematic entity Pos must contain three doubles");
            }
            const position = pos.value.value.map((value, axis) => (value as number) + offset[axis]) as TripleArray;
            const value = entityData(entity, version);
            value.Pos = { type: "list", value: { type: "double", value: [...position] } };
            return { position, nbt: { type: "compound", value } };
        });
        return { size, blocks, entities, dataVersion };
    }

}

type Tag = Compound["value"][string];

function integer(tag: Tag, name: string): number {
    if (tag?.type !== "int" || !Number.isInteger(tag.value) || tag.value < -2147483648 || tag.value > 2147483647) {
        throw new MineRenderError(`Sponge schematic ${name} must be an int`);
    }
    return tag.value;
}

function compound(tag: Tag, name: string): Compound["value"] {
    if (tag?.type !== "compound" || !tag.value || typeof tag.value !== "object" || Array.isArray(tag.value)) {
        throw new MineRenderError(`Sponge schematic ${name} must be a compound`);
    }
    return tag.value;
}

function intPosition(tag: Tag, name: string): TripleArray {
    if (tag?.type !== "intArray" || !Array.isArray(tag.value) || tag.value.length !== 3 ||
        !tag.value.every(value => Number.isInteger(value) && value >= -2147483648 && value <= 2147483647)) {
        throw new MineRenderError(`Sponge schematic ${name} must contain three ints`);
    }
    return [...tag.value] as TripleArray;
}

function compoundList(tags: Compound["value"], name: string): Compound["value"][] {
    const tag = tags[name];
    if (tag === undefined) return [];
    if (tag.type === "list" && Array.isArray(tag.value.value)) {
        if (tag.value.value.length === 0) return [];
        if (tag.value.type === "compound") return tag.value.value as Compound["value"][];
    }
    throw new MineRenderError(`Sponge schematic ${name} must be a compound list`);
}

function blockState(state: string): { type: string; properties: BlockStateProperties } {
    const match = /^((?:[a-z0-9_.-]+:)?[a-z0-9_./-]+)(?:\[([^\[\]]*)\])?$/.exec(state);
    if (!match) throw new MineRenderError(`Invalid Sponge schematic block state ${state}`);
    const properties: BlockStateProperties = {};
    if (match[2]) {
        for (const entry of match[2].split(",")) {
            const pair = /^([a-z0-9_]+)=([^\s=,\[\]]+)$/.exec(entry);
            if (!pair || Object.prototype.hasOwnProperty.call(properties, pair[1])) throw new MineRenderError(`Invalid Sponge schematic block state ${state}`);
            Object.defineProperty(properties, pair[1], { value: pair[2], enumerable: true, writable: true, configurable: true });
        }
    }
    return { type: match[1].includes(":") ? match[1] : `minecraft:${match[1]}`, properties };
}

function entityData(entity: Compound["value"], version: number): Compound["value"] {
    const id = entity.Id;
    if (id?.type !== "string" || !id.value) throw new MineRenderError("Sponge schematic entity Id must be a nonempty string");
    const { Id, Pos, ...extra } = entity;
    const value = version === 2 ? extra : entity.Data === undefined ? {} : { ...compound(entity.Data, "entity Data") };
    value.id = { type: "string", value: id.value.includes(":") ? id.value : `minecraft:${id.value}` };
    return value;
}
