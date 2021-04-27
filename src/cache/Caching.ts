import { AsyncLoadingCache, Caches, Loader, LoadingCache, SimpleCache } from "@inventivetalent/loading-cache";
import { BoxGeometryKey, CacheKey, serializeBoxGeometryKey, serializeImageKey, TextureKey } from "./CacheKey";
import { Time } from "@inventivetalent/time";
import { ImageInfo, ImageLoader } from "../image/ImageLoader";
import { BoxGeometry, Material, Mesh, PixelFormat, RGBAFormat, Texture } from "three";
import { TextureLoader } from "../texture/TextureLoader";
import { Geometry } from "three/examples/jsm/deprecated/Geometry";
import { Geometries } from "../Geometries";
import { Meshes } from "../Meshes";
import { Textures } from "../texture/Textures";
import { Materials } from "../Materials";
import { CompatImage } from "../canvas/CanvasCompat";
import { Model, TextureAsset } from "../model/Model";
import { WrappedImage } from "../WrappedImage";
import { TextureAtlas } from "../texture/TextureAtlas";
import { ExtractableImageData } from "../ExtractableImageData";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import { BlockStates } from "../assets/BlockStates";
import { BlockState } from "../model/block/BlockState";

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


    public static clear() {
        this.rawImageCache.invalidateAll();
        this.textureCache.invalidateAll();
    }

    public static end() {
        this.clear();

        this.rawImageCache.end();
        this.textureCache.end();
    }

    public static get cacheSizes() {
        return {
            //TODO
        }
    }

}

