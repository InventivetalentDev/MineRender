import { AssetLoader, Renderer, SceneDocumentLoader } from "minerender";
import type { LoadedSceneDocument, SceneDocument } from "minerender";
import { Box3, Color, Mesh, PerspectiveCamera, Vector3 } from "three";
import { loadEmbedScene } from "./load";
import { parseEmbedUrl } from "./params";
import type { EmbedRequest } from "./params";

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const status = document.querySelector<HTMLElement>("#status")!;
const message = status.querySelector("p")!;
const abort = new AbortController();
const up = new Vector3(0, 1, 0);
const target = new Vector3();
let renderer: Renderer | undefined;
let loaded: LoadedSceneDocument | undefined;
let definition: SceneDocument | undefined;
let request: EmbedRequest;
let visible = false;
let started = false;
let disposed = false;
let stopFrames: (() => void) | undefined;
let fitOnResize = true;

function report(error: unknown): void {
    viewport.dataset.state = "error";
    status.hidden = false;
    message.textContent = error instanceof Error ? error.message : String(error);
}

function size(): { width: number; height: number } | undefined {
    const width = Math.floor(viewport.clientWidth), height = Math.floor(viewport.clientHeight);
    return width > 0 && height > 0 ? { width, height } : undefined;
}

function resize(): void {
    const dimensions = size();
    if (!renderer || !dimensions) return;
    const { width, height } = dimensions;
    // Bound GPU allocation independently of the host page's CSS dimensions.
    const pixelRatio = Math.min(request.view.pixelRatio, 4096 / Math.max(width, height), Math.sqrt(4194304 / (width * height)));
    renderer.renderer.setDrawingBufferSize(width, height, pixelRatio);
    renderer.resize(width, height);
    if (loaded && fitOnResize) frameScene();
}

function frameScene(): void {
    if (!renderer || !loaded) return;
    loaded.root.updateWorldMatrix(true, true);
    const bounds = new Box3();
    loaded.root.traverseVisible(object => {
        if (!(object as Mesh).isMesh) return;
        const mesh = object as Mesh;
        mesh.geometry.computeBoundingBox();
        if (mesh.geometry.boundingBox) bounds.union(mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
    });
    const center = bounds.isEmpty() ? new Vector3() : bounds.getCenter(new Vector3());
    const radius = bounds.isEmpty() ? 16 : Math.max(1, bounds.getSize(new Vector3()).length() / 2);
    if (![...center.toArray(), radius].every(Number.isFinite)) throw new Error("Invalid scene bounds");
    const camera = renderer.camera as PerspectiveCamera;
    const position = request.view.camera?.position ?? definition?.camera?.position;
    const selectedTarget = request.view.camera?.target ?? definition?.camera?.target;
    const direction = camera.position.clone().sub(renderer.controls?.target ?? target);
    target.copy(selectedTarget ? new Vector3(...selectedTarget) : center);
    if (position) {
        camera.position.fromArray(position);
    } else {
        if (direction.lengthSq() < 0.01) direction.set(1, 0.75, 1);
        const vertical = camera.fov * Math.PI / 360;
        const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
        const distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
        camera.position.copy(center).addScaledVector(direction.normalize(), distance);
    }
    if (camera.position.distanceToSquared(target) < 0.000001) throw new Error("Camera position and target must differ");
    const distance = camera.position.distanceTo(center);
    camera.near = Math.max(0.01, Math.min(1, distance / 1000));
    camera.far = Math.max(10000, distance + radius * 4);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    renderer.controls?.target.copy(target);
    renderer.controls?.update();
    renderer.dirty = true;
    fitOnResize = !position;
}

async function initialize(): Promise<void> {
    started = true;
    try {
        definition ??= await loadEmbedScene(request, abort.signal);
        if (disposed) return;
        if (!visible || document.hidden || !size()) { started = false; return; }
        if (definition.minecraftVersion) AssetLoader.setVersion(definition.minecraftVersion);
        renderer = new Renderer({
            render: { pixelRatio: 1, antialias: true, autoResize: false, stats: false, fpsLimit: 60 },
            composer: { enabled: false },
            controls: { enabled: request.view.controls.enabled },
            camera: { position: definition.objects.every(object => object.type === "gui") ? [0, 0, 50] : [40, 30, 50], near: 0.1, far: 10000 },
            debug: { grid: false, axes: false }
        });
        renderer.stop();
        resize();
        renderer.appendTo(viewport);
        renderer.renderer.domElement.setAttribute("aria-label", "Interactive Minecraft scene");
        renderer.renderer.domElement.setAttribute("role", "img");
        const background = request.view.background;
        if (background !== null) renderer.renderer.setClearColor(new Color(background), 1);
        viewport.classList.toggle("shadow", request.view.shadow);
        if (renderer.controls) {
            renderer.controls.enableZoom = request.view.controls.zoom;
            renderer.controls.enableRotate = request.view.controls.rotate;
            renderer.controls.enablePan = request.view.controls.pan;
            renderer.controls.update();
        }
        const content = await SceneDocumentLoader.load(renderer.scene, definition);
        if (disposed) { content.dispose(); return; }
        loaded = content;
        const animated = definition.objects.some(object => object.type === "entity" && object.animation && !object.animation.paused);
        if (animated || request.view.autorotate !== 0) {
            const offset = new Vector3();
            stopFrames = renderer.onFrame(({ delta }) => {
                if (animated) loaded?.advanceAnimations(delta);
                if (request.view.autorotate && renderer) {
                    const pivot = renderer.controls?.target ?? target;
                    offset.copy(renderer.camera.position).sub(pivot).applyAxisAngle(up, request.view.autorotate * Math.PI / 180 * delta);
                    renderer.camera.position.copy(pivot).add(offset);
                    renderer.camera.lookAt(pivot);
                }
            });
        }
        syncRunning();
    } catch (error) {
        if (disposed) return;
        releaseRenderer();
        report(error);
    }
}

function syncRunning(): void {
    if (disposed || viewport.dataset.state === "error") return;
    try {
        if (visible && !document.hidden && size()) {
            if (!started) void initialize();
            if (loaded && renderer) {
                if (viewport.dataset.state !== "ready") {
                    resize();
                    frameScene();
                    renderer.renderOnce();
                    viewport.dataset.state = "ready";
                    status.hidden = true;
                }
                renderer.start();
            }
        } else {
            renderer?.stop();
        }
    } catch (error) {
        releaseRenderer();
        report(error);
    }
}

function releaseRenderer(): void {
    stopFrames?.();
    stopFrames = undefined;
    loaded?.dispose();
    loaded = undefined;
    renderer?.dispose();
    renderer?.renderer.domElement.remove();
    renderer = undefined;
}

const intersection = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
    syncRunning();
});
const observer = new ResizeObserver(() => {
    try { resize(); syncRunning(); }
    catch (error) { releaseRenderer(); report(error); }
});

try {
    request = parseEmbedUrl(new URL(location.href));
    intersection.observe(viewport);
    observer.observe(viewport);
} catch (error) {
    report(error);
}

document.addEventListener("visibilitychange", syncRunning);
window.addEventListener("pageshow", syncRunning);
window.addEventListener("pagehide", event => {
    renderer?.stop();
    if (event.persisted) return;
    disposed = true;
    abort.abort();
    intersection.disconnect();
    observer.disconnect();
    document.removeEventListener("visibilitychange", syncRunning);
    releaseRenderer();
});
