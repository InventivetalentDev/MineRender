import { AsyncLoadingCache, Caches, Loader, LoadingCache, SimpleCache } from "@inventivetalent/loading-cache";
import { BoxGeometryKey, CacheKey, serializeBoxGeometryKey, serializeImageKey, TextureKey } from "./CacheKey";
import { Time } from "@inventivetalent/time";
import { ImageInfo, ImageLoader } from "../image/ImageLoader";
import { BoxGeometry, Material, Mesh, PixelFormat, RGBAFormat, Texture } from "three";
import { Materials } from "../Materials";
import { CompatImage } from "../canvas/CanvasCompat";
import { Model, TextureAsset } from "../model/Model";
import { WrappedImage } from "../WrappedImage";
import { TextureAtlas } from "../texture/TextureAtlas";
import { ExtractableImageData } from "../ExtractableImageData";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import type { DefaultBlockStates } from "../assets/BlockStates";
import type { EntityModelFile } from "../entity/EntityModel";
import type { EntityAnimationFile } from "../entity/EntityAnimation";
import type { ListAsset } from "../ListAsset";
import { BlockState } from "../model/block/BlockState";
import type { AssetKey } from "../assets/AssetKey";

export class Caching {

    static readonly rawImageCache: AsyncLoadingCache<CacheKey, ImageInfo> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(5))
        .buildAsync<CacheKey, ImageInfo>();
    static readonly imageDataCache: AsyncLoadingCache<CacheKey, ImageData> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(10))
        .buildAsync<CacheKey, ImageData>();
    static readonly canvasImageDataCache: AsyncLoadingCache<CacheKey, ExtractableImageData> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(10))
        .buildAsync<CacheKey, ExtractableImageData>();
    static readonly wrappedImageCache: AsyncLoadingCache<CacheKey, WrappedImage> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(10))
        .buildAsync<CacheKey, WrappedImage>();

    static readonly boxGeometryCache: SimpleCache<CacheKey, BoxGeometry> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(20))
        .build<CacheKey, BoxGeometry>();

    static readonly textureCache: SimpleCache<CacheKey, Texture> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Texture>();

    static readonly materialCache: SimpleCache<CacheKey, Material> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Material>();

    static readonly boxMeshCache: SimpleCache<CacheKey, Mesh> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Mesh>();

    static readonly textureAssetCache: AsyncLoadingCache<CacheKey, TextureAsset> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<CacheKey, TextureAsset>();
    static readonly textureMetaCache: AsyncLoadingCache<CacheKey, MinecraftTextureMeta> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<CacheKey, MinecraftTextureMeta>();

    static readonly rawModelCache: AsyncLoadingCache<CacheKey, Model> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<CacheKey, Model>();
    static readonly mergedModelCache: AsyncLoadingCache<CacheKey, Model> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<CacheKey, Model>();
    static readonly modelTextureAtlasCache: AsyncLoadingCache<CacheKey, TextureAtlas> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<CacheKey, TextureAtlas>();

    static readonly blockStateCache: AsyncLoadingCache<CacheKey, BlockState> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .buildAsync<CacheKey, BlockState>();

    static readonly listAssetCache: AsyncLoadingCache<CacheKey, ListAsset> = Caching.createAssetCache<ListAsset>();

    static readonly defaultBlockStatesCache: AsyncLoadingCache<CacheKey, DefaultBlockStates> = Caching.createAssetCache<DefaultBlockStates>();

    static readonly blockTintCache: AsyncLoadingCache<CacheKey, number> = Caching.createAssetCache<number>();

    static readonly entityModelCache: AsyncLoadingCache<CacheKey, EntityModelFile> = Caching.createAssetCache<EntityModelFile>();

    static readonly entityTextureCache: AsyncLoadingCache<CacheKey, AssetKey> = Caching.createAssetCache<AssetKey>();

    static readonly entityAnimationCache: AsyncLoadingCache<CacheKey, EntityAnimationFile> = Caching.createAssetCache<EntityAnimationFile>();

    private static createAssetCache<T>(): AsyncLoadingCache<CacheKey, T> {
        return Caches.builder()
            .expireAfterWrite(Time.minutes(10))
            .expireAfterAccess(Time.minutes(5))
            .expirationInterval(Time.seconds(30))
            .buildAsync<CacheKey, T>();
    }


    /** Every cache above, so clear()/end() can never fall out of sync with the field list again. */
    private static get all(): { invalidateAll(): void; end(): void }[] {
        return [
            this.rawImageCache,
            this.imageDataCache,
            this.canvasImageDataCache,
            this.wrappedImageCache,
            this.boxGeometryCache,
            this.textureCache,
            this.materialCache,
            this.boxMeshCache,
            this.textureAssetCache,
            this.textureMetaCache,
            this.rawModelCache,
            this.mergedModelCache,
            this.modelTextureAtlasCache,
            this.blockStateCache,
            this.listAssetCache,
            this.defaultBlockStatesCache,
            this.blockTintCache,
            this.entityModelCache,
            this.entityTextureCache,
            this.entityAnimationCache
        ];
    }

    public static clear() {
        for (const cache of this.all) {
            cache.invalidateAll();
        }
    }

    /**
     * Clears every cache and stops its expiry timer.
     *
     * Expiry timers are unref'd in Node, so idle processes can exit without this cleanup.
     * Use {@link shutdown} to also stop requests and the shared Ticker.
     */
    public static end() {
        for (const cache of this.all) {
            cache.invalidateAll();
            cache.end();
        }
    }

    public static get cacheSizes() {
        return {
            //TODO
        }
    }

}

