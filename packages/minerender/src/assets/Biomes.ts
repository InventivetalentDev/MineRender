import { AssetKey } from "./AssetKey";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source/parser/AssetParsers";
import { Caching } from "../cache/Caching";
import { MineRenderError } from "../error/MineRenderError";
import type { MinecraftAsset } from "../MinecraftAsset";
import { Colormaps } from "../texture/Colormaps";
import { swampGrassColor } from "./_biomes/SwampGrassColor";

export type BiomeColorKind = "grass" | "foliage" | "dry_foliage" | "water";

/** Climate and color fields from a biome registry entry. Other registry fields are ignored. */
export interface Biome extends MinecraftAsset {
    temperature: number;
    downfall: number;
    effects: Partial<Record<`${BiomeColorKind}_color`, number | string>> & {
        grass_color_modifier?: "none" | "dark_forest" | "swamp";
    };
}

/** Resolves biome colors through the selected version's registry and resource-pack colormaps. */
export class Biomes {

    /** Loads a biome registry entry, or returns `undefined` when no source provides it. */
    public static async get(id: string, origin?: AssetKey): Promise<Biome | undefined> {
        if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(id)) throw new MineRenderError(`Invalid biome identifier: ${id}`);
        const [namespace, path] = id.includes(":") ? id.split(":") : ["minecraft", id];
        const key = new AssetKey(namespace, path, "worldgen", "biome", "data", ".json", origin?.root);
        return Caching.biomeCache.get(key.serialize(), async () => {
            const asset = await AssetLoader.get<Biome>(key, AssetParser.JSON);
            if (asset === undefined) return undefined;
            if (!asset || typeof asset !== "object" || Array.isArray(asset)
                || !asset.effects || typeof asset.effects !== "object" || Array.isArray(asset.effects)) {
                throw new MineRenderError(`Invalid biome effects: ${id}`);
            }
            if (typeof asset.temperature !== "number" || !Number.isFinite(asset.temperature)
                || typeof asset.downfall !== "number" || !Number.isFinite(asset.downfall)) {
                throw new MineRenderError(`Invalid biome climate: ${id}`);
            }
            for (const kind of ["grass", "foliage", "dry_foliage", "water"] as const) {
                const color = asset.effects[`${kind}_color`];
                if (color !== undefined) this.parseColor(color, id, kind);
            }
            const modifier = asset.effects.grass_color_modifier;
            if (modifier !== undefined && modifier !== "none" && modifier !== "dark_forest" && modifier !== "swamp") {
                throw new MineRenderError(`Invalid biome grass color modifier: ${id}`);
            }
            return asset;
        });
    }

    /** Returns packed sRGB, or `undefined` when the biome or requested water color is missing. */
    public static async getColor(id: string, kind: BiomeColorKind, origin?: AssetKey, x = 0, z = 0): Promise<number | undefined> {
        const biome = await this.get(id, origin);
        if (!biome) return undefined;
        const rawColor = biome.effects[`${kind}_color`];
        let color = rawColor === undefined ? undefined : this.parseColor(rawColor, id, kind);
        if (kind === "water") return color;
        const modifier = kind === "grass" ? biome.effects.grass_color_modifier : undefined;
        if (modifier === "swamp") return swampGrassColor(x, z);
        if (color === undefined) {
            const clamp = (value: number) => Math.max(0, Math.min(1, Math.fround(value)));
            color = await Colormaps.getColor(kind, origin, clamp(biome.temperature), clamp(biome.downfall));
        }
        return modifier === "dark_forest" ? ((color & 0xfefefe) + 0x28340a) >> 1 : color;
    }

    private static parseColor(value: number | string, id: string, kind: BiomeColorKind): number {
        if (typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value)) return parseInt(value.slice(1), 16);
        if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
        throw new MineRenderError(`Invalid biome ${kind} color: ${id}`);
    }
}
