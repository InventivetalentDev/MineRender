import { DataTexture, DoubleSide, FrontSide, MeshBasicMaterial, SRGBColorSpace } from "three";
import { Caching } from "../cache/Caching";
import { serializeImageKey } from "../cache/CacheKey";
import { MineRenderError } from "../error/MineRenderError";
import { ImageLoader } from "../image/ImageLoader";
import { Textures } from "../texture/Textures";

export interface SkinTexture {
    material: MeshBasicMaterial;
    slim: boolean;
    legacy: boolean;
}

export class SkinTextures {

    public static async get(src: string, legacy?: boolean): Promise<SkinTexture> {
        const image = await ImageLoader.getData(src);
        const scale = image.width / 64;
        if (!Number.isInteger(scale) || scale < 1 || (image.height !== image.width && image.height !== image.width / 2)) {
            throw new MineRenderError(`Invalid skin dimensions ${image.width}x${image.height}; expected 64x64 or 64x32, or an integer-scaled equivalent`);
        }
        const isLegacy = legacy ?? image.height === image.width / 2;
        if (!isLegacy && image.height !== image.width) {
            throw new MineRenderError(`Invalid skin dimensions ${image.width}x${image.height}; non-legacy skins must be square`);
        }
        const slim = !isLegacy && this.isSlim(image, scale);
        const key = `skin:${serializeImageKey({ src })}:${isLegacy}`;
        const material = Caching.materialCache.get(key, () => {
            const pixels = isLegacy ? this.normalizeLegacy(image, scale) : new Uint8Array(image.data);
            return this.createMaterial(pixels, image.width, image.width);
        }) as MeshBasicMaterial;
        return { material, slim, legacy: isLegacy };
    }

    public static async getCape(src: string): Promise<MeshBasicMaterial> {
        const image = await ImageLoader.getData(src);
        const scale = image.width / 64;
        if (!Number.isInteger(scale) || scale < 1 || image.height !== image.width / 2) {
            throw new MineRenderError(`Invalid cape dimensions ${image.width}x${image.height}; expected 64x32 or an integer-scaled equivalent`);
        }
        return Caching.materialCache.get(`cape:${serializeImageKey({ src })}`, () => {
            return this.createMaterial(new Uint8Array(image.data), image.width, image.height, false);
        }) as MeshBasicMaterial;
    }

    private static createMaterial(pixels: Uint8Array, width: number, height: number, transparent: boolean = true): MeshBasicMaterial {
        const texture = Textures.initTextureProps(new DataTexture(pixels, width, height));
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = true;
        texture.needsUpdate = true;
        return new MeshBasicMaterial({ map: texture, transparent, side: transparent ? DoubleSide : FrontSide, alphaTest: transparent ? 0.5 : 0 });
    }

    private static isSlim(image: ImageData, scale: number): boolean {
        for (const [x, y] of [[46, 52], [54, 20]]) {
            for (let row = y * scale; row < (y + 12) * scale; row++) {
                for (let column = x * scale; column < (x + 1) * scale; column++) {
                    if (image.data[(row * image.width + column) * 4 + 3] !== 0) return false;
                }
            }
        }
        return true;
    }

    private static normalizeLegacy(image: ImageData, scale: number): Uint8Array {
        const pixels = new Uint8Array(image.width * image.width * 4);
        pixels.set(image.data.subarray(0, image.width * image.width / 2 * 4));
        // Vanilla mirrors each right-limb face into the modern left-limb texture regions.
        for (const [sx, sy, dx, dy, width, height] of [
            [4, 16, 20, 48, 4, 4], [8, 16, 24, 48, 4, 4],
            [0, 20, 24, 52, 4, 12], [4, 20, 20, 52, 4, 12],
            [8, 20, 16, 52, 4, 12], [12, 20, 28, 52, 4, 12],
            [44, 16, 36, 48, 4, 4], [48, 16, 40, 48, 4, 4],
            [40, 20, 40, 52, 4, 12], [44, 20, 36, 52, 4, 12],
            [48, 20, 32, 52, 4, 12], [52, 20, 44, 52, 4, 12]
        ]) {
            for (let y = 0; y < height * scale; y++) {
                for (let x = 0; x < width * scale; x++) {
                    const source = ((sy * scale + y) * image.width + sx * scale + x) * 4;
                    const target = ((dy * scale + y) * image.width + (dx + width) * scale - 1 - x) * 4;
                    pixels.set(image.data.subarray(source, source + 4), target);
                }
            }
        }
        let clearHat = true;
        for (let y = 0; y < 32 * scale; y++) {
            for (let x = 32 * scale; x < image.width; x++) {
                if (pixels[(y * image.width + x) * 4 + 3] < 128) clearHat = false;
            }
        }
        for (let y = 0; y < image.width; y++) {
            for (let x = 0; x < image.width; x++) {
                const alpha = (y * image.width + x) * 4 + 3;
                if ((x < 32 * scale && y < 16 * scale) ||
                    (y >= 16 * scale && y < 32 * scale) ||
                    (x >= 16 * scale && x < 48 * scale && y >= 48 * scale)) {
                    pixels[alpha] = 255;
                } else if (clearHat && x >= 32 * scale && y < 32 * scale) {
                    pixels[alpha] = 0;
                }
            }
        }
        return pixels;
    }

}
