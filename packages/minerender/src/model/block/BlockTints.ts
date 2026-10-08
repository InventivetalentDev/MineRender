import { AssetKey } from "../../assets/AssetKey";
import { Colormaps } from "../../texture/Colormaps";
import type { Model } from "../Model";
import type { BlockStateProperties } from "./BlockStateProperties";
import blockTints from "./blockTints.json";

type BlockTintRule = ({ source: "constant"; color: number } |
    { source: "grass" | "redstone" | "stem" }) & { untinted?: number[] };

const rules = blockTints as Record<string, BlockTintRule>;

/** Supplies block-preview tint colors from block properties and the active resource pack. */
export class BlockTints {

    /** Resolves block preview colors without biome context; explicit tints take precedence. */
    public static async get(key: AssetKey | undefined, state: BlockStateProperties, model: Model,
                            tints?: Record<number, number>): Promise<Record<number, number> | undefined> {
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

        let color: number;
        switch (rule.source) {
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
