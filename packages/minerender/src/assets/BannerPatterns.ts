import { AssetKey } from "./AssetKey";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source/parser/AssetParsers";
import { Caching } from "../cache/Caching";
import type { MinecraftAsset } from "../MinecraftAsset";
import type { ListAsset } from "../ListAsset";
import { MineRenderData } from "./MineRenderData";

/** @deprecated Fixed 1.21.11 palette. Use {@link BannerPatterns.getColors} for the selected version. */
export const DYE_COLORS = Object.freeze({
    white: 0xf9fffe, orange: 0xf9801d, magenta: 0xc74ebd, light_blue: 0x3ab3da,
    yellow: 0xfed83d, lime: 0x80c71f, pink: 0xf38baa, gray: 0x474f52,
    light_gray: 0x9d9d97, cyan: 0x169c9c, purple: 0x8932b8, blue: 0x3c44aa,
    brown: 0x835432, green: 0x5e7c16, red: 0xb02e26, black: 0x1d1d21
} as const);

export type DyeColor = keyof typeof DYE_COLORS;

/** A registry banner pattern or an inline value in a `banner_patterns` component. */
export interface BannerPattern extends MinecraftAsset {
    asset_id: string;
    translation_key: string;
}

export interface BannerPatternDraw {
    texture: AssetKey;
    color: number;
}

/** Loads banner-pattern registry entries and resolves their banner or shield textures. */
export class BannerPatterns {

    /** Lists namespaced pattern IDs from the selected namespace's data directory. */
    public static async getList(namespace = "minecraft", root?: string): Promise<string[]> {
        const collect = async (path: string): Promise<string[]> => {
            const prefix = path ? `${path}/` : "";
            const key = new AssetKey(namespace, `${prefix}_list`, "banner_pattern", undefined, "data", ".json", root);
            const list = await Caching.listAssetCache.get(key.serialize(), () => AssetLoader.get<ListAsset>(key, AssetParser.LIST));
            if (!list) return [];
            const files = list.files.filter(file => file.endsWith(".json") && file !== "_list.json")
                .map(file => `${namespace}:${prefix}${file.slice(0, -5)}`);
            const children = await Promise.all(list.directories.map(directory => collect(`${prefix}${directory}`)));
            return [...files, ...children.flat()];
        };
        return collect("");
    }

    /** Loads the selected version's texture dye colors as packed sRGB values. */
    public static async getColors(root?: string): Promise<Record<DyeColor, number>> {
        const dyes = await MineRenderData.get("dyes", root);
        return Object.fromEntries(Object.entries(dyes).map(([name, dye]) => [name, dye.textureDiffuseColor])) as Record<DyeColor, number>;
    }

    /** @deprecated Uses the fixed 1.21.11 palette. Use {@link getColors} for versioned colors. */
    public static getColor(color: unknown): number {
        if (typeof color !== "string" || !Object.prototype.hasOwnProperty.call(DYE_COLORS, color)) throw new Error(`Unsupported dye color ${color}`);
        return DYE_COLORS[color as DyeColor];
    }

    /** Resolves the first 16 layers of a `banner_patterns` component, preserving their order. */
    public static async getLayers(value: unknown, target: "banner" | "shield", root?: string): Promise<BannerPatternDraw[]> {
        if (value === undefined) return [];
        if (!Array.isArray(value)) throw new Error("banner_patterns must be an array");
        const activeRoot = AssetLoader.ROOT, scope = AssetLoader.persistentScope;
        const checkSources = () => {
            if (activeRoot !== AssetLoader.ROOT || scope !== AssetLoader.persistentScope) throw new Error("Asset sources changed while loading banner patterns; retry the request");
        };
        const colors = value.length ? await this.getColors(root) : undefined;
        checkSources();
        return Promise.all(value.slice(0, 16).map(async layer => {
            if (!layer || typeof layer !== "object" || Array.isArray(layer)) throw new Error("Each banner pattern requires a pattern and dye color");
            if (typeof layer.color !== "string" || !Object.prototype.hasOwnProperty.call(colors, layer.color)) throw new Error(`Unsupported dye color ${layer.color}`);
            const color = colors![layer.color as DyeColor];
            let pattern: unknown = layer.pattern;
            if (typeof pattern === "string") {
                const id = this.identifier(pattern);
                const key = new AssetKey(id.namespace, id.getFullPath(), "banner_pattern", undefined, "data", ".json", root);
                pattern = await Caching.bannerPatternCache.get(key.serialize(), () => AssetLoader.get<BannerPattern>(key, AssetParser.JSON));
                checkSources();
                if (!pattern) throw new Error(`Missing banner pattern ${layer.pattern}`);
            }
            if (!pattern || typeof pattern !== "object" || Array.isArray(pattern)
                || typeof (pattern as BannerPattern).translation_key !== "string") throw new Error("Banner patterns require asset_id and translation_key");
            const asset = this.identifier((pattern as BannerPattern).asset_id);
            return { color, texture: new AssetKey(asset.namespace, `${target}/${asset.getFullPath()}`, "textures", "entity", "assets", ".png", root) };
        }));
    }

    private static identifier(value: string): AssetKey {
        if (typeof value !== "string" || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(value)) throw new Error(`Invalid banner-pattern identifier ${value}`);
        const [namespace, path] = value.includes(":") ? value.split(":") : ["minecraft", value];
        return new AssetKey(namespace, path);
    }
}
