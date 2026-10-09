import type { Compound, NBT } from "prismarine-nbt";
import { MineRenderError } from "../../error/MineRenderError";
import { Block } from "../block/Block";
import { TripleArray } from "../Model";
import { MultiBlockBlock, MultiBlockStructure } from "./MultiBlockStructure";

/** A named region with block and entity positions relative to the schematic origin. */
export interface LitematicaRegion extends MultiBlockStructure {
    readonly name: string;
    /** The selected first corner, relative to the schematic origin. */
    readonly position: TripleArray;
    /** Signed source dimensions. The inherited size contains their absolute values. */
    readonly signedSize: TripleArray;
}

/** Combined blocks and the named regions that produced them. */
export interface LitematicaStructure extends MultiBlockStructure {
    readonly regions: LitematicaRegion[];
}

/** Reads v5–7 `.litematic` files without migrating block states or entity NBT. */
export class LitematicaParser {

    /**
     * Parses decoded NBT, preserving subregion placement and omitting air.
     * Later entries in regions replace earlier cells, including with air.
     * Size encloses all region bounds; positions retain the schematic origin.
     * Metadata and scheduled ticks are not imported. Named regions can be placed individually.
     */
    public static async parse(nbt: NBT): Promise<LitematicaStructure> {
        const tags = nbt.value;
        const version = integer(tags.Version, "Version");
        if (version < 5 || version > 7) throw new MineRenderError(`Unsupported Litematica version ${version}; expected 5, 6, or 7`);
        const dataVersion = tags.MinecraftDataVersion === undefined ? undefined : integer(tags.MinecraftDataVersion, "MinecraftDataVersion");
        const blocks = new Map<string, MultiBlockBlock>();
        const regions: LitematicaRegion[] = [];
        const min: TripleArray = [Infinity, Infinity, Infinity];
        const max: TripleArray = [-Infinity, -Infinity, -Infinity];
        for (const [name, tag] of Object.entries(compound(tags.Regions, "Regions"))) {
            const region = readRegion(compound(tag, `region ${name}`), name, dataVersion, blocks);
            regions.push(region);
            for (let axis = 0; axis < 3; axis++) {
                const start = minimum(region.position[axis], region.signedSize[axis]);
                min[axis] = Math.min(min[axis], start);
                max[axis] = Math.max(max[axis], start + region.size[axis]);
            }
        }
        return {
            size: regions.length ? min.map((value, axis) => max[axis] - value) as TripleArray : [0, 0, 0],
            blocks: [...blocks.values()], entities: regions.flatMap(region => region.entities ?? []), dataVersion, regions
        };
    }

}

type Tag = Compound["value"][string];

