import { AssetLoader, Renderer, SceneDocumentLoader, isEntityObject } from "minerender";
import type { LoadedSceneDocument, SceneDocument, TripleArray } from "minerender";
import { Box3, Color, Mesh, PerspectiveCamera, Vector3 } from "three";
import { loadEmbedScene } from "./load";
import { parseEmbedUrl } from "./params";
import type { EmbedRequest } from "./params";

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const status = document.querySelector<HTMLElement>("#status")!;
const message = status.querySelector("p")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;
const up = new Vector3(0, 1, 0);
const target = new Vector3();
const defaultVersion = AssetLoader.version;
const playback = new Map<string, number>();
let renderer: Renderer | undefined;
let loaded: LoadedSceneDocument | undefined;
let definition: SceneDocument | undefined;
let request: EmbedRequest | undefined;
let savedCamera: { position: TripleArray; target: TripleArray } | undefined;
let abort: AbortController | undefined;
let loading: Promise<void> | undefined;
let revision = 0;
let visible = false;
let disposed = false;
let framed = false;
let stopFrames: (() => void) | undefined;
let fitOnResize = true;

function showState(state: string, text = "", retryable = false): void {
    viewport.dataset.state = state;
    status.hidden = state === "ready";
    message.textContent = text;
    retry.hidden = !retryable;
}

function report(error: unknown): void {
    showState("error", error instanceof Error ? error.message : String(error), true);
}

function size(): { width: number; height: number } | undefined {
    const width = Math.floor(viewport.clientWidth), height = Math.floor(viewport.clientHeight);
    return width > 0 && height > 0 ? { width, height } : undefined;
}

function active(): boolean {
    return visible && !document.hidden && !!size();
}

function resize(): void {
    const dimensions = size();
    if (!renderer || !request || !dimensions || renderer.renderer.getContext().isContextLost()) return;
    const { width, height } = dimensions;
    // Bound GPU allocation independently of the host page's CSS dimensions.
    const pixelRatio = Math.min(request.view.pixelRatio, 4096 / Math.max(width, height), Math.sqrt(4194304 / (width * height)));
    renderer.renderer.setDrawingBufferSize(width, height, pixelRatio);
    renderer.resize(width, height);
    if (framed && fitOnResize) frameScene();
}

function frameScene(): void {
    if (!renderer || !loaded || !request) return;
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
    const explicitPosition = request.view.camera?.position ?? definition?.camera?.position;
    const position = savedCamera?.position ?? explicitPosition;
    const selectedTarget = savedCamera?.target ?? request.view.camera?.target ?? definition?.camera?.target;
    const direction = camera.position.clone().sub(renderer.orbitControls?.target ?? target);
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
    renderer.orbitControls?.target.copy(target);
    renderer.orbitControls?.update();
    renderer.dirty = true;
    fitOnResize = !explicitPosition;
    savedCamera = undefined;
}

function contextLost(event?: Event): void {
    event?.preventDefault();
    renderer?.stop();
    showState("context-lost", "3D rendering was interrupted. Retry to resume.", true);
}

function contextRestored(): void {
    showState("loading", "Resuming render…");
    syncRunning();
}

