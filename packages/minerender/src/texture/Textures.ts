import { CanvasTexture, Texture } from "three";
import { TextureLoader } from "./TextureLoader";
import { Caching } from "../cache/Caching";
import { serializeTextureKey, TextureKey } from "../cache/CacheKey";
import { AssetKey } from "../assets/AssetKey";
import * as THREE from "three";

export class Textures {

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
