import test, { ExecutionContext } from "ava";
import { createCanvas } from "canvas";
import createGL from "gl";
import { decode } from "fast-png";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CanvasTexture, Mesh, MeshBasicMaterial, NearestFilter, PlaneGeometry, ShaderMaterial, SRGBColorSpace, WebGLRenderTarget } from "three";
import { AssetKey } from "../../src/assets/AssetKey";
import { AssetLoader } from "../../src/assets/AssetLoader";
import { AssetSource } from "../../src/assets/source/AssetSource";
import { AssetParser } from "../../src/assets/source/parser/AssetParsers";
import { Caching } from "../../src/cache/Caching";
import { CUBE_FACES } from "../../src/CubeFace";
import { Env } from "../../src/Env";
import { NodeEnv } from "../../src/env/node/NodeEnv";
import { NodeRenderer } from "../../src/env/node/NodeRenderer";
import type { MinecraftAsset } from "../../src/MinecraftAsset";
import type { Model } from "../../src/model/Model";
import { ModelObject } from "../../src/model/scene/ModelObject";
import { shutdown } from "../../src/shutdown";

const cacheDirectory = mkdtempSync(join(tmpdir(), "minerender-node-test-"));
class TestNodeEnv extends NodeEnv {
    openCache(name: string, version: number) {
        return super.openCache(join(cacheDirectory, name), version);
    }
}

test.before(() => Env.register(new TestNodeEnv()));
test.after.always(() => {
    shutdown();
    rmSync(cacheDirectory, { recursive: true, force: true });
});

async function renderer(t: ExecutionContext, composer = false, pixelRatio = 1) {
    const result = await NodeRenderer.create({
        width: 32, height: 32,
        camera: {
            type: "orthographic", near: 0.1, far: 100,
            orthographic: { left: -1, right: 1, top: 1, bottom: -1 },
            position: [0, 0, 10], lookingAt: [0, 0, 0]
        },
        composer: { enabled: composer },
        render: { pixelRatio, antialias: false }
    });
    t.teardown(() => result.dispose());
    return result;
}

function plane(t: ExecutionContext, target: NodeRenderer) {
    const geometry = new PlaneGeometry(2, 2);
    const material = new MeshBasicMaterial({ toneMapped: false });
    const mesh = new Mesh(geometry, material);
    target.scene.add(mesh);
    t.teardown(() => { geometry.dispose(); material.dispose(); });
    return { mesh, material };
}

function pixel(image: ReturnType<typeof decode>, x: number, y: number): number[] {
    const start = (y * image.width + x) * 4;
    return Array.from(image.data.subarray(start, start + 4));
}

function nearPixel(t: ExecutionContext, actual: number[], expected: number[]) {
    t.true(actual.every((value, index) => Math.abs(value - expected[index]) <= 2), `${actual} ≈ ${expected}`);
}

test.serial("native capture preserves texture orientation, sRGB and straight alpha without a DOM or animation callbacks", async t => {
    t.is(typeof document, "undefined");
    t.is(typeof window, "undefined");
    const source = createCanvas(2, 2);
    const context = source.getContext("2d");
    ["#804020", "#0080c0", "#204080", "#c08000"].forEach((color, index) => {
        context.fillStyle = color;
        context.fillRect(index % 2, Math.floor(index / 2), 1, 1);
    });
    const captures: Uint8Array[] = [];
    for (const composer of [false, true]) {
        const target = await renderer(t, composer);
        const { material } = plane(t, target);
        const texture = new CanvasTexture(source as unknown as HTMLCanvasElement);
        texture.colorSpace = SRGBColorSpace;
        texture.minFilter = texture.magFilter = NearestFilter;
        texture.generateMipmaps = false;
        t.teardown(() => texture.dispose());
        material.map = texture;
        let callbacks = 0;
        target.onFrame(() => callbacks++);
        target.stop();
        const image = decode(await target.renderToBuffer());
        nearPixel(t, pixel(image, 8, 8), [128, 64, 32, 255]);
        nearPixel(t, pixel(image, 24, 8), [0, 128, 192, 255]);
        nearPixel(t, pixel(image, 8, 24), [32, 64, 128, 255]);
        captures.push(new Uint8Array(image.data));
        material.map = null;
        material.color.set("#ff0000");
        material.transparent = true;
        material.opacity = 0.5;
        material.needsUpdate = true;
        nearPixel(t, pixel(decode(await target.renderToBuffer()), 16, 16), [255, 0, 0, 128]);
        t.is(callbacks, 0);
        t.is(target.renderer.getContext().getError(), 0);
    }
    t.deepEqual(captures[0], captures[1]);
});

test.serial("native capture resizes the drawing buffer, trims alpha and restores the active render target", async t => {
    const target = await renderer(t, true, 2);
    const { mesh, material } = plane(t, target);
    material.transparent = true;
    material.opacity = 0.25;
    target.resize(20, 12);
    mesh.scale.set(5, 3, 1);
    const full = decode(await target.renderToBuffer());
    t.deepEqual([full.width, full.height], [40, 24]);
    t.deepEqual([target.renderer.getContext().drawingBufferWidth, target.renderer.getContext().drawingBufferHeight], [40, 24]);
    const previous = new WebGLRenderTarget(4, 4);
    t.teardown(() => previous.dispose());
    target.renderer.setRenderTarget(previous);
    const trimmed = decode(await target.renderToBuffer({ trim: true }));
    t.deepEqual([trimmed.width, trimmed.height], [20, 12]);
    nearPixel(t, pixel(trimmed, 10, 6), [255, 255, 255, 64]);
    t.is(target.renderer.getRenderTarget(), previous);
    mesh.visible = false;
    const empty = decode(await target.renderToBuffer({ trim: true }));
    t.deepEqual([empty.width, empty.height, ...empty.data], [1, 1, 0, 0, 0, 0]);
});

