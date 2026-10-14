import { DEFAULT_NAMESPACE } from "../../assets/Assets";
import { MineRenderData, MineRenderDatasets } from "../../assets/MineRenderData";
import { CUBE_FACES, CubeFace } from "../../CubeFace";
import type { Block } from "../../model/block/Block";
import type { Maybe } from "../../util/util";

export type BlockCullingData = MineRenderDatasets["blockCulling"];
export type BlockCullingRule = BlockCullingData["profiles"][number];
type CullingBlock = Pick<Block, "type" | "properties">;

/** Loads vanilla's neighbor face rules, if the selected version publishes them. */
export async function loadBlockCulling(root?: string): Promise<Maybe<BlockCullingData>> {
    const { manifest } = await MineRenderData.resolve(root);
    return manifest.datasets.blockCulling ? MineRenderData.get("blockCulling", root) : undefined;
}

/** The rule of a block type, or `undefined` when the block hides no faces this way. */
export function blockCullingRule(data: BlockCullingData, type: string): Maybe<BlockCullingRule> {
    if (!type.includes(":")) type = `${DEFAULT_NAMESPACE}:${type}`;
    return Object.prototype.hasOwnProperty.call(data.blocks, type) ? data.profiles[data.blocks[type]] : undefined;
}

/** `face` indexes CUBE_FACES. Occlusion by opaque cubes is a separate check. */
export function skipsBlockFace(data: BlockCullingData, rule: BlockCullingRule, block: CullingBlock, neighbor: CullingBlock, face: number): boolean {
    const type = block.type.includes(":") ? block.type : `${DEFAULT_NAMESPACE}:${block.type}`;
    const other = neighbor.type.includes(":") ? neighbor.type : `${DEFAULT_NAMESPACE}:${neighbor.type}`;
    const same = type === other;
    const vertical = CUBE_FACES[face] === CubeFace.UP || CUBE_FACES[face] === CubeFace.DOWN;
    switch (rule.type) {
        case "same_block": return same;
        case "same_block_vertical": return same && vertical;
        case "connected": {
            if (vertical) return same;
            const group = rule.group ? data.groups?.[rule.group] : undefined;
            return (same || !!group?.includes(type) && group.includes(other))
                && String(block.properties?.[CUBE_FACES[face]]) === "true"
                && String(neighbor.properties?.[CUBE_FACES[face ^ 1]]) === "true";
        }
        default: return false;
    }
}
