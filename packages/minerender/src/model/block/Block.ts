import { BlockStateProperties } from "./BlockStateProperties";
import { TripleArray } from "../Model";

/** Block data passed to world setters. `type` is a namespaced ID such as `minecraft:oak_log`. */
export interface Block {

    type: string;
    properties?: BlockStateProperties;
    nbt?: any;

}
