import test, { ExecutionContext } from "ava";
import { Caching } from "../src/cache/Caching";
import { serializeImageKey } from "../src/cache/CacheKey";
import { ImageLoader } from "../src/image/ImageLoader";
import { SkinImage } from "../src/skin/SkinImage";

const pngs = {
    rgba: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAAFUlEQVR4nGM44SbHkNK0SopbTPE/ABp2BBjmyHWLAAAAAElFTkSuQmCC",
    palette: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAgMAAADgGo6JAAAACVBMVEXIRh5kgqoLFiF+XnneAAAAAnRSTlMAGovxNEIAAAAMSURBVHicY5BgmAAAANwAqWznwCMAAAAASUVORK5CYII=",
    suggestedPalette: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAACVBMVEXIRh5kgqoLFiF+XnneAAAAFUlEQVR4nGM44SbHkNK0SopbTPE/ABp2BBjmyHWLAAAAAElFTkSuQmCC",
    gray: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACAgAAAADyryFnAAAAAnRSTlMAApidrBQAAAAMSURBVHicY5BgeAIAATAA/VbNHHMAAAAASUVORK5CYII=",
    grayAlpha: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAQAAABeK7cBAAAADUlEQVR4nGNwY+iRAgACTwDtynKYqgAAAABJRU5ErkJggg==",
    rgb16: "iVBORw0KGgoAAAANSUhEUgAAAAMAAAABEAIAAADEEl+gAAAABnRSTlMSNFZ4q81ouwj+AAAAGUlEQVR4nGMQMgmrWH1W6D+I/P+/gYHhPwBRPglhLfidaQAAAABJRU5ErkJggg==",
    rgba16: "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABEAYAAACksqPJAAAAGUlEQVR4nGM4wejGJMfMwJDC2MS0ilmKBQAbPQLncGcxZwAAAABJRU5ErkJggg=="
};

function info(src: keyof typeof pngs) {
    const data = Buffer.from(pngs[src], "base64");
    return { src, type: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20), data };
}

function fixture(t: ExecutionContext) {
    const original = { loadInfo: ImageLoader.loadInfo, getData: ImageLoader.getData };
    const requests: string[] = [];
    Caching.clear();
    ImageLoader.loadInfo = async src => { requests.push(src); return info(src as keyof typeof pngs); };
    t.teardown(() => {
        ImageLoader.loadInfo = original.loadInfo;
        ImageLoader.getData = original.getData;
        Caching.clear();
    });
    return requests;
}

test.serial("skin PNG decoding preserves hidden RGB and low-alpha colors without reusing canvas pixels", async t => {
    const requests = fixture(t);
    const canvasPixels = { width: 1, height: 1, data: new Uint8ClampedArray(4), colorSpace: "srgb" } as ImageData;
    await Caching.imageDataCache.get(serializeImageKey({ src: "rgba" }), async () => canvasPixels);
    const decoded = await SkinImage.getData("rgba");
    t.deepEqual([decoded.width, decoded.height], [3, 1]);
    t.deepEqual(Array.from(decoded.data), [200, 70, 30, 0, 100, 130, 170, 26, 11, 22, 33, 255]);
    t.is(await SkinImage.getData("rgba"), decoded);
    t.deepEqual(requests, ["rgba"]);
    ImageLoader.loadInfo = async () => ({ type: "jpg", width: 1, height: 1, data: Buffer.alloc(0) });
    ImageLoader.getData = async src => { t.is(src, "photo"); return canvasPixels; };
    t.is(await SkinImage.getData("photo"), canvasPixels);
});

test.serial("indexed, grayscale and 16-bit PNGs become RGBA8 with transparency applied before downconversion", async t => {
    fixture(t);
    for (const [src, expected] of [
        ["palette", [200, 70, 30, 0, 100, 130, 170, 26, 11, 22, 33, 255, 11, 22, 33, 255, 100, 130, 170, 26, 200, 70, 30, 0]],
        ["suggestedPalette", [200, 70, 30, 0, 100, 130, 170, 26, 11, 22, 33, 255]],
        ["gray", [0, 0, 0, 255, 85, 85, 85, 255, 170, 170, 170, 0, 255, 255, 255, 255, 170, 170, 170, 0, 85, 85, 85, 255]],
        ["grayAlpha", [70, 70, 70, 0, 140, 140, 140, 26]],
        ["rgb16", [18, 86, 171, 0, 18, 86, 171, 255, 255, 128, 0, 255]],
        ["rgba16", [200, 70, 30, 0, 100, 130, 170, 26]]
    ] as Array<[keyof typeof pngs, number[]]>) {
        t.deepEqual(Array.from((await SkinImage.getData(src)).data), expected, src);
    }
});

test.serial("a corrupt PNG decode evicts fetched bytes so the next skin load can recover", async t => {
    fixture(t);
    const valid = info("rgba");
    const corrupt = Buffer.from(valid.data);
    corrupt[41] ^= 255;
    let requests = 0;
    ImageLoader.loadInfo = async () => ({ ...valid, data: ++requests === 1 ? corrupt : valid.data });
    await t.throwsAsync(SkinImage.getData("rgba"));
    const decoded = await SkinImage.getData("rgba");
    t.deepEqual(Array.from(decoded.data.slice(0, 4)), [200, 70, 30, 0]);
    t.is(requests, 2);
});
