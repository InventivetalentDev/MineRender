import { Block } from "../model/block/Block";
import { BlockObject } from "../model/block/scene/BlockObject";

export interface BlockInfo<SectionMeshing extends boolean = false> {
    /** Detached block data; use world or chunk setters to update stored blocks. */
    readonly block: Block;
    /** Merged terrain has no individual render object in section-meshing mode. */
    object: SectionMeshing extends false ? BlockObject : BlockObject | undefined;
}
