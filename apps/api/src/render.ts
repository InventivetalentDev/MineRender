import { AssetLoader, NodeRenderer, SceneDocumentLoader } from "minerender/node";
import type { LoadedSceneDocument } from "minerender/node";
import { Box3, Color, Mesh, PerspectiveCamera, Vector3 } from "three";
import type { RenderRequest } from "./request.js";
import { guardFetch } from "./assets.js";

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

export async function render(request: RenderRequest, assetOrigins: string[] = []): Promise<Buffer> {
    const restoreFetch = guardFetch(assetOrigins);
    let renderer: NodeRenderer | undefined;
    let loaded: LoadedSceneDocument | undefined;
    try {
        if (AssetLoader.version !== request.scene.minecraftVersion) AssetLoader.setVersion(request.scene.minecraftVersion);
        renderer = await NodeRenderer.create({ width: request.output.width, height: request.output.height });
        if (request.output.background !== null) renderer.scene.background = new Color(request.output.background);
        loaded = await SceneDocumentLoader.load(renderer.scene, request.scene);
        fitCamera(renderer, loaded, request);
        return await renderer.renderToBuffer({ trim: request.output.trim });
    } finally {
        try { loaded?.dispose(); }
        finally {
            try { renderer?.dispose(); }
            finally { restoreFetch(); }
        }
    }
}
