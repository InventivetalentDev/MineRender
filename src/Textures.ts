import { TextureCacheKey } from "./cache/CacheKey";
import { Texture } from "three";
import { TextureLoader } from "./texture/TextureLoader";
import { Caching } from "./cache/Caching";

export class Textures {

    public static create(key: TextureCacheKey): Texture {
        return TextureLoader.load(key.src, key.format);
    }

    public static get(key: TextureCacheKey): Texture {
        return Caching.textureCache.get(key)!;
    }

}
