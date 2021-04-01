import { AssetKey, serializeAssetKey } from "../cache/CacheKey";
import { Maybe } from "../util/util";
import { BlockState } from "./BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "../assets/AssetLoader";

export class BlockStates {

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
