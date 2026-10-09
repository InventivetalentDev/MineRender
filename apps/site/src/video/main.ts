/**
 * Video stage runtime. Driven by scripts/render-video.mjs through `window.__video`, which loads one
 * shot at a time and advances it frame by frame on the injected virtual clock. Opened directly in a
 * browser (no clock shim), it plays the timeline in real time as a preview.
 */
import { Renderer, type RendererOptions } from "minerender";
import type { PerspectiveCamera } from "three";
import type { DeepPartial } from "../examples/types";
import { Overlay } from "./overlay";
import { timelines } from "./timeline";
import type { Shot, ShotContext } from "./types";

interface VirtualClock {
    freeze(): void;
    resume(): void;
    step(ms: number): number;
    now(): number;
    readonly mode: "realtime" | "stepped";
}

interface ShotInfo {
    id: string;
    seconds: number;
    frames: number;
}

interface VideoApi {
    ready: true;
    timeline: string;
    list(fps: number): ShotInfo[];
    load(id: string, fps: number): Promise<ShotInfo>;
    step(): number;
    unload(): void;
}

declare global {
    interface Window {
        __clock?: VirtualClock;
        __video?: VideoApi;
    }
}

const DEFAULTS: DeepPartial<RendererOptions> = {
    camera: {
        near: 1,
        far: 10000,
        position: [40, 30, 50],
        lookingAt: [0, 0, 0]
    },
    render: {
        // The driver steps frames itself; never skip one and always draw.
        fpsLimit: 0,
        pixelRatio: 1, // replaced per load from the dpr parameter
        antialias: true,
        stats: false,
        autoResize: false,
        renderAlways: true
    },
    composer: { enabled: false },
    controls: { enabled: false },
    debug: { grid: false, axes: false }
};

type AnyRecord = Record<string, unknown>;
const isPlainObject = (value: unknown): value is AnyRecord =>
    typeof value === "object" && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function merge<T extends AnyRecord>(base: T, patch: AnyRecord | undefined): T {
    const result: AnyRecord = { ...base };
    for (const [key, value] of Object.entries(patch ?? {})) {
        if (value === undefined) continue;
        const current = result[key];
        result[key] = isPlainObject(value) && isPlainObject(current) ? merge(current, value) : value;
    }
    return result as T;
}

const params = new URLSearchParams(location.search);
const width = Number(params.get("w") ?? 1920);
const height = Number(params.get("h") ?? 1080);
/** Device pixels per CSS pixel; the driver uses 2 for headed renders so the window fits the screen. */
const pixelRatio = Number(params.get("dpr") ?? 1);
const timelineName = params.get("timeline") ?? "hero";
const shots = timelines[timelineName];
if (!shots) throw new Error(`Unknown timeline "${timelineName}"`);

const stage = document.getElementById("stage")!;
const surface = stage.querySelector<HTMLElement>(".stage-surface")!;
stage.style.width = `${width}px`;
stage.style.height = `${height}px`;
stage.style.setProperty("--stage-height", `${height}px`);
stage.classList.toggle("is-portrait", height > width);
const overlay = new Overlay(stage);
overlay.clear();

let current: { shot: Shot; renderer: Renderer; context: ShotContext; abort: AbortController; fps: number; frame: number } | undefined;

function unload(): void {
    if (!current) return;
    current.abort.abort();
    current.renderer.stop();
    current.renderer.dispose();
    surface.replaceChildren();
    overlay.clear();
    current = undefined;
}

async function load(id: string, fps: number): Promise<ShotInfo> {
    unload();
    const shot = shots.find(entry => entry.id === id);
    if (!shot) throw new Error(`Unknown shot "${id}"`);
    window.__clock?.resume();

    const options = merge(merge({}, DEFAULTS as AnyRecord), shot.renderer as AnyRecord) as AnyRecord;
    (options.render as AnyRecord).pixelRatio = pixelRatio;
    const renderer = new Renderer(options as Partial<RendererOptions>);
    renderer.appendTo(surface);
    const abort = new AbortController();
    const context: ShotContext = {
        renderer,
        camera: renderer.camera as PerspectiveCamera,
        signal: abort.signal,
        overlay,
        width,
        height,
        portrait: height > width
    };
    current = { shot, renderer, context, abort, fps, frame: 0 };
    await shot.prepare(context);
    await document.fonts.ready;
    if (current?.shot !== shot) throw new Error(`Shot "${id}" was unloaded while loading`);
    shot.update(context, 0);
    renderer.start();
    return { id, seconds: shot.seconds, frames: Math.round(shot.seconds * fps) };
}

/** Advances one frame: runs the shot update, then lets the clock fire the animation frame that draws it. */
function step(): number {
    if (!current) throw new Error("No shot loaded");
    const t = current.frame / current.fps;
    current.shot.update(current.context, t);
    current.frame++;
    window.__clock?.step(1000 / current.fps);
    return t;
}

const api: VideoApi = {
    ready: true,
    timeline: timelineName,
    list: fps => shots.map(shot => ({ id: shot.id, seconds: shot.seconds, frames: Math.round(shot.seconds * fps) })),
    load,
    step,
    unload
};
window.__video = api;

// Preview mode: no clock shim, so play the timeline on the browser's own frame timing.
if (!window.__clock) {
    const fps = 60;
    const play = async (index: number): Promise<void> => {
        const shot = shots[index % shots.length];
        const info = await load(shot.id, fps);
        await new Promise<void>(resolve => {
            const tick = () => {
                if (!current || current.frame >= info.frames) return resolve();
                step();
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
        await play(index + 1);
    };
    play(0).catch(console.error);
}
