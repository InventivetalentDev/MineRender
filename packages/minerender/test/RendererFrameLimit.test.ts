import test from "ava";
import type { Camera, WebGLRenderer } from "three";
import { Renderer, RendererFrame } from "../src/renderer/Renderer";
import type { MineRenderScene } from "../src/renderer/MineRenderScene";
import { shutdown } from "../src/shutdown";

class FrameRenderer extends Renderer {
    frames = 0;
    loop?: (time: number) => void;

    constructor(fpsLimit: number, renderAlways = true) {
        super({ render: { fpsLimit, renderAlways }, composer: { enabled: false } });
        this.start();
    }

    protected createScene(): MineRenderScene { return { dirty: false, clear() {} } as MineRenderScene; }
    protected createCamera(): Camera { return {} as Camera; }
    protected createComposer(): undefined { return undefined; }
    protected createRenderer(): WebGLRenderer {
        return {
            render: () => this.frames++,
            setAnimationLoop: (loop: ((time: number) => void) | null) => { this.loop = loop ?? undefined; },
            domElement: { remove() {} }, dispose() {}, forceContextLoss() {}
        } as unknown as WebGLRenderer;
    }
    public init(): void {}

    tick(time: number): void { this.loop?.(time); }
}

test.after.always(() => shutdown());

test("frame limit keeps fractional intervals on faster displays", t => {
    const renderer = new FrameRenderer(60);
    for (let frame = 0; frame < 144; frame++) renderer.tick(frame * 1000 / 144);
    t.is(renderer.frames, 60);

    const rounded = new FrameRenderer(60);
    for (let frame = 0; frame < 60; frame++) rounded.tick(Math.round(frame * 1000 / 60 * 10) / 10);
    t.is(rounded.frames, 60);
});

test("a skipped frame preserves its pending redraw", t => {
    const renderer = new FrameRenderer(30, false);
    renderer.tick(0);
    renderer.dirty = true;
    renderer.tick(10);
    t.is(renderer.frames, 1);
    t.true(renderer.dirty);
    renderer.tick(1000 / 30);
    t.is(renderer.frames, 2);
    t.false(renderer.dirty);
});

test("idle gaps do not cause catch-up frames and stop resets the deadline", t => {
    const renderer = new FrameRenderer(30);
    for (const time of [0, 1000, 1001, 1010]) renderer.tick(time);
    t.is(renderer.frames, 2);
    renderer.stop();
    renderer.start();
    renderer.tick(1011);
    t.is(renderer.frames, 3);
});

test("zero and negative limits draw on every animation callback", t => {
    for (const limit of [0, -1]) {
        const renderer = new FrameRenderer(limit);
        for (const time of [0, 1, 2, 3]) renderer.tick(time);
        t.is(renderer.frames, 4);
    }
});

test("frame subscriptions update clean scenes before FPS-limited draws and unsubscribe back to idle", t => {
    const renderer = new FrameRenderer(20, false);
    renderer.tick(0);
    const updates: Array<RendererFrame & { draws: number }> = [];
    const callback = (frame: RendererFrame) => { updates.push({ ...frame, draws: renderer.frames }); };
    const unsubscribe = renderer.onFrame(callback);
    renderer.onFrame(callback);
    for (const time of [10, 50, 75, 100]) renderer.tick(time);
    t.deepEqual(updates, [{ time: 0.05, delta: 0, draws: 1 }, { time: 0.1, delta: 0.05, draws: 2 }]);
    t.is(renderer.frames, 3);
    unsubscribe();
    unsubscribe();
    renderer.tick(150);
    t.is(renderer.frames, 3);
});

test("late subscriptions and resumed callbacks start with zero delta", t => {
    const renderer = new FrameRenderer(0, false);
    const first: number[] = [], second: number[] = [];
    renderer.onFrame(({ delta }) => first.push(delta));
    renderer.tick(1000);
    renderer.tick(1100);
    renderer.onFrame(({ delta }) => second.push(delta));
    renderer.tick(1200);
    renderer.stop();
    renderer.tick(5000);
    t.deepEqual(first, [0, 0.1, 0.1]);
    t.deepEqual(second, [0]);
    renderer.start();
    renderer.tick(10000);
    renderer.tick(10050);
    t.deepEqual(first, [0, 0.1, 0.1, 0, 0.05]);
    t.deepEqual(second, [0, 0, 0.05]);
});

test("callbacks can unsubscribe, add updates for the next frame, and stop or dispose before drawing", async t => {
    const renderer = new FrameRenderer(0, false);
    const calls: string[] = [];
    const replacedDeltas: number[] = [];
    const added = () => { calls.push("added"); };
    const replaced = ({ delta }: RendererFrame) => { calls.push("replaced"); replacedDeltas.push(delta); };
    renderer.onFrame(() => {
        calls.push("first");
        if (calls.length === 1) {
            unsubscribe();
            renderer.onFrame(replaced);
            renderer.onFrame(added);
        }
    });
    const unsubscribe = renderer.onFrame(replaced);
    renderer.tick(0);
    t.deepEqual(calls, ["first"]);
    unsubscribe();
    renderer.tick(10);
    t.deepEqual(calls, ["first", "first", "replaced", "added"]);
    t.deepEqual(replacedDeltas, [0]);

    for (const method of ["stop", "dispose"] as const) {
        const stopped = new FrameRenderer(0, false);
        stopped.onFrame(() => stopped[method]());
        stopped.onFrame(() => t.fail("updates after stop must not run"));
        stopped.tick(0);
        t.is(stopped.frames, 0);
        // Three queues another frame after invoking its callback; deferred cancellation must remove it.
        stopped.loop = () => t.fail("the stopped animation loop must not restart");
        await Promise.resolve();
        t.is(stopped.loop, undefined);
        if (method === "dispose") {
            stopped.onFrame(() => t.fail("disposed renderers must not accept updates"));
            stopped.start();
            stopped.tick(100);
            t.is(stopped["_frameCallbacks"].size, 0);
        }
    }
});
