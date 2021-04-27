import { Camera, OrthographicCamera, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { MineRenderScene } from "./MineRenderScene";
import merge from "ts-deepmerge";
import Stats from "stats.js";

export class Renderer {

    public static readonly DEFAULT_OPTIONS: RendererOptions = merge({}, <RendererOptions>{
        camera: {
            type: "perspective",
            near: 0.1,
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
            }
        },
        render: {
            fpsLimit: 60,
            stats: false
        }
    });
    public readonly options: RendererOptions;

    protected _scene: Scene;
    protected _camera: Camera;
    protected _renderer: WebGLRenderer;

    protected _stats?: Stats;

    protected _animationTimer?: NodeJS.Timeout = undefined;
    protected _animationFrame?: number = undefined;

    constructor(options?: Partial<RendererOptions>) {
        this.options = merge({}, Renderer.DEFAULT_OPTIONS, options ?? {});

        this._scene = this.createScene();
        this._camera = this.createCamera();
        this._renderer = this.createRenderer();

        if (this.options.render.stats) {
            this._stats = new Stats();

            document.body.appendChild(this._stats.dom);//TODO
        }
    }

    //<editor-fold desc="INIT">

    protected createScene(): Scene {
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
        const renderer = new WebGLRenderer({}); // TODO: config
        renderer.setSize(this.viewWidth, this.viewHeight);
        return renderer;
    }

    //</editor-fold>

    //<editor-fold desc="RENDER">

    public start() {
        stop(); // just in case
        this.animate();
    }

    public stop() {
        if (this._animationTimer)
            clearTimeout(this._animationTimer);
        this._animationTimer = undefined;

        if (this._animationFrame)
            cancelAnimationFrame(this._animationFrame);
        this._animationFrame = undefined;
    }

    private animate(t?: number): void {

        if (this._stats) {
            this._stats.begin();
        }

        this.renderer.render(this.scene, this.camera);

        if (this._stats) {
            this._stats.end();
        }

        this._animationTimer = setTimeout(() => {
            this._animationFrame = requestAnimationFrame((t) => this.animate(t));
        }, this.options.render.fpsLimit > 0 ? (1000 / this.options.render.fpsLimit) : undefined);
    }

    //</editor-fold>

    ///

    protected get viewWidth() {
        //TODO
        return window.innerWidth;
    }

    protected get viewHeight() {
        //TODO
        return window.innerHeight;
    }

    public get scene(): Scene {
        return this._scene;
    }

    public get camera(): Camera {
        return this._camera;
    }

    public get renderer(): WebGLRenderer {
        return this._renderer;
    }

    ///


}

export interface RendererOptions {
    camera: CameraOptions;
    render: RenderOptions;
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
}

export interface RenderOptions {
    fpsLimit: number;
    stats: boolean;
}
