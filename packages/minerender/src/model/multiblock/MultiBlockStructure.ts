import { TripleArray } from "../Model";
import { Block } from "../block/Block";

export interface MultiBlockStructure {

    readonly size: TripleArray;
    readonly blocks: MultiBlockBlock[];
    readonly dataVersion?: number;
    readonly entities?: MultiBlockEntity[];

}

export interface MultiBlockEntity {
    position: TripleArray;
    blockPosition?: TripleArray;
    nbt: unknown;
}

export interface MultiBlockBlock extends Block {
    position: TripleArray;
}
