import { CanvasTexture, DataTexture, Texture } from "three";
import { TextureLoader } from "./TextureLoader";
import { Caching } from "../cache/Caching";
import { serializeTextureKey, TextureKey } from "../cache/CacheKey";
import { AssetKey } from "../assets/AssetKey";
import * as THREE from "three";

export class Textures {

    /** Creates the shared checkerboard from pixels without fetching or decoding an image. */
    public static getMissing(): DataTexture {
        return Caching.textureCache.get("builtin:missing-texture", () => {
            const size = 64;
            const data = new Uint8Array(size * size * 4);
            for (let y = 0; y < size; y++) {
                for (let x = 0; x < size; x++) {
                    const offset = (y * size + x) * 4;
                    const color = (x + y) % 2 === 0 ? 255 : 0;
                    data[offset] = data[offset + 2] = color;
                    data[offset + 3] = 255;
                }
            }
            const texture = new DataTexture(data, size, size);
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.flipY = true;
            texture.needsUpdate = true;
            return this.initTextureProps(texture);
        }) as DataTexture;
    }

    public static initTextureProps<T extends Texture>(texture: T): T {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.anisotropy = 0;
        return texture;
    }


    public static createImage(key: TextureKey): Texture {
        return TextureLoader.load(key.src, key.format, key.rotation);
    }

    public static createAsset(key: AssetKey): Texture {
        return new Texture()
    }

    public static createCanvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        return this.initTextureProps(texture);
    }

    public static getImage(key: TextureKey): Texture {
        const keyStr = serializeTextureKey(key);
        const cached = Caching.textureCache.peek(keyStr);
        if (cached && TextureLoader.hasFailed(cached)) {
            Caching.textureCache.invalidate(keyStr);
        }
        return Caching.textureCache.get(keyStr, k=>{
            return Textures.createImage(key);
        })!;
    }

}
