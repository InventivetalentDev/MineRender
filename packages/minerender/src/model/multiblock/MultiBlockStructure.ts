import { TripleArray } from "../Model";
import { Block } from "../block/Block";

/** Parsed blocks and entity data for {@link MineRenderWorld.placeMultiBlock}. Dimensions and positions use blocks. */
export interface MultiBlockStructure {

    readonly size: TripleArray;
    readonly blocks: MultiBlockBlock[];
    readonly dataVersion?: number;
    readonly entities?: MultiBlockEntity[];

}

/** Preserved entity position and NBT. World placement does not create a render object for it. */
export interface MultiBlockEntity {
    position: TripleArray;
    blockPosition?: TripleArray;
    nbt: unknown;
}

/** Block data and its position within a parsed structure. */
export interface MultiBlockBlock extends Block {
    position: TripleArray;
}
