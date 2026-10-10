import test from "ava";
import { BoxGeometry, Float32BufferAttribute } from "three";
import { Env, EnvProvider } from "../src/Env";
import { ModelTextures } from "../src/assets/ModelTextures";
import { UVMapper } from "../src/UVMapper";
import { WrappedImage } from "../src/WrappedImage";
import type { Model } from "../src/model/Model";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import type { ExtractableImageData } from "../src/ExtractableImageData";

import type { ExecutionContext } from "ava";

function stubTextures(t: ExecutionContext, alpha = 255): ExtractableImageData {
    const originals = { provider: Env["_provider"], get: ModelTextures.get, meta: ModelTextures.getMeta };
    t.teardown(() => {
        Env["_provider"] = originals.provider;
        ModelTextures.get = originals.get;
        ModelTextures.getMeta = originals.meta;
    });
    const pixels = { width: 16, height: 16, data: new Uint8ClampedArray(16 * 16 * 4).fill(255) };
    pixels.data[3] = alpha;
    Env.register({
        name: "test",
        createCanvas: (width, height) => ({
            width, height,
            getContext: () => ({
                createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
                putImageData() {}, clearRect() {}
            }),
            toDataURL: () => ""
        } as unknown as CompatCanvas)
    } as EnvProvider);
    const image = { width: 16, height: 16, data: { getImageData: () => pixels } } as ExtractableImageData;
    ModelTextures.get = async () => image;
    ModelTextures.getMeta = async () => undefined;
    return image;
}

for (const alpha of [0, 128, 255]) {
    test.serial(`image and atlas distinguish transparency from translucency for alpha ${alpha}`, async t => {
        const image = new WrappedImage(stubTextures(t, alpha));
        const atlas = (await UVMapper.createAtlas({
            textures: { side: "block/stone" },
            elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: { east: { texture: "#side" } } }]
        }))!;
        t.teardown(() => atlas.dispose());

        t.is(image.hasTransparency, alpha < 255);
        t.is(image.hasTranslucency, alpha > 0 && alpha < 255);
        t.is(atlas.hasTransparency, image.hasTransparency);
        t.is(atlas.hasTranslucency, image.hasTranslucency);
    });
}

test.serial("faces without texture references keep fallback UVs while textured faces map normally", async t => {
    stubTextures(t);
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

test.serial("atlases bake UVs onto their own element copies, not onto elements shared through a parent", async t => {
    stubTextures(t);
    // Both merged models reference the same element objects, as models inheriting block/cube do.
    const shared = [{
        from: [0, 0, 0] as [number, number, number], to: [16, 16, 16] as [number, number, number],
        faces: { up: { texture: "#top" }, north: { texture: "#side" } }
    }];
    const single: Model = { textures: { top: "block/planks", side: "#top" }, elements: shared };
    const several: Model = { textures: { top: "block/furnace_top", side: "block/furnace_side", extra: "block/furnace_front" }, elements: shared };

    const first = (await UVMapper.createAtlas(single))!;
    const firstUv = [...first.model.elements![0].mappedUv!];
    const second = (await UVMapper.createAtlas(several))!;

    t.not(first.model.elements![0], shared[0]);
    t.not(second.model.elements![0], shared[0]);
    t.is(shared[0].mappedUv, undefined);
    t.deepEqual(first.model.elements![0].mappedUv, firstUv);
    t.notDeepEqual(second.model.elements![0].mappedUv, firstUv);
});

test.serial("atlas bounds preserve narrow crops and constrain missing faces", async t => {
    stubTextures(t);
    const atlas = (await UVMapper.createAtlas({
        textures: { side: "block/stone", west: "#side" },
        elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: { east: {}, west: { texture: "#west", uv: [0, 0, 0.125, 0.125] } }
        }]
    }))!;
    const element = atlas.model.elements![0];
    const geometry = new BoxGeometry(16, 16, 16);
    const uv = new Float32BufferAttribute(element.mappedUv!, 2);
    for (let vertex = 20; vertex < 24; vertex++) uv.setXY(vertex, 0.25, 0.75);
    geometry.setAttribute("uv", uv);
    const originalUv = uv.array.slice();

    UVMapper.setAtlasUvBounds(geometry, element.faces, atlas);

    const bounds = geometry.getAttribute("uvBounds").array;
    t.deepEqual(Array.from(bounds.slice(0, 4)), [0.015625, 0.015625, 0.234375, 0.234375]);
    t.deepEqual(Array.from(bounds.slice(16, 32)), Array(4).fill([0.515625, 0.515625, 0.984375, 0.984375]).flat());
    t.deepEqual(Array.from(bounds.slice(32, 36)), [0.015625, 0.765625, 0.234375, 0.984375]);
    t.deepEqual(Array.from(bounds.slice(80, 84)), [0.25, 0.75, 0.25, 0.75]);
    t.deepEqual(uv.array, originalUv);
});
