import { AssetKey } from "./AssetKey";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source/parser/AssetParsers";
import { ModelTextures } from "./ModelTextures";
import { Caching } from "../cache/Caching";
import type { CompatCanvas } from "../canvas/CanvasCompat";
import type { MinecraftAsset } from "../MinecraftAsset";

export interface BitmapGlyph {
    image?: CompatCanvas;
    /** Source rectangle in the bitmap sheet, before applying scale. */
    x: number;
    y: number;
    width: number;
    height: number;
    scale: number;
    ascent: number;
    advance: number;
}

export interface BitmapFont {
    glyphs: Map<string, BitmapGlyph>;
}

interface ProviderOptions {
    filter?: { uniform?: boolean; jp?: boolean };
}

interface BitmapProvider extends ProviderOptions {
    type: "bitmap" | "minecraft:bitmap";
    file: string;
    height?: number;
    ascent: number;
    chars: string[];
}

interface SpaceProvider extends ProviderOptions {
    type: "space" | "minecraft:space";
    advances: Record<string, number>;
}

interface ReferenceProvider extends ProviderOptions {
    type: "reference" | "minecraft:reference";
    id: string;
}

interface UnsupportedProvider extends ProviderOptions {
    type: "unihex" | "minecraft:unihex" | "ttf" | "minecraft:ttf";
}

interface FontAsset extends MinecraftAsset {
    providers: (BitmapProvider | SpaceProvider | ReferenceProvider | UnsupportedProvider)[];
}

export class Fonts {

    public static async get(key: AssetKey | string = "minecraft:default"): Promise<BitmapFont> {
        const fontKey = typeof key === "string" ? AssetKey.parse("font", key) : key;
        return (await Caching.fontCache.get(fontKey.serialize(), () => this.load(fontKey, [])))!;
    }

    private static relatedKey(assetType: string, id: string, origin: AssetKey): AssetKey {
        const key = AssetKey.parse(assetType, id);
        key.root = origin.root;
        return key;
    }

    private static async load(key: AssetKey, parents: string[]): Promise<BitmapFont> {
        const serialized = key.serialize();
        if (parents.includes(serialized)) throw new Error(`Cyclic font reference: ${key.toNamespacedString()}`);
        const stack = await AssetLoader.getAll<FontAsset>(key, AssetParser.JSON);
        if (stack.length === 0) throw new Error(`Could not load font ${key.toNamespacedString()}`);
        const glyphs = new Map<string, BitmapGlyph>();
        for (const asset of stack) {
            for (const provider of asset.providers) {
                if (provider.filter?.uniform || provider.filter?.jp) continue;
                let provided: Map<string, BitmapGlyph>;
                switch (provider.type) {
                    case "bitmap": case "minecraft:bitmap":
                        provided = await this.bitmap(provider, key);
                        break;
                    case "space": case "minecraft:space":
                        provided = new Map(Object.entries(provider.advances).map(([character, advance]) => [character,
                            { x: 0, y: 0, width: 0, height: 0, scale: 1, ascent: 0, advance }]));
                        break;
                    case "reference": case "minecraft:reference":
                        provided = (await this.load(this.relatedKey("font", provider.id, key), [...parents, serialized])).glyphs;
                        break;
                    default:
                        continue;
                }
                for (const [character, glyph] of provided) {
                    if (character !== "\0" && !glyphs.has(character)) glyphs.set(character, glyph);
                }
            }
        }
        return { glyphs };
    }

    private static async bitmap(provider: BitmapProvider, fontKey: AssetKey): Promise<Map<string, BitmapGlyph>> {
        const rows = provider.chars.map(row => [...row]);
        const columns = rows[0]?.length;
        if (!columns || rows.some(row => row.length !== columns)) {
            throw new Error(`Invalid character grid in font ${fontKey.toNamespacedString()}`);
        }
        const key = this.relatedKey("textures", provider.file, fontKey);
        const image = await ModelTextures.get(key);
        if (!image) throw new Error(`Could not load font texture ${key.toNamespacedString()}`);
        const width = Math.floor(image.width / columns), height = Math.floor(image.height / rows.length);
        if (!width || !height) throw new Error(`Font texture ${key.toNamespacedString()} is smaller than its character grid`);
        const scale = (provider.height ?? 8) / height;
        const pixels = image.data.getImageData(0, 0, image.width, image.height).data;
        const glyphs = new Map<string, BitmapGlyph>();
        rows.forEach((row, rowIndex) => row.forEach((character, columnIndex) => {
            if (character === "\0") return;
            const x = columnIndex * width, y = rowIndex * height;
            let occupiedWidth = 0;
            for (let column = width - 1; column >= 0 && !occupiedWidth; column--) {
                for (let row = 0; row < height; row++) {
                    if (pixels[((y + row) * image.width + x + column) * 4 + 3] !== 0) {
                        occupiedWidth = column + 1;
                        break;
                    }
                }
            }
            glyphs.set(character, {
                image: (image.data as CanvasRenderingContext2D).canvas, x, y, width, height, scale,
                ascent: provider.ascent, advance: Math.floor(occupiedWidth * scale + 0.5) + 1
            });
        }));
        return glyphs;
    }

}
