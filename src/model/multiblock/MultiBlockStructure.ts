import { TripleArray } from "../Model";
import { BlockStateProperties } from "../block/BlockStateProperties";
import { Block } from "../block/Block";

export interface MultiBlockStructure {

    readonly size: TripleArray;
    readonly blocks: MultiBlockBlock[];

}

export interface MultiBlockBlock extends Block {
    position: TripleArray;
}
