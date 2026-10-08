import type { Compound, NBT } from "prismarine-nbt";
import { MineRenderError } from "../../error/MineRenderError";
import { TripleArray } from "../Model";
import { BlockStateProperties } from "../block/BlockStateProperties";
import { MultiBlockBlock, MultiBlockStructure } from "./MultiBlockStructure";
import legacyBlocks from "./legacyBlocks.json";

/** Converts legacy Alpha `.schematic` NBT with numeric block IDs into modern block names and properties. */
export class SchematicParser {

    /**
     * Parses a legacy schematic using custom mappings before the bundled defaults.
     * Keys are `id:metadata`; values are block states such as `minecraft:oak_log[axis=x]`.
     */
    public static async parse(nbt: NBT, customMappings: Readonly<Record<string, string>> = {},
                              options: SchematicParserOptions = {}): Promise<MultiBlockStructure> {
        const tags = nbt.value;
        if (!options.lenient && (tags.Materials?.type !== "string" || tags.Materials.value !== "Alpha")) {
            throw new MineRenderError("Schematic Materials must be Alpha");
        }
        const size = ["Width", "Height", "Length"].map(name => {
            const tag = tags[name];
            if (tag?.type !== "short" || !Number.isInteger(tag.value) || tag.value <= 0 || tag.value > 32767) {
                throw new MineRenderError(`Schematic ${name} must be a positive short`);
            }
            return tag.value;
        }) as TripleArray;
        const [width, height, length] = size;
        const volume = width * height * length;
        const ids = tags.Blocks;
        const data = tags.Data;
        if (ids?.type !== "byteArray" || data?.type !== "byteArray" ||
            !Array.isArray(ids.value) || !Array.isArray(data.value) ||
            ids.value.length !== volume || data.value.length !== volume) {
            throw new MineRenderError(`Schematic Blocks and Data must contain ${volume} bytes`);
        }
        const addBlocks = tags.AddBlocks;
        if (addBlocks && (addBlocks.type !== "byteArray" || !Array.isArray(addBlocks.value))) {
            throw new MineRenderError("Schematic AddBlocks must be a byte array");
        }
        const tileEntities = new Map<number, Compound>();
        for (const tile of compoundList(tags, "TileEntities")) {
            const position = ["x", "y", "z"].map((axis, i) => {
                const coordinate = tile[axis];
                if (coordinate?.type !== "int" || !Number.isInteger(coordinate.value) ||
                    coordinate.value < 0 || coordinate.value >= size[i]) {
                    throw new MineRenderError("Schematic TileEntities position is outside its dimensions");
                }
                return coordinate.value;
            });
            const [x, y, z] = position;
            tileEntities.set((y * length + z) * width + x, { type: "compound", value: tile });
        }
        const blocks: MultiBlockBlock[] = [];
        const mapping: Record<string, string> = legacyBlocks.blocks;
        for (let index = 0; index < volume; index++) {
            const packed = addBlocks?.value[index >> 1] ?? 0;
            const high = (packed >> ((index & 1) * 4)) & 0xf;
            const id = (high << 8) | (ids.value[index] & 0xff);
            const metadata = data.value[index] & 0xff;
            const key = `${id}:${metadata}`;
            let mapped = customMappings[key] ?? mapping[key];
            if (!mapped && options.lenient) {
                mapped = customMappings[`${id}:0`] ?? mapping[`${id}:0`];
            }
            if (!mapped) {
                if (options.lenient) {
                    continue;
                }
                throw new MineRenderError(`Unsupported legacy block ${id}:${metadata} at schematic index ${index}`);
            }
            const [type, state] = mapped.split("[");
            if (type === "minecraft:air") continue;
            const properties: BlockStateProperties = {};
            if (state) {
                for (const property of state.slice(0, -1).split(",")) {
                    const [key, value] = property.split("=");
                    properties[key] = value;
                }
            }
            blocks.push({
                type, properties,
                position: [index % width, Math.floor(index / (width * length)), Math.floor(index / width) % length],
                nbt: tileEntities.get(index)
            });
        }
        const entities = compoundList(tags, "Entities").map(entity => {
            const pos = entity.Pos;
            if (pos?.type !== "list" || pos.value.type !== "double" || pos.value.value.length !== 3 ||
                !pos.value.value.every(Number.isFinite)) {
                throw new MineRenderError("Schematic entity Pos must contain three doubles");
            }
            return { position: [...pos.value.value] as TripleArray, nbt: { type: "compound", value: entity } };
        });
        const dataVersion = tags.DataVersion;
        if (dataVersion && (dataVersion.type !== "int" || !Number.isInteger(dataVersion.value))) {
            throw new MineRenderError("Schematic DataVersion must be an int");
        }
        return { size, blocks, entities, dataVersion: dataVersion?.value };
    }

}

export interface SchematicParserOptions {
    /**
     * Ignores Materials, tries metadata 0 for unmapped states, and skips unknown IDs. Defaults to false.
     * Dimensions, arrays, and entity data remain validated.
     */
    lenient?: boolean;
}

function compoundList(tags: Compound["value"], name: string): Compound["value"][] {
    const tag = tags[name];
    if (!tag) return [];
    if (tag.type === "list" && Array.isArray(tag.value.value)) {
        if (tag.value.value.length === 0) return [];
        if (tag.value.type === "compound") return tag.value.value as Compound["value"][];
    }
    throw new MineRenderError(`Schematic ${name} must be a compound list`);
}
