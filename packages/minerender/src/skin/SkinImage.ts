import { Caching } from "../cache/Caching";
import { serializeImageKey } from "../cache/CacheKey";
import { ImageLoader } from "../image/ImageLoader";

/** Decodes skin pixels while preserving hidden RGB values in transparent PNG pixels. */
export class SkinImage {

    public static async getData(src: string): Promise<ImageData> {
        const key = serializeImageKey({ src });
        return (await Caching.imageDataCache.get(`skin:${key}`, async () => {
            const info = await ImageLoader.getInfo(src);
            if (info.type !== "png") return ImageLoader.getData(src);
            try {
                return await this.decodePng(info.data);
            } catch (error) {
                Caching.rawImageCache.invalidate(key);
                throw error;
            }
        }))!;
    }

    private static async decodePng(bytes: Uint8Array): Promise<ImageData> {
        // Canvas discards RGB from transparent pixels that Minecraft makes opaque.
        const { decode, convertIndexedToRgb } = await import("fast-png");
        const png = decode(bytes);
        let { data, channels, depth } = png;
        if (channels === 1 && (png.palette || depth < 8)) {
            const max = (1 << depth) - 1;
            const palette = png.palette ?? Array.from({ length: max + 1 }, (_, value) => {
                const gray = value * 255 / max;
                return [gray, gray, gray, png.transparency?.[0] === value ? 0 : 255];
            });
            data = convertIndexedToRgb({ ...png, palette });
            channels = palette[0].length;
            depth = 8;
        }
        const pixels = new Uint8ClampedArray(png.width * png.height * 4);
        for (let pixel = 0; pixel < png.width * png.height; pixel++) {
            const source = pixel * channels;
            const target = pixel * 4;
            const sample = (channel: number) => depth === 16 ? data[source + channel] >>> 8 : data[source + channel];
            pixels[target] = sample(0);
            pixels[target + 1] = sample(channels < 3 ? 0 : 1);
            pixels[target + 2] = sample(channels < 3 ? 0 : 2);
            pixels[target + 3] = channels % 2 === 0 ? sample(channels - 1)
                : png.transparency?.every((value, channel) => data[source + channel] === value) ? 0 : 255;
        }
        return { width: png.width, height: png.height, data: pixels, colorSpace: "srgb" };
    }

}
