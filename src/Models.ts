import { Model } from "./model/Model";
import { Caching } from "./cache/Caching";
import { Textures } from "./Textures";
import { Maybe } from "./util/util";
import { debug } from "./debug";
import { ModelMerger } from "./ModelMerger";
import { AssetKey, serializeAssetKey } from "./cache/CacheKey";
import { AssetLoader } from "./AssetLoader";

export const DEFAULT_ROOT = "https://assets.mcasset.cloud/1.16.5";
export const DEFAULT_NAMESPACE = "minecraft";

export class Models {

    public static async loadAndMerge(key: AssetKey): Promise<Maybe<Model>> {
        const model = await this.getRaw(key);
        if (!model) {
            return undefined;
        }
        return ModelMerger.mergeWithParents(model);
    }

    public static async getRaw(key: AssetKey): Promise<Maybe<Model>> {
        if (!key.assetType) {
            key.assetType = "models";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        const keyStr = serializeAssetKey(key);
        return Caching.rawModelCache.get(keyStr, k => {
            return AssetLoader.loadOrRetryWithDefaults(key, AssetLoader.MODEL).then(asset => {
                if (asset)
                    asset.key = key;
                return asset;
            })
        });
    }

    public static async getMerged(key: AssetKey): Promise<Maybe<Model>> {
        if (!key.assetType) {
            key.assetType = "models";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        const keyStr = serializeAssetKey(key);
        return Caching.mergedModelCache.get(keyStr, k => {
            return Models.loadAndMerge(key);
        });
    }

}
