import { Block } from "../model/block/Block";
import { BlockObject } from "../model/block/scene/BlockObject";

export interface BlockInfo {
    /** Detached block data; use world or chunk setters to update stored blocks. */
    readonly block: Block;
    object: BlockObject;
}
