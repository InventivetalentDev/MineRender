import { Model } from "./Model";
import { Caching } from "../cache/Caching";
import { Textures } from "../texture/Textures";
import { Maybe } from "../util/util";
import { ModelMerger } from "./ModelMerger";
import { AssetKey, serializeAssetKey } from "../cache/CacheKey";
import { AssetLoader } from "../assets/AssetLoader";
import { Memoize } from "typscript-memoize";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "../assets/Assets";

export class Models {

    @Memoize()
    public static async getItemList(): Promise<string[]> {
        return AssetLoader.loadOrRetryWithDefaults({
            root: DEFAULT_ROOT,
            namespace: DEFAULT_NAMESPACE,
            assetType: "models",
            type: "item",
            path: "_list",
            extension: ".json"
        }, AssetLoader.LIST).then(r => r?.files ?? []);
    }

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
