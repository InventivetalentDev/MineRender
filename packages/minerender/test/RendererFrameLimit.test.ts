import test from "ava";
import type { Camera, WebGLRenderer } from "three";
import type { EffectComposer } from "postprocessing";
import { Renderer } from "../src/renderer/Renderer";
import type { MineRenderScene } from "../src/renderer/MineRenderScene";
import { shutdown } from "../src/shutdown";

class FrameRenderer extends Renderer {
    frames = 0;

    constructor(fpsLimit: number, renderAlways = true) {
        super({ render: { fpsLimit, renderAlways }, composer: { enabled: false } });
    }

    protected createScene(): MineRenderScene { return { dirty: false } as MineRenderScene; }
    protected createCamera(): Camera { return {} as Camera; }
    protected createComposer(): EffectComposer { return {} as EffectComposer; }
    protected createRenderer(): WebGLRenderer {
        return { render: () => this.frames++, setAnimationLoop: () => {} } as unknown as WebGLRenderer;
    }
    public init(): void {}

    tick(time: number): void { this["animate"](time); }
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
