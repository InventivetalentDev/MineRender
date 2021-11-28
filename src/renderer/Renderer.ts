import { AxesHelper, Camera, GridHelper, OrthographicCamera, PCFSoftShadowMap, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from "three";
import { MineRenderScene } from "./MineRenderScene";
import merge from "ts-deepmerge";
import Stats from "stats.js";
import { DeepPartial, isVector3 } from "../util/util";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { SSAARenderPass } from "three/examples/jsm/postprocessing/SSAARenderPass";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { SAOPass } from "three/examples/jsm/postprocessing/SAOPass";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass";
import { SSAOShader } from "three/examples/jsm/shaders/SSAOShader";
import { BloomPass } from "three/examples/jsm/postprocessing/BloomPass";
import { ToonShader1, ToonShader2 } from "three/examples/jsm/shaders/ToonShader";
import { isTripleArray, TripleArray } from "../model/Model";
import { isOrthographicCamera, isPerspectiveCamera } from "../util/three";

export class Renderer {

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
            stats: false,
            antialias: true,
            shade: true,
            autoResize: true
        },
        composer: {
            enabled: true
        },
        debug: {
            grid: false,
            axes: false
        }
    });
    public readonly options: RendererOptions;

    public readonly element: HTMLElement;

    protected _scene: MineRenderScene;
    protected _camera: Camera;
    protected _renderer: WebGLRenderer;
    protected _composer: EffectComposer;

    protected _stats?: Stats;

    protected _animationLoop;
    protected _fpsTimer;
    protected _animationTimer?: NodeJS.Timeout = undefined;
    protected _animationFrame?: number = undefined;
    protected _resizeListener?: () => void = undefined;

    constructor(options?: DeepPartial<RendererOptions>, element = document.body) {
        this.options = merge({}, Renderer.DEFAULT_OPTIONS, options ?? {});
        this.element = element;

        this._animationLoop = this.animate.bind(this);
        this._fpsTimer = this.options.render.fpsLimit > 0 ? (1000 / this.options.render.fpsLimit) : undefined;

        this._scene = this.createScene();
        this._camera = this.createCamera();
        this._renderer = this.createRenderer();
        this._composer = this.createComposer();

        if (this.options.render.stats) {
            this._stats = new Stats();

            document.body.appendChild(this._stats.dom);//TODO
        }

        this.init();
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
        renderer.shadowMap.type = PCFSoftShadowMap;

        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(this.viewWidth, this.viewHeight);

        return renderer;
    }

    protected createComposer(): EffectComposer {
        const composer = new EffectComposer(this.renderer);
        if (!this.options.composer.enabled) return composer;

        composer.setSize(this.viewWidth, this.viewHeight);
        //TODO: options

        // This one just tanks completely down to ~2fps (in structures at least, works pretty well for simpler stuff)
        const ssaaPass = new SSAARenderPass(this.scene, this.camera, 0x000000, 0);//TODO: options
        ssaaPass.unbiased = true;
        composer.addPass(ssaaPass);


        composer.addPass(new RenderPass(this.scene, this.camera));


        // composer.addPass(new SMAAPass(this.viewWidth, this.viewHeight));


        //
        // Makes movement sluggish
        // const ssaoPass = new SSAOPass(this.scene, this.camera, this.viewWidth, this.viewHeight);
        // composer.addPass(ssaoPass);

        // const saoPass = new SAOPass(this.scene, this.camera);
        // composer.addPass(saoPass);


        //
        //
        const shaderPass1 = new ShaderPass(CopyShader);
        shaderPass1.renderToScreen = true;
        composer.addPass(shaderPass1);


        return composer;
    }

    //</editor-fold>

    public init() {
        if (typeof window["__THREE_DEVTOOLS__"] !== 'undefined') {
            window["__THREE_DEVTOOLS__"].dispatchEvent(new CustomEvent('observe', { detail: this.scene }));
        }

        /// DEBUG
        if (this.options.debug.grid) {
            const gridHelper = new GridHelper(128, 16);
            this.scene.add(gridHelper);

            const gridHelper2 = new GridHelper(128, 16);
            gridHelper2.rotation.x = 90 * (Math.PI / 180)
            this.scene.add(gridHelper2);

            const gridHelper3 = new GridHelper(128, 16);
            gridHelper3.rotation.z = 90 * (Math.PI / 180)
            this.scene.add(gridHelper3);
        }
        if (this.options.debug.axes) {
            const axesHelper = new AxesHelper(64);
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

        if (this.options.render.autoResize) {
            this._resizeListener = () => {
                this.resize(this.viewWidth, this.viewHeight);
            };
            window.addEventListener('resize', this._resizeListener);//TODO: remove listener
        }

        // Add the canvas!
        this.element.appendChild(this.renderer.domElement);
    }

    public resize(width: number, height: number) {
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
        this.composer.setSize(width, height);
    }

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

        this._animationFrame = requestAnimationFrame(this._animationLoop);

        // this._animationTimer = setTimeout(() => {
        //     this._animationFrame = requestAnimationFrame(this._animationLoop);
        // }, this._fpsTimer);

        if (this._stats) {
            this._stats.begin();
        }


        if (this.options.composer.enabled) {
            this.composer.render();
        } else {
            this.renderer.render(this.scene, this.camera);
        }

        if (this._stats) {
            this._stats.end();
        }

    }

    //</editor-fold>

    ///

    protected get attachedToBody() {
        return this.element === document.body;
    }

    protected get viewWidth() {
        return this.attachedToBody ? window.innerWidth : this.element.offsetWidth;
    }

    protected get viewHeight() {
        return this.attachedToBody ? window.innerHeight : this.element.offsetHeight;
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

    public get composer(): EffectComposer {
        return this._composer;
    }

    ///


}

export interface RendererOptions {
    camera: CameraOptions;
    render: RenderOptions;
    composer: ComposerOptions;
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
    position: Vector3;
    lookingAt: Vector3;
}

export interface RenderOptions {
    fpsLimit: number;
    stats: boolean;
    antialias: boolean;
    shade: boolean;
    autoResize: boolean;
}

export interface ComposerOptions {
    enabled: boolean;
}

export interface DebugOptions {
    grid: boolean;
    axes: boolean;
}
