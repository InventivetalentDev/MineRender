import { decodeSceneDocument, SCENE_DOCUMENT_MAX_BYTES } from "minerender/browser";
import type { SceneDocument } from "minerender";
import { validateEmbedScene } from "./limits";
import type { EmbedRequest } from "./params";

async function fetchScene(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]), credentials: "omit" });
    try {
        if (!response.ok) throw new Error(`Scene request failed (HTTP ${response.status})`);
        if (new URL(response.url).protocol !== "https:") throw new Error("Scene URLs must use HTTPS");
        if (Number(response.headers.get("content-length")) > SCENE_DOCUMENT_MAX_BYTES) throw new Error("Scene JSON exceeds 1 MiB");
    } catch (error) {
        await response.body?.cancel().catch(() => {});
        throw error;
    }
    if (!response.body) throw new Error("Scene response has no body");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > SCENE_DOCUMENT_MAX_BYTES) throw new Error("Scene JSON exceeds 1 MiB");
            chunks.push(value);
        }
    } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

/** Resolves one scene source and applies URL overrides before any rendering assets are loaded. */
export async function loadEmbedScene(request: EmbedRequest, signal: AbortSignal): Promise<SceneDocument> {
    const { source } = request;
    let scene = validateEmbedScene(source.kind === "scene" ? source.scene
        : source.kind === "inline" ? await decodeSceneDocument(source.value) : await fetchScene(source.url, signal));
    signal.throwIfAborted();
    if (request.minecraftVersion) scene.minecraftVersion = request.minecraftVersion;
    if (request.view.camera?.position || request.view.camera?.target) {
        const position = request.view.camera.position ?? scene.camera?.position;
        const target = request.view.camera.target ?? scene.camera?.target;
        if (position && target) scene.camera = { position, target };
    }
    scene = validateEmbedScene(scene);
    return scene;
}
