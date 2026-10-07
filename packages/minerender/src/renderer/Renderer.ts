import { AxesHelper, Camera, EventDispatcher, GridHelper, OrthographicCamera, PCFShadowMap, PerspectiveCamera, SRGBColorSpace, Vector3, WebGLRenderer } from "three";
import {MineRenderScene} from "./MineRenderScene";
import merge from "ts-deepmerge";
import Stats from "stats.js";
import { BloomEffect, EffectComposer,  RenderPass, SSAOEffect, } from "postprocessing";
import {DeepPartial, isVector3, Maybe} from "../util/util";
import {isTripleArray, TripleArray} from "../model/Model";
import {isOrthographicCamera, isPerspectiveCamera} from "../util/three";
import { Disposable } from "../Disposable";
import { OrbitControls } from "../three/OrbitControls";
import { SceneExporter, SceneGLTFExportOptions } from "../export/SceneExporter";
import type { PLYExporterOptions } from "three/examples/jsm/exporters/PLYExporter.js";
import { trimCanvas } from "../canvas/trimCanvas";

export class Renderer implements Disposable {

    public static readonly DEFAULT_OPTIONS: RendererOptions = merge({}, <RendererOptions>{
        camera: {
            type: "perspective",
            near: 1,
            far: 5000,
            perspective: {
                aspect: undefined,
                fov: 50,
            },
            orthographic: {
                left: undefined,
                right: undefined,
                top: undefined,
                bottom: undefined
            },
            position: new Vector3(50, 50, 50),
            lookingAt: new Vector3(0, 0, 0)
        },
        render: {
            fpsLimit: 60,
            pixelRatio: 1,
            stats: false,
            antialias: true,
            shade: true,
            autoResize: true,
            renderAlways: false
        },
        composer: {
            enabled: true
        },
        controls: {
            enabled: false
        },
        debug: {
            grid: false,
            axes: false
        }
    });
    public readonly options: RendererOptions;

    protected _element?: HTMLElement;

    protected _scene: MineRenderScene;
    protected _camera: Camera;
    protected _renderer: WebGLRenderer;
    protected _composer?: EffectComposer;
    protected _controls?: OrbitControls;

    protected _stats?: Stats;

    protected _dirty: boolean = true;

    protected _animationLoop;
    protected _frameInterval?: number;
    protected _resizeListener?: () => void = undefined;

    private _nextFrameTime?: number;
    private _running: boolean = false;
    private _inAnimationLoop: boolean = false;
    private _disposed: boolean = false;
    private readonly _frameCallbacks = new Map<FrameCallback, { previous?: number }>();
    private readonly _debugHelpers: Array<GridHelper | AxesHelper> = [];
    private readonly _eventDispatchers = new Map<EventDispatcher<any>, Set<string>>();
    private readonly _changeListener = () => {
        this._dirty = true;
    };

    constructor(options?: DeepPartial<RendererOptions>) {
        this.options = merge({}, Renderer.DEFAULT_OPTIONS, options ?? {});
        const pixelRatio = this.options.render.pixelRatio ?? 1;
        if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
            throw new RangeError("render.pixelRatio must be a finite positive number");
        }

        this._animationLoop = (time: number) => {
            this._inAnimationLoop = true;
            try {
                this.animate(time);
            } finally {
                this._inAnimationLoop = false;
            }
        };
        this._frameInterval = this.options.render.fpsLimit > 0 ? (1000 / this.options.render.fpsLimit) : undefined;

        this._scene = this.createScene();
        this._camera = this.createCamera();
        this._renderer = this.createRenderer();
        this._composer = this.createComposer();

        if (this.options.render.stats) {
            this._stats = new Stats();

            document.body.appendChild(this._stats.dom);//TODO
        }

