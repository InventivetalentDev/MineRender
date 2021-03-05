import { AssetKey, serializeAssetKey } from "./cache/CacheKey";
import { Maybe } from "./util/util";
import { TextureAsset } from "./model/Model";
import { Caching } from "./cache/Caching";
import { AssetLoader } from "./AssetLoader";
import { CompatImage } from "./CanvasCompat";
import { ImageLoader } from "./image/ImageLoader";

export class ModelTextures {

    public static async get(key: AssetKey): Promise<Maybe<ImageData>> {
        const asset = await this.preload(key);
        if (asset) {
            return ImageLoader.infoToData(asset);
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


}
