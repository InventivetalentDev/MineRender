import { AssetKey } from "../../assets/AssetKey";
import { Colormaps } from "../../texture/Colormaps";
import type { Model } from "../Model";
import type { BlockStateProperties } from "./BlockStateProperties";
import { MineRenderData } from "../../assets/MineRenderData";
import { Biomes, BiomeColorKind } from "../../assets/Biomes";
import type { TripleArray } from "../Model";

/** Supplies block tint colors from versioned rendering rules and the active resource pack. */
export class BlockTints {

    /** Returns a block's versioned biome color source, leaving fixed-color blocks unchanged. */
    public static async biomeSource(key?: AssetKey): Promise<BiomeColorKind | undefined> {
        const rule = key && (await MineRenderData.get("blockTints", key.root))[key.toNamespacedString()];
        return rule ? rule.biome ?? (rule.source === "grass" ? "grass" : undefined) : undefined;
    }

    /** Resolves one block's biome tint at world block coordinates, without biome blending. */
    public static async getBiomeColor(key?: AssetKey, biome?: string, position?: Readonly<TripleArray>): Promise<number | undefined> {
        if (!biome) return undefined;
        const x = position?.[0], z = position?.[2];
        const source = await this.biomeSource(key);
        return source ? Biomes.getColor(biome, source, key, x, z) : undefined;
    }

    /** Resolves used tint indices from biome or preview colors; explicit tints take precedence. */
    public static async get(key: AssetKey | undefined, state: BlockStateProperties, model: Model,
                            tints?: Record<number, number>, biomeColor?: number | (() => Promise<number | undefined>)): Promise<Record<number, number> | undefined> {
        if (!key) return tints;
        const candidates = (model.elements ?? []).flatMap(element => Object.values(element.faces))
            .some(face => face?.tintindex !== undefined && face.tintindex >= 0 && tints?.[face.tintindex] === undefined);
        if (!candidates) return tints;
        const rule = (await MineRenderData.get("blockTints", key.root))[key.toNamespacedString()];
        if (!rule) return tints;

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

        const source = rule.biome ?? (rule.source === "grass" ? "grass" : undefined);
        const biome = source ? typeof biomeColor === "function" ? await biomeColor() : biomeColor : undefined;
        let color: number;
        if (biome !== undefined) {
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
