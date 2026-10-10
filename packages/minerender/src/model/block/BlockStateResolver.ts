import { Euler } from "three";
import { BlockStates } from "../../assets/BlockStates";
import { MineRenderError } from "../../error/MineRenderError";
import { clampRotationDegrees, toRadians } from "../../util/util";
import { BlockState, BlockStateVariant, MultipartCondition } from "./BlockState";
import { BlockStateProperties } from "./BlockStateProperties";
import type { TripleArray } from "../Model";

function matchesCondition(condition: MultipartCondition, state: BlockStateProperties): boolean {
    return Object.entries(condition).every(([key, value]) => {
        if (Array.isArray(value)) {
            if (key === "OR") return value.some(child => matchesCondition(child, state));
            if (key === "AND") return value.every(child => matchesCondition(child, state));
            return false;
        }
        return typeof value === "string" && state[key] !== undefined && value.split("|").includes(`${state[key]}`);
    });
}

/** Selects block models from property values, including multipart conditions and weighted alternatives. */
export class BlockStateResolver {

    /** Loads vanilla property defaults, falling back to preview values inferred from the blockstate file. */
    public static async defaults(blockState: BlockState): Promise<BlockStateProperties> {
        const defaults = blockState.key ? await BlockStates.getDefaultState(blockState.key) : undefined;
        const state = {};
        if (defaults && Object.keys(defaults).length > 0) {
            for (const key in defaults) state[key] = defaults[key].default;
        } else if (blockState.variants) {
            const variant = Object.keys(blockState.variants)[0];
            if (variant) {
                for (const property of variant.split(",")) {
                    const [key, value] = property.split("=");
                    state[key] = value;
                }
            }
        } else if (blockState.multipart) {
            // Guess preview values only from a flat condition; logical groups need a known state.
            const condition = blockState.multipart.map(part => part.when)
                .find((when): when is Record<string, string> =>
                    when !== undefined && Object.values(when).every(value => typeof value === "string"));
            for (const [key, value] of Object.entries(condition ?? {})) state[key] = value.split("|")[0];
        }
        return state;
    }

    /** Selects matching models. Supply `choose` to control selection within each alternatives array. */
    public static select(blockState: BlockState, state: BlockStateProperties,
                         choose: (variants: BlockStateVariant | BlockStateVariant[]) => BlockStateVariant = this.choose): BlockStateVariant[] {
        // Passing choose directly would make Array.map supply its index as the position.
        return this.matching(blockState, state).map(variants => choose(variants));
    }

    /** Returns matching model groups before choosing weighted alternatives. */
    public static matching(blockState: BlockState, state: BlockStateProperties): (BlockStateVariant | BlockStateVariant[])[] {
        const out: (BlockStateVariant | BlockStateVariant[])[] = [];
        if (blockState.variants) {
            if (Object.keys(blockState.variants).length === 1 && "" in blockState.variants) {
                out.push(blockState.variants[""]);
            } else {
                for (const variantKey in blockState.variants) {
                    const matches = variantKey.split(",").every(property => {
                        const [key, value] = property.split("=");
                        return `${state[key]}` === `${value}`;
                    });
                    if (matches) out.push(blockState.variants[variantKey]);
                }
            }
        } else if (blockState.multipart) {
            for (const part of blockState.multipart) {
                if (part.apply && (!part.when || matchesCondition(part.when, state))) {
                    out.push(part.apply);
                }
            }
        }
        return out;
    }

    /** Selects by positive integer weights (default 1); world block coordinates make the choice repeatable. */
    public static choose(variants: BlockStateVariant | BlockStateVariant[], position?: Readonly<TripleArray>): BlockStateVariant {
        if (!Array.isArray(variants)) return variants;
        if (!variants.length) throw new MineRenderError("Blockstate variant arrays must not be empty");
        const total = variants.reduce((sum, variant) => {
            const weight = variant.weight ?? 1;
            if (!Number.isInteger(weight) || weight < 1) {
                throw new MineRenderError(`Invalid blockstate variant weight: ${weight}`);
            }
            return sum + weight;
        }, 0);
        let choice = position === undefined ? Math.random() * total : BlockStateResolver.positionSample(position, total);
        for (const variant of variants) {
            choice -= variant.weight ?? 1;
            if (choice < 0) return variant;
        }
        return variants[variants.length - 1];
    }

    private static positionSample(position: Readonly<TripleArray>, bound: number): number {
        if (bound > 0x7fffffff) {
            throw new MineRenderError("Position-based blockstate variant total weight must not exceed 2147483647");
        }
        // Mth.getSeed multiplies x as an int before widening it to a long.
        let mixed = BigInt(Math.imul(position[0], 3129871)) ^ BigInt(position[2]) * 116129781n ^ BigInt(position[1]);
        mixed = BigInt.asIntN(64, mixed * mixed * 42317861n + mixed * 11n) >> 16n;
        let seed = (mixed ^ 0x5deece66dn) & 0xffffffffffffn;
        let bits: number, value: number;
        do {
            seed = (seed * 0x5deece66dn + 11n) & 0xffffffffffffn;
            bits = Number(seed >> 17n);
            if ((bound & (bound - 1)) === 0) return Number(BigInt(bound) * BigInt(bits) >> 31n);
            value = bits % bound;
        } while ((bits - value + bound - 1 | 0) < 0);
        return value;
    }

    /** Converts blockstate rotations in degrees into the Euler rotation used by model rendering. */
    public static rotation(variant: BlockStateVariant): Euler {
        const rotation = new Euler();
        if (typeof variant.x !== "undefined") {
            rotation.x = toRadians(clampRotationDegrees(variant.x));
        }
        if (typeof variant.y !== "undefined") {
            rotation.y = toRadians(clampRotationDegrees(typeof variant.x !== "undefined" ? variant.y : 360 - variant.y));
        }
        return rotation;
    }

}
