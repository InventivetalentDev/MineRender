import { BlockStateProperties } from "./BlockStateProperties";
import { TripleArray } from "../Model";

export interface Block {

    type: string;
    properties?: BlockStateProperties;
    nbt?: any;

}
