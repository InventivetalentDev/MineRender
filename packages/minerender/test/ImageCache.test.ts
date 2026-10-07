import test from "ava";
import { MeshBasicMaterial, NearestFilter, SRGBColorSpace } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { serializeImageKey } from "../src/cache/CacheKey";
import { EntityObject } from "../src/entity/scene/EntityObject";
import { Env } from "../src/Env";
import { ExtractableImageData } from "../src/ExtractableImageData";
import { ImageInfo, ImageLoader } from "../src/image/ImageLoader";
import { Materials } from "../src/Materials";
import { Textures } from "../src/texture/Textures";

test.serial("the missing texture is shared pixel data without image loading or an environment provider", t => {
    const originals = { provider: Env["_provider"], data: ImageLoader.getData };
    Caching.clear();
    Env["_provider"] = undefined;
    ImageLoader.getData = async () => {
        t.fail("The built-in missing texture must not load an image");
        throw new Error("Unexpected image load");
    };
    t.teardown(() => {
        Env["_provider"] = originals.provider;
        ImageLoader.getData = originals.data;
        Caching.clear();
    });

    const material = Materials.MISSING_TEXTURE as MeshBasicMaterial;
    const texture = Textures.getMissing();
    t.is(Materials.MISSING_TEXTURE, material);
    t.is(material.map, texture);
    t.is(Textures.getMissing(), texture);
    t.deepEqual([texture.image.width, texture.image.height], [64, 64]);
    t.deepEqual(Array.from(texture.image.data.slice(0, 8)), [255, 0, 255, 255, 0, 0, 0, 255]);
    t.deepEqual(Array.from(texture.image.data.slice(256, 264)), [0, 0, 0, 255, 255, 0, 255, 255]);
    t.deepEqual([texture.colorSpace, texture.minFilter, texture.magFilter], [SRGBColorSpace, NearestFilter, NearestFilter]);
    t.true(texture.flipY);

    Caching.clear();
    t.not(Materials.MISSING_TEXTURE, material);
    t.not(Textures.getMissing(), texture);
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const info: ImageInfo = { width: 1, height: 1, type: "png", data: Buffer.from([1]) };

for (const modelTexture of [false, true]) {
    test.serial(`a stale ${modelTexture ? "model texture" : "image"} decode failure preserves replacement bytes`, async t => {
        const originals = { loadInfo: ImageLoader.loadInfo, decode: ImageLoader.infoToCanvasData, getAsset: AssetLoader.get };
        const decoding = deferred<void>();
        const decoded = deferred<ExtractableImageData>();
        const error = new Error("old image failed to decode");
        const key = new AssetKey("test", "image", "textures", "block", "assets", ".png");
        const src = "https://example.invalid/image.png";
        const cache = modelTexture ? Caching.textureAssetCache : Caching.rawImageCache;
        const cacheKey = modelTexture ? key.serialize() : serializeImageKey({ src });
        Caching.clear();
        ImageLoader.loadInfo = async () => info;
        AssetLoader.get = (async () => info) as typeof AssetLoader.get;
        ImageLoader.infoToCanvasData = async () => { decoding.resolve(); return decoded.promise; };
        try {
            const pending = modelTexture ? ModelTextures.get(key) : ImageLoader.loadCanvasData(src);
            const rejection = t.throwsAsync(pending, { is: error });
            await decoding.promise;
            cache.invalidate(cacheKey);
            await cache.get(cacheKey, async () => ({ ...info }));
            const replacement = cache.getIfPresent(cacheKey);
            decoded.reject(error);
            await rejection;
            t.is(cache.getIfPresent(cacheKey), replacement);
        } finally {
            ImageLoader.loadInfo = originals.loadInfo;
            ImageLoader.infoToCanvasData = originals.decode;
            AssetLoader.get = originals.getAsset;
            Caching.clear();
        }
    });
}

test.serial("an entity decode finishing after a cache clear does not restore the old material", async t => {
    const originalGet = ModelTextures.get;
    const originalCreate = Materials.createBasicCanvasMaterial;
    const decoding = deferred<void>();
    const decoded = deferred<ExtractableImageData>();
    const material = new MeshBasicMaterial();
    const key = new AssetKey("test", "cow", "textures", "entity", "assets", ".png");
    Caching.clear();
    ModelTextures.get = async textureKey => {
        await Caching.textureAssetCache.get(textureKey.serialize(), async () => info);
        decoding.resolve();
        return decoded.promise;
    };
    Materials.createBasicCanvasMaterial = () => material;
    try {
        await Caching.textureAssetCache.get(key.serialize(), async () => info);
        const entity = new EntityObject({
            key, texture: key, id: "test:cow",
            layer: {
                texture: [1, 1],
                root: { pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {} }
            }
        });
        const pending = entity["applyTextures"]();
        await decoding.promise;
        Caching.clear();
        decoded.resolve({ width: 1, height: 1, data: { canvas: {} } as CanvasRenderingContext2D });
        await pending;
        t.is(Caching.materialCache.getIfPresent(`entity:cutout::${key.serialize()}`), undefined);
    } finally {
        ModelTextures.get = originalGet;
        Materials.createBasicCanvasMaterial = originalCreate;
        material.dispose();
        Caching.clear();
    }
});
