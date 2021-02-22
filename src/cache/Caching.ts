import { AsyncLoadingCache, Caches, Loader, LoadingCache, SimpleCache } from "@inventivetalent/loading-cache";
import { BoxGeometryCacheKey, BoxMeshCacheKey, CacheKey, MaterialCacheKey, parseImageKey, ProcessedImageCacheKey, RawImageCacheKey, TextureCacheKey } from "./CacheKey";
import { Time } from "@inventivetalent/time";
import { ImageLoader } from "../image/ImageLoader";
import { BoxGeometry, Material, Mesh, PixelFormat, RGBAFormat, Texture } from "three";
import { TextureLoader } from "../texture/TextureLoader";
import { Geometry } from "three/examples/jsm/deprecated/Geometry";
import { Geometries } from "../Geometries";
import { Meshes } from "../Meshes";
import { Textures } from "../Textures";
import { Materials } from "../Materials";
import { CompatImage } from "../CanvasCompat";

export class Caching {

     static readonly rawImageCache: LoadingCache<CacheKey, CompatImage> = Caches.builder()
        .expireAfterWrite(Time.minutes(2))
        .expireAfterAccess(Time.seconds(20))
        .expirationInterval(Time.seconds(5))
        .build<CacheKey, CompatImage>(key => ImageLoader.load(parseImageKey(key)));
     static readonly processedImageCache: SimpleCache<CacheKey, ImageData> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expireAfterAccess(Time.minutes(1))
        .expirationInterval(Time.seconds(10))
        .build<CacheKey, ImageData>();

     static readonly boxGeometryCache: LoadingCache<CacheKey, BoxGeometry> = Caches.builder()
        .expireAfterWrite(Time.minutes(2))
        .expireAfterAccess(Time.minutes(1))
        .expirationInterval(Time.seconds(20))
        .build<CacheKey, BoxGeometry>(key => Geometries.createBox(key));

     static readonly textureCache: LoadingCache<CacheKey, Texture> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Texture>(key => Textures.create(key));

    static readonly materialCache: LoadingCache<CacheKey, Material> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Material>(key => Materials.create(key));

     static readonly boxMeshCache: LoadingCache<CacheKey, Mesh> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Mesh>(key => Meshes.createBox(key));


    public static getRawImage(src: string): CompatImage {
        return this.rawImageCache.get({ src })!;
    }

    // public static getProcessedImage(key: ProcessedImageCacheKey, loader?: Loader<ProcessedImageCacheKey, ImageData>): ImageData {
    //
    // }

    public static getBoxGeometry(key: BoxGeometryCacheKey): BoxGeometry {
        return this.boxGeometryCache.get(key)!;
    }

    public static getTexture(src: string, format: PixelFormat = RGBAFormat): Texture {
        return this.textureCache.get({ src, format })!;
    }

    public static clear() {
        this.rawImageCache.invalidateAll();
        this.textureCache.invalidateAll();
    }

    public static end() {
        this.clear();

        this.rawImageCache.end();
        this.textureCache.end();
    }

}
