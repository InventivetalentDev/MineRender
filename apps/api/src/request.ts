import { parseSceneDocument } from "minerender/browser";
import type { SceneDocument } from "minerender/browser";
import { ApiError } from "./problem.js";

export interface RenderRequest {
    scene: SceneDocument & { minecraftVersion: string };
    output: {
        width: number;
        height: number;
        format: "png";
        trim: boolean;
        background: number | null;
    };
}

function object(value: unknown, path: string, allowed?: string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
        throw new ApiError(422, `${path}: expected a JSON object`);
    }
    for (const key of Object.keys(value)) {
        if (["__proto__", "constructor", "prototype"].includes(key) || (allowed && !allowed.includes(key))) {
            throw new ApiError(422, `${path}.${key}: unsupported property`);
        }
    }
    return value as Record<string, unknown>;
}

function dimension(value: unknown, path: string): number {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2048) {
        throw new ApiError(422, `${path}: expected an integer from 1 to 2048`);
    }
    return value;
}

function bounded(values: readonly number[] | undefined, maximum: number, path: string): void {
    if (values?.some(value => Math.abs(value) > maximum)) {
        throw new ApiError(422, `${path}: absolute values must not exceed ${maximum}`);
    }
}

function playerTexture(value: string | undefined, path: string): void {
    if (value === undefined || /^[a-zA-Z0-9_]{1,16}$/.test(value)
        || /^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$/.test(value)
        || /^https:\/\/textures\.minecraft\.net\/texture\/[a-fA-F0-9]{1,64}$/.test(value)) return;
    throw new ApiError(422, `${path}: expected a Minecraft username, UUID, or HTTPS textures.minecraft.net texture URL`);
}

export function parseRenderRequest(value: unknown): RenderRequest {
    const input = object(value, "request", ["scene", "output"]);
    object(input.scene, "scene");
    let scene: SceneDocument;
    try {
        scene = parseSceneDocument(input.scene);
    } catch (error) {
        throw new ApiError(422, error instanceof Error ? error.message : "Invalid scene document");
    }
    if (scene.objects.length < 1 || scene.objects.length > 32) {
        throw new ApiError(422, "scene.objects: expected 1 to 32 objects");
    }
    if (scene.minecraftVersion === "." || scene.minecraftVersion === ".." || (scene.minecraftVersion?.length ?? 0) > 64) {
        throw new ApiError(422, "scene.minecraftVersion: expected a Minecraft version of at most 64 characters");
    }
    if (scene.camera) {
        bounded(scene.camera.position, 1_000_000, "scene.camera.position");
        bounded(scene.camera.target, 1_000_000, "scene.camera.target");
        if (scene.camera.position.every((value, index) => value === scene.camera!.target[index])) {
            throw new ApiError(422, "scene.camera: position and target must differ");
        }
    }
    let layerCount = 0;
    let textLength = 0;
    for (const [index, definition] of scene.objects.entries()) {
        const path = `scene.objects[${index}]`;
        bounded(definition.position, 1_000_000, `${path}.position`);
        bounded(definition.rotation, 1_000_000, `${path}.rotation`);
        bounded(definition.scale, 1024, `${path}.scale`);
        if (definition.type === "skin") {
            playerTexture(definition.skin, `${path}.skin`);
            playerTexture(definition.cape?.texture, `${path}.cape.texture`);
            for (const [part, rotation] of Object.entries(definition.pose ?? {})) {
                bounded(rotation, 1_000_000, `${path}.pose.${part}`);
            }
        }
        if (definition.type === "entity" && definition.animation) {
            bounded([definition.animation.time ?? 0, definition.animation.speed ?? 1], 1_000_000, `${path}.animation`);
        }
        if (definition.type !== "gui") continue;
        layerCount += definition.layers.length;
        for (const [index, layer] of definition.layers.entries()) {
            const layerPath = `${path}.layers[${index}]`;
            bounded(layer.position, 1_000_000, `${layerPath}.position`);
            bounded(layer.size, 4096, `${layerPath}.size`);
            if ("crop" in layer) bounded(layer.crop, 16384, `${layerPath}.crop`);
            if ("text" in layer) {
                textLength += typeof layer.text === "string" ? layer.text.length
                    : layer.text.reduce((length, run) => length + run.text.length, 0);
                bounded([layer.lineHeight ?? 0, layer.maxWidth ?? 0], 4096, layerPath);
            }
        }
    }
    if (layerCount > 128) throw new ApiError(422, "scene: at most 128 GUI layers are supported");
    if (textLength > 8192) throw new ApiError(422, "scene: GUI text must not exceed 8192 characters in total");

    const output = input.output === undefined ? {} : object(input.output, "output", ["width", "height", "format", "trim", "background"]);
    const width = dimension(output.width === undefined ? 512 : output.width, "output.width");
    const height = dimension(output.height === undefined ? 512 : output.height, "output.height");
    if (width * height > 4_194_304) throw new ApiError(422, "output: at most 4194304 pixels are supported");
    if (output.format !== undefined && output.format !== "png") throw new ApiError(422, "output.format: only png is supported");
    if (output.trim !== undefined && typeof output.trim !== "boolean") throw new ApiError(422, "output.trim: expected a boolean");
    const background = output.background === undefined ? null : output.background;
    if (background !== null && (typeof background !== "number" || !Number.isInteger(background) || background < 0 || background > 0xffffff)) {
        throw new ApiError(422, "output.background: expected null or an RGB integer from 0 to 16777215");
    }
    return {
        scene: { ...scene, minecraftVersion: scene.minecraftVersion ?? "1.21.11" },
        output: { width, height, format: "png", trim: (output.trim as boolean | undefined) ?? false, background }
    };
}