test.serial("native rendering loads a skin and a shaded model atlas from local fixtures", async t => {
    const skinCanvas = createCanvas(64, 64);
    const context = skinCanvas.getContext("2d");
    context.fillStyle = "#00ff00";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "#ff0000";
    context.fillRect(8, 8, 8, 4);
    context.fillStyle = "#0000ff";
    context.fillRect(8, 12, 8, 4);
    const target = await NodeRenderer.create({
        width: 64, height: 80, composer: { enabled: false }, render: { antialias: false },
        camera: { type: "orthographic", near: 0.1, far: 100,
            orthographic: { left: -16, right: 16, top: 20, bottom: -20 },
            position: [0, 16, 60], lookingAt: [0, 16, 0] }
    });
    t.teardown(() => target.dispose());
    const skin = await target.scene.addSkin(skinCanvas.toDataURL(), { slim: false });
    t.teardown(() => skin.disposeAndRemoveAllChildren());
    for (const part of ["hat", "jacket", "leftSleeve", "rightSleeve", "leftTrousers", "rightTrousers"]) {
        skin.getMeshByName(part)!.visible = false;
    }
    const skinImage = decode(await target.renderToBuffer());
    nearPixel(t, pixel(skinImage, 32, 12), [255, 0, 0, 255]);
    nearPixel(t, pixel(skinImage, 32, 20), [0, 0, 255, 255]);
    skin.visible = false;

    const texture = createCanvas(2, 2);
    const textureContext = texture.getContext("2d");
    textureContext.fillStyle = "#808080";
    textureContext.fillRect(0, 0, 2, 2);
    class FixtureSource extends AssetSource {
        constructor() { super(); }
        async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string) {
            if (parser === AssetParser.META) return undefined;
            if (key.namespace !== "headless-test" || parser !== AssetParser.IMAGE) throw new Error(`Unexpected fixture asset ${key.serialize()}`);
            return { key, width: 2, height: 2, type: "png", data: texture.toBuffer() } as unknown as T;
        }
        blocks() { return true; }
    }
    AssetLoader.addSource("headless-test", new FixtureSource());
    t.teardown(() => { AssetLoader.removeSource("headless-test"); Caching.clear(); });
    const model: Model = {
        key: new AssetKey("headless-test", "cube", "models", "block"),
        textures: { all: "headless-test:block/gray" },
        elements: [{ from: [0, 0, 0], to: [16, 16, 16],
            faces: Object.fromEntries(CUBE_FACES.map(face => [face, { texture: "#all" }])) }]
    };
    const object = await target.scene.addModel(model, { instanceMeshes: false }) as ModelObject;
    t.teardown(() => object.disposeAndRemoveAllChildren());
    object.position.y = 16;
    object.iterateAllMeshes(mesh => {
        t.true((mesh.material as ShaderMaterial).isShaderMaterial);
        (mesh.material as ShaderMaterial).uniforms.SHADE.value = true;
    });
    nearPixel(t, pixel(decode(await target.renderToBuffer()), 32, 40), [115, 115, 115, 255]);
    t.is(target.renderer.getContext().getError(), 0);
});

test.serial("native disposal destroys factory contexts and preserves injected contexts", async t => {
    const owned = await renderer(t);
    const ownedContext = owned.renderer.getContext();
    owned.dispose();
    owned.dispose();
    t.throws(() => ownedContext.getError(), { message: "Invalid GL context" });
    await t.throwsAsync(owned.renderToBuffer(), { message: /disposed/ });

    const context = createGL(8, 8, { createWebGL2Context: true, preserveDrawingBuffer: true }) as unknown as WebGL2RenderingContext;
    const extension = context.getExtension("STACKGL_destroy_context")!;
    t.teardown(() => extension.destroy());
    const canvas = { width: 8, height: 8, addEventListener() {}, removeEventListener() {} };
    const injected = new NodeRenderer({ composer: { enabled: false } }, { canvas, context, width: 8, height: 8 });
    injected.dispose();
    injected.dispose();
    context.clearColor(1, 0, 0, 1);
    context.clear(context.COLOR_BUFFER_BIT);
    const pixels = new Uint8Array(4);
    context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, pixels);
    t.deepEqual([...pixels], [255, 0, 0, 255]);

    const straight = createGL(8, 8, { createWebGL2Context: true, alpha: true, premultipliedAlpha: false }) as unknown as WebGL2RenderingContext;
    t.teardown(() => straight.getExtension("STACKGL_destroy_context")!.destroy());
    t.throws(() => new NodeRenderer({ composer: { enabled: false } }, { canvas, context: straight, width: 8, height: 8 }),
        { message: /premultipliedAlpha/ });
    straight.clearColor(0, 1, 0, 1);
    straight.clear(straight.COLOR_BUFFER_BIT);
    straight.readPixels(0, 0, 1, 1, straight.RGBA, straight.UNSIGNED_BYTE, pixels);
    t.deepEqual([...pixels], [0, 255, 0, 255]);
});
