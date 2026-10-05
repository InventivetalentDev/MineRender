import { Maybe } from "../util/util";
import { TextureAsset } from "../model/Model";
import { Caching } from "../cache/Caching";
import { AssetLoader } from "./AssetLoader";
import { CompatImage } from "../canvas/CanvasCompat";
import { ImageLoader } from "../image/ImageLoader";
import { ExtractableImageData } from "../ExtractableImageData";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetKey } from "./AssetKey";
import { AssetParser } from "./source/parser/AssetParsers";

export class ModelTextures {

    private static _persistentMetaCache: PersistentCache | undefined;

    private static get PERSISTENT_META_CACHE(): PersistentCache {
        return this._persistentMetaCache ??= PersistentCache.open("minerender-texturemeta");
    }

    public static async get(key: AssetKey): Promise<Maybe<ExtractableImageData>> {
        const keyStr = key.serialize();
        const pending = this.preload(key);
        const cached = Caching.textureAssetCache.getIfPresent(keyStr);
        try {
            const asset = await pending;
            if (asset) {
                return await ImageLoader.infoToCanvasData(asset);
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

    public static async preload(key: AssetKey): Promise<Maybe<TextureAsset>> {
        const keyStr = key.serialize();
        return Caching.textureAssetCache.get(keyStr, k => {
            return AssetLoader.get<TextureAsset>(key, AssetParser.IMAGE).then(asset => {
                if (asset)
                    asset.key = key;
                return asset;
            })
        })
    }

    public static async getMeta(key: AssetKey): Promise<Maybe<MinecraftTextureMeta>> {
        if (!key.extension || !key.extension.endsWith(".mcmeta")) {
            key = Object.assign(new AssetKey("", ""), key);
            key.extension += ".mcmeta";
        }
        const keyStr = key.serialize();

        return Caching.textureMetaCache.get(keyStr, k => {
            return this.PERSISTENT_META_CACHE.getOrLoad(AssetLoader.persistentKey(keyStr), k1 => {
                return AssetLoader.get<MinecraftTextureMeta>(key, AssetParser.META).then(asset => {
                    if (asset)
                        asset.key = key;
                    return asset;
                })
            })
        })
    }

    public static async clearCache() {
        await this.PERSISTENT_META_CACHE.clear();
    }

}
