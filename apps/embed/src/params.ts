import type { SceneDocument, TripleArray } from "minerender";
import { booleanParam, CONTENT_MODIFIERS, SHORTHAND_TYPES, shorthandScene } from "./shorthand";

export interface EmbedView {
    controls: { enabled: boolean; zoom: boolean; rotate: boolean; pan: boolean };
    autorotate: number;
    background: number | null;
    shadow: boolean;
    pixelRatio: number;
    camera?: { position?: TripleArray; target?: TripleArray };
}

export interface EmbedRequest {
    source: { kind: "scene"; scene: SceneDocument } | { kind: "inline"; value: string } | { kind: "remote"; url: string };
    view: EmbedView;
    minecraftVersion?: string;
}

const VIEW_PARAMS = ["controls", "controls.zoom", "controls.rotate", "controls.pan", "autorotate", "background",
    "shadow", "pixelRatio", "camera.position", "camera.target", "version"];

function uniqueParams(params: URLSearchParams): void {
    const seen = new Set<string>();
    for (const key of params.keys()) {
        if (seen.has(key)) throw new Error(`${key}: duplicate parameter`);
        seen.add(key);
    }
}

function numeric(value: string, name: string, minimum = -Infinity, maximum = Infinity): number {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)
        || !Number.isFinite(Number(value)) || Number(value) < minimum || Number(value) > maximum) {
        throw new Error(`${name}: expected ${Number.isFinite(minimum) ? `a number from ${minimum} to ${maximum}` : "a finite number"}`);
    }
    return Number(value);
}

function vector(value: string, name: string): TripleArray {
    const parts = value.split(",");
    if (parts.length !== 3) throw new Error(`${name}: expected x,y,z`);
    return parts.map(part => numeric(part, name)) as TripleArray;
}

function minecraftVersion(value: string): string {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(value) || value === "." || value === "..") {
        throw new Error("version: expected a Minecraft version of at most 64 characters without slashes");
    }
    return value;
}

function httpsUrl(value: string): string {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error("src: expected an HTTPS URL"); }
    if (url.protocol !== "https:" || url.username || url.password || !value.startsWith("https://")) {
        throw new Error("src: expected an HTTPS URL without credentials");
    }
    return url.href;
}

export function parseEmbedUrl(url: URL): EmbedRequest {
    uniqueParams(url.searchParams);
    const params = url.searchParams;
    const hash = new URLSearchParams(url.hash.slice(1));
    uniqueParams(hash);
    for (const key of hash.keys()) if (key !== "scene") throw new Error(`${key}: unsupported fragment parameter`);
    const allowed = [...SHORTHAND_TYPES, "src", ...CONTENT_MODIFIERS, ...VIEW_PARAMS];
    for (const key of params.keys()) if (!allowed.includes(key)) throw new Error(`${key}: unsupported parameter`);
    const selectors = [...SHORTHAND_TYPES, "src"].filter(key => params.has(key));
    if (selectors.length + Number(hash.has("scene")) !== 1) {
        throw new Error("Choose exactly one scene source: skin, block, item, entity, model, src, or #scene");
    }
    const shorthand = SHORTHAND_TYPES.find(key => params.has(key));
    if (!shorthand) {
        for (const key of CONTENT_MODIFIERS) if (params.has(key)) throw new Error(`${key} requires a shorthand scene`);
    }

    let source: EmbedRequest["source"];
    if (shorthand) source = { kind: "scene", scene: shorthandScene(shorthand, params) };
    else if (params.has("src")) source = { kind: "remote", url: httpsUrl(params.get("src")!) };
    else {
        const value = hash.get("scene")!;
        if (!value) throw new Error("scene: expected an encoded scene document");
        source = { kind: "inline", value };
    }

    const background = params.get("background") ?? "transparent";
    if (background !== "transparent" && !/^#?[0-9a-fA-F]{6}$/.test(background)) {
        throw new Error("background: expected transparent or a six-digit RGB hex color");
    }
    const view: EmbedView = {
        controls: {
            enabled: booleanParam(params, "controls", true), zoom: booleanParam(params, "controls.zoom", false),
            rotate: booleanParam(params, "controls.rotate", true), pan: booleanParam(params, "controls.pan", false)
        },
        autorotate: numeric(params.get("autorotate") ?? "0", "autorotate", -360, 360),
        background: background === "transparent" ? null : parseInt(background.replace(/^#/, ""), 16),
        shadow: booleanParam(params, "shadow", false),
        pixelRatio: numeric(params.get("pixelRatio") ?? "1", "pixelRatio", 0.25, 4)
    };
    if (params.has("camera.position") || params.has("camera.target")) {
        view.camera = {};
        if (params.has("camera.position")) view.camera.position = vector(params.get("camera.position")!, "camera.position");
        if (params.has("camera.target")) view.camera.target = vector(params.get("camera.target")!, "camera.target");
        if (view.camera.position && view.camera.target
            && view.camera.position.every((value, index) => value === view.camera!.target![index])) {
            throw new Error("camera: position and target must differ");
        }
    }
    return { source, view, ...(params.has("version") ? { minecraftVersion: minecraftVersion(params.get("version")!) } : {}) };
}
