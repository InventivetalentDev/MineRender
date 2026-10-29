import { AssetKey } from "../assets/AssetKey";
import { ModelTextures } from "../assets/ModelTextures";
import { Caching } from "../cache/Caching";
import { CanvasImage } from "../canvas/CanvasImage";
import { MineRenderError } from "../error/MineRenderError";
import type { ExtractableImageData } from "../ExtractableImageData";
import type { Maybe } from "../util/util";

/** Recolours textures using indexed pairs of palette images. */
export class PalettedTextures {
    /** Loads a texture with a palette permutation, sharing the resulting canvas between callers. */
    public static async get(texture: AssetKey, key: AssetKey, permutation: AssetKey): Promise<Maybe<ExtractableImageData>> {
        return Caching.canvasImageDataCache.get(`palette:${texture.serialize()}:${key.serialize()}:${permutation.serialize()}`, async () => {
            const source = await ModelTextures.get(texture);
            if (!source) return undefined;
            const [palette, replacement] = await Promise.all([ModelTextures.get(key), ModelTextures.get(permutation)]);
            if (!palette) throw new MineRenderError(`Missing palette ${key.toNamespacedString()}`);
            if (!replacement) throw new MineRenderError(`Missing palette ${permutation.toNamespacedString()}`);
            const pixels = source.data.getImageData(0, 0, source.width, source.height);
            const colors = palette.data.getImageData(0, 0, palette.width, palette.height).data;
            const replacements = replacement.data.getImageData(0, 0, replacement.width, replacement.height).data;
            const image = new CanvasImage(source.width, source.height);
            const output = image.context.createImageData(source.width, source.height);
            output.data.set(this.permute(pixels.data, colors, replacements));
            image.putData(output);
            return { data: image.context as unknown as CanvasRenderingContext2D, width: image.width, height: image.height };
        });
    }

    /** @internal */
    public static permute(pixels: Uint8ClampedArray, key: Uint8ClampedArray, permutation: Uint8ClampedArray): Uint8ClampedArray {
        if (key.length !== permutation.length) throw new MineRenderError("Palette images must have the same pixel count");
        const mapping = new Map<number, number>();
        for (let i = 0; i < key.length; i += 4) {
            if (key[i + 3] !== 0) mapping.set((key[i] << 16) | (key[i + 1] << 8) | key[i + 2], i);
        }
        const output = new Uint8ClampedArray(pixels);
        // PalettedPermutations.createPaletteMapping matches RGB and multiplies source and replacement alpha.
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i + 3] === 0) continue;
            const mapped = mapping.get((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
            if (mapped === undefined) continue;
            output.set(permutation.subarray(mapped, mapped + 3), i);
            output[i + 3] = Math.floor(pixels[i + 3] * permutation[mapped + 3] / 255);
        }
        return output;
    }
}
