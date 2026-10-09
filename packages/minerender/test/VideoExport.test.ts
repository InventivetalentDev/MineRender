import test, { ExecutionContext } from "ava";
import type { Camera, WebGLRenderer } from "three";
import type { EffectComposer } from "postprocessing";
import { VideoExporter } from "../src/export/VideoExporter";
import { Renderer } from "../src/renderer/Renderer";
import type { MineRenderScene } from "../src/renderer/MineRenderScene";
import { shutdown } from "../src/shutdown";

class TrackedEvents extends EventTarget {
    readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    addEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(callback);
        this.listeners.set(type, listeners);
        super.addEventListener(type, callback, options);
    }
    removeEventListener(type: string, callback: EventListenerOrEventListenerObject, options?: EventListenerOptions | boolean): void {
        this.listeners.get(type)?.delete(callback);
        super.removeEventListener(type, callback, options);
    }
    get listenerCount(): number { return [...this.listeners.values()].reduce((sum, listeners) => sum + listeners.size, 0); }
}

function fixture(t: ExecutionContext) {
    const globals = { document: globalThis.document, MediaRecorder: globalThis.MediaRecorder, setTimeout, clearTimeout };
    t.teardown(() => { Object.assign(globalThis, globals); });
    const events: string[] = [];
    const copies: unknown[][] = [];
    const timers = new Map<object, { callback: () => void; delay: number }>();
    const state = {
        supported: new Set(["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]),
        constructorError: undefined as Error | undefined,
        startError: undefined as Error | undefined,
        captureError: undefined as Error | undefined,
        drawError: undefined as Error | undefined,
        finishOnStop: true
    };
    class Track extends TrackedEvents {
        stops = 0;
        stop(): void { this.stops++; }
    }
    const tracks: Track[] = [];
    const recorders: Recorder[] = [];
    class Recorder extends TrackedEvents {
        static isTypeSupported(type: string): boolean { return state.supported.has(type); }
        state = "inactive";
        readonly mimeType: string;
        stops = 0;
        constructor(readonly stream: MediaStream, readonly options: MediaRecorderOptions) {
            super();
            if (state.constructorError) throw state.constructorError;
            this.mimeType = options.mimeType!;
            recorders.push(this);
        }
        start(): void {
            if (state.startError) throw state.startError;
            this.state = "recording";
        }
        begin(): void { this.dispatchEvent(new Event("start")); }
        data(contents: string, type = this.mimeType): void {
            this.dispatchEvent(Object.assign(new Event("dataavailable"), { data: new Blob([contents], { type }) }));
        }
        stop(): void {
            this.stops++;
            this.state = "inactive";
            if (state.finishOnStop) queueMicrotask(() => {
                this.data("video");
                this.dispatchEvent(new Event("stop"));
            });
        }
    }
    const targets: Array<{ width: number; height: number; fps?: number; contextOptions?: unknown }> = [];
    globalThis.document = {
        createElement() {
            const canvas = {
                width: 0, height: 0, fps: undefined as number | undefined, contextOptions: undefined as unknown,
                getContext(_type: string, options: unknown) {
                    canvas.contextOptions = options;
                    return {
                        fillStyle: "",
                        fillRect() { events.push("fill"); },
                        drawImage(...args: unknown[]) {
                            if (state.captureError) throw state.captureError;
                            events.push("copy"); copies.push(args);
                        }
                    };
                },
                captureStream(fps: number) {
                    canvas.fps = fps;
                    const track = new Track();
                    tracks.push(track);
                    return { getTracks: () => [track] };
                }
            };
            targets.push(canvas);
            return canvas;
        }
    } as unknown as Document;
    globalThis.MediaRecorder = Recorder as unknown as typeof MediaRecorder;
    globalThis.setTimeout = ((callback: () => void, delay: number) => {
        const timer = {};
        timers.set(timer, { callback, delay });
        return timer;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = (timer => { timers.delete(timer as object); }) as typeof clearTimeout;
    const source = { width: 320, height: 240, remove() {} } as HTMLCanvasElement;
    const fireTimer = () => {
        const [timer, { callback }] = [...timers][0];
        timers.delete(timer);
        callback();
    };
    class TestRenderer extends Renderer {
        loop?: (time: number) => void;
        constructor(composer = false) { super({ render: { fpsLimit: 30 }, composer: { enabled: composer } }); }
        protected createScene(): MineRenderScene { return { dirty: false, clear() {} } as MineRenderScene; }
        protected createCamera(): Camera { return {} as Camera; }
        protected createRenderer(): WebGLRenderer {
            return {
                domElement: source,
                render: () => {
                    if (state.drawError) throw state.drawError;
                    events.push("draw");
                },
                setAnimationLoop: (loop: ((time: number) => void) | null) => { this.loop = loop ?? undefined; },
                dispose() {}, forceContextLoss() {}
            } as unknown as WebGLRenderer;
        }
        protected createComposer(): EffectComposer {
            return { render: () => events.push("composer"), dispose() {} } as unknown as EffectComposer;
        }
        public init(): void {}
        tick(time: number): void { this.loop?.(time); }
    }
    const clean = () => {
        t.is(timers.size, 0);
        for (const track of tracks) { t.is(track.stops, 1); t.is(track.listenerCount, 0); }
        for (const recorder of recorders) t.is(recorder.listenerCount, 0);
    };
    return { source, state, events, copies, targets, timers, tracks, recorders, fireTimer, clean, TestRenderer };
}

test.after.always(() => shutdown());

test.serial("video export composites fixed-size frames and waits for final data before resolving", async t => {
    const f = fixture(t);
    f.state.finishOnStop = false;
    const exporter = new VideoExporter(f.source, { duration: 2, fps: 24, videoBitsPerSecond: 1000000 });
    const recorder = f.recorders[0];
    t.is(f.timers.size, 0);
    t.deepEqual(recorder.options, { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 1000000 });
    t.is(f.targets[0].fps, 24);
    t.deepEqual(f.targets[0].contextOptions, { alpha: false });
    exporter.capture();
    f.source.width = 640;
    exporter.capture();
    t.deepEqual(f.events, ["fill", "copy", "fill", "copy"]);
    t.deepEqual(f.copies[1], [f.source, 0, 0, 320, 240]);
    recorder.begin();
    t.is([...f.timers.values()][0].delay, 2000);
    recorder.data("");
    recorder.data("first", "video/webm;codecs=vp09.00.10.08");
    let resolved = false;
    void exporter.result.then(() => { resolved = true; });
    f.fireTimer();
    await Promise.resolve();
    t.false(resolved);
    recorder.data("last");
    recorder.dispatchEvent(new Event("stop"));
    const blob = await exporter.result;
    t.is(await blob.text(), "firstlast");
    t.is(blob.type, "video/webm;codecs=vp09.00.10.08");
    exporter.capture();
    exporter.cancel();
    t.is(f.copies.length, 2);
    f.clean();
});

test.serial("video validation rejects invalid options before creating a capture stream", t => {
    const f = fixture(t);
    for (const options of [
        { duration: 0 }, { duration: -1 }, { duration: NaN }, { duration: Infinity }, { duration: 2147484 },
        { duration: 1, fps: 0 }, { duration: 1, fps: Infinity }, { duration: 1, fps: NaN },
        { duration: 1, videoBitsPerSecond: 0 }, { duration: 1, videoBitsPerSecond: 1.5 }, { duration: 1, videoBitsPerSecond: 0x100000000 },
        { duration: 1, mimeType: "" }, { duration: 1, mimeType: "audio/webm" }, { duration: 1, mimeType: "video/unsupported" }
    ]) t.throws(() => new VideoExporter(f.source, options));
    f.source.width = 0;
    t.throws(() => new VideoExporter(f.source, { duration: 1 }), { message: /empty canvas/ });
    f.source.width = 320;
    const controller = new AbortController(), reason = new Error("already cancelled");
    controller.abort(reason);
    t.throws(() => new VideoExporter(f.source, { duration: 1, signal: controller.signal }), { is: reason });
    globalThis.MediaRecorder = undefined as unknown as typeof MediaRecorder;
    t.throws(() => new VideoExporter(f.source, { duration: 1 }), { message: /MediaRecorder support/ });
    t.is(f.tracks.length, 0);
});

test.serial("video format selection prefers WebM and falls back to supported MP4", async t => {
    const f = fixture(t);
    for (const type of ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"]) {
        const exporter = new VideoExporter(f.source, { duration: 1 });
        t.is(f.recorders.at(-1)!.mimeType, type);
        const failure = t.throwsAsync(exporter.result, { name: "AbortError" });
        exporter.cancel();
        await failure;
        f.state.supported.delete(type);
    }
    t.throws(() => new VideoExporter(f.source, { duration: 1 }), { message: /requested video format/ });
    f.clean();
});

test.serial("video setup, capture, stream, and recorder failures release all owned resources", async t => {
    const f = fixture(t);
    for (const key of ["constructorError", "startError", "captureError"] as const) {
        const reason = new Error(key);
        f.state[key] = reason;
        const exporter = new VideoExporter(f.source, { duration: 1 });
        const failure = t.throwsAsync(exporter.result, { is: reason });
        t.notThrows(() => exporter.capture());
        await failure;
        f.state[key] = undefined;
    }
    for (const event of ["error", "ended", "mute", "stop", "empty"] as const) {
        f.state.finishOnStop = false;
        const exporter = new VideoExporter(f.source, { duration: 1 });
        const failure = t.throwsAsync(exporter.result);
        const recorder = f.recorders.at(-1)!;
        recorder.begin();
        if (event === "ended" || event === "mute") f.tracks.at(-1)!.dispatchEvent(new Event(event));
        else if (event === "empty") { f.fireTimer(); recorder.dispatchEvent(new Event("stop")); }
        else recorder.dispatchEvent(new Event(event));
        await failure;
    }
    f.clean();
});

test.serial("renderer video capture follows direct and composer draws and restores the prior loop state", async t => {
    const f = fixture(t);
    for (const composer of [false, true]) for (const running of [false, true]) {
        const renderer = new f.TestRenderer(composer);
        if (running) renderer.start();
        let updates = 0;
        const unsubscribe = renderer.onFrame(() => { updates++; });
        f.events.length = 0;
        const result = renderer.toVideo({ duration: 1 });
        const draw = composer ? "composer" : "draw";
        t.deepEqual(f.events, [draw, "fill", "copy"]);
        t.is(updates, 0);
        renderer.tick(0);
        t.is(updates, 1);
        unsubscribe();
        renderer.tick(40);
        t.deepEqual(f.events, [draw, "fill", "copy", draw, "fill", "copy", draw, "fill", "copy"]);
        await t.throwsAsync(renderer.toVideo({ duration: 1 }), { message: /already running/ });
        f.recorders.at(-1)!.begin();
        f.fireTimer();
        t.true((await result).size > 0);
        t.is(!!renderer.loop, running);
        renderer.dispose();
    }
    f.clean();
});

test.serial("renderer stop, disposal, and abort cancel recording without stopping a later restart", async t => {
    const f = fixture(t);
    for (const action of ["stop", "dispose", "abort"] as const) {
        const renderer = new f.TestRenderer();
        const controller = new AbortController();
        const result = renderer.toVideo({ duration: 1, signal: controller.signal });
        const failure = t.throwsAsync(result, { name: "AbortError" });
        f.recorders.at(-1)!.begin();
        if (action === "abort") controller.abort();
        else renderer[action]();
        if (action === "stop") renderer.start();
        await failure;
        t.is(!!renderer.loop, action === "stop");
        renderer.dispose();
        await t.throwsAsync(renderer.toVideo({ duration: 1 }), { message: /disposed renderer/ });
    }
    f.clean();
});

test.serial("renderer draw failures reject video exports and keep an existing loop owned by its caller", async t => {
    const f = fixture(t);
    const renderer = new f.TestRenderer();
    renderer.start();
    const result = renderer.toVideo({ duration: 1 });
    const reason = new Error("draw failed");
    const failure = t.throwsAsync(result, { is: reason });
    f.state.drawError = reason;
    t.throws(() => renderer.tick(0), { is: reason });
    await failure;
    t.truthy(renderer.loop);
    renderer.dispose();
    f.clean();
});