async function initialize(): Promise<void> {
    const current = revision;
    const controller = new AbortController();
    abort = controller;
    const source = request!;
    try {
        const scene = definition ?? await loadEmbedScene(source, controller.signal);
        if (current !== revision || disposed) return;
        definition = scene;
        if (!active()) return;
        const version = scene.minecraftVersion ?? defaultVersion;
        if (AssetLoader.version !== version) AssetLoader.setVersion(version);
        const view = new Renderer({
            render: { pixelRatio: 1, antialias: true, autoResize: false, stats: false, fpsLimit: 60 },
            composer: { enabled: false },
            controls: { enabled: source.view.controls.enabled, mode: "orbit" },
            camera: { position: scene.objects.every(object => object.type === "gui") ? [0, 0, 50] : [40, 30, 50], near: 0.1, far: 10000 },
            debug: { grid: false, axes: false }
        });
        renderer = view;
        view.stop();
        const canvas = view.renderer.domElement;
        canvas.addEventListener("webglcontextlost", contextLost);
        canvas.addEventListener("webglcontextrestored", contextRestored);
        resize();
        view.appendTo(viewport);
        canvas.setAttribute("aria-label", "Interactive Minecraft scene");
        canvas.setAttribute("role", "img");
        const background = source.view.background;
        if (background !== null) view.renderer.setClearColor(new Color(background), 1);
        viewport.classList.toggle("shadow", source.view.shadow);
        if (view.orbitControls) {
            view.orbitControls.enableZoom = source.view.controls.zoom;
            view.orbitControls.enableRotate = source.view.controls.rotate;
            view.orbitControls.enablePan = source.view.controls.pan;
            view.orbitControls.update();
        }
        const content = await SceneDocumentLoader.load(view.scene, scene);
        if (current !== revision || disposed) { content.dispose(); return; }
        loaded = content;
        for (const entry of content.objects) {
            const time = playback.get(entry.definition.id);
            if (time !== undefined && isEntityObject(entry.object)) entry.object.setAnimationTime(time);
        }
        const animated = scene.objects.some(object => object.type === "entity" && object.animation && !object.animation.paused);
        if (animated || source.view.autorotate !== 0) {
            const offset = new Vector3();
            stopFrames = view.onFrame(({ delta }) => {
                if (animated) content.advanceAnimations(delta);
                if (source.view.autorotate) {
                    const pivot = view.orbitControls?.target ?? target;
                    offset.copy(view.camera.position).sub(pivot).applyAxisAngle(up, source.view.autorotate * Math.PI / 180 * delta);
                    view.camera.position.copy(pivot).add(offset);
                    view.camera.lookAt(pivot);
                }
            });
        }
    } catch (error) {
        if (current !== revision || disposed) return;
        releaseRenderer();
        report(error);
    } finally {
        if (abort === controller) abort = undefined;
    }
}

function syncRunning(): void {
    if (disposed || !request) return;
    try {
        if (!active()) {
            if (renderer || abort) {
                suspend();
                showState("loading", "Loading render…");
            }
            return;
        }
        if (viewport.dataset.state === "error") return;
        if (renderer?.renderer.getContext().isContextLost()) { contextLost(); return; }
        if (loaded && renderer) {
            if (!framed) { resize(); frameScene(); framed = true; }
            if (viewport.dataset.state !== "ready") {
                renderer.renderOnce();
                if (renderer.renderer.getContext().isContextLost()) { contextLost(); return; }
                showState("ready");
            }
            renderer.start();
        } else if (!loading) {
            // Finish older asset loads before changing the global asset version.
            loading = initialize().finally(() => { loading = undefined; syncRunning(); });
        }
    } catch (error) {
        releaseRenderer();
        report(error);
    }
}

function releaseRenderer(): void {
    const canvas = renderer?.renderer.domElement;
    canvas?.removeEventListener("webglcontextlost", contextLost);
    canvas?.removeEventListener("webglcontextrestored", contextRestored);
    stopFrames?.();
    stopFrames = undefined;
    loaded?.dispose();
    loaded = undefined;
    renderer?.dispose();
    renderer = undefined;
    framed = false;
    target.set(0, 0, 0);
}

function suspend(): void {
    if (renderer && loaded && framed) {
        savedCamera = { position: renderer.camera.position.toArray(), target: (renderer.orbitControls?.target ?? target).toArray() };
        for (const entry of loaded.objects) {
            if (isEntityObject(entry.object)) playback.set(entry.definition.id, entry.object.animationTime);
        }
    }
    revision++;
    abort?.abort();
    abort = undefined;
    releaseRenderer();
}

function readLocation(): void {
    suspend();
    definition = undefined;
    savedCamera = undefined;
    playback.clear();
    request = undefined;
    showState("loading", "Loading render…");
    try { request = parseEmbedUrl(new URL(location.href)); syncRunning(); }
    catch (error) { report(error); }
}

const intersection = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
    syncRunning();
});
const observer = new ResizeObserver(() => {
    try { syncRunning(); resize(); }
    catch (error) { releaseRenderer(); report(error); }
});

retry.addEventListener("click", () => {
    if (!request) { readLocation(); return; }
    suspend();
    showState("loading", "Loading render…");
    syncRunning();
});
readLocation();
intersection.observe(viewport);
observer.observe(viewport);
window.addEventListener("hashchange", readLocation);
document.addEventListener("visibilitychange", syncRunning);
window.addEventListener("pageshow", syncRunning);
window.addEventListener("pagehide", event => {
    suspend();
    if (event.persisted) { showState("loading", "Loading render…"); return; }
    disposed = true;
    intersection.disconnect();
    observer.disconnect();
    window.removeEventListener("hashchange", readLocation);
    document.removeEventListener("visibilitychange", syncRunning);
});
