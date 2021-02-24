import { AsyncLoadingCache, Caches, Loader, LoadingCache, SimpleCache } from "@inventivetalent/loading-cache";
import {  BoxGeometryKey,  CacheKey,  serializeBoxGeometryKey, serializeImageKey, TextureKey } from "./CacheKey";
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
import { Model } from "../model/Model";

export class Caching {

    static readonly rawImageCache: SimpleCache<CacheKey, CompatImage> = Caches.builder()
        .expireAfterWrite(Time.minutes(2))
        .expireAfterAccess(Time.seconds(20))
        .expirationInterval(Time.seconds(5))
        .build();
    static readonly processedImageCache: SimpleCache<CacheKey, ImageData> = Caches.builder()
        .expireAfterWrite(Time.minutes(5))
        .expireAfterAccess(Time.minutes(1))
        .expirationInterval(Time.seconds(10))
        .build<CacheKey, ImageData>();

    static readonly boxGeometryCache: SimpleCache<CacheKey, BoxGeometry> = Caches.builder()
        .expireAfterWrite(Time.minutes(2))
        .expireAfterAccess(Time.minutes(1))
        .expirationInterval(Time.seconds(20))
        .build<CacheKey, BoxGeometry>();

    static readonly textureCache: SimpleCache<CacheKey, Texture> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Texture>();

    static readonly materialCache: SimpleCache<CacheKey, Material> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Material>();

    static readonly boxMeshCache: SimpleCache<CacheKey, Mesh> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(2))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Mesh>();



    static readonly modelCache: SimpleCache<CacheKey, Model> = Caches.builder()
        .expireAfterWrite(Time.minutes(10))
        .expireAfterAccess(Time.minutes(5))
        .expirationInterval(Time.seconds(30))
        .build<CacheKey, Model>();



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
