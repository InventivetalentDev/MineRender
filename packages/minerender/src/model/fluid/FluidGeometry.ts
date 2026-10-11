import { BufferGeometry, Float32BufferAttribute } from "three";
import type { AssetKey } from "../../assets/AssetKey";
import type { BlockStateProperties } from "../block/BlockStateProperties";
import { MineRenderData, MineRenderDatasets } from "../../assets/MineRenderData";
import { buildFluidQuads } from "./FluidQuads";
import type { FluidKind, FluidSampler } from "./FluidQuads";

export * from "./FluidQuads";

/** Fluid contained in a block and whether the block's ordinary model is also drawn. */
export interface BlockFluidState {
    kind: FluidKind;
    level: number;
    renderModel: boolean;
}

export type FluidRules = MineRenderDatasets["fluids"];

/** Finds water or lava from the block ID and properties, including waterlogged blocks and aquatic plants. */
export async function getBlockFluidState(key?: AssetKey, state?: BlockStateProperties): Promise<BlockFluidState | undefined> {
    return resolveBlockFluidState(key, state, await MineRenderData.get("fluids", key?.root));
}

/** Resolves fluid state using rules already loaded for the block's asset version. */
export function resolveBlockFluidState(key: AssetKey | undefined, state: BlockStateProperties | undefined,
                                       rules: FluidRules): BlockFluidState | undefined {
    const rule = key && rules[key.toNamespacedString()];
    if (rule) return {
        kind: rule.kind,
        level: rule.levelProperty ? Number(state?.[rule.levelProperty] ?? 0) : 0,
        renderModel: rule.renderModel
    };
    return state?.waterlogged === "true" ? { kind: "water", level: 0, renderModel: true } : undefined;
}

export async function getFluidKind(key?: AssetKey, state?: BlockStateProperties): Promise<FluidKind | undefined> {
    return (await getBlockFluidState(key, state))?.kind;
}

/** Builds centered fluid faces with material groups 0 (still) and 1 (flowing). */
export function createFluidGeometry(kind: FluidKind, sample: FluidSampler): BufferGeometry {
    const { positions, normals, uvs, sprites } = buildFluidQuads(kind, sample);
    const geometry = new BufferGeometry();
    const indices: number[] = [];
    for (let quad = 0; quad < sprites.length; quad++) {
        const start = quad * 4;
        geometry.addGroup(indices.length, 6, sprites[quad]);
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
}
