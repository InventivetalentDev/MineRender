import { decodeSceneDocument, parseSceneDocument, SCENE_DOCUMENT_MAX_BYTES } from "minerender/browser";
import type { SceneDocument } from "minerender";
import type { EmbedRequest } from "./params";

async function fetchScene(url: string, signal: AbortSignal): Promise<string> {
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
    let size = 0;
    const bounded = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            size += chunk.byteLength;
            if (size > SCENE_DOCUMENT_MAX_BYTES) throw new Error("Scene JSON exceeds 1 MiB");
            controller.enqueue(chunk);
        }
    }), { signal });
    return new TextDecoder("utf-8", { fatal: true }).decode(await new Response(bounded).arrayBuffer());
}

/** Resolves one scene source and applies URL overrides before any rendering assets are loaded. */
export async function loadEmbedScene(request: EmbedRequest, signal: AbortSignal): Promise<SceneDocument> {
    signal.throwIfAborted();
    const { source } = request;
    let scene: SceneDocument;
    if (source.kind === "inline") scene = await decodeSceneDocument(source.value);
    else {
        const json = source.kind === "remote" ? await fetchScene(source.url, signal) : JSON.stringify(source.scene);
        if (source.kind === "scene" && new Blob([json]).size > SCENE_DOCUMENT_MAX_BYTES) throw new Error("Scene JSON exceeds 1 MiB");
        scene = parseSceneDocument(json);
    }
    signal.throwIfAborted();
    if (request.minecraftVersion) scene.minecraftVersion = request.minecraftVersion;
    if (request.view.camera?.position || request.view.camera?.target) {
        const position = request.view.camera.position ?? scene.camera?.position;
        const target = request.view.camera.target ?? scene.camera?.target;
        if (position && target) scene.camera = { position, target };
    }
    return scene;
}
