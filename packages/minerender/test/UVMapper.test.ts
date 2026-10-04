import test from "ava";
import { Env, EnvProvider } from "../src/Env";
import { ModelTextures } from "../src/assets/ModelTextures";
import { ImageLoader } from "../src/image/ImageLoader";
import { UVMapper } from "../src/UVMapper";
import type { Model } from "../src/model/Model";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import type { ExtractableImageData } from "../src/ExtractableImageData";

test.serial("faces without texture references keep fallback UVs while textured faces map normally", async t => {
    const originals = { provider: Env["_provider"], get: ModelTextures.get, meta: ModelTextures.getMeta, data: ImageLoader.getData };
    t.teardown(() => {
        Env["_provider"] = originals.provider;
        ModelTextures.get = originals.get;
        ModelTextures.getMeta = originals.meta;
        ImageLoader.getData = originals.data;
    });
    const pixels = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) };
    Env.register({
        name: "test",
        createCanvas: (width, height) => ({
            width, height,
            getContext: () => ({ putImageData() {} }),
            toDataURL: () => ""
        } as unknown as CompatCanvas)
    } as EnvProvider);
    ModelTextures.get = async () => ({ width: 16, height: 16, data: { getImageData: () => pixels } } as ExtractableImageData);
    ModelTextures.getMeta = async () => undefined;
    ImageLoader.getData = async () => pixels;
    const model: Model = {
        textures: { side: "block/stone" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: { east: {}, west: { texture: "#side" } }
        }]
    };

    const atlas = (await UVMapper.createAtlas(model))!;
    const uv = atlas.model.elements![0].mappedUv!;
    t.is(uv.length, 48);
    t.true(uv.every(Number.isFinite));
    t.deepEqual(uv.slice(0, 8), [0, 0, 0.25, 0, 0, 0.25, 0.25, 0.25]);
    t.deepEqual(uv.slice(8, 16), [0.5, 1, 1, 1, 0.5, 0.5, 1, 0.5]);
    t.deepEqual(uv.slice(16, 24), [0, 1, 0.25, 1, 0, 0.75, 0.25, 0.75]);
});
