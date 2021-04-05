import { AssetKey, serializeAssetKey } from "../cache/CacheKey";
import { Maybe } from "../util/util";
import { BlockState } from "./BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "../assets/AssetLoader";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "../assets/Assets";
import { Memoize } from "typscript-memoize";

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
