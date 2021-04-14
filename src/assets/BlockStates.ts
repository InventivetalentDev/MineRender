import { Maybe } from "../util/util";
import { BlockState } from "../model/BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { Memoize } from "typscript-memoize";
import defaultBlockStates from "../model/defaultBlockStates.json";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../model/BlockStateProperties";
import { AssetKey } from "./AssetKey";

export class BlockStates {

    // BlockState names are hardcoded
    @Memoize()
    public static async getList(): Promise<string[]> {
        return AssetLoader.loadOrRetryWithDefaults(new AssetKey(
            DEFAULT_NAMESPACE,
            "_list",
            "blockstates",
            undefined,
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
            return AssetLoader.loadOrRetryWithDefaults(key, AssetLoader.BLOCKSTATE).then(asset => {
                if (asset)
                    asset.key = key;
                return asset;
            })
        })
    }

}
