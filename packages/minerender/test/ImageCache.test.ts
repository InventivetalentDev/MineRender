import test, { ExecutionContext } from "ava";
import { MeshBasicMaterial, NearestFilter, SRGBColorSpace } from "three";
import { AssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { ModelTextures } from "../src/assets/ModelTextures";
import { Caching } from "../src/cache/Caching";
import { serializeImageKey } from "../src/cache/CacheKey";
import { EntityObject } from "../src/entity/scene/EntityObject";
import { Env, EnvProvider } from "../src/Env";
import { probeImageSize } from "../src/env/browser/probeImageSize";
import { ExtractableImageData } from "../src/ExtractableImageData";
import { ImageInfo, ImageLoader } from "../src/image/ImageLoader";
import { Materials } from "../src/Materials";
import { Requests } from "../src/request/Requests";
import { Textures } from "../src/texture/Textures";

const inlinePng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAABeK7cBAAAADUlEQVR4nGNwY+iRAgACTwDtynKYqgAAAABJRU5ErkJggg==", "base64");

function inlineImageFixture(t: ExecutionContext) {
    const originals = { provider: Env["_provider"], request: Requests.genericRequest, decode: ImageLoader.infoToCanvasData };
    const requests: string[] = [];
    Caching.clear();
    Env.register({ name: "test", imageSize: probeImageSize } as EnvProvider);
    Requests.genericRequest = async request => {
        requests.push(request.url);
        throw new Error("Embedded images must not make requests");
    };
    t.teardown(() => {
        Env["_provider"] = originals.provider;
        Requests.genericRequest = originals.request;
        ImageLoader.infoToCanvasData = originals.decode;
        Caching.clear();
    });
    return requests;
}

test.serial("embedded image bytes decode without requests and retain the image info cache", async t => {
    const requests = inlineImageFixture(t);
    for (const src of [
        `data:image/png;base64,${inlinePng.toString("base64")}`,
        `DATA:image/png; BASE64,${encodeURIComponent(inlinePng.toString("base64").replace(/=+$/, ""))}%20#preview`,
        `data:image/png,${Array.from(inlinePng, byte => `%${byte.toString(16).padStart(2, "0")}`).join("")}`
    ]) {
        const info = await ImageLoader.getInfo(src);
        t.deepEqual([info.width, info.height, info.type], [2, 1, "png"]);
        t.is(info.src, src);
        t.deepEqual(info.data, inlinePng);
        t.is(await ImageLoader.getInfo(src), info);
    }
    t.deepEqual(requests, []);
});

test.serial("invalid embedded images reject without caching while remote images still use requests", async t => {
    const requests = inlineImageFixture(t);
    for (const src of ["data:image/png;base64", "data:image/png;base64,not!base64", "data:image/png;base64,YWJj"]) {
        await t.throwsAsync(ImageLoader.getInfo(src));
        t.is(Caching.rawImageCache.getIfPresent(serializeImageKey({ src })), undefined);
    }
    t.deepEqual(requests, []);

    Requests.genericRequest = (async request => {
        requests.push(request.url);
        t.is(request.responseType, "arraybuffer");
        return { data: Uint8Array.from(inlinePng).buffer, url: request.url };
    }) as typeof Requests.genericRequest;
    const src = "https://example.invalid/image.png";
    t.deepEqual((await ImageLoader.getInfo(src)).data, inlinePng);
    t.deepEqual(requests, [src]);
});

test.serial("an embedded image decode failure evicts its bytes and can be retried", async t => {
    const requests = inlineImageFixture(t);
    const src = `data:image/png;base64,${inlinePng.toString("base64")}`;
    const key = serializeImageKey({ src });
    const error = new Error("Image decode failed");
    const decoded = { width: 2, height: 1, data: {} as CanvasRenderingContext2D };
    let decodes = 0;
    ImageLoader.infoToCanvasData = async info => {
        t.deepEqual(info.data, inlinePng);
        if (++decodes === 1) {
            throw error;
        }
        return decoded;
    };
    await t.throwsAsync(ImageLoader.getCanvasData(src), { is: error });
    t.is(Caching.rawImageCache.getIfPresent(key), undefined);
    t.is(Caching.canvasImageDataCache.getIfPresent(key), undefined);
    t.is(await ImageLoader.getCanvasData(src), decoded);
    t.is(await ImageLoader.getCanvasData(src), decoded);
    t.is(decodes, 2);
    t.deepEqual(requests, []);
});

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
        const assets = AssetLoader.context;
        const originals = { loadInfo: ImageLoader.loadInfo, decode: ImageLoader.infoToCanvasData, getAsset: assets.get };
        const decoding = deferred<void>();
        const decoded = deferred<ExtractableImageData>();
        const error = new Error("old image failed to decode");
        const key = new AssetKey("test", "image", "textures", "block", "assets", ".png");
        const src = "https://example.invalid/image.png";
        const cache = modelTexture ? Caching.textureAssetCache : Caching.rawImageCache;
        const cacheKey = modelTexture ? AssetLoader.context.cacheKey(key) : serializeImageKey({ src });
        Caching.clear();
        ImageLoader.loadInfo = async () => info;
        assets.get = (async () => info) as typeof assets.get;
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
            assets.get = originals.getAsset;
            Caching.clear();
        }
    });
}

test.serial("an entity decode finishing after a cache clear does not restore the old material", async t => {
    const modelTextures = AssetLoader.context.modelTextures;
    const originalGet = modelTextures.get;
    const originalCreate = Materials.createBasicCanvasMaterial;
    const decoding = deferred<void>();
    const decoded = deferred<ExtractableImageData>();
    const material = new MeshBasicMaterial();
    const key = new AssetKey("test", "cow", "textures", "entity", "assets", ".png");
    Caching.clear();
    modelTextures.get = async textureKey => {
        await Caching.textureAssetCache.get(AssetLoader.context.cacheKey(textureKey), async () => info);
        decoding.resolve();
        return decoded.promise;
    };
    Materials.createBasicCanvasMaterial = () => material;
    try {
        await Caching.textureAssetCache.get(AssetLoader.context.cacheKey(key), async () => info);
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
        t.is(Caching.materialCache.getIfPresent(`entity:cutout::${AssetLoader.context.cacheKey(key)}`), undefined);
    } finally {
        modelTextures.get = originalGet;
        Materials.createBasicCanvasMaterial = originalCreate;
        material.dispose();
        Caching.clear();
    }
});