        this.init();
        this._controls = this.createControls();
    }

    //<editor-fold desc="INIT">

    protected createScene(): MineRenderScene {
        return new MineRenderScene();
    }

    protected createCamera(): Camera {
        switch (this.options.camera.type) {
            case "perspective":
            default:
                return new PerspectiveCamera(
                    this.options.camera.perspective.fov,
                    this.options.camera.perspective.aspect ?? (this.viewWidth / this.viewHeight),
                    this.options.camera.near,
                    this.options.camera.far
                );
            case "orthographic":
                return new OrthographicCamera(
                    this.options.camera.orthographic.left ?? (this.viewWidth / -2),
                    this.options.camera.orthographic.right ?? (this.viewWidth / 2),
                    this.options.camera.orthographic.top ?? (this.viewHeight / 2),
                    this.options.camera.orthographic.bottom ?? (this.viewHeight / -2),
                    this.options.camera.near,
                    this.options.camera.far
                )

        }

    }

    protected createRenderer(): WebGLRenderer {
        const renderer = new WebGLRenderer({
            antialias: this.options.render.antialias,
            alpha: true,
            powerPreference: "high-performance",
            depth: true
        });

        renderer.setClearColor(0x000000, 0);

        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = PCFShadowMap;

        renderer.outputColorSpace = SRGBColorSpace;

        renderer.setPixelRatio(this.options.render.pixelRatio ?? 1);
        renderer.setSize(this.viewWidth, this.viewHeight);

        return renderer;
    }

    protected createComposer(): Maybe<EffectComposer> {
        if (!this.options.composer.enabled) return undefined;

        const composer = new EffectComposer(this.renderer);

        composer.setSize(this.viewWidth, this.viewHeight);
        //TODO: options

        // // This one just tanks completely down to ~2fps (in structures at least, works pretty well for simpler stuff)
        // const ssaaPass = new SSAARenderPass(this.scene, this.camera, 0x000000, 0);//TODO: options
        // ssaaPass.unbiased = true;
        // composer.addPass(ssaaPass);


        composer.addPass(new RenderPass(this.scene, this.camera));

        // composer.addPass(new EffectPass(this.camera, new SSAOEffect(this.camera)))


        // composer.addPass(new SMAAPass(this.viewWidth, this.viewHeight));


        //
        // Makes movement sluggish
        // const ssaoPass = new SSAOPass(this.scene, this.camera, this.viewWidth, this.viewHeight);
        // composer.addPass(ssaoPass);

        // const saoPass = new SAOPass(this.scene, this.camera);
        // composer.addPass(saoPass);


        //
        // //
        // const shaderPass1 = new ShaderPass(CopyShader);
        // shaderPass1.renderToScreen = true;
        // composer.addPass(shaderPass1);

        return composer;
    }

    protected createControls(): Maybe<OrbitControls> {
        if (!this.options.controls?.enabled) return undefined;

        // OrbitControls updates the camera around the origin during construction.
        const position = this.camera.position.clone();
        const controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.camera.position.copy(position);

        const target = this.options.camera.lookingAt;
        if (isVector3(target)) {
            controls.target.copy(target);
        } else if (isTripleArray(target)) {
            controls.target.set(target[0], target[1], target[2]);
        }
        controls.update();
        controls.saveState();
        this.registerEventDispatcher(controls);
        return controls;
    }

    //</editor-fold>

    public init() {
        if (this._disposed) return;

        if (typeof window["__THREE_DEVTOOLS__"] !== 'undefined') {
            window["__THREE_DEVTOOLS__"].dispatchEvent(new CustomEvent('observe', {detail: this.scene}));
        }

        /// DEBUG
        if (this.options.debug.grid) {
            const gridHelper = new GridHelper(128, 16);
            this._debugHelpers.push(gridHelper);
            this.scene.add(gridHelper);

            const gridHelper2 = new GridHelper(128, 16);
            this._debugHelpers.push(gridHelper2);
            gridHelper2.rotation.x = 90 * (Math.PI / 180)
            this.scene.add(gridHelper2);

            const gridHelper3 = new GridHelper(128, 16);
            this._debugHelpers.push(gridHelper3);
            gridHelper3.rotation.z = 90 * (Math.PI / 180)
            this.scene.add(gridHelper3);
        }
        if (this.options.debug.axes) {
            const axesHelper = new AxesHelper(64);
            this._debugHelpers.push(axesHelper);
            this.scene.add(axesHelper);
        }

        /// CAMERA
        if (this.options.camera.position) {
            if (isVector3(this.options.camera.position)) {
                this.camera.position.set(this.options.camera.position.x, this.options.camera.position.y, this.options.camera.position.z);
            } else if (isTripleArray(this.options.camera.position)) {
                this.camera.position.set(this.options.camera.position[0], this.options.camera.position[1], this.options.camera.position[2]);
            }
        }
        if (this.options.camera.lookingAt) {
            if (isVector3(this.options.camera.lookingAt)) {
                this.camera.lookAt(this.options.camera.lookingAt);
            } else if (isTripleArray(this.options.camera.lookingAt)) {
                this.camera.lookAt(this.options.camera.lookingAt[0], this.options.camera.lookingAt[1], this.options.camera.lookingAt[2]);
            }
        }

        if (this.options.render.autoResize && !this._resizeListener) {
            this._resizeListener = () => {
                this.resize(this.viewWidth, this.viewHeight);
            };
            window.addEventListener('resize', this._resizeListener);
        }
    }

    public get element(): Maybe<HTMLElement> {
        return this._element;
    }

    public appendTo(element: HTMLElement): void {
        if (this._disposed) return;

        this._element = element;
        this._element.appendChild(this.renderer.domElement);
        if (this.viewWidth == 0) {
            console.warn('0 element width');
        }
        if (this.viewHeight == 0) {
            console.warn('0 element height');
        }
        this.resize(this.viewWidth, this.viewHeight);
    }

    /**
     * Redraws when the dispatcher emits the selected event. Registering the same pair twice has no effect.
     * The renderer removes its listener on disposal; the caller retains ownership of the dispatcher.
     */
    public registerEventDispatcher(dispatcher: EventDispatcher<any>, changeEvent: string = 'change') {
        if (this._disposed) return;

        let events = this._eventDispatchers.get(dispatcher);
        if (!events) {
            events = new Set<string>();
            this._eventDispatchers.set(dispatcher, events);
        }
        if (events.has(changeEvent)) return;

        events.add(changeEvent);
        dispatcher.addEventListener(changeEvent, this._changeListener);
    }

    public resize(width: number, height: number) {
        if (this._disposed) return;

        if (isPerspectiveCamera(this.camera)) {
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
        } else if (isOrthographicCamera(this.camera)) {
            this.camera.left = width / -2;
            this.camera.right = width / 2;
            this.camera.top = height / 2;
            this.camera.bottom = height / -2;
            this.camera.updateProjectionMatrix();
        }

        this.renderer.setSize(width, height);
        this.composer?.setSize(width, height);
        this._dirty = true;
    }

    //<editor-fold desc="RENDER">

    public get dirty(): boolean {
        return this._dirty || this.scene.dirty;
    }

    public set dirty(dirty: boolean) {
        this._dirty = dirty;
        this.scene.dirty = dirty;
    }

    /**
     * Calls a synchronous animation update before each FPS-limited draw while started.
     * Subscriptions keep the scene drawing without manual dirty flags. Returns an unsubscribe function.
     * Registering the same callback twice has no effect. Image exports do not invoke callbacks.
     */
    public onFrame(callback: FrameCallback): () => void {
        if (this._disposed) return () => {};
        const subscription = this._frameCallbacks.get(callback) ?? {};
        this._frameCallbacks.set(callback, subscription);
        return () => {
            if (this._frameCallbacks.get(callback) === subscription) this._frameCallbacks.delete(callback);
        };
    }

    public start() {
        if (this._disposed) return;

        this.stop();
        this._running = true;
        if (!this._inAnimationLoop) this.renderer.setAnimationLoop(this._animationLoop);
    }

    public stop() {
        if (this._disposed) return;

        this._running = false;
        if (this._inAnimationLoop) {
            // Three schedules its next frame after the callback; apply loop changes after that scheduling.
            queueMicrotask(() => {
                this.renderer.setAnimationLoop(null);
                if (this._running) this.renderer.setAnimationLoop(this._animationLoop);
            });
        } else {
            this.renderer.setAnimationLoop(null);
        }
        this._nextFrameTime = undefined;
        for (const subscription of this._frameCallbacks.values()) subscription.previous = undefined;
    }

    /**
     * Stops rendering and releases owned resources. Repeated calls have no effect, and a disposed
     * renderer cannot be restarted. Scene objects are detached; shared assets and caller-owned
     * controls must be managed by their owners.
     */
    public dispose(): void {
        if (this._disposed) return;

        this.stop();
        this._disposed = true;
        this._frameCallbacks.clear();

        if (this._resizeListener) {
            window.removeEventListener('resize', this._resizeListener);
            this._resizeListener = undefined;
        }
        for (const [dispatcher, events] of this._eventDispatchers) {
            for (const event of events) {
                dispatcher.removeEventListener(event, this._changeListener);
            }
        }
        this._eventDispatchers.clear();

        this._stats?.dom.remove();
        this._stats = undefined;
        this.renderer.domElement.remove();
        this._element = undefined;

        if (this._controls) {
            const controls = this._controls;
            this._controls = undefined;
            controls.enabled = false;
            controls.dispose();
        }

        this.scene.clear();
        for (const helper of this._debugHelpers) {
            helper.geometry.dispose();
            const materials = Array.isArray(helper.material) ? helper.material : [helper.material];
            for (const material of materials) {
                material.dispose();
            }
        }
        this._debugHelpers.length = 0;

        this.composer?.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
    }

    private animate(t: number = performance.now()): void {
        if (!this._running) return;

        // Damping and auto-rotation can make a previously clean scene need another frame.
        if (this._controls?.enabled) {
            this._controls.update();
        }
        if (!this._running) return;
        if (!this.dirty && !this.options.render.renderAlways && !this._frameCallbacks.size) return;

        const interval = this._frameInterval;
        if (interval) {
            const next = this._nextFrameTime;
            // Allow for rounded animation timestamps without losing a pending redraw.
            if (next !== undefined && t + 0.1 < next) return;
            // Keep fractional intervals, but do not catch up after idle periods or long frames.
            this._nextFrameTime = next !== undefined && t - next < interval ? next + interval : t + interval;
        }

        for (const [callback, subscription] of [...this._frameCallbacks]) {
            if (this._frameCallbacks.get(callback) !== subscription) continue;
            const previous = subscription.previous;
            subscription.previous = t;
            callback({ time: t / 1000, delta: previous === undefined ? 0 : (t - previous) / 1000 });
            if (!this._running) return;
        }
        this.drawFrame();
    }

    private drawFrame(): void {
        if (this._stats) {
            this._stats.begin();
        }

        if (this.options.composer.enabled && this.composer) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        this.dirty = false;

        if (this._stats) {
            this._stats.end();
        }

    }

    //</editor-fold>

    /**
     * Renders a fresh frame and returns an image data URL, including while the animation loop is stopped.
     * Trimming removes transparent borders; an empty image becomes one transparent pixel.
     * MIME type support and lossy quality (0–1) follow the canvas encoder.
     */
    public toImage(trim: boolean = false, mime: string = "image/png", quality?: number): string {
        if (this._disposed) throw new Error("Cannot export an image from a disposed renderer");
        if (this._controls?.enabled) {
            this._controls.update();
        }

        // Read the drawing buffer in the same task as the draw, before WebGL can clear it.
        this.drawFrame();
        const canvas = trim ? trimCanvas(this.renderer.domElement) : this.renderer.domElement;
        return (canvas as HTMLCanvasElement).toDataURL(mime, quality);
    }

    public toObj(): string {
        return SceneExporter.toObj(this.scene);
    }

    public toPLY(options?: PLYExporterOptions): string | ArrayBuffer {
        return SceneExporter.toPLY(this.scene, options);
    }

    public toGLTF(options?: SceneGLTFExportOptions): Promise<Record<string, any> | ArrayBuffer> {
        return SceneExporter.toGLTF(this.scene, options);
    }

    ///

    protected get attachedToBody() {
        return this.element === document.body;
    }

    protected get viewWidth() {
        return this.attachedToBody ? window.innerWidth : this.element?.offsetWidth || 0;
    }

    protected get viewHeight() {
        return this.attachedToBody ? window.innerHeight : this.element?.offsetHeight || 0;
    }

    public get scene(): MineRenderScene {
        return this._scene;
    }

    public get camera(): Camera {
        return this._camera;
    }

    public get renderer(): WebGLRenderer {
        return this._renderer;
    }

    public get composer(): Maybe<EffectComposer> {
        return this._composer;
    }

    /** Renderer-owned controls, or undefined when disabled at construction or after disposal. */
    public get controls(): Maybe<OrbitControls> {
        return this._controls;
    }

    ///


}

