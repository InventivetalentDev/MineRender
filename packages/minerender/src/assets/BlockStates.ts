import { Maybe } from "../util/util";
import { BlockState } from "../model/block/BlockState";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "./AssetLoader";
import type { AssetContext } from "./AssetContext";
import { DEFAULT_NAMESPACE } from "./Assets";
import { BlockStatePropertyDefaults } from "../model/block/BlockStateProperties";
import { AssetKey } from "./AssetKey";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetParser } from "./source/parser/AssetParsers";
import { ListAsset } from "../ListAsset";
import { MinecraftAsset } from "../MinecraftAsset";
import defaultBlockStates from "../model/defaultBlockStates.json";

/** Loads blockstate definitions and the property defaults used to select block models. */
export class BlockStates {

    constructor(private readonly assets: AssetContext) {
    }

    public static getList(): Promise<string[]> {
        return AssetLoader.context.blockStates.getList();
    }

    public static getDefaultStates(): Promise<Maybe<DefaultBlockStates>> {
        return AssetLoader.context.blockStates.getDefaultStates();
    }

    public static getDefaultState(key: AssetKey): Promise<Maybe<BlockStatePropertyDefaults>> {
        return AssetLoader.context.blockStates.getDefaultState(key);
    }

    public static get(key: AssetKey): Promise<Maybe<BlockState>> {
        return AssetLoader.context.blockStates.get(key);
    }

    public static getAll(keys: AssetKey[] | Iterable<AssetKey>): Promise<Maybe<BlockState>[]> {
        return AssetLoader.context.blockStates.getAll(keys);
    }

    public static clearCache() {
        return AssetLoader.context.blockStates.clearCache();
    }

    private static _persistentCache: PersistentCache | undefined;

    private static get PERSISTENT_CACHE(): PersistentCache {
        return this._persistentCache ??= PersistentCache.open("minerender-blockstates");
    }

    // BlockState names are hardcoded
    /** Returns blockstate filenames from the selected version's `_list.json`, or an empty list. */
    public async getList(): Promise<string[]> {
        const key = new AssetKey(
            DEFAULT_NAMESPACE,
            "_list",
            "blockstates",
            undefined,
            "assets",
            ".json"
        );
        return Caching.listAssetCache.get(this.assets.cacheKey(key), () => {
            return this.assets.get<ListAsset>(key, AssetParser.LIST);
        }).then(r => r?.files ?? []);
    }

    public async getDefaultStates(): Promise<Maybe<DefaultBlockStates>> {
        return defaultBlockStates as DefaultBlockStates;
    }

    /** Looks up vanilla property definitions for the key's block path, or returns `undefined`. */
    public async getDefaultState(key: AssetKey): Promise<Maybe<BlockStatePropertyDefaults>> {
        const defaultStates = await this.getDefaultStates();
        if (!defaultStates) {
            return undefined;
        }
        return defaultStates["minecraft:" + key.path] as BlockStatePropertyDefaults;
    }

    /** Loads a cached blockstate definition for {@link MineRenderScene.addBlock}, or returns `undefined`. */
    public async get(key: AssetKey): Promise<Maybe<BlockState>> {
        if (!key.assetType) {
            key.assetType = "blockstates";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        key = this.assets.bind(Object.assign(new AssetKey("", ""), key));
        return Caching.blockStateCache.get(this.assets.cacheKey(key), async () => {
            const asset = await BlockStates.PERSISTENT_CACHE.getOrLoad(this.assets.persistentKey(key), () => {
                return this.assets.get<BlockState>(key, AssetParser.BLOCKSTATE);
            });
            return asset ? this.assets.bind({ ...asset, key }) : undefined;
        });
    }

    public getAll(keys: AssetKey[] | Iterable<AssetKey>): Promise<Maybe<BlockState>[]> {
        const promises: Promise<Maybe<BlockState>>[] = [];
        for (let key of keys) {
            promises.push(this.get(key));
        }
        return Promise.all(promises);
    }

    /** Clears persisted blockstates. Use {@link Caching.clear} to also discard in-memory assets. */
    public async clearCache() {
        await BlockStates.PERSISTENT_CACHE.clear();
    }

}

export class DefaultBlockStates implements MinecraftAsset {
    [k: string]: BlockStatePropertyDefaults;
}
