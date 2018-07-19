import OrbitControls from "./lib/OrbitControls";
import { SSAARenderPass } from "threejs-ext";
import EffectComposer, { ShaderPass, CopyShader } from "@johh/three-effectcomposer";
import * as THREE from "three";
import OnScreen from "onscreen";
import * as $ from "jquery";

/**
 * Default asset root
 * @type {string}
 */
export const DEFAULT_ROOT = "https://minerender.org/res/mc";

/**
 * Texture cache
 * @type {Object.<string,string>}
 */
const textureCache = {};
/**
 * Texture callbacks
 * @type {Object.<string,function[]>}
 */
const textureCallbacks = {};

/**
 * Model cache
 * @type {Object.<string,string>}
 */
const modelCache = {};
/**
 * Model callbacks
 * @type {Object.<string,function[]>}
 */
const modelCallbacks = {};

/**
 * @property {boolean} showAxes                 Debugging - Show the scene's axes
 * @property {boolean} showOutlines             Debugging - Show bounding boxes
 * @property {boolean} showGrid                 Debugging - Show coordinate grid
 *
 * @property {object} controls                  Controls settings
 * @property {boolean} [controls.enabled=true]  Toggle controls
 * @property {boolean} [controls.zoom=true]     Toggle zoom
 * @property {boolean} [controls.rotate=true]   Toggle rotation
 * @property {boolean} [controls.pan=true]      Toggle panning
 *
 * @property {object} camera                    Camera settings
 * @property {number} camera.x                  Camera X-position
 * @property {number} camera.y                  Camera Y-Position
 * @property {number} camera.z                  Camera Z-Position
 * @property {number[]} camera.target           [x,y,z] array where the camera should look
 */
export const defaultOptions = {
    showAxes: false,
    showGrid: false,
    autoResize: false,
    controls: {
        enabled: true,
        zoom: true,
        rotate: true,
        pan: true,
        keys: true
    },
    camera: {
        type: "perspective",
        x: 20,
        y: 35,
        z: 20,
        target: [0, 0, 0]
    },
    canvas: {
        width: undefined,
        height: undefined
    },
    pauseHidden: true,
    forceContext: false
};

/**
 * Base class for all Renders
 */
export default class Render {

    /**
     * @param {object} options The options for this renderer, see {@link defaultOptions}
     * @param {object} defOptions Additional default options, provided by the individual renders
     * @param {HTMLElement} [element=document.body] DOM Element to attach the renderer to - defaults to document.body
     * @constructor
     */
    constructor(options, defOptions, element) {
        /**
         * DOM Element to attach the renderer to
         * @type {HTMLElement}
         */
        this.element = element || document.body;
        /**
         * Combined options
         * @type {{} & defaultOptions & defOptions & options}
         */
        this.options = Object.assign({}, defaultOptions, defOptions, options);
    }

    /**
     * @returns {string} The content of the renderer's canvas as a Base64 encoded image
     */
    toImage() {
        if (this._renderer)
            return this._renderer.domElement.toDataURL("image/png");
    };

