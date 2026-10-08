import { BufferGeometry, Float32BufferAttribute } from "three";
import type { DoubleArray, TripleArray } from "../Model";
import type { AssetKey } from "../../assets/AssetKey";
import type { BlockStateProperties } from "../block/BlockStateProperties";
import fluidBlocks from "./fluidBlocks.json";

export type FluidKind = "water" | "lava";

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

/** A neighboring cell's fluid level and full-cube occlusion state. */
export interface FluidSample {
    fluid?: FluidKind;
    level?: number;
    solid?: boolean;
}

/** Reads cells at integer block offsets relative to the fluid being rendered, with `(0, 0, 0)` as the center. */
export type FluidSampler = (x: number, y: number, z: number) => FluidSample;

const HORIZONTAL = [[0, -1], [0, 1], [-1, 0], [1, 0]] as const;
const EPSILON = 0.001;

function ownHeight(sample: FluidSample): number {
    const level = sample.level ?? 0;
    return (level === 0 || level >= 8 ? 8 : 8 - level) / 9;
}

/** Builds centered fluid faces with material groups 0 (still) and 1 (flowing). */
export function createFluidGeometry(kind: FluidKind, sample: FluidSampler): BufferGeometry {
    const geometry = new BufferGeometry();
    const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
    const self = sample(0, 0, 0);
    const height = (x: number, z: number): number => {
        const state = sample(x, 0, z);
        if (state.fluid !== kind) return state.solid ? -1 : 0;
        return sample(x, 1, z).fluid === kind ? 1 : ownHeight(state);
    };
    const selfHeight = height(0, 0);
    const corner = (x: number, z: number): number => {
        if (selfHeight >= 1) return 1;
        const adjacent = [height(x, 0), height(0, z)];
        if (adjacent.some(value => value >= 1)) return 1;
        const values = [selfHeight, ...adjacent];
        if (adjacent.some(value => value > 0)) {
            const diagonal = height(x, z);
            if (diagonal >= 1) return 1;
            values.push(diagonal);
        }
        let sum = 0, weights = 0;
        for (const value of values) {
            if (value < 0) continue;
            const weight = value >= 0.8 ? 10 : 1;
            sum += value * weight;
            weights += weight;
        }
        return sum / weights;
    };
    const heights = [corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1)];
    const above = sample(0, 1, 0), below = sample(0, -1, 0);
    const renderTop = above.fluid !== kind && !(above.solid && Math.min(...heights) >= 1);
    const renderBottom = below.fluid !== kind && !below.solid;
    const bottom = renderBottom ? EPSILON : 0;
    const face = (vertices: TripleArray[], uv: DoubleArray[], normal: TripleArray, material: number) => {
        const start = positions.length / 3;
        geometry.addGroup(indices.length, 6, material);
        for (let i = 0; i < 4; i++) {
            positions.push(...vertices[i].map(value => value * 16 - 8));
            normals.push(...normal);
            uvs.push(uv[i][0], 1 - uv[i][1]);
        }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    };

    if (renderTop) {
        for (let i = 0; i < heights.length; i++) heights[i] -= EPSILON;
        let flowX = 0, flowZ = 0;
        for (const [x, z] of HORIZONTAL) {
            const neighbor = sample(x, 0, z);
            if (neighbor.fluid && neighbor.fluid !== kind) continue;
            let difference = 0;
            if (neighbor.fluid === kind) {
                difference = ownHeight(self) - ownHeight(neighbor);
            } else if (!neighbor.solid) {
                const lower = sample(x, -1, z);
                if (lower.fluid === kind) difference = ownHeight(self) - (ownHeight(lower) - 8 / 9);
            }
            flowX += x * difference;
            flowZ += z * difference;
        }
        const flowing = flowX !== 0 || flowZ !== 0;
        let uv: DoubleArray[] = [[0, 0], [0, 1], [1, 1], [1, 0]];
        if (flowing) {
            const angle = Math.atan2(flowZ, flowX) - Math.PI / 2;
            const s = Math.sin(angle) / 4, c = Math.cos(angle) / 4;
            uv = [[0.5 - c - s, 0.5 - c + s], [0.5 - c + s, 0.5 + c + s],
                [0.5 + c + s, 0.5 + c - s], [0.5 + c - s, 0.5 - c - s]];
        }
        face([[0, heights[0], 0], [0, heights[1], 1], [1, heights[2], 1], [1, heights[3], 0]], uv, [0, 1, 0], flowing ? 1 : 0);
    }
    if (renderBottom) {
        face([[0, bottom, 0], [1, bottom, 0], [1, bottom, 1], [0, bottom, 1]],
            [[0, 0], [1, 0], [1, 1], [0, 1]], [0, -1, 0], 0);
    }
    const sides = [
        { x: 0, z: -1, corners: [0, 3], edge: [[0, EPSILON], [1, EPSILON]] },
        { x: 0, z: 1, corners: [2, 1], edge: [[1, 1 - EPSILON], [0, 1 - EPSILON]] },
        { x: -1, z: 0, corners: [1, 0], edge: [[EPSILON, 1], [EPSILON, 0]] },
        { x: 1, z: 0, corners: [3, 2], edge: [[1 - EPSILON, 0], [1 - EPSILON, 1]] }
    ];
    for (const { x, z, corners, edge } of sides) {
        const neighbor = sample(x, 0, z);
        if (neighbor.fluid === kind || neighbor.solid) continue;
        const [h0, h1] = corners.map(index => heights[index]);
        const [[x0, z0], [x1, z1]] = edge;
        face([[x0, h0, z0], [x1, h1, z1], [x1, bottom, z1], [x0, bottom, z0]],
            [[0, (1 - h0) / 2], [0.5, (1 - h1) / 2], [0.5, 0.5], [0, 0.5]], [x, 0, z], 1);
    }
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    geometry.setAttribute("normal", new Float32BufferAttribute(normals, 3));
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
}
