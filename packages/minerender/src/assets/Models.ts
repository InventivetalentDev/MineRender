import { Model } from "../model/Model";
import { Caching } from "../cache/Caching";
import { Textures } from "../texture/Textures";
import { Maybe } from "../util/util";
import { ModelMerger } from "../model/ModelMerger";
import { AssetLoader } from "./AssetLoader";
import { Memoize } from "typescript-memoize";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetKey } from "./AssetKey";
import { ListAsset } from "../ListAsset";
import { AssetParser } from "./source/parser/AssetParsers";

export class Models {

    private static _persistentCache: PersistentCache | undefined;

    // opened lazily: touching the store at import time would hit IndexedDB/disk just for loading
    // the library, and would require an EnvProvider before any entry has had a chance to register
    private static get PERSISTENT_CACHE(): PersistentCache {
        return this._persistentCache ??= PersistentCache.open("minerender-models");
    }

    @Memoize()
    public static async getItemList(): Promise<string[]> {
        return AssetLoader.get<ListAsset>(new AssetKey(
            DEFAULT_NAMESPACE,
            "_list",
            "models",
            "item",
            "assets",
            ".json",
            DEFAULT_ROOT
        ), AssetParser.LIST).then(r => r?.files ?? []);
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
        //TODO: maybe add the asset source to the key
        return Caching.rawModelCache.get(keyStr, k => {
            return this.PERSISTENT_CACHE.getOrLoad(keyStr, k1 => {
                return AssetLoader.get<Model>(key, AssetParser.MODEL);
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
            //TODO: persistent cache
            return Models.loadAndMerge(key);
        });
    }

    public static async get(key: AssetKey): Promise<Maybe<Model>> {
        return this.getMerged(key);
    }

    public static async clearCache() {
        return this.PERSISTENT_CACHE.clear();
    }

}
