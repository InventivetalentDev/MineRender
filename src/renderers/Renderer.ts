import { Camera, PerspectiveCamera, Scene, WebGLRenderer } from "three";

export class Renderer {

    protected _scene: Scene;
    protected _camera: Camera;
    protected _renderer: WebGLRenderer;

    constructor(readonly options: RenderOptions) {
        this._scene = new Scene();
        this._camera = new PerspectiveCamera(50, this.viewWidth/ this.viewHeight,0.1,5000); // TODO: config
        this._renderer = new WebGLRenderer({}); // TODO: config
        this._renderer.setSize(this.viewWidth, this.viewHeight);
    }

    protected  get viewWidth() {
        //TODO
        return window.innerWidth;
    }

    protected  get viewHeight() {
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

}

export interface RenderOptions {

}
