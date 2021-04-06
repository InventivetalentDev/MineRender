import { AssetKey, serializeAssetKey } from "../cache/CacheKey";
import { Maybe } from "../util/util";
import { TextureAsset } from "./Model";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "../assets/AssetLoader";
import { CompatImage } from "../canvas/CanvasCompat";
import { ImageLoader } from "../image/ImageLoader";
import { ExtractableImageData } from "../ExtractableImageData";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import { PersistentCache } from "../cache/PersistentCache";
import { keys } from "node-persist";

export class ModelTextures {

    private static PERSISTENT_META_CACHE = PersistentCache.open("minerender-texturemeta");

    public static async get(key: AssetKey): Promise<Maybe<ExtractableImageData>> {
        const asset = await this.preload(key);
        if (asset) {
            return ImageLoader.infoToCanvasData(asset);
        }
        return undefined;
    }

    public static async preload(key: AssetKey): Promise<Maybe<TextureAsset>> {
        const keyStr = serializeAssetKey(key);
        return Caching.textureAssetCache.get(keyStr, k => {
            return AssetLoader.loadOrRetryWithDefaults<TextureAsset>(key, AssetLoader.IMAGE).then(asset => {
                if (asset)
                    asset.key = key;
                return asset;
            })
        })
    }

    public static async getMeta(key: AssetKey): Promise<Maybe<MinecraftTextureMeta>> {
        key.extension += ".mcmeta";
        const keyStr = serializeAssetKey(key);

        return Caching.textureMetaCache.get(keyStr, k => {
            return this.PERSISTENT_META_CACHE.getOrLoad(keyStr, k1 => {
                return AssetLoader.loadOrRetryWithDefaults<MinecraftTextureMeta>(key, AssetLoader.META).then(asset => {
                    if (asset)
                        asset.key = key;
                    return asset;
                })
            })
        })
    }


}
