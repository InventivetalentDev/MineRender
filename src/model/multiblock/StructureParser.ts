import { MultiBlockBlock, MultiBlockStructure } from "./MultiBlockStructure";
import { TripleArray } from "../Model";
import { NBT } from "prismarine-nbt";
import { MineRenderError } from "../../error/MineRenderError";
import { BlockStateProperties } from "../block/BlockStateProperties";

export class StructureParser {

    public static async parse(_nbt: NBT, paletteIndex?: number): Promise<MultiBlockStructure> {
        const nbt = _nbt.value as unknown as StructureNBT;

        let palette: Palette;
        if ("palette" in nbt) {
            palette = nbt.palette!;
        } else if ("palettes" in nbt) {
            palette = nbt.palettes![paletteIndex ?? 0];
        } else {
            throw new MineRenderError("Structure does not have palette(s)");
        }

        const blocks: MultiBlockBlock[] =
            nbt.blocks.value.value.map(block => {
                const state = palette.value.value[block.state.value];
                const props: BlockStateProperties = {};
                for (let k in state.Properties?.value) {
                    props[k] = state.Properties.value[k].value;
                }
                return <MultiBlockBlock>{
                    type: state.Name.value,
                    properties: props,
                    position: block.pos.value,
                    nbt: block.nbt
                }
            });
        return {
            blocks: blocks,
            size: nbt.size.value.value
        }
    }

}

export interface StructureNBT {
    DataVersion: {
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
    palettes?: Palette[];
    blocks: {
        type: "list";
        value: {
            type: "compound";
            value: BlockEntry[];
        }
    }
    entities: {};//TODO
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
        value: TripleArray;
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