    /**
     * Initializes the scene
     * @param renderCb
     * @param doNotAnimate
     * @protected
     */
    initScene(renderCb, doNotAnimate) {
        let renderObj = this;

        console.log(" ");
        console.log('%c       ', 'font-size: 100px; background: url(https://minerender.org/img/minerender.svg) no-repeat;');
        console.log("MineRender/" + (renderObj.renderType || renderObj.constructor.name));
        console.log((PRODUCTION ? "PRODUCTION" : "DEVELOPMENT") + " build");
        console.log("Built @ " + BUILD_DATE);
        console.log(" ");

        // Scene INIT
        let scene = new THREE.Scene();
        renderObj._scene = scene;
        let camera;
        if (renderObj.options.camera.type === "orthographic") {
            camera = new THREE.OrthographicCamera((renderObj.options.canvas.width || window.innerWidth) / -2, (renderObj.options.canvas.width || window.innerWidth) / 2, (renderObj.options.canvas.height || window.innerHeight) / 2, (renderObj.options.canvas.height || window.innerHeight) / -2, 1, 1000);
        } else {
            camera = new THREE.PerspectiveCamera(75, (renderObj.options.canvas.width || window.innerWidth) / (renderObj.options.canvas.height || window.innerHeight), 5, 1000);
        }
        renderObj._camera = camera;

        if (renderObj.options.camera.zoom) {
            camera.zoom = renderObj.options.camera.zoom;
        }

        let renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: true});
        renderObj._renderer = renderer;
        renderer.setSize((renderObj.options.canvas.width || window.innerWidth), (renderObj.options.canvas.height || window.innerHeight));
        renderer.setClearColor(0x000000, 0);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        renderObj.element.appendChild(renderObj._canvas = renderer.domElement);

        let composer = new EffectComposer(renderer);
        composer.setSize((renderObj.options.canvas.width || window.innerWidth), (renderObj.options.canvas.height || window.innerHeight));
        renderObj._composer = composer;
        let ssaaRenderPass = new SSAARenderPass(scene, camera);
        ssaaRenderPass.unbiased = true;
        composer.addPass(ssaaRenderPass);
        // let renderPass = new RenderPass(scene, camera);
        // renderPass.enabled = false;
        // composer.addPass(renderPass);
        let copyPass = new ShaderPass(CopyShader);
        copyPass.renderToScreen = true;
        composer.addPass(copyPass);

        if (renderObj.options.autoResize) {
            window.addEventListener("resize", function () {
                let width = (renderObj.element && renderObj.element !== document.body) ? renderObj.element.offsetWidth : window.innerWidth;
                let height = (renderObj.element && renderObj.element !== document.body) ? renderObj.element.offsetHeight : window.innerHeight;

                renderObj._resize(width, height);
            });
        }
        renderObj._resize = function (width, height) {
            if (renderObj.options.camera.type === "orthographic") {
                camera.left = width / -2;
                camera.right = width / 2;
                camera.top = height / 2;
                camera.bottom = height / -2;
            } else {
                camera.aspect = width / height;
            }
            camera.updateProjectionMatrix();

            renderer.setSize(width, height);
            composer.setSize(width, height);
        };

        // Helpers
        if (renderObj.options.showAxes) {
            scene.add(new THREE.AxesHelper(50));
        }
        if (renderObj.options.showGrid) {
            scene.add(new THREE.GridHelper(100, 100));
        }

        let light = new THREE.AmbientLight(0xFFFFFF); // soft white light
        scene.add(light);

        // Init controls
        let controls = new OrbitControls(camera, renderer.domElement);
        renderObj._controls = controls;
        controls.enableZoom = renderObj.options.controls.zoom;
        controls.enableRotate = renderObj.options.controls.rotate;
        controls.enablePan = renderObj.options.controls.pan;
        controls.enableKeys = renderObj.options.controls.keys;
        controls.target.set(renderObj.options.camera.target[0], renderObj.options.camera.target[1], renderObj.options.camera.target[2]);

        // Set camera location & target
        camera.position.x = renderObj.options.camera.x;
        camera.position.y = renderObj.options.camera.y;
        camera.position.z = renderObj.options.camera.z;
        camera.lookAt(new THREE.Vector3(renderObj.options.camera.target[0], renderObj.options.camera.target[1], renderObj.options.camera.target[2]));

        // Do the render!
        let animate = function () {
            renderObj._animId = requestAnimationFrame(animate);

            if (renderObj.onScreen) {
                if (typeof renderCb === "function") renderCb();

                composer.render();
            }
        };
        renderObj._animate = animate;

        if (!doNotAnimate) {
            animate();
        }

        renderObj.onScreen = true;// default to true, in case the checking is disabled
        let id = "minerender-canvas-" + renderObj._scene.uuid + "-" + Date.now();
        renderObj._canvas.id = id;
        if (renderObj.options.pauseHidden) {
            renderObj.onScreen = false;// set to false if the check is enabled
            let os = new OnScreen();

            os.on("enter", "#" + id, (element, event) => {
                renderObj.onScreen = true;
                if (renderObj.options.forceContext) {
                    renderObj._renderer.forceContextRestore();
                }
            })
            os.on("leave", "#" + id, (element, event) => {
                renderObj.onScreen = false;
                if (renderObj.options.forceContext) {
                    renderObj._renderer.forceContextLoss();
                }
            });
        }
    };


    clearScene() {
        while (this._scene.children.length > 0) {
            this._scene.remove(this._scene.children[0]);
        }
    };

    dispose() {
        cancelAnimationFrame(this._animId);

        this.clearScene();

        this._canvas.remove();
        let el = this.element;
        while (el.firstChild) {
            el.removeChild(el.firstChild);
        }
    };

}

/**
 * Loads a Mincraft texture an returns it as Base64
 *
 * @param {string} root Asset root, see {@link DEFAULT_ROOT}
 * @param {string} namespace Namespace, usually 'minecraft'
 * @param {string} dir Directory of the texture
 * @param {string} name Name of the texture
 * @returns {Promise<string>}
 */
export function loadTextureAsBase64(root, namespace, dir, name) {
    return new Promise((resolve, reject) => {
        loadTexture(root, namespace, dir, name, resolve, reject);
    })
};

/**
 * Load a texture as base64 - shouldn't be used directly
 * @see loadTextureAsBase64
 * @ignore
 */
