import { CanvasTexture, Texture } from "three";
import { TextureLoader } from "./texture/TextureLoader";
import { Caching } from "./cache/Caching";
import { serializeTextureKey, TextureKey } from "./cache/CacheKey";
import * as THREE from "three";

export class Textures {

    static readonly MISSING_TEXTURE = Textures.getImage({ src: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABAAQMAAACQp+OdAAAABlBMVEX/AP8AAACfphTyAAAAFUlEQVQoz2MIhQKGVVAwKjIqQrwIAHRz/wFI17TEAAAAAElFTkSuQmCC"}    );

    public static initTextureProps<T extends Texture>(texture: T): T {
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.anisotropy = 0;
        return texture;
    }

    public static createImage(key: TextureKey): Texture {
        return TextureLoader.load(key.src, key.format, key.rotation);
    }

    public static createCanvas(canvas: HTMLCanvasElement): Texture {
        return this.initTextureProps(new CanvasTexture(canvas));
    }

    public static getImage(key: TextureKey): Texture {
        const keyStr = serializeTextureKey(key);
        return Caching.textureCache.get(keyStr, k=>{
            return Textures.createImage(key);
        })!;
    }

}
