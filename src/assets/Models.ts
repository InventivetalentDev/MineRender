import { Model } from "../model/Model";
import { Caching } from "../cache/Caching";
import { Textures } from "../texture/Textures";
import { Maybe } from "../util/util";
import { ModelMerger } from "../model/ModelMerger";
import { AssetLoader } from "./AssetLoader";
import { Memoize } from "typscript-memoize";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetKey } from "./AssetKey";

export class Models {

    private static PERSISTENT_CACHE = PersistentCache.open("minerender-models");

    @Memoize()
    public static async getItemList(): Promise<string[]> {
        return AssetLoader.loadOrRetryWithDefaults(new AssetKey(
            DEFAULT_NAMESPACE,
            "_list",
            "models",
            "item",
            ".json",
            DEFAULT_ROOT
        ), AssetLoader.LIST).then(r => r?.files ?? []);
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
        const keyStr = key.serialize();
        return Caching.rawModelCache.get(keyStr, k => {
            return this.PERSISTENT_CACHE.getOrLoad(keyStr, k1 => {
                return AssetLoader.loadOrRetryWithDefaults(key, AssetLoader.MODEL).then(asset => {
                    return asset;
                })
            })
        }).then(asset => {
            if (asset) {
                asset.key = key;
            }
            return asset;
        })
    }

    public static async getMerged(key: AssetKey): Promise<Maybe<Model>> {
        if (!key.assetType) {
            key.assetType = "models";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        const keyStr = key.serialize();
        return Caching.mergedModelCache.get(keyStr, k => {
            return Models.loadAndMerge(key);
        });
    }

    public static async get(key: AssetKey): Promise<Maybe<Model>> {
        return this.getMerged(key);
    }

}
