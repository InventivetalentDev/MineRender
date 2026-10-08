import test, { ExecutionContext } from "ava";
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, ShaderMaterial } from "three";
import { Env, EnvProvider } from "../src/Env";
import { ModelTextures } from "../src/assets/ModelTextures";
import { UVMapper } from "../src/UVMapper";
import { Ticker } from "../src/Ticker";
import { ModelObject } from "../src/model/scene/ModelObject";
import { MineRenderScene } from "../src/renderer/MineRenderScene";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import type { AnimationMeta, MinecraftTextureMeta } from "../src/MinecraftTextureMeta";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import type { ExtractableImageData } from "../src/ExtractableImageData";

async function fixture(t: ExecutionContext, width: number, height: number, animation?: Partial<AnimationMeta>, sourcePixels?: number[]) {
    const originals = { provider: Env["_provider"], get: ModelTextures.prototype.get, meta: ModelTextures.prototype.getMeta };
    const draws: number[][] = [];
    const uploads: number[][] = [];
    const pixels = (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(255) });
    Env.register({ name: "test", createCanvas: (width, height) => ({ width, height,
        getContext: () => ({ createImageData: pixels, clearRect() {},
            putImageData: (image: { data: Uint8ClampedArray }) => uploads.push(Array.from(image.data))
        }), toDataURL: () => ""
    } as unknown as CompatCanvas) } as EnvProvider);
    ModelTextures.prototype.get = async () => ({ width, height, data: {
        getImageData(x: number, y: number, w: number, h: number) {
            draws.push([x, y, w, h]);
            const image = pixels(w, h);
            if (sourcePixels) for (let row = 0; row < h; row++) {
                const start = ((y + row) * width + x) * 4;
                image.data.set(sourcePixels.slice(start, start + w * 4), row * w * 4);
            }
            return image;
        }
    } } as ExtractableImageData);
    ModelTextures.prototype.getMeta = async () => animation ? { animation } as MinecraftTextureMeta : undefined;
    const restore = () => {
        Env["_provider"] = originals.provider;
        ModelTextures.prototype.get = originals.get;
        ModelTextures.prototype.getMeta = originals.meta;
    };
    t.teardown(restore);
    const atlas = (await UVMapper.createAtlas({ textures: { side: "block/animated" }, elements: [] }))!;
    t.teardown(() => atlas.dispose());
    return { atlas, draws, uploads, restore, tick: () => Ticker.tickers.get(atlas.ticker!)!() };
}

class AnimatedModel extends ModelObject {
    readonly geometry = new BoxGeometry();
    constructor(atlas: TextureAtlas, instanced = false) {
        super(atlas.model, { instanceMeshes: instanced });
        this.atlas = atlas;
    }
    protected async loadTextures() {}
    protected createMeshes() {
        const material = new MeshBasicMaterial();
        this.add(this.options.instanceMeshes
            ? this.createInstancedMesh(undefined, this.geometry, material, 2)
            : new Mesh(this.geometry, material));
        material.dispose();
    }
    get material() { return (this.children[0] as Mesh).material as ShaderMaterial; }
}

test.serial("frame grids honor the initial frame, object durations, and repeated frame indices", async t => {
    const { atlas, draws, tick } = await fixture(t, 4, 4, {
        width: 2, height: 2, frametime: 2, frames: [{ index: 3, time: 1 }, 1, 1, 0]
    });
    t.deepEqual(atlas.sizes.side, [2, 2]);
    t.deepEqual(draws[0], [2, 2, 2, 2]);
    t.is(atlas.ticker, undefined);
    let changes = 0;
    const stop = atlas.subscribe(() => changes++);
    draws.length = 0;
    for (const expected of [1, 1, 1, 1, 2, 2, 3]) {
        tick();
        t.is(changes, expected);
    }
    t.deepEqual(draws, [[2, 0, 2, 2], [0, 0, 2, 2], [2, 2, 2, 2]]);
    stop();
    t.is(atlas.ticker, undefined);
    t.is(Ticker["interval"], undefined);
});

