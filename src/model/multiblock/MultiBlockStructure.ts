import { TripleArray } from "../Model";
import { BlockStateProperties } from "../block/BlockStateProperties";

export interface MultiBlockStructure {

    readonly size: TripleArray;
    readonly blocks: MultiBlockBlock[];

}

export interface MultiBlockBlock {

    readonly type: string;
    readonly properties: BlockStateProperties;
    readonly position: TripleArray;
    readonly nbt?: any;

}
