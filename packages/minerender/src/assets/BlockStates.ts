import { Maybe } from "../util/util";
import { BlockState } from "../model/block/BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE } from "./Assets";
import { BlockStatePropertyDefaults } from "../model/block/BlockStateProperties";
import { AssetKey } from "./AssetKey";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetParser } from "./source/parser/AssetParsers";
import { ListAsset } from "../ListAsset";
import { MinecraftAsset } from "../MinecraftAsset";

export class BlockStates {

    private static _persistentCache: PersistentCache | undefined;

    private static get PERSISTENT_CACHE(): PersistentCache {
        return this._persistentCache ??= PersistentCache.open("minerender-blockstates");
    }

    // BlockState names are hardcoded
    public static async getList(): Promise<string[]> {
        const key = new AssetKey(
            DEFAULT_NAMESPACE,
            "_list",
            "blockstates",
            undefined,
            "assets",
            ".json",
            AssetLoader.ROOT
        );
        return Caching.listAssetCache.get(key.serialize(), () => {
            return AssetLoader.get<ListAsset>(key, AssetParser.LIST);
        }).then(r => r?.files ?? []);
    }

    public static async getDefaultStates(): Promise<Maybe<DefaultBlockStates>> {
        const key = AssetKey.parse("blockstates", "minerender:defaultBlockStates");
        return Caching.defaultBlockStatesCache.get(key.serialize(), () => {
            return AssetLoader.get<DefaultBlockStates>(key, AssetParser.JSON);
        });
    }

    public static async getDefaultState(key: AssetKey): Promise<Maybe<BlockStatePropertyDefaults>> {
        const defaultStates = await this.getDefaultStates();
        if (!defaultStates) {
            return undefined;
        }
        return defaultStates["minecraft:" + key.path] as BlockStatePropertyDefaults;
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
            return this.PERSISTENT_CACHE.getOrLoad(AssetLoader.persistentKey(keyStr), k1 => {
                return AssetLoader.get<BlockState>(key, AssetParser.BLOCKSTATE);
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

    public static async clearCache() {
        await this.PERSISTENT_CACHE.clear();
    }

}

export class DefaultBlockStates implements MinecraftAsset {
    [k: string]: BlockStatePropertyDefaults;
}
