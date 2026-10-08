import { AssetKey } from "../assets/AssetKey";
import { ModelTextures } from "../assets/ModelTextures";
import { Caching } from "../cache/Caching";
import { MineRenderError } from "../error/MineRenderError";

/** Samples resource-pack colormaps to produce packed sRGB tint colors. */
export class Colormaps {

    /** Samples the selected resource pack's grass colormap using Minecraft's climate coordinates. */
    public static async grassColor(origin?: AssetKey, temperature = 0.5, downfall = 1): Promise<number> {
        const key = AssetKey.parse("textures", "minecraft:colormap/grass", origin);
        const temp = Math.fround(temperature);
        const rain = Math.fround(downfall) * temp;
        const x = Math.floor((1 - temp) * 255), y = Math.floor((1 - rain) * 255);
        return (await Caching.blockTintCache.get(`${key.serialize()}|${x},${y}`, async () => {
            const image = await ModelTextures.get(key);
            if (!image) throw new MineRenderError(`Missing grass colormap: ${key.toNamespacedString()}`);
            if (image.width !== 256 || image.height !== 256) {
                throw new MineRenderError("Grass colormaps must be 256 × 256 pixels");
            }
            const [red, green, blue] = image.data.getImageData(x, y, 1, 1).data;
            return (red << 16) | (green << 8) | blue;
        }))!;
    }

}
