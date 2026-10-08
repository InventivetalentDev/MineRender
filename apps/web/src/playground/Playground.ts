import {
    ArchiveAssetSource, AssetLoader, BrowserArchiveProxy, Caching, HostedAssetSource,
    Renderer, SceneExporter, SceneInspector, Ticker, isSceneObject, type DeepPartial, type RendererOptions
} from "minerender";
import { Box3, Color, InstancedMesh, Mesh, Object3D, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { button, checkbox, download, input, note, section, select } from "./controls";
import { clone, readConfig, type AssetSettings, type CameraState, type PlaygroundConfig, type ViewSettings } from "./config";

declare const MINERENDER_PLAYGROUND_HOME: string;

export interface DemoContext {
    renderer: Renderer;
    /** File paths inside the selected resource pack, if any. */
    assetFiles: readonly string[];
    isCurrent(): boolean;
    onCleanup(cleanup: () => void | Promise<void>): void;
}

export interface DemoContent {
    /** Primary object for the inspector and single-object exports. */
    object?: Object3D;
    bounds?: Box3;
    /** Custom camera framing; replaces the default bounds-based fit. */
    fit?: () => void;
    /** Runs after this preview becomes visible: sync page controls to the loaded state. */
    activate?: () => void;
    /** Runs when a later load failed and this preview was kept; defaults to `activate`. */
    restore?: () => void;
    dispose?: () => void | Promise<void>;
}

export interface PlaygroundOptions<S> {
    title: string;
    defaults: S;
    renderer?: DeepPartial<RendererOptions>;
    presets?: Record<string, { label: string; state: Partial<S> }>;
    load(context: DemoContext, state: S): Promise<DemoContent | void>;
    /** Content part of the "Copy code" snippet; `renderer` is already set up. */
    code?: (state: S) => string;
}

interface Preview {
    renderer: Renderer;
    mount: HTMLElement;
    content: DemoContent;
    inspector?: SceneInspector;
    cleanups: Array<() => void | Promise<void>>;
}

interface ResourcePack {
    file: File;
    source: ArchiveAssetSource;
    files: string[];
}

/**
 * Shared page shell: sidebar, renderer, asset sources, presets, exports, and shareable configuration.
 * Every change loads into a staged renderer; the previous preview and configuration stay until the load succeeds.
 */
export class Playground<S extends object> {
    readonly controls: HTMLElement;
    readonly status: HTMLElement;
    private readonly viewport: HTMLElement;
    private readonly settings: HTMLElement;
    private readonly inspectorHost: HTMLElement;
    private readonly stats: HTMLElement;
    private readonly defaults: PlaygroundConfig<S>;
    private config: PlaygroundConfig<S>;
    private committed?: PlaygroundConfig<S>;
    private active?: Preview;
    private generation = 0;
    private pending = Promise.resolve();
    private disposed = false;
    private loading = false;
    private paused = false;
    private readonly observer: ResizeObserver;
    private readonly timer: ReturnType<typeof setInterval>;
    private zip?: ResourcePack;
    private committedZip?: ResourcePack;
    private appliedAssets?: string;
    private appliedZip?: ArchiveAssetSource;

    constructor(private readonly options: PlaygroundOptions<S>) {
        const r = options.renderer;
        this.defaults = {
            schema: 1,
            demo: location.pathname.replace(/index\.html$/, "").replace(/\/$/, ""),
            content: clone(options.defaults),
            view: {
                projection: r?.camera?.type ?? "perspective", fov: r?.camera?.perspective?.fov ?? 50,
                near: r?.camera?.near ?? 0.1, far: r?.camera?.far ?? 10000,
                pixelRatio: r?.render?.pixelRatio ?? 1, fpsLimit: r?.render?.fpsLimit ?? 60,
                antialias: r?.render?.antialias ?? true, composer: r?.composer?.enabled ?? false,
                renderAlways: r?.render?.renderAlways ?? false, grid: r?.debug?.grid ?? false,
                axes: r?.debug?.axes ?? false, stats: true, background: "transparent"
            },
            assets: { version: AssetLoader.version, root: "" },
            output: { format: "png", trim: false, quality: 0.9, maxTextureSize: 2048, scope: "scene" }
        };
        this.config = clone(this.defaults);
        const preset = new URLSearchParams(location.search).get("preset");
        if (preset && options.presets?.[preset]) Object.assign(this.config.content, clone(options.presets[preset].state));
        let configError: string | undefined;
        try {
            const text = new URLSearchParams(location.hash.slice(1)).get("config");
            if (text) this.config = readConfig(text, this.defaults);
        } catch (error) {
            configError = this.message(error);
        }

        document.body.classList.add("playground");
        const panel = document.createElement("aside");
        panel.className = "playground-panel";
        panel.id = "playground-panel";
        const home = document.createElement("a");
        home.href = MINERENDER_PLAYGROUND_HOME;
        home.textContent = "← All playgrounds";
        const title = document.createElement("h1");
        title.textContent = options.title;
        this.status = document.createElement("p");
        this.status.className = "playground-status";
        this.status.setAttribute("role", "status");
        panel.append(home, title, this.status);
        if (options.presets) {
            const presets = options.presets;
            const picker = select(panel, "Preset", [["", "Choose a preset…"], ...Object.entries(presets).map(([key, value]): [string, string] => [key, value.label])], "");
            picker.addEventListener("change", () => {
                const chosen = presets[picker.value];
                picker.value = "";
                if (!chosen) return;
                this.config.content = { ...clone(options.defaults), ...clone(chosen.state) };
                delete this.config.view.camera;
                void this.reload(false);
            });
        }
        this.controls = section(panel, "Content", true);
        this.settings = document.createElement("div");
        panel.append(this.settings);
        this.inspectorHost = section(panel, "Inspector");
        note(this.inspectorHost, "Ctrl/Cmd+click the preview to inspect a part.");
        this.stats = document.createElement("output");
        this.stats.className = "playground-stats";
        panel.append(this.stats);

        this.viewport = document.createElement("main");
        this.viewport.className = "playground-viewport";
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "panel-toggle";
        toggle.textContent = "Hide controls";
        toggle.addEventListener("click", () => {
            toggle.textContent = document.body.classList.toggle("controls-hidden") ? "Show controls" : "Hide controls";
        });
        document.body.replaceChildren(panel, this.viewport, toggle);
        this.renderSettings();
        if (configError) this.report(`Could not restore configuration: ${configError}`, true);
        this.observer = new ResizeObserver(() => this.resize());
        this.observer.observe(this.viewport);
        this.timer = setInterval(() => this.updateStats(), 1000);
        window.addEventListener("pagehide", event => { if (!event.persisted) void this.dispose(); }, { once: true });
        Object.assign(window, { playground: this });
    }

    get state(): S { return this.config.content; }
    get renderer(): Renderer | undefined { return this.active?.renderer; }
    get inspector(): SceneInspector | undefined { return this.active?.inspector; }

    start(): Promise<void> { return this.reload(false); }

    /** Change content settings and rebuild the preview. */
    update(patch: Partial<S>): Promise<void> {
        this.config.content = { ...this.config.content, ...clone(patch) };
        return this.reload();
    }

    /** Save content settings that the page already applied to the live preview. */
    record(patch: Partial<S>): void {
        this.config.content = { ...this.config.content, ...clone(patch) };
        if (this.active && !this.loading && this.committed) this.committed.content = clone(this.config.content);
    }

    report(message: string, error = false): void {
        this.status.textContent = message;
        this.status.classList.toggle("error", error);
    }

    reload(preserveCamera = true): Promise<void> {
        if (this.disposed) return Promise.resolve();
        if (preserveCamera) this.captureCamera();
        const id = ++this.generation;
        const config = clone(this.config);
        const zip = this.zip;
        this.report("Loading…");
        this.loading = true;
        this.active?.renderer.stop();
        // Asset sources and caches are global: loads run one at a time.
        this.pending = this.pending.catch(error => console.error(error)).then(async () => {
            if (id !== this.generation || this.disposed) return;
            let preview: Preview | undefined;
            const previous = this.active;
            const started = performance.now();
            try {
                readConfig(JSON.stringify(config), this.defaults);
                await this.applyAssets(config.assets, zip);
                if (id !== this.generation || this.disposed) return;
                const mount = document.createElement("div");
                mount.className = "preview-mount staging";
                this.viewport.append(mount);
                let renderer: Renderer;
                try {
                    renderer = new Renderer(this.rendererOptions(config.view));
                } catch (error) {
                    mount.remove();
                    throw error;
                }
                preview = { renderer, mount, content: {}, cleanups: [] };
                renderer.appendTo(mount);
                this.background(renderer, config.view.background);
                const current = preview;
                const content = await this.options.load({
                    renderer,
                    assetFiles: config.assets.zipName ? zip?.files ?? [] : [],
                    isCurrent: () => !this.disposed && (id === this.generation || (this.active === current && !this.loading)),
                    onCleanup: cleanup => current.cleanups.push(cleanup)
                }, config.content);
                preview.content = content || {};
                if (id !== this.generation || this.disposed) {
                    await this.release(preview);
                    return;
                }
                this.active = preview;
                renderer.resize(this.viewport.clientWidth, this.viewport.clientHeight);
                preview.inspector = new SceneInspector(renderer);
                this.inspectorHost.replaceChildren(this.inspectorHost.firstElementChild!);
                preview.inspector.appendTo(this.inspectorHost);
                if (preview.content.object) preview.inspector.selectObject(preview.content.object);
                if (config.view.camera) this.restoreCamera(config.view.camera);
                else this.fit();
                preview.content.activate?.();
                this.committed = clone(this.config);
                this.committedZip = zip;
                preview.mount.classList.remove("staging");
                Object.assign(window, { renderer });
                if (!this.paused) renderer.start();
                if (previous) await this.release(previous);
                if (id === this.generation) {
                    this.report(`Ready · ${config.assets.version} · ${((performance.now() - started) / 1000).toFixed(2)} s`);
                    this.updateStats();
                }
            } catch (error) {
                if (preview) {
                    if (this.active === preview) {
                        this.active = previous;
                        this.inspectorHost.replaceChildren(this.inspectorHost.firstElementChild!);
                        previous?.inspector?.appendTo(this.inspectorHost);
                    }
                    await this.release(preview);
                }
                if (id === this.generation) {
                    if (this.active && this.committed) {
                        this.config = clone(this.committed);
                        this.zip = this.committedZip;
                        await this.applyAssets(this.config.assets, this.zip);
                        this.renderSettings();
                        const content = this.active.content;
                        try { (content.restore ?? content.activate)?.(); }
                        catch (restoreError) { console.error("Could not restore controls", restoreError); }
                    }
                    this.report(`${this.message(error)}${this.active ? " Previous preview kept." : ""}`, true);
                }
                console.error(error);
            } finally {
                if (id === this.generation) {
                    this.loading = false;
                    if (!this.paused) this.renderer?.start();
                }
            }
        });
        return this.pending;
    }

    /** Frame the content: the page's `fit` callback, or the scene bounds. */
    fit(): void {
        const preview = this.active;
        if (!preview) return;
        if (preview.content.fit) {
            preview.content.fit();
        } else {
            let bounds = this.contentBounds(preview);
            if (bounds.isEmpty() && preview.content.bounds) bounds = preview.content.bounds.clone();
            if (bounds.isEmpty()) return;
            const center = bounds.getCenter(new Vector3());
            const radius = Math.max(1, bounds.getSize(new Vector3()).length() / 2);
            const camera = preview.renderer.camera as PerspectiveCamera | OrthographicCamera;
            const direction = camera.position.clone().sub(preview.renderer.controls?.target ?? center);
            if (direction.lengthSq() < 0.01) direction.set(1, 0.75, 1);
            direction.normalize();
            let distance = radius * 3;
            if (camera instanceof PerspectiveCamera) {
                const vertical = camera.fov * Math.PI / 360;
                const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
                distance = radius / Math.sin(Math.min(vertical, horizontal)) * 1.15;
            } else {
                camera.zoom = Math.min(this.viewport.clientWidth, this.viewport.clientHeight) / (radius * 2.3);
            }
            camera.position.copy(center).addScaledVector(direction, distance);
            camera.near = Math.min(this.config.view.near, Math.max(0.01, distance / 1000));
            camera.far = Math.max(this.config.view.far, distance + radius * 4);
            camera.lookAt(center);
            camera.updateProjectionMatrix();
            preview.renderer.controls?.target.copy(center);
            preview.renderer.controls?.update();
        }
        preview.renderer.dirty = true;
        this.captureCamera();
    }

    private contentBounds(preview: Preview): Box3 {
        const bounds = new Box3();
        preview.renderer.scene.updateMatrixWorld(true);
        preview.renderer.scene.traverse(child => {
            if ((child as InstancedMesh).isInstancedMesh) (child as InstancedMesh).computeBoundingBox();
        });
        for (const child of preview.renderer.scene.children) {
            if (isSceneObject(child) || (child as Mesh).isMesh) bounds.expandByObject(child);
        }
        if (bounds.isEmpty() && preview.content.object?.parent) bounds.setFromObject(preview.content.object);
        return bounds;
    }

    private rendererOptions(view: ViewSettings): DeepPartial<RendererOptions> {
        const r = this.options.renderer;
        return {
            camera: {
                ...r?.camera, type: view.projection, near: view.near, far: view.far,
                perspective: { ...r?.camera?.perspective, fov: view.fov }
            },
            controls: { enabled: r?.controls?.enabled ?? true },
            render: {
                ...r?.render, autoResize: false, stats: false, pixelRatio: view.pixelRatio,
                fpsLimit: view.fpsLimit, antialias: view.antialias, renderAlways: view.renderAlways
            },
            composer: { enabled: view.composer }, debug: { grid: view.grid, axes: view.axes }
        };
    }

    private captureCamera(): void {
        const r = this.renderer;
        if (!r) return;
        const c = r.camera as PerspectiveCamera | OrthographicCamera;
        this.config.view.camera = {
            position: c.position.toArray(), target: (r.controls?.target ?? new Vector3()).toArray(), zoom: c.zoom
        };
        if (this.committed) this.committed.view.camera = clone(this.config.view.camera);
    }

    private restoreCamera(state: CameraState): void {
        const r = this.renderer!;
        const c = r.camera as PerspectiveCamera | OrthographicCamera;
        c.position.fromArray(state.position);
        c.zoom = state.zoom;
        c.lookAt(...state.target);
        r.controls?.target.fromArray(state.target);
        r.controls?.update();
        c.updateProjectionMatrix();
        r.dirty = true;
    }

    private background(renderer: Renderer, value: string): void {
        renderer.scene.background = value === "transparent" ? null : new Color(value);
        renderer.dirty = true;
    }

    private resize(): void {
        const r = this.renderer;
        if (!r || !this.viewport.clientWidth || !this.viewport.clientHeight) return;
        r.resize(this.viewport.clientWidth, this.viewport.clientHeight);
        this.active?.content.fit?.();
    }

    private async applyAssets(settings: AssetSettings, zip: ResourcePack | undefined): Promise<void> {
        if (settings.zipName && zip?.file.name !== settings.zipName) throw new Error(`Select the resource pack ${settings.zipName} again under Assets.`);
        const key = JSON.stringify(settings);
        if (key === this.appliedAssets && zip?.source === this.appliedZip) return;
        AssetLoader.removeSource("playground-hosted");
        AssetLoader.removeSource("playground-zip");
        AssetLoader.setVersion(settings.version);
        if (settings.root) AssetLoader.addSource("playground-hosted", new HostedAssetSource(settings.root.replace(/\/$/, ""), { retryDefaults: false }));
        if (settings.zipName && zip) AssetLoader.addSource("playground-zip", zip.source);
        Caching.clear();
        this.appliedAssets = key;
        this.appliedZip = zip?.source;
    }

    private renderSettings(): void {
        this.settings.replaceChildren();
        const renderer = section(this.settings, "Renderer and camera");
        const v = this.config.view;
        const projection = select(renderer, "Projection", ["perspective", "orthographic"], v.projection);
        const numeric: Array<[keyof ViewSettings, string, number, number, number]> = [
            ["fov", "Field of view", 1, 175, 1], ["near", "Near plane", 0.01, 100000, 0.1], ["far", "Far plane", 1, 1000000, 100],
            ["pixelRatio", "Pixel ratio", 0.25, 4, 0.25], ["fpsLimit", "FPS limit (0 = uncapped)", 0, 240, 1]
        ];
        const numbers = numeric.map(([key, title, min, max, step]) => {
            const control = input(renderer, title, v[key] as number, "number");
            Object.assign(control, { min: String(min), max: String(max), step: String(step) });
            return { key, control };
        });
        const toggles = ([
            ["antialias", "Antialiasing"], ["composer", "Postprocessing composer"], ["renderAlways", "Render continuously"],
            ["grid", "Grid"], ["axes", "Axes"], ["stats", "Scene statistics"]
        ] as const).map(([key, title]) => ({ key, control: checkbox(renderer, title, v[key]) }));
        button(renderer, "Apply renderer settings", async () => {
            const candidate = clone(this.config);
            candidate.view.projection = projection.value as ViewSettings["projection"];
            for (const { key, control } of numbers) candidate.view[key] = control.valueAsNumber as never;
            for (const { key, control } of toggles) candidate.view[key] = control.checked;
            try {
                readConfig(JSON.stringify(candidate), this.defaults);
                const projectionChanged = candidate.view.projection !== this.config.view.projection;
                this.config = candidate;
                if (projectionChanged) delete this.config.view.camera;
                await this.reload(!projectionChanged);
            } catch (error) { this.report(this.message(error), true); }
        });
        const background = select(renderer, "Background", [["transparent", "Transparent"], ["#ffffff", "White"], ["#20242b", "Dark"], ["#87ceeb", "Sky blue"]], v.background);
        background.addEventListener("change", () => {
            this.config.view.background = background.value;
            if (this.committed) this.committed.view.background = background.value;
            if (this.renderer) this.background(this.renderer, background.value);
        });
        button(renderer, "Fit content", () => { this.fit(); });
        button(renderer, "Reset camera", () => {
            delete this.config.view.camera;
            void this.reload(false);
        });
        const pause = button(renderer, this.paused ? "Resume rendering" : "Pause rendering", () => {
            this.paused = !this.paused;
            this.paused ? this.renderer?.stop() : this.renderer?.start();
            pause.textContent = this.paused ? "Resume rendering" : "Pause rendering";
        });

        const assets = section(this.settings, "Assets");
        const version = input(assets, "Minecraft version", this.config.assets.version);
        const root = input(assets, "Hosted asset root (optional)", this.config.assets.root, "url");
        button(assets, "Apply asset sources", async () => {
            const candidate = clone(this.config);
            candidate.assets = { ...candidate.assets, version: version.value.trim(), root: root.value.trim() };
            try {
                readConfig(JSON.stringify(candidate), this.defaults);
                this.config = candidate;
                await this.reload();
            } catch (error) { this.report(this.message(error), true); }
        });
        const zip = input(assets, this.config.assets.zipName ? `Resource pack (${this.config.assets.zipName})` : "Resource pack ZIP", "", "file");
        zip.accept = ".zip";
        zip.addEventListener("change", async () => {
            const file = zip.files?.[0];
            if (!file) return;
            zip.disabled = true;
            try {
                const proxy = new BrowserArchiveProxy(file);
                const entries = await proxy.getEntries();
                if (this.disposed) return;
                this.zip = { file, source: new ArchiveAssetSource(proxy), files: entries.filter(entry => !entry.directory).map(entry => entry.filename) };
                this.config.assets.zipName = file.name;
                this.renderSettings();
                await this.reload();
            } catch (error) {
                this.report(`Could not read pack: ${this.message(error)}`, true);
            } finally { zip.disabled = false; }
        });
        if (this.config.assets.zipName) {
            button(assets, "Remove resource pack", async () => {
                this.zip = undefined;
                delete this.config.assets.zipName;
                this.renderSettings();
                await this.reload();
            });
        }

        this.exportControls();
        const share = section(this.settings, "Share");
        note(share, "Links and JSON files keep the settings and camera. Local files must be selected again.");
        button(share, "Copy link", () => this.copy(this.shareUrl()));
        button(share, "Copy code", () => this.copy(this.code()));
        button(share, "Download JSON", () => download(this.serialize(), "minerender-playground.json"));
        const imported = input(share, "Import JSON", "", "file");
        imported.accept = ".json,application/json";
        imported.addEventListener("change", async () => {
            const file = imported.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                if (this.disposed) return;
                this.config = readConfig(text, this.defaults);
                this.renderSettings();
                await this.reload(false);
            } catch (error) {
                this.report(`Could not import configuration: ${this.message(error)}`, true);
            }
        });
        button(share, "Reset everything", async () => {
            this.config = clone(this.defaults);
            this.zip = undefined;
            this.paused = false;
            history.replaceState(null, "", location.pathname);
            this.renderSettings();
            await this.reload(false);
        });
    }

    private exportControls(): void {
        const parent = section(this.settings, "Export");
        const o = this.config.output;
        const format = select(parent, "Format", [["png", "PNG image"], ["jpeg", "JPEG image"], ["obj", "OBJ"], ["ply", "PLY"], ["gltf", "glTF"], ["glb", "GLB"]], o.format);
        const trim = checkbox(parent, "Trim transparent borders", o.trim);
        const quality = input(parent, "JPEG quality (0–1)", o.quality, "number");
        Object.assign(quality, { min: "0", max: "1", step: "0.05" });
        const size = input(parent, "Maximum glTF texture size", o.maxTextureSize, "number");
        Object.assign(size, { min: "16", max: "8192", step: "16" });
        const scope = select(parent, "3D export content", [["scene", "Whole scene"], ["object", "Primary object"]], o.scope);
        const save = () => {
            const candidate = clone(this.config);
            candidate.output = { format: format.value as typeof o.format, trim: trim.checked, quality: quality.valueAsNumber, maxTextureSize: size.valueAsNumber, scope: scope.value as typeof o.scope };
            try {
                readConfig(JSON.stringify(candidate), this.defaults);
                this.config.output = candidate.output;
                if (this.committed) this.committed.output = clone(candidate.output);
                return true;
            } catch (error) {
                this.report(this.message(error), true);
                return false;
            }
        };
        [format, trim, quality, size, scope].forEach(control => control.addEventListener("change", save));
        const exportButton = button(parent, "Download", async () => {
            if (!this.active) return this.report("Nothing to export yet.", true);
            if (!save()) return;
            exportButton.disabled = true;
            try {
                const output = this.config.output;
                const preview = this.active;
                const root = output.scope === "object" ? preview.content.object : preview.renderer.scene;
                if (!root && !["png", "jpeg"].includes(output.format)) throw new Error("This preview has no single primary object. Choose Whole scene.");
                const name = `minerender-${this.options.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
                if (output.format === "png" || output.format === "jpeg") {
                    download(preview.renderer.toImage(output.trim, `image/${output.format}`, output.quality), `${name}.${output.format === "jpeg" ? "jpg" : "png"}`);
                } else if (output.format === "obj") download(SceneExporter.toObj(root!), `${name}.obj`, "text/plain");
                else if (output.format === "ply") download(SceneExporter.toPLY(root!), `${name}.ply`, "application/octet-stream");
                else download(await SceneExporter.toGLTF(root!, { binary: output.format === "glb", maxTextureSize: output.maxTextureSize }), `${name}.${output.format}`, output.format === "glb" ? "model/gltf-binary" : "model/gltf+json");
                this.report("Download ready.");
            } catch (error) { this.report(`Could not export: ${this.message(error)}`, true); }
            finally { exportButton.disabled = false; }
        });
    }

    private serialize(): string {
        this.captureCamera();
        return JSON.stringify(this.committed ?? this.config, null, 2);
    }

    private shareUrl(): string {
        const url = new URL(location.href);
        url.search = "";
        url.hash = `config=${encodeURIComponent(this.serialize())}`;
        return url.href;
    }

    /** A minimal script reproducing the current preview: only non-default renderer options are included. */
    private code(): string {
        this.captureCamera();
        const config = this.committed ?? this.config;
        const v = config.view;
        const camera: Record<string, unknown> = {};
        if (v.projection !== "perspective") camera.type = v.projection;
        if (v.fov !== 50) camera.perspective = { fov: v.fov };
        if (v.near !== 1) camera.near = v.near;
        if (v.far !== 5000) camera.far = v.far;
        if (v.camera) {
            camera.position = v.camera.position.map(n => Number(n.toFixed(2)));
            camera.lookingAt = v.camera.target.map(n => Number(n.toFixed(2)));
        }
        const render: Record<string, unknown> = {};
        if (v.pixelRatio !== 1) render.pixelRatio = v.pixelRatio;
        if (v.fpsLimit !== 60) render.fpsLimit = v.fpsLimit;
        if (!v.antialias) render.antialias = false;
        if (v.renderAlways) render.renderAlways = true;
        const options: Record<string, unknown> = { camera, controls: { enabled: true }, composer: { enabled: v.composer } };
        if (Object.keys(render).length) options.render = render;
        if (v.grid || v.axes) options.debug = { grid: v.grid, axes: v.axes };
        let code = `import * as MineRender from "minerender";\n\n`;
        if (config.assets.version !== this.defaults.assets.version) code += `MineRender.AssetLoader.setVersion(${JSON.stringify(config.assets.version)});\n`;
        if (config.assets.root) code += `MineRender.AssetLoader.addSource("custom", new MineRender.HostedAssetSource(${JSON.stringify(config.assets.root)}, { retryDefaults: false }));\n`;
        if (config.assets.zipName) code += `// Resource pack: new MineRender.ArchiveAssetSource(new MineRender.BrowserArchiveProxy(file)) for ${config.assets.zipName}\n`;
        code += `const renderer = new MineRender.Renderer(${JSON.stringify(options, null, 2)});\nrenderer.appendTo(document.body);\nrenderer.start();\n`;
        if (v.background !== "transparent") code += `renderer.scene.background = new THREE.Color(${JSON.stringify(v.background)});\n`;
        if (v.camera && v.camera.zoom !== 1) code += `renderer.camera.zoom = ${v.camera.zoom};\nrenderer.camera.updateProjectionMatrix();\n`;
        code += `\n${this.options.code?.(clone(config.content)) ?? `const content = ${JSON.stringify(config.content, null, 2)};\n`}`;
        return code;
    }

    private async copy(text: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(text);
            this.report("Copied to clipboard.");
        } catch {
            const area = document.createElement("textarea");
            area.value = text;
            area.readOnly = true;
            this.status.replaceChildren(area);
            area.focus();
            area.select();
        }
    }

    private updateStats(): void {
        this.stats.hidden = !this.config.view.stats;
        const r = this.renderer;
        if (!r) return;
        const info = r.renderer.info;
        this.stats.textContent = `${r.scene.stats.sceneObjectCount} scene objects · ${r.scene.stats.instanceCount} instances · ${info.render.calls} draw calls · ${info.render.triangles} triangles · ${info.memory.geometries} geometries · ${info.memory.textures} textures · ${Ticker.tpsOneSecond} TPS · ${r.renderer.domElement.width}×${r.renderer.domElement.height} px`;
    }

    private async release(preview: Preview): Promise<void> {
        preview.renderer.stop();
        preview.inspector?.dispose();
        for (const cleanup of [preview.content.dispose, ...preview.cleanups.reverse()]) {
            try { await cleanup?.(); } catch (error) { console.error("Preview cleanup failed", error); }
        }
        for (const child of [...preview.renderer.scene.children]) {
            if (isSceneObject(child)) {
                try { child.dispose(); } catch (error) { console.error("Scene cleanup failed", error); }
            }
        }
        preview.renderer.dispose();
        preview.mount.remove();
    }

    private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

    async dispose(): Promise<void> {
        this.disposed = true;
        this.generation++;
        this.observer.disconnect();
        clearInterval(this.timer);
        await this.pending;
        if (this.active) await this.release(this.active);
        this.active = undefined;
    }
}
