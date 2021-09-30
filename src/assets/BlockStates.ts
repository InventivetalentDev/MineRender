import { Maybe } from "../util/util";
import { BlockState } from "../model/block/BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { Memoize } from "typscript-memoize";
import defaultBlockStates from "../model/defaultBlockStates.json";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../model/block/BlockStateProperties";
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
            return AssetLoader.loadOrRetryWithDefaults(key, AssetLoader.BLOCKSTATE).then(asset => {
                return asset;
            })
        }).then(asset => {
            if (asset) {
                asset.key = key;
            }
            return asset;
        })
    }

    public static getAll(keys: AssetKey[]): Promise<Maybe<BlockState>[]> {
        const promises: Promise<Maybe<BlockState>>[] = [];
        keys.forEach(key => promises.push(this.get(key)));
        return Promise.all(promises);
    }

}