export interface RendererFrame {
    /** Animation-loop timestamp in seconds, relative to the browser's performance time origin. */
    readonly time: number;
    /** Seconds since this callback's previous update; zero on its first update after subscribing or starting. */
    readonly delta: number;
}

export type FrameCallback = (frame: RendererFrame) => void;

export interface RendererOptions {
    camera: CameraOptions;
    render: RenderOptions;
    composer: ComposerOptions;
    controls?: ControlsOptions;
    debug: DebugOptions;
}

export interface CameraOptions {
    type: "perspective" | "orthographic";
    near: number;
    far: number;
    perspective: {
        aspect: undefined | number;
        fov: number;
    }
    orthographic: {
        left: undefined | number;
        right: undefined | number;
        top: undefined | number;
        bottom: undefined | number;
    }
    position: Vector3 | TripleArray;
    lookingAt: Vector3 | TripleArray;
}

export interface RenderOptions {
    /** Maximum draw rate (60 by default); zero or a negative value disables the limit. */
    fpsLimit: number;
    /** Drawing-buffer pixels per CSS pixel (default 1); also scales toImage() output. */
    pixelRatio?: number;
    stats: boolean;
    antialias: boolean;
    shade: boolean;
    autoResize: boolean;
    renderAlways: boolean;
}

export interface ComposerOptions {
    enabled: boolean;
}

export interface ControlsOptions {
    enabled: boolean;
}

export interface DebugOptions {
    grid: boolean;
    axes: boolean;
}
