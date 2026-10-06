import test, { ExecutionContext } from "ava";
import type { Camera, WebGLRenderer } from "three";
import type { EffectComposer } from "postprocessing";
import { Env, EnvProvider } from "../src/Env";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";
import { Renderer } from "../src/renderer/Renderer";
import type { MineRenderScene } from "../src/renderer/MineRenderScene";
import type { OrbitControls } from "../src/three/OrbitControls";
import { shutdown } from "../src/shutdown";

function canvasFixture(width: number, height: number, onRead = () => {}) {
    const canvas = {
        width, height, clientWidth: width / 2, clientHeight: height / 2,
        pixels: new Uint8ClampedArray(width * height * 4),
        getContext: () => ({
            drawImage(source: typeof canvas) { canvas.pixels.set(source.pixels); },
            getImageData(x: number, y: number, width: number, height: number) {
                const data = new Uint8ClampedArray(width * height * 4);
                for (let row = 0; row < height; row++) {
                    const start = ((y + row) * canvas.width + x) * 4;
                    data.set(canvas.pixels.subarray(start, start + width * 4), row * width * 4);
                }
                return { width, height, data };
            },
            putImageData(image: { data: Uint8ClampedArray }) { canvas.pixels = image.data; }
        }),
        toDataURL(mime: string, quality?: number) {
            onRead();
            return JSON.stringify({ mime, quality, width: canvas.width, height: canvas.height,
                pixels: Array.from(canvas.pixels.subarray(0, canvas.width * canvas.height * 4)) });
        }
    };
    return canvas;
}

class ImageRenderer extends Renderer {
    events: string[] = [];

    constructor(composer = false) {
        super({ render: { fpsLimit: 30, pixelRatio: 2 }, composer: { enabled: composer } });
        this.start();
    }

    protected createScene(): MineRenderScene { return { dirty: false } as MineRenderScene; }
    protected createCamera(): Camera { return {} as Camera; }
    protected createRenderer(): WebGLRenderer {
        return {
            domElement: canvasFixture(8, 6, () => this.events.push("read")),
            render: () => this.events.push("direct"),
            setAnimationLoop: () => this.events.push("loop")
        } as unknown as WebGLRenderer;
    }
    protected createComposer(): EffectComposer {
        return { render: () => this.events.push("composer") } as unknown as EffectComposer;
    }
    public init(): void {}
    tick(time: number): void { this["animate"](time); }
}

function fixture(t: ExecutionContext) {
    const provider = Env["_provider"];
    t.teardown(() => { Env["_provider"] = provider; });
    Env.register({ name: "test", createCanvas: (width, height) => canvasFixture(width, height) as unknown as CompatCanvas } as EnvProvider);
    const renderer = new ImageRenderer();
    const canvas = renderer.renderer.domElement as unknown as ReturnType<typeof canvasFixture>;
    return { renderer, canvas };
}

test.after.always(() => shutdown());

test("image export draws before readback while clean, frame-limited, or stopped", t => {
    for (const composer of [false, true]) {
        const renderer = new ImageRenderer(composer);
        renderer["_controls"] = { enabled: true, update: () => renderer.events.push("controls") } as unknown as OrbitControls;
        renderer.tick(0);
        let callbacks = 0;
        renderer.onFrame(() => { callbacks++; });
        const deadline = renderer["_nextFrameTime"];
        renderer.events.length = 0;
        const image = JSON.parse(renderer.toImage(false, "image/jpeg", 0.7));
        t.deepEqual(renderer.events, ["controls", composer ? "composer" : "direct", "read"]);
        t.deepEqual([image.mime, image.quality, image.width, image.height], ["image/jpeg", 0.7, 8, 6]);
        t.is(renderer["_nextFrameTime"], deadline);
        renderer.dirty = true;
        renderer.tick(1);
        t.true(renderer.dirty);
        renderer.events.length = 0;
        renderer.toImage();
        t.deepEqual(renderer.events, ["controls", composer ? "composer" : "direct", "read"]);
        t.false(renderer.dirty);
        renderer.stop();
        renderer.events.length = 0;
        t.is(JSON.parse(renderer.toImage()).mime, "image/png");
        t.deepEqual(renderer.events, ["controls", composer ? "composer" : "direct", "read"]);
        t.is(callbacks, 0);
        renderer["_disposed"] = true;
        t.throws(() => renderer.toImage(), { message: "Cannot export an image from a disposed renderer" });
    }
});

test.serial("trimming preserves inclusive buffer bounds and partially transparent single pixels", t => {
    const { renderer, canvas } = fixture(t);
    canvas.pixels.set([10, 20, 30, 1], (2 * canvas.width + 3) * 4);
    canvas.pixels.set([40, 50, 60, 255], (5 * canvas.width + 7) * 4);
    const image = JSON.parse(renderer.toImage(true, "image/webp", 0.8));
    t.deepEqual([image.mime, image.quality, image.width, image.height], ["image/webp", 0.8, 5, 4]);
    t.deepEqual(image.pixels.slice(0, 4), [10, 20, 30, 1]);
    t.deepEqual(image.pixels.slice(-4), [40, 50, 60, 255]);
    t.deepEqual([canvas.width, canvas.height], [8, 6]);

    canvas.pixels.fill(0);
    canvas.pixels.set([70, 80, 90, 1], (5 * canvas.width + 7) * 4);
    const single = JSON.parse(renderer.toImage(true));
    t.deepEqual([single.width, single.height, ...single.pixels], [1, 1, 70, 80, 90, 1]);
});

test.serial("trimming an empty or zero-sized image returns one transparent pixel", t => {
    const { renderer, canvas } = fixture(t);
    for (const width of [8, 0]) {
        canvas.width = width;
        const image = JSON.parse(renderer.toImage(true));
        t.deepEqual([image.width, image.height, ...image.pixels], [1, 1, 0, 0, 0, 0]);
    }
});
