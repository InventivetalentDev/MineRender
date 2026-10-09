import { AssetKey } from "../../assets/AssetKey";
import { Colormaps } from "../../texture/Colormaps";
import type { Model } from "../Model";
import type { BlockStateProperties } from "./BlockStateProperties";
import blockTints from "./blockTints.json";
import { Biomes } from "../../assets/Biomes";
import type { TripleArray } from "../Model";

type BlockTintRule = ({ source: "constant"; color: number } |
    { source: "grass" | "redstone" | "stem" }) & { untinted?: number[]; biome?: "foliage" | "dry_foliage" | "water" | "grass" };

const rules = blockTints as Record<string, BlockTintRule>;

/** Supplies block-preview tint colors from block properties and the active resource pack. */
export class BlockTints {

    /** Returns the biome color used by a vanilla block, leaving fixed-color blocks unchanged. */
    public static biomeSource(key?: AssetKey): "grass" | "foliage" | "dry_foliage" | "water" | undefined {
        const rule = key && rules[key.toNamespacedString()];
        return rule ? rule.biome ?? (rule.source === "grass" ? "grass" : undefined) : undefined;
    }

    /** Resolves one block's biome tint at world block coordinates, without biome blending. */
    public static async getBiomeColor(key?: AssetKey, biome?: string, position?: Readonly<TripleArray>): Promise<number | undefined> {
        const source = this.biomeSource(key);
        return biome && source ? Biomes.getColor(biome, source, key, position?.[0], position?.[2]) : undefined;
    }

    /** Resolves used tint indices from biome or preview colors; explicit tints take precedence. */
    public static async get(key: AssetKey | undefined, state: BlockStateProperties, model: Model,
                            tints?: Record<number, number>, biomeColor?: number | (() => Promise<number | undefined>)): Promise<Record<number, number> | undefined> {
        const rule = key && rules[key.toNamespacedString()];
        if (!key || !rule) return tints;

        const indices = new Set<number>();
        for (const element of model.elements ?? []) {
            for (const face of Object.values(element.faces)) {
                const index = face?.tintindex;
                if (index !== undefined && index >= 0 && tints?.[index] === undefined && !rule.untinted?.includes(index)) {
                    indices.add(index);
                }
            }
        }
        if (!indices.size) return tints;

        const biome = typeof biomeColor === "function" ? await biomeColor() : biomeColor;
        let color: number;
        if (biome !== undefined && this.biomeSource(key)) {
            color = biome;
        } else switch (rule.source) {
            case "constant":
                color = rule.color;
                break;
            case "grass":
                color = await Colormaps.grassColor(key);
                break;
            case "redstone": {
                const power = Number(state.power ?? 0) / 15;
                const red = power * 0.6 + (power > 0 ? 0.4 : 0.3);
                const green = Math.max(0, power * power * 0.7 - 0.5);
                const blue = Math.max(0, power * power * 0.6 - 0.7);
                color = (Math.floor(red * 255) << 16) | (Math.floor(green * 255) << 8) | Math.floor(blue * 255);
                break;
            }
            case "stem": {
                const age = Number(state.age ?? 0);
                color = ((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4);
                break;
            }
        }
        return { ...Object.fromEntries([...indices].map(index => [index, color])), ...tints };
    }

}
