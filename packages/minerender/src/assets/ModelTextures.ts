import { Maybe } from "../util/util";
import { TextureAsset } from "../model/Model";
import { Caching } from "../cache/Caching";
import type { AssetContext } from "./AssetContext";
import { AssetLoader } from "./AssetLoader";
import { ImageLoader } from "../image/ImageLoader";
import { ExtractableImageData } from "../ExtractableImageData";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetKey } from "./AssetKey";
import { AssetParser } from "./source/parser/AssetParsers";

/** Loads texture pixels and `.mcmeta` files through the active asset sources. */
export class ModelTextures {

    constructor(private readonly assets: AssetContext) {
    }

    public static get(key: AssetKey): Promise<Maybe<ExtractableImageData>> {
        return AssetLoader.context.modelTextures.get(key);
    }

    public static preload(key: AssetKey): Promise<Maybe<TextureAsset>> {
        return AssetLoader.context.modelTextures.preload(key);
    }

    public static getMeta(key: AssetKey): Promise<Maybe<MinecraftTextureMeta>> {
        return AssetLoader.context.modelTextures.getMeta(key);
    }

    public static clearCache() {
        return AssetLoader.context.modelTextures.clearCache();
    }

    private static _persistentMetaCache: PersistentCache | undefined;

    private static get PERSISTENT_META_CACHE(): PersistentCache {
        return this._persistentMetaCache ??= PersistentCache.open("minerender-texturemeta");
    }

    /** Loads and decodes a texture into a readable canvas, or returns `undefined` when missing. */
    public async get(key: AssetKey): Promise<Maybe<ExtractableImageData>> {
        const keyStr = this.assets.cacheKey(key);
        const pending = this.preload(key);
        const cached = Caching.textureAssetCache.getIfPresent(keyStr);
        try {
            const asset = await pending;
            if (asset) {
                return this.assets.bind(await ImageLoader.infoToCanvasData(asset));
            }
            return undefined;
        } catch (err) {
            // Discard corrupt encoded bytes, but preserve any newer load for this key.
            if (cached && Caching.textureAssetCache.getIfPresent(keyStr) === cached) {
                Caching.textureAssetCache.invalidate(keyStr);
            }
            throw err;
        }
    }

    /** Fetches and caches encoded texture bytes without decoding the pixels. */
    public async preload(key: AssetKey): Promise<Maybe<TextureAsset>> {
        key = this.assets.bind(Object.assign(new AssetKey("", ""), key));
        return Caching.textureAssetCache.get(this.assets.cacheKey(key), async () => {
            const asset = await this.assets.get<TextureAsset>(key, AssetParser.IMAGE);
            return asset ? this.assets.bind({ ...asset, key }) : undefined;
        });
    }

    /** Loads a texture's `.mcmeta` file, or returns `undefined` when no metadata file exists. */
    public async getMeta(key: AssetKey): Promise<Maybe<MinecraftTextureMeta>> {
        key = this.assets.bind(Object.assign(new AssetKey("", ""), key));
        if (!key.extension || !key.extension.endsWith(".mcmeta")) {
            key.extension += ".mcmeta";
        }
        return Caching.textureMetaCache.get(this.assets.cacheKey(key), async () => {
            const asset = await ModelTextures.PERSISTENT_META_CACHE.getOrLoad(this.assets.persistentKey(key), () => {
                return this.assets.get<MinecraftTextureMeta>(key, AssetParser.META);
            });
            return asset ? this.assets.bind({ ...asset, key }) : undefined;
        });
    }

    /** Clears persisted texture metadata. Use {@link Caching.clear} to discard in-memory textures and metadata. */
    public async clearCache() {
        await ModelTextures.PERSISTENT_META_CACHE.clear();
    }

}
