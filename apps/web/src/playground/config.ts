export interface CameraState {
    position: [number, number, number];
    target: [number, number, number];
    zoom: number;
}

export interface ViewSettings {
    projection: "perspective" | "orthographic";
    fov: number;
    near: number;
    far: number;
    pixelRatio: number;
    antialias: boolean;
    composer: boolean;
    fpsLimit: number;
    renderAlways: boolean;
    grid: boolean;
    axes: boolean;
    stats: boolean;
    background: string;
    camera?: CameraState;
}

export interface AssetSettings {
    version: string;
    root: string;
    zipName?: string;
}

export interface ExportSettings {
    format: "png" | "jpeg" | "video" | "obj" | "ply" | "gltf" | "glb";
    trim: boolean;
    quality: number;
    maxTextureSize: number;
    scope: "scene" | "object";
    duration: number;
    fps: number;
}

export interface PlaygroundConfig<S> {
    schema: 1;
    demo: string;
    content: S;
    view: ViewSettings;
    assets: AssetSettings;
    output: ExportSettings;
}

export function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function object(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function number(value: unknown, min: number, max: number): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** Reject malformed shared settings before they allocate a drawing buffer or request an asset. */
export function readConfig<S>(text: string, defaults: PlaygroundConfig<S>): PlaygroundConfig<S> {
    const data = JSON.parse(text, (key, value) => {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsupported configuration key.");
        return value;
    });
    if (!object(data) || data.schema !== 1 || data.demo !== defaults.demo || !object(data.content)) {
        throw new Error("Choose a version 1 configuration for this playground.");
    }
    const result = clone(defaults);
    result.content = { ...result.content, ...data.content };
    for (const key of ["view", "assets", "output"] as const) {
        if (data[key] !== undefined && !object(data[key])) throw new Error(`Invalid ${key} settings.`);
        Object.assign(result[key], data[key]);
    }
    const v = result.view;
    if (!["perspective", "orthographic"].includes(v.projection)
        || !number(v.fov, 1, 175) || !number(v.near, 0.01, 100000) || !number(v.far, v.near + 0.01, 1000000)
        || !number(v.pixelRatio, 0.25, 4) || !number(v.fpsLimit, 0, 240)
        || ![v.antialias, v.composer, v.renderAlways, v.grid, v.axes, v.stats].every(value => typeof value === "boolean")
        || !(v.background === "transparent" || /^#[0-9a-f]{6}$/i.test(v.background))) {
        throw new Error("Invalid renderer settings. Pixel ratio must be 0.25–4 and FPS must be 0–240.");
    }
    if (v.camera !== undefined && (!object(v.camera)
        || ![v.camera.position, v.camera.target].every(vec => Array.isArray(vec) && vec.length === 3 && vec.every(n => number(n, -1e8, 1e8)))
        || !number(v.camera.zoom, 0.001, 10000))) throw new Error("Invalid camera position, target, or zoom.");
    if (typeof result.assets.version !== "string" || !/^[\w.-]+$/.test(result.assets.version)
        || typeof result.assets.root !== "string" || (result.assets.zipName !== undefined && typeof result.assets.zipName !== "string")) {
        throw new Error("Invalid asset version or source.");
    }
    if (result.assets.root && !["https:", "http:"].includes(new URL(result.assets.root).protocol)) {
        throw new Error("Use an HTTP or HTTPS asset root.");
    }
    const o = result.output;
    if (!["png", "jpeg", "video", "obj", "ply", "gltf", "glb"].includes(o.format) || typeof o.trim !== "boolean"
        || !number(o.quality, 0, 1) || !number(o.maxTextureSize, 16, 8192) || !["scene", "object"].includes(o.scope)
        || !number(o.duration, 0.1, 120) || !number(o.fps, 1, 60) || !Number.isInteger(o.fps)) {
        throw new Error("Invalid export settings.");
    }
    return result;
}
