import { AssetLoader, NodeRenderer, SceneDocumentLoader, shutdown } from "minerender/node";
import type { LoadedSceneDocument } from "minerender/node";
import { Box3, Color, Mesh, PerspectiveCamera, Vector3 } from "three";
import type { RenderRequest } from "./request.js";

function allowedUrl(url: URL): boolean {
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) return false;
    switch (url.hostname) {
        case "assets.mcasset.cloud": return true;
        case "raw.githubusercontent.com":
            return url.pathname.startsWith("/InventivetalentDev/minerender-fallback-assets/master/");
        case "mcproxy.dev":
            return /^\/(?:uuid|skin|cape)\/[a-zA-Z0-9_-]{1,36}$/.test(url.pathname);
        case "textures.minecraft.net":
            return /^\/texture\/[a-fA-F0-9]{1,64}$/.test(url.pathname);
        default: return false;
    }
}

function guardFetch(): () => void {
    const fetch = globalThis.fetch;
    let totalBytes = 0;
    globalThis.fetch = async (input, init) => {
        let request = new Request(input, init);
        if (request.method !== "GET" && request.method !== "HEAD") throw new Error("Unsupported asset request method");
        for (let redirects = 0; redirects <= 5; redirects++) {
            if (!allowedUrl(new URL(request.url))) throw new Error("Unsupported asset source");
            const response = await fetch(request, { redirect: "manual" });
            if (![301, 302, 303, 307, 308].includes(response.status)) {
                if (!response.ok || !response.body) return response;
                const reader = response.body.getReader();
                const chunks: Uint8Array[] = [];
                let size = 0;
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        size += value.length;
                        totalBytes += value.length;
                        if (size > 8 * 1024 * 1024 || totalBytes > 64 * 1024 * 1024) {
                            throw new Error("Asset download exceeds the size limit");
                        }
                        chunks.push(value);
                    }
                } catch (error) {
                    await reader.cancel().catch(() => {});
                    throw error;
                } finally {
                    reader.releaseLock();
                }
                const bounded = new Response(Buffer.concat(chunks, size), response);
                Object.defineProperty(bounded, "url", { value: response.url });
                return bounded;
            }
            const location = response.headers.get("location");
            await response.body?.cancel();
            if (!location || redirects === 5) throw new Error("Invalid asset redirect");
            request = new Request(new URL(location, request.url), request);
        }
        throw new Error("Too many asset redirects");
    };
    return () => { globalThis.fetch = fetch; };
}

function fitCamera(renderer: NodeRenderer, loaded: LoadedSceneDocument, request: RenderRequest): void {
    const bounds = new Box3();
    loaded.root.updateMatrixWorld(true);
    loaded.root.traverseVisible(object => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });
    const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
    const radius = bounds.isEmpty() ? 1 : Math.max(0.01, bounds.getSize(new Vector3()).length() / 2);
    if (![...center.toArray(), radius].every(Number.isFinite)) throw new Error("Invalid scene bounds");
    const camera = renderer.camera as PerspectiveCamera;
    if (request.scene.camera) {
        camera.position.fromArray(request.scene.camera.position);
        camera.lookAt(...request.scene.camera.target);
    } else {
        const vertical = camera.fov * Math.PI / 360;
        const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
        const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
        const direction = request.scene.objects.every(object => object.type === "gui")
            ? new Vector3(0, 0, 1) : new Vector3(1, 0.75, 1).normalize();
        camera.position.copy(center).addScaledVector(direction, distance);
        camera.lookAt(center);
    }
    const distance = camera.position.distanceTo(center);
    camera.near = Math.max(0.001, Math.min(0.1, radius / 1000));
    camera.far = Math.max(5000, distance + radius * 4);
    camera.updateProjectionMatrix();
    renderer.dirty = true;
}

export async function render(request: RenderRequest): Promise<Buffer> {
    const restoreFetch = guardFetch();
    let renderer: NodeRenderer | undefined;
    let loaded: LoadedSceneDocument | undefined;
    try {
        AssetLoader.setVersion(request.scene.minecraftVersion);
        renderer = await NodeRenderer.create({ width: request.output.width, height: request.output.height });
        if (request.output.background !== null) renderer.scene.background = new Color(request.output.background);
        loaded = await SceneDocumentLoader.load(renderer.scene, request.scene);
        fitCamera(renderer, loaded, request);
        return await renderer.renderToBuffer({ trim: request.output.trim });
    } finally {
        try { loaded?.dispose(); }
        finally {
            try { renderer?.dispose(); }
            finally { shutdown(); restoreFetch(); }
        }
    }
}