test.serial("animation dimensions use metadata while images without animation metadata stay whole", async t => {
    for (const [width, height, animation, size] of [
        [16, 32, {}, [16, 16]], [8, 4, { width: 4 }, [4, 4]],
        [8, 4, { height: 2 }, [8, 2]], [8, 4, {}, [4, 4]],
        [16, 32, undefined, [16, 32]]
    ] as [number, number, Partial<AnimationMeta> | undefined, number[]][]) {
        const { atlas, restore } = await fixture(t, width, height, animation);
        t.deepEqual(atlas.sizes.side, size);
        t.is(atlas.hasAnimation, animation !== undefined);
        restore();
    }
});

for (const interpolate of [false, true]) test.serial(`animation uploads ${interpolate ? "interpolated RGBA" : "stepped frames"} across custom durations, repeated indices, and wrap`, async t => {
    const first = [0, 31, 71, 40], second = [253, 110, 20, 200];
    const { atlas, uploads, tick } = await fixture(t, 1, 2, {
        interpolate, frames: [{ index: 1, time: 3 }, { index: 0, time: 2 }, { index: 0, time: 4 }]
    }, [...first, ...second]);
    t.deepEqual(uploads.at(-1), second);
    let changes = 0;
    const stop = atlas.subscribe(() => changes++);
    const expected = interpolate
        ? [[169, 84, 37, 147], [85, 57, 54, 93], first, undefined, undefined,
            [63, 51, 58, 80], [126, 70, 46, 120], [190, 90, 33, 160], second]
        : [undefined, undefined, first, undefined, undefined, undefined, undefined, undefined, second];
    let changedTicks = 0;
    for (const frame of expected) {
        uploads.length = 0;
        tick();
        t.deepEqual(uploads, frame ? [frame] : []);
        if (frame) changedTicks++;
        t.is(changes, changedTicks);
    }
    stop();
    t.is(atlas.ticker, undefined);
});

for (const interpolate of [false, true]) test.serial(`shared ${interpolate ? "interpolated" : "stepped"} animation updates each texture and scene, then stops on removal and empty instance pools`, async t => {
    const { atlas, tick } = await fixture(t, 16, 32, { frametime: 2, interpolate });
    const scenes = [new MineRenderScene(), new MineRenderScene()];
    const models = [new AnimatedModel(atlas), new AnimatedModel(atlas, true)];
    const group = new Group();
    scenes[1].add(group);
    for (const [index, model] of models.entries()) {
        model.scene = scenes[index];
        await model.init();
        (index ? group : scenes[0]).add(model);
        t.teardown(() => { model.dispose(); model.removeFromParent(); model.geometry.dispose(); });
    }
    const reference = models[1].nextInstance();
    const textures = models.map(model => model.material.uniforms.map.value);
    const versions = textures.map(texture => texture.version);
    const materialVersions = models.map(model => model.material.version);
    scenes.forEach(scene => scene.dirty = false);
    tick();
    t.deepEqual(scenes.map(scene => scene.dirty), [interpolate, interpolate]);
    tick();
    t.deepEqual(scenes.map(scene => scene.dirty), [true, true]);
    t.deepEqual(textures.map(texture => texture.version), versions.map(version => version + (interpolate ? 2 : 1)));
    t.deepEqual(models.map(model => model.material.version), materialVersions);
    models[0].removeFromParent();
    const detachedVersion = textures[0].version;
    scenes.forEach(scene => scene.dirty = false);
    tick(); tick();
    t.deepEqual(scenes.map(scene => scene.dirty), [false, true]);
    t.is(textures[0].version, detachedVersion);
    reference.dispose();
    t.is(atlas.ticker, undefined);
    models[1].nextInstance();
    t.not(atlas.ticker, undefined);
    models[1].dispose();
    t.is(atlas.ticker, undefined);
});
