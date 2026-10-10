import { parseSceneDocument, SCENE_DOCUMENT_MAX_BYTES } from "minerender/browser";
import type { SceneDocument } from "minerender";

export function minecraftVersion(value: string): string {
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(value) || value === "." || value === "..") {
        throw new Error("version: expected a Minecraft version of at most 64 characters without slashes");
    }
    return value;
}

export function httpsUrl(value: string, name: string): string {
    let url: URL;
    try { url = new URL(value); }
    catch { throw new Error(`${name}: expected an HTTPS URL`); }
    if (url.protocol !== "https:" || url.username || url.password || !value.startsWith("https://")) {
        throw new Error(`${name}: expected an HTTPS URL without credentials`);
    }
    return url.href;
}

function bounded(values: readonly number[] | undefined, maximum: number, path: string): void {
    if (values?.some(value => Math.abs(value) > maximum)) throw new Error(`${path}: absolute values must not exceed ${maximum}`);
}

function playerTexture(value: string | undefined, path: string): void {
    if (value === undefined || /^[a-zA-Z0-9_]{1,16}$/.test(value)
        || /^(?:[a-fA-F0-9]{32}|[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12})$/.test(value)
        || /^data:image\/png;base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) && value.length > 22) return;
    httpsUrl(value, path);
}

export function validateEmbedScene(value: unknown): SceneDocument {
    const json = typeof value === "string" ? value : JSON.stringify(value);
    if (new TextEncoder().encode(json).byteLength > SCENE_DOCUMENT_MAX_BYTES) {
        throw new Error(`Scene document exceeds ${SCENE_DOCUMENT_MAX_BYTES} bytes`);
    }
    const scene = parseSceneDocument(value);
    if (scene.objects.length < 1 || scene.objects.length > 32) throw new Error("scene.objects: expected 1 to 32 objects");
    if (scene.minecraftVersion !== undefined) minecraftVersion(scene.minecraftVersion);
    if (scene.camera) {
        bounded(scene.camera.position, 1_000_000, "scene.camera.position");
        bounded(scene.camera.target, 1_000_000, "scene.camera.target");
        if (scene.camera.position.every((value, index) => value === scene.camera!.target[index])) {
            throw new Error("scene.camera: position and target must differ");
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
            for (const [part, rotation] of Object.entries(definition.pose ?? {})) bounded(rotation, 1_000_000, `${path}.pose.${part}`);
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
    if (layerCount > 128) throw new Error("scene: at most 128 GUI layers are supported");
    if (textLength > 8192) throw new Error("scene: GUI text must not exceed 8192 characters in total");
    return scene;
}
