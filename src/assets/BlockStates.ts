import { Maybe } from "../util/util";
import { BlockState } from "../model/block/BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { Memoize } from "typescript-memoize";
import defaultBlockStates from "../model/defaultBlockStates.json";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../model/block/BlockStateProperties";
import { AssetKey } from "./AssetKey";
import { PersistentCache } from "../cache/PersistentCache";

export class BlockStates {

    private static PERSISTENT_CACHE = PersistentCache.open("minerender-blockstates");

    // BlockState names are hardcoded
    @Memoize()
    public static async getList(): Promise<string[]> {
        return AssetLoader.loadOrRetryWithDefaults(new AssetKey(
            DEFAULT_NAMESPACE,
            "_list",
            "blockstates",
            undefined,
            "assets",
            ".json",
            DEFAULT_ROOT
        ), AssetLoader.LIST).then(r => r?.files ?? []);
    }

    public static getDefaultState(key: AssetKey): Maybe<BlockStatePropertyDefaults> {
        return defaultBlockStates["minecraft:" + key.path] as BlockStatePropertyDefaults;
    }

    public static async get(key: AssetKey): Promise<Maybe<BlockState>> {
        if (!key.assetType) {
            key.assetType = "blockstates";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        const keyStr = key.serialize();
        return Caching.blockStateCache.get(keyStr, k => {
            return this.PERSISTENT_CACHE.getOrLoad(keyStr, k1 => {
                return AssetLoader.loadOrRetryWithDefaults(key, AssetLoader.BLOCKSTATE).then(asset => {
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

    public static getAll(keys: AssetKey[] | Iterable<AssetKey>): Promise<Maybe<BlockState>[]> {
        const promises: Promise<Maybe<BlockState>>[] = [];
        for (let key of keys) {
            promises.push(this.get(key));
        }
        return Promise.all(promises);
    }

}
