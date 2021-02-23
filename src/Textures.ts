import { Texture } from "three";
import { TextureLoader } from "./texture/TextureLoader";
import { Caching } from "./cache/Caching";
import { serializeTextureKey, TextureKey } from "./cache/CacheKey";

export class Textures {

    public static create(key: TextureKey): Texture {
        return TextureLoader.load(key.src, key.format, key.rotation);
    }

    public static get(key: TextureKey): Texture {
        const keyStr = serializeTextureKey(key);
        return Caching.textureCache.get(keyStr, k=>{
            return Textures.create(key);
        })!;
    }

}
