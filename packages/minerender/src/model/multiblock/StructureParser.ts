import { MultiBlockBlock, MultiBlockStructure } from "./MultiBlockStructure";
import { TripleArray } from "../Model";
import type { NBT } from "prismarine-nbt";
import { MineRenderError } from "../../error/MineRenderError";
import { BlockStateProperties } from "../block/BlockStateProperties";

/** Converts Java structure NBT into blocks and preserved entity data for world placement. */
export class StructureParser {

    /**
     * Parses decoded NBT, omitting air blocks.
     * @param _nbt - Structure data decoded by {@link NBTHelper.fromBuffer}.
     * @param paletteIndex - Palette to select when the structure has several. Defaults to 0.
     */
    public static async parse(_nbt: NBT, paletteIndex?: number): Promise<MultiBlockStructure> {
        const nbt = _nbt.value as unknown as StructureNBT;

        let palette: Palette;
        if ("palette" in nbt) {
            palette = nbt.palette!;
        } else if ("palettes" in nbt) {
            const selected = nbt.palettes!.value.value[paletteIndex ?? 0];
            if (!selected) throw new MineRenderError(`Structure palette ${paletteIndex ?? 0} does not exist`);
            palette = { type: "list", value: selected };
        } else {
            throw new MineRenderError("Structure does not have palette(s)");
        }

        const blocks: MultiBlockBlock[] =
            nbt.blocks.value.value.map(block => {
                const state = palette.value.value[block.state.value];
                if (!state) throw new MineRenderError(`Structure palette index ${block.state.value} does not exist`);
                if (["minecraft:air", "minecraft:cave_air", "minecraft:void_air"].includes(state.Name.value)) return undefined;

                const props: BlockStateProperties = {};
                for (let k in state.Properties?.value) {
                    props[k] = state.Properties.value[k].value;
                }
                return <MultiBlockBlock>{
                    type: state.Name.value,
                    properties: props,
                    position: block.pos.value.value,
                    nbt: block.nbt
                }
            }).filter(m => typeof m !== "undefined") as  MultiBlockBlock[] ;
        return {
            blocks: blocks,
            size: nbt.size.value.value,
            dataVersion: nbt.DataVersion?.value,
            entities: (nbt.entities?.value.value ?? []).map(entity => ({
                position: entity.pos.value.value,
                blockPosition: entity.blockPos.value.value,
                nbt: entity.nbt
            }))
        }
    }

}

/** Tagged NBT fields used by Java structure files. */
export interface StructureNBT {
    DataVersion?: {
        type: "int";
        value: number;
    }
    size: {
        type: "list";
        value: {
            type: "int";
            value: TripleArray;
        }
    }
    palette?: Palette;
    palettes?: {
        type: "list";
        value: { type: "list"; value: Palette["value"][] };
    };
    blocks: {
        type: "list";
        value: {
            type: "compound";
            value: BlockEntry[];
        }
    }
    entities?: {
        type: "list";
        value: {
            type: "compound";
            value: {
                pos: { type: "list"; value: { type: "double"; value: TripleArray } };
                blockPos: { type: "list"; value: { type: "int"; value: TripleArray } };
                nbt: { type: "compound"; value: any };
            }[];
        };
    };
}

interface Palette {
    type: "list";
    value: {
        type: "compound";
        value: PaletteEntry[]
    }
}

interface PaletteEntry {
    Name: {
        type: "string";
        value: string;
    }
    Properties: {
        type: "compound";
        value: { [property: string]: PalettePropertyValue; };
    }
}

interface PalettePropertyValue {
    type: string;
    value: string;
}

interface BlockEntry {
    pos: {
        type: "list";
        value: {
            type: "int";
            value: TripleArray;
        }
    }
    state: {
        type: "int";
        value: number;
    }
    nbt: {
        type: "compound";
        value: any;
    }
}
