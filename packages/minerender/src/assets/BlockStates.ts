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
import { MineRenderData } from "./MineRenderData";

/** Loads blockstate definitions and the property defaults used to select block models. */
export class BlockStates {

    private static _persistentCache: PersistentCache | undefined;

    private static get PERSISTENT_CACHE(): PersistentCache {
        return this._persistentCache ??= PersistentCache.open("minerender-blockstates");
    }

    // BlockState names are hardcoded
    /** Returns blockstate filenames from the selected version's `_list.json`, or an empty list. */
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

    public static async getDefaultStates(root?: string): Promise<Maybe<DefaultBlockStates>> {
        return MineRenderData.get("blockStates", root);
    }

    /** Looks up vanilla property definitions for the key's block path, or returns `undefined`. */
    public static async getDefaultState(key: AssetKey): Promise<Maybe<BlockStatePropertyDefaults>> {
        const defaultStates = await this.getDefaultStates(key.root);
        if (!defaultStates) {
            return undefined;
        }
        return defaultStates[key.toNamespacedString()] as BlockStatePropertyDefaults;
    }

    /** Loads a cached blockstate definition for {@link MineRenderScene.addBlock}, or returns `undefined`. */
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

    /** Clears persisted blockstates. Use {@link Caching.clear} to also discard in-memory assets. */
    public static async clearCache() {
        await this.PERSISTENT_CACHE.clear();
    }

}

export class DefaultBlockStates implements MinecraftAsset {
    [k: string]: BlockStatePropertyDefaults;
}