function readRegion(tags: Compound["value"], name: string, dataVersion: number | undefined,
                    combined: Map<string, MultiBlockBlock>): LitematicaRegion {
    const position = blockPosition(compound(tags.Position, `region ${name} Position`));
    const signedSize = blockPosition(compound(tags.Size, `region ${name} Size`));
    if (signedSize.some(value => value === 0)) throw new MineRenderError(`Litematica region ${name} dimensions must be nonzero`);
    const size = signedSize.map(Math.abs) as TripleArray;
    const min = position.map((value, axis) => minimum(value, signedSize[axis])) as TripleArray;
    const [width, height, length] = size;
    const volume = width * height * length;
    const palette = compounds(tags.BlockStatePalette, "BlockStatePalette").map(blockState);
    if (!palette.length) throw new MineRenderError(`Litematica region ${name} has no block palette`);
    const bits = Math.max(2, Math.ceil(Math.log2(palette.length)));
    if (!Number.isSafeInteger(volume * bits)) throw new MineRenderError(`Litematica region ${name} volume is too large`);
    const packed = tags.BlockStates;
    const expected = Math.ceil(volume * bits / 64);
    if (packed?.type !== "longArray" || !Array.isArray(packed.value) || packed.value.length !== expected) {
        throw new MineRenderError(`Litematica region ${name} BlockStates must contain ${expected} longs`);
    }
    const words = packed.value.map(pair => {
        if (!Array.isArray(pair) || pair.length !== 2 ||
            !pair.every(value => Number.isInteger(value) && value >= -2147483648 && value <= 4294967295)) {
            throw new MineRenderError(`Litematica region ${name} has an invalid BlockStates long`);
        }
        return (BigInt(pair[0] >>> 0) << 32n) | BigInt(pair[1] >>> 0);
    });
    const blockEntities = new Map<number, Compound>();
    for (const tile of compounds(tags.TileEntities, "TileEntities")) {
        const pos = blockPosition(tile);
        if (pos.some((value, axis) => value < 0 || value >= size[axis])) {
            throw new MineRenderError(`Litematica region ${name} block entity is outside its dimensions`);
        }
        const index = pos[0] + pos[2] * width + pos[1] * width * length;
        if (blockEntities.has(index)) throw new MineRenderError(`Duplicate Litematica block entity at index ${index}`);
        const value = { ...tile };
        for (const [axis, key] of ["x", "y", "z"].entries()) value[key] = { type: "int", value: pos[axis] + min[axis] };
        blockEntities.set(index, { type: "compound", value });
    }
    const blocks: MultiBlockBlock[] = [];
    const mask = (1n << BigInt(bits)) - 1n;
    for (let index = 0; index < volume; index++) {
        const word = Math.floor(index * bits / 64);
        const shift = index * bits % 64;
        let value = words[word] >> BigInt(shift);
        // Litematica packs continuously, so an index can span two longs.
        if (shift + bits > 64) value |= words[word + 1] << BigInt(64 - shift);
        const id = Number(value & mask);
        const state = palette[id];
        if (!state) throw new MineRenderError(`Litematica region ${name} palette index ${id} does not exist`);
        const pos: TripleArray = [index % width + min[0], Math.floor(index / (width * length)) + min[1],
            Math.floor(index / width) % length + min[2]];
        const key = pos.join(",");
        if (["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].includes(state.type)) {
            combined.delete(key);
            continue;
        }
        const block = { type: state.type, properties: { ...state.properties }, position: pos, nbt: blockEntities.get(index) };
        blocks.push(block);
        combined.set(key, block);
    }
    const entities = compounds(tags.Entities, "Entities").map(entity => {
        const pos = entity.Pos;
        if (pos?.type !== "list" || pos.value.type !== "double" || pos.value.value.length !== 3 ||
            !pos.value.value.every(Number.isFinite)) {
            throw new MineRenderError(`Litematica region ${name} entity Pos must contain three doubles`);
        }
        // Entity positions use the selected first corner, even when the region size is negative.
        const absolute = pos.value.value.map((value, axis) => (value as number) + position[axis]) as TripleArray;
        const value: Compound["value"] = { ...entity, Pos: { type: "list", value: { type: "double", value: [...absolute] } } };
        return { position: absolute, nbt: { type: "compound", value } };
    });
    return { name, position, signedSize, size, blocks, entities, dataVersion };
}

function minimum(position: number, size: number): number {
    return position + Math.min(0, size + 1);
}

function integer(tag: Tag, name: string): number {
    if (tag?.type !== "int" || !Number.isInteger(tag.value) || tag.value < -2147483648 || tag.value > 2147483647) {
        throw new MineRenderError(`Litematica ${name} must be an int`);
    }
    return tag.value;
}

function compound(tag: Tag, name: string): Compound["value"] {
    if (tag?.type !== "compound" || !tag.value || typeof tag.value !== "object" || Array.isArray(tag.value)) {
        throw new MineRenderError(`Litematica ${name} must be a compound`);
    }
    return tag.value;
}

function blockPosition(tags: Compound["value"]): TripleArray {
    return ["x", "y", "z"].map(axis => integer(tags[axis], axis)) as TripleArray;
}

function compounds(tag: Tag, name: string): Compound["value"][] {
    if (tag === undefined) return [];
    if (tag.type === "list" && Array.isArray(tag.value.value)) {
        if (tag.value.value.length === 0) return [];
        if (tag.value.type === "compound") return tag.value.value as Compound["value"][];
    }
    throw new MineRenderError(`Litematica ${name} must be a compound list`);
}

function blockState(tags: Compound["value"]): Block {
    const name = tags.Name;
    if (name?.type !== "string" || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(name.value)) {
        throw new MineRenderError("Litematica palette entry must have a block Name");
    }
    const properties: Record<string, string> = {};
    if (tags.Properties !== undefined) {
        for (const [key, tag] of Object.entries(compound(tags.Properties, "block Properties"))) {
            if (tag?.type !== "string") throw new MineRenderError("Litematica block properties must be strings");
            Object.defineProperty(properties, key, { value: tag.value, enumerable: true, writable: true, configurable: true });
        }
    }
    return { type: name.value.includes(":") ? name.value : `minecraft:${name.value}`, properties };
}
