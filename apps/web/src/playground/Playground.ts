import {
    ArchiveAssetSource, AssetLoader, BrowserArchiveProxy, Caching, HostedAssetSource,
    Renderer, SceneExporter, SceneInspector, Ticker, isSceneObject, type DeepPartial, type RendererOptions
} from "minerender";
import { Box3, Color, InstancedMesh, Mesh, Object3D, OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { button, checkbox, download, input, note, section, select } from "./controls";
import { clone, readConfig, type AssetSettings, type CameraState, type PlaygroundConfig, type ViewSettings } from "./config";

export interface DemoContext {
    renderer: Renderer;
    assetFiles: readonly string[];
    isCurrent(): boolean;
    onCleanup(cleanup: () => void | Promise<void>): void;
}

export interface DemoContent {
    object?: Object3D;
    bounds?: Box3;
    fit?: () => void;
    activate?: () => void;
    restore?: () => void;
    dispose?: () => void | Promise<void>;
}

export interface PlaygroundOptions<S> {
    title: string;
    defaults: S;
    renderer?: DeepPartial<RendererOptions>;
    presets?: Record<string, { label: string; state: Partial<S> }>;
    load(context: DemoContext, state: S): Promise<DemoContent | void>;
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

/** One page owns its preview, settings, and uploads; replacements commit only after a successful load. */
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
    private settingsOperation = 0;
    private paused = false;
    private readonly observer: ResizeObserver;
    private readonly timer: ReturnType<typeof setInterval>;
    private zip?: ResourcePack;
    private committedZip?: ResourcePack;
    private appliedAssets?: AssetSettings;
    private appliedZip?: ArchiveAssetSource;
    private loadMilliseconds = 0;

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
        panel.setAttribute("aria-label", "Playground controls");
        const home = document.createElement("a");
        home.href = "../../";
        home.textContent = "← All playgrounds";
        const title = document.createElement("h1");
        title.textContent = options.title;
        this.status = document.createElement("p");
        this.status.className = "playground-status";
        this.status.setAttribute("role", "status");
        this.status.setAttribute("aria-live", "polite");
        panel.append(home, title, this.status);
        this.controls = section(panel, "Content", true);
        this.settings = document.createElement("div");
        panel.append(this.settings);
        this.inspectorHost = section(panel, "Inspector");
        note(this.inspectorHost, "Ctrl/Cmd+click the preview to inspect a part or instance. Select its name to edit transforms and visibility.");
        this.stats = document.createElement("output");
        this.stats.className = "playground-stats";
        panel.append(this.stats);

        this.viewport = document.createElement("main");
        this.viewport.className = "playground-viewport";
        this.viewport.setAttribute("aria-label", `${options.title} preview`);
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "panel-toggle";
        toggle.textContent = "Hide controls";
        toggle.setAttribute("aria-controls", panel.id);
        toggle.setAttribute("aria-expanded", "true");
        toggle.addEventListener("click", () => {
            const hidden = document.body.classList.toggle("controls-hidden");
            toggle.textContent = hidden ? "Show controls" : "Hide controls";
            toggle.setAttribute("aria-expanded", String(!hidden));
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

    update(patch: Partial<S>): Promise<void> {
        this.config.content = { ...this.config.content, ...clone(patch) };
        return this.reload();
    }

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
        this.report("Loading preview…");
        this.loading = true;
        this.active?.renderer.stop();
        this.viewport.setAttribute("aria-busy", "true");
        // Asset sources are global. Finish the active load before changing their order or clearing caches.
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
                const instructions = this.inspectorHost.firstElementChild;
                this.inspectorHost.replaceChildren(...(instructions ? [instructions] : []));
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
                this.loadMilliseconds = performance.now() - started;
                if (id === this.generation) {
                    this.report(`Ready · ${config.assets.version} · ${(this.loadMilliseconds / 1000).toFixed(2)} s`);
                    this.updateStats();
                }
            } catch (error) {
                if (preview) {
                    if (this.active === preview) {
                        this.active = previous;
                        this.inspectorHost.replaceChildren();
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
                        try { this.active.content.restore?.(); }
                        catch (restoreError) { console.error("Could not restore controls", restoreError); }
                    }
                    this.report(`${this.message(error)}${this.active ? " Previous preview and configuration kept." : ""}`, true);
                }
                console.error(error);
            } finally {
                if (id === this.generation) {
                    this.loading = false;
                    this.viewport.setAttribute("aria-busy", "false");
                    if (!this.paused) this.renderer?.start();
                }
            }
        });
        return this.pending;
    }

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
            if ((child as Object3D & { isSceneObject?: boolean }).isSceneObject || (child as Mesh).isMesh) bounds.expandByObject(child);
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

    private async applyAssets(settings: AssetSettings, zip: typeof this.zip): Promise<void> {
        if (settings.zipName && zip?.file.name !== settings.zipName) throw new Error(`Reselect resource pack ${settings.zipName} in Assets.`);
        if (JSON.stringify(settings) === JSON.stringify(this.appliedAssets) && this.appliedZip === zip?.source) return;
        AssetLoader.removeSource("playground-hosted");
        AssetLoader.removeSource("playground-zip");
        AssetLoader.setVersion(settings.version);
        if (settings.root) AssetLoader.addSource("playground-hosted", new HostedAssetSource(settings.root.replace(/\/$/, ""), { retryDefaults: false }));
        if (settings.zipName && zip) AssetLoader.addSource("playground-zip", zip.source);
        Caching.clear();
        this.appliedAssets = clone(settings);
        this.appliedZip = zip?.source;
    }

    private renderSettings(): void {
        this.settings.replaceChildren();
        if (this.options.presets) {
            const presets = section(this.settings, "Presets", true);
            const picker = select(presets, "Example", [["", "Choose a preset"], ...Object.entries(this.options.presets).map(([key, value]): [string, string] => [key, value.label])], "");
            picker.addEventListener("change", () => {
                const preset = this.options.presets?.[picker.value];
                if (preset) {
                    this.config.content = { ...clone(this.options.defaults), ...clone(preset.state) };
                    delete this.config.view.camera;
                    void this.reload(false);
                }
            });
        }
        const renderer = section(this.settings, "Renderer and camera");
        const v = this.config.view;
        const projection = select(renderer, "Projection", ["perspective", "orthographic"], v.projection);
        const numeric: Array<[keyof ViewSettings, string, number, number, number]> = [
            ["fov", "Field of view (degrees)", 1, 175, 1], ["near", "Near clipping plane", 0.01, 100000, 0.1],
            ["far", "Far clipping plane", 1, 1000000, 100], ["pixelRatio", "Pixel ratio", 0.25, 4, 0.25], ["fpsLimit", "FPS limit (0 = uncapped)", 0, 240, 1]
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
        const background = select(renderer, "Background", [["transparent", "Transparent / checkerboard"], ["#ffffff", "White"], ["#20242b", "Dark"], ["#87ceeb", "Sky blue"]], v.background);
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
        const position = input(renderer, "Camera position (x, y, z)", v.camera?.position.join(", ") ?? "50, 50, 50");
        const target = input(renderer, "Camera target (x, y, z)", v.camera?.target.join(", ") ?? "0, 0, 0");
        button(renderer, "Read camera", () => {
            this.captureCamera();
            position.value = this.config.view.camera?.position.join(", ") ?? "";
            target.value = this.config.view.camera?.target.join(", ") ?? "";
        });
        button(renderer, "Set camera", () => {
            try {
                const vector = (text: string): [number, number, number] => {
                    const values = text.split(",").map(Number);
                    if (values.length !== 3 || !values.every(Number.isFinite)) throw new Error("Enter three comma-separated coordinates.");
                    return values as [number, number, number];
                };
                this.config.view.camera = { position: vector(position.value), target: vector(target.value), zoom: this.config.view.camera?.zoom ?? 1 };
                if (this.renderer) this.restoreCamera(this.config.view.camera);
            } catch (error) { this.report(this.message(error), true); }
        });

        const assets = section(this.settings, "Assets");
        const version = input(assets, "Minecraft version", this.config.assets.version);
        const root = input(assets, "Hosted asset root (optional)", this.config.assets.root, "url");
        button(assets, "Apply asset sources", async () => {
            this.settingsOperation++;
            const candidate = clone(this.config);
            candidate.assets = { ...candidate.assets, version: version.value.trim(), root: root.value.trim() };
            try {
                readConfig(JSON.stringify(candidate), this.defaults);
                this.config = candidate;
                await this.reload();
            } catch (error) { this.report(this.message(error), true); }
        });
        const zip = input(assets, "Resource pack ZIP", "", "file");
        zip.accept = ".zip";
        note(assets, this.config.assets.zipName ? `Selected pack: ${this.config.assets.zipName}` : "ZIP overrides hosted assets, which override vanilla assets.");
        zip.addEventListener("change", async () => {
            const file = zip.files?.[0];
            if (!file) return;
            const operation = ++this.settingsOperation;
            zip.disabled = true;
            try {
                const proxy = new BrowserArchiveProxy(file);
                const entries = await proxy.getEntries();
                if (operation !== this.settingsOperation || this.disposed) return;
                this.zip = { file, source: new ArchiveAssetSource(proxy), files: entries.filter(entry => !entry.directory).map(entry => entry.filename) };
                this.config.assets.zipName = file.name;
                this.renderSettings();
                await this.reload();
            } catch (error) {
                if (operation === this.settingsOperation && !this.disposed) this.report(`Could not read pack: ${this.message(error)}`, true);
            }
            finally { zip.disabled = false; }
        });
        button(assets, "Remove resource pack", async () => {
            this.settingsOperation++;
            this.zip = undefined;
            delete this.config.assets.zipName;
            this.renderSettings();
            await this.reload();
        });

        this.exportControls();
        const configuration = section(this.settings, "Save and restore");
        note(configuration, "Links and JSON keep settings, camera, model JSON, and filenames. Reselect local binary assets after reopening. Inspector-only edits are not saved.");
        button(configuration, "Copy link", () => this.copy(this.shareUrl()));
        button(configuration, "Copy configuration", () => this.copy(this.serialize()));
        button(configuration, "Download configuration", () => download(this.serialize(), "minerender-playground.json"));
        button(configuration, "Copy code", async () => {
            try { await this.copy(this.code()); }
            catch (error) { this.report(`Could not create code: ${this.message(error)}`, true); }
        });
        const imported = input(configuration, "Import configuration JSON", "", "file");
        imported.accept = ".json,application/json";
        imported.addEventListener("change", async () => {
            const file = imported.files?.[0];
            if (!file) return;
            const operation = ++this.settingsOperation;
            try {
                const text = await file.text();
                if (operation !== this.settingsOperation || this.disposed) return;
                this.config = readConfig(text, this.defaults);
                this.renderSettings();
                await this.reload(false);
            } catch (error) {
                if (operation === this.settingsOperation && !this.disposed) this.report(`Could not import configuration: ${this.message(error)}`, true);
            }
        });
        button(configuration, "Reset all settings", async () => {
            this.settingsOperation++;
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
        const format = select(parent, "Format", ["png", "jpeg", "obj", "ply", "gltf", "glb"], o.format);
        const trim = checkbox(parent, "Trim transparent image borders", o.trim);
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
        note(parent, "Images use the drawing-buffer size set by Pixel ratio. 3D exports capture the current pose. OBJ/PLY omit texture images; glTF does not bake custom lighting.");
        const exportButton = button(parent, "Download preview", async () => {
            if (!this.active) return this.report("Load a preview before exporting.", true);
            if (!save()) return;
            exportButton.disabled = true;
            try {
                readConfig(this.serialize(), this.defaults);
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

    private code(): string {
        this.captureCamera();
        const config = this.committed ?? this.config;
        const options = this.rendererOptions(config.view);
        if (config.view.camera) options.camera = { ...options.camera, position: config.view.camera.position, lookingAt: config.view.camera.target };
        let code = `import * as MineRender from "minerender";\nimport { Color } from "three";\n\nMineRender.AssetLoader.setVersion(${JSON.stringify(config.assets.version)});\n`;
        if (config.assets.root) code += `MineRender.AssetLoader.addSource("custom", new MineRender.HostedAssetSource(${JSON.stringify(config.assets.root)}, { retryDefaults: false }));\n`;
        if (config.assets.zipName) code += `const packInput = document.createElement("input");\npackInput.type = "file";\npackInput.accept = ".zip";\npackInput.setAttribute("aria-label", ${JSON.stringify(`Select ${config.assets.zipName}`)});\ndocument.body.append(packInput);\nconst pack = await new Promise(resolve => packInput.addEventListener("change", () => {\n    if (packInput.files[0]) resolve(packInput.files[0]);\n}));\nMineRender.AssetLoader.addSource("pack", new MineRender.ArchiveAssetSource(new MineRender.BrowserArchiveProxy(pack)));\npackInput.remove();\n`;
        code += `const renderer = new MineRender.Renderer(${JSON.stringify(options, null, 2)});\nrenderer.appendTo(document.body);\nrenderer.start();\n\n`;
        if (config.view.background !== "transparent") code += `renderer.scene.background = new Color(${JSON.stringify(config.view.background)});\n`;
        if (config.view.camera) code += `renderer.camera.zoom = ${config.view.camera.zoom};\nrenderer.camera.updateProjectionMatrix();\n`;
        code += this.options.code?.(clone(config.content)) ?? `// Content settings for ${this.options.title}.\nconst content = ${JSON.stringify(config.content, null, 2)};\n`;
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
            area.setAttribute("aria-label", "Text to copy");
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
