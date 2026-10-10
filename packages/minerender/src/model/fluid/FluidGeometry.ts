import { BufferGeometry, Float32BufferAttribute } from "three";
import type { AssetKey } from "../../assets/AssetKey";
import type { BlockStateProperties } from "../block/BlockStateProperties";
import fluidBlocks from "./fluidBlocks.json";
import { buildFluidQuads } from "./FluidQuads";
import type { FluidKind, FluidSampler } from "./FluidQuads";

export * from "./FluidQuads";

/** Fluid contained in a block and whether the block's ordinary model is also drawn. */
export interface BlockFluidState {
    kind: FluidKind;
    level: number;
    renderModel: boolean;
}

const fluidRules = fluidBlocks as Record<string, { kind: FluidKind; levelProperty?: string; renderModel: boolean }>;

/** Finds water or lava from the block ID and properties, including waterlogged blocks and aquatic plants. */
export function getBlockFluidState(key?: AssetKey, state?: BlockStateProperties): BlockFluidState | undefined {
    const rule = key && fluidRules[key.toNamespacedString()];
    if (rule) return {
        kind: rule.kind,
        level: rule.levelProperty ? Number(state?.[rule.levelProperty] ?? 0) : 0,
        renderModel: rule.renderModel
    };
    return state?.waterlogged === "true" ? { kind: "water", level: 0, renderModel: true } : undefined;
}

export function getFluidKind(key?: AssetKey, state?: BlockStateProperties): FluidKind | undefined {
    return getBlockFluidState(key, state)?.kind;
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
