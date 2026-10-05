import test, { ExecutionContext } from "ava";
import { AssetKey } from "../src/assets/AssetKey";
import { Models } from "../src/assets/Models";
import { CUBE_FACES } from "../src/CubeFace";
import { ModelCulling } from "../src/model/ModelCulling";
import { ModelMerger } from "../src/model/ModelMerger";
import { Env, EnvProvider } from "../src/Env";
import { ModelTextures } from "../src/assets/ModelTextures";
import { ImageLoader } from "../src/image/ImageLoader";
import { UVMapper } from "../src/UVMapper";
import type { Model } from "../src/model/Model";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import type { ExtractableImageData } from "../src/ExtractableImageData";

function fixture(t: ExecutionContext) {
    const originals = { provider: Env["_provider"], get: ModelTextures.get, meta: ModelTextures.getMeta, data: ImageLoader.getData, raw: Models.getRaw };
    t.teardown(() => {
        Env["_provider"] = originals.provider;
        ModelTextures.get = originals.get;
        ModelTextures.getMeta = originals.meta;
        ImageLoader.getData = originals.data;
        Models.getRaw = originals.raw;
    });
    const pixels = (size = 16) => ({ width: size, height: size, data: new Uint8ClampedArray(size * size * 4).fill(255) });
    Env.register({
        name: "test",
        createCanvas: (width, height) => ({
            width, height,
            getContext: () => ({ putImageData() {} }),
            toDataURL: () => ""
        } as unknown as CompatCanvas)
    } as EnvProvider);
    ModelTextures.get = async key => {
        const data = pixels(key.path === "large" ? 32 : 16);
        return { width: data.width, height: data.height, data: { getImageData: () => data } } as ExtractableImageData;
    };
    ModelTextures.getMeta = async () => undefined;
    ImageLoader.getData = async () => pixels();
}

test.serial("faces without texture references keep fallback UVs while textured faces map normally", async t => {
    fixture(t);
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


test.serial("sibling atlases keep inherited UVs and occlusion independent of load order", async t => {
    fixture(t);
    for (const reverse of [false, true]) {
        const parent: Model = { elements: [{
            from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#side", cullface: face }]))
        }] };
        const source = structuredClone(parent);
        Models.getRaw = async () => parent;
        const models = await Promise.all([
            ModelMerger.mergeWithParents({ parent: "test:block/base", textures: { side: "test:block/stone" } }),
            ModelMerger.mergeWithParents({ parent: "test:block/base", textures: { padding: "test:block/large", side: "test:block/dirt" } })
        ]);
        models.forEach((model, index) => { model.key = new AssetKey("test", `sibling${index}`, "models", "block"); });
        const order = reverse ? [1, 0] : [0, 1];
        const first = (await UVMapper.createAtlas(models[order[0]]))!;
        const firstElements = structuredClone(first.model.elements);
        const second = (await UVMapper.createAtlas(models[order[1]]))!;
        t.deepEqual(first.model.elements, firstElements);
        t.true(ModelCulling.isOpaqueFullCube(first));
        t.true(ModelCulling.isOpaqueFullCube(second));
        t.deepEqual(parent, source);
        for (const model of models) t.deepEqual(model.elements, source.elements);
        for (const [index, atlas] of [first, second].entries()) {
            const modelIndex = order[index];
            const expected = modelIndex === 0
                ? [0.5, 1, 1, 1, 0.5, 0.5, 1, 0.5]
                : [0, 0.5, 0.25, 0.5, 0, 0.25, 0.25, 0.25];
            t.deepEqual(atlas.model.elements![0].mappedUv, CUBE_FACES.flatMap(() => expected));
            t.is(atlas.model.key, models[modelIndex].key);
            t.is(atlas.model.key!.getFullPath(), `block/sibling${modelIndex}`);
        }
    }
});

test.serial("atlas generation distinguishes omitted item elements from explicit empty geometry", async t => {
    fixture(t);
    const item: Model = { textures: { layer0: "item/stone" } };
    const atlas = (await UVMapper.createAtlas(item))!;
    t.true(atlas.model.elements!.length > 0);
    t.false("elements" in item);
    t.true(atlas.model.elements!.every(element => element.mappedUv?.length === 48));
    const empty = { ...item, elements: [] };
    t.deepEqual((await UVMapper.createAtlas(empty))!.model.elements, []);
    t.deepEqual(empty.elements, []);
});