function loadTexture(root, namespace, dir, name, resolve, reject, forceLoad) {
    let path = "/assets/" + namespace + "/textures" + dir + name + ".png";

    if (textureCache.hasOwnProperty(path)) {
        if (textureCache[path] === "__invalid") {
            reject();
            return;
        }
        resolve(textureCache[path]);
        return;
    }

    if (!textureCallbacks.hasOwnProperty(path) || textureCallbacks[path].length === 0 || forceLoad) {
        // https://gist.github.com/oliyh/db3d1a582aefe6d8fee9 / https://stackoverflow.com/questions/20035615/using-raw-image-data-from-ajax-request-for-data-uri
        let xhr = new XMLHttpRequest();
        xhr.open('GET', root + path, true);
        xhr.responseType = 'arraybuffer';
        xhr.onloadend = function () {
            if (xhr.status === 200) {
                let arr = new Uint8Array(this.response);
                let raw = String.fromCharCode.apply(null, arr);
                let b64 = btoa(raw);
                let dataURL = "data:image/png;base64," + b64;

                textureCache[path] = dataURL;

                if (textureCallbacks.hasOwnProperty(path)) {
                    while (textureCallbacks[path].length > 0) {
                        let cb = textureCallbacks[path].shift(0);
                        cb[0](dataURL);
                    }
                }
            } else {
                if (DEFAULT_ROOT === root) {
                    textureCache[path] = "__invalid";

                    if (textureCallbacks.hasOwnProperty(path)) {
                        while (textureCallbacks[path].length > 0) {
                            let cb = textureCallbacks[path].shift(0);
                            cb[1]();
                        }
                    }
                } else {
                    loadTexture(DEFAULT_ROOT, namespace, dir, name, resolve, reject, true)
                }
            }
        };
        xhr.send();

        // init array
        if (!textureCallbacks.hasOwnProperty(path))
            textureCallbacks[path] = [];
    }

    // add the promise callback
    textureCallbacks[path].push([resolve, reject]);
}

/**
 * Loads a blockstate file and returns the contained JSON
 * @param {string} state Name of the blockstate
 * @param {string} assetRoot Asset root, see {@link DEFAULT_ROOT}
 * @returns {Promise<object>}
 */
export function loadBlockState(state, assetRoot) {
    return loadJsonFromPath(assetRoot, "/assets/minecraft/blockstates/" + state + ".json")
};

export function loadTextureMeta(texture,assetRoot){
    return loadJsonFromPath(assetRoot, "/assets/minecraft/textures/block/" + texture + ".png.mcmeta")
}

/**
 * Loads a model file and returns the contained JSON
 * @param {string} root Asset root, see {@link DEFAULT_ROOT}
 * @param {string} path Path to the model file
 * @returns {Promise<object>}
 */
export function loadJsonFromPath(root, path) {
    return new Promise((resolve, reject) => {
        loadJsonFromPath_(root, path, resolve, reject);
    })
}

/**
 * Load a model - shouldn't used directly
 * @see loadJsonFromPath
 * @ignore
 */
function loadJsonFromPath_(root, path, resolve, reject, forceLoad) {
    if (modelCache.hasOwnProperty(path)) {
        if (modelCache[path] === "__invalid") {
            reject();
            return;
        }
        resolve(Object.assign({}, modelCache[path]));
        return;
    }

    if (!modelCallbacks.hasOwnProperty(path) || modelCallbacks[path].length === 0 || forceLoad) {
        $.ajax(root + path)
            .done((data) => {
                modelCache[path] = data;

                if (modelCallbacks.hasOwnProperty(path)) {
                    while (modelCallbacks[path].length > 0) {
                        let dataCopy = Object.assign({}, data);
                        let cb = modelCallbacks[path].shift(0);
                        cb[0](dataCopy);
                    }
                }
            })
            .fail(() => {
                if (DEFAULT_ROOT === root) {
                    modelCache[path] = "__invalid";

                    if (modelCallbacks.hasOwnProperty(path)) {
                        while (modelCallbacks[path].length > 0) {
                            let cb = modelCallbacks[path].shift(0);
                            cb[1]();
                        }
                    }
                } else {
                    // Try again with default root
                    loadJsonFromPath_(DEFAULT_ROOT, path, resolve, reject, true);
                }
            });

        if (!modelCallbacks.hasOwnProperty(path))
            modelCallbacks[path] = [];
    }

    modelCallbacks[path].push([resolve, reject]);
}

/**
 * Scales UV values
 * @param {number} uv UV value
 * @param {number} size
 * @param {number} [scale=16]
 * @returns {number}
 */
export function scaleUv(uv, size, scale) {
    if (uv === 0) return 0;
    return size / (scale || 16) * uv;
}
