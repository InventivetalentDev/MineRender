import { AssetKey, serializeAssetKey } from "../cache/CacheKey";
import { Maybe } from "../util/util";
import { BlockState } from "../model/BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { Memoize } from "typscript-memoize";
import defaultBlockStates from "../model/defaultBlockStates.json";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../model/BlockStateProperties";

export class BlockStates {

    @Memoize()
    public static async getList(): Promise<string[]> {
        return AssetLoader.loadOrRetryWithDefaults({
            root: DEFAULT_ROOT,
            namespace: DEFAULT_NAMESPACE,
            assetType: "blockstates",
            type: undefined,
            path: "_list",
            extension: ".json"
        }, AssetLoader.LIST).then(r => r?.files ?? []);
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
        const keyStr = serializeAssetKey(key);
        return Caching.blockStateCache.get(keyStr, k => {
            return AssetLoader.loadOrRetryWithDefaults(key, AssetLoader.BLOCKSTATE).then(asset => {
                if (asset)
                    asset.key = key;
                return asset;
            })
        })
    }

}
