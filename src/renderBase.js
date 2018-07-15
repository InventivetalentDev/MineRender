import OrbitControls from "./lib/OrbitControls";
import { SSAARenderPass } from "threejs-ext";
import EffectComposer, { ShaderPass, CopyShader } from "@johh/three-effectcomposer";
import * as THREE from "three";
import OnScreen from "onscreen";

export const DEFAULT_ROOT = "https://minerender.org/res/mc";

const textureCache = {};

export const defaultOptions = {
    showAxes: false,
    showGrid: false,
    autoResize: false,
    controls: {
        enabled: true,
        zoom: true,
        rotate: true,
        pan: true
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

export function initScene(renderObj, renderCb, doNotAnimate) {
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

export function loadTextureAsBase64(root, namespace, dir, name) {
    return new Promise((resolve, reject) => {
        loadTexture(root, namespace, dir, name, resolve, reject);
    })
};

function loadTexture(root, namespace, dir, name, resolve, reject) {
    let path = root + "/assets/" + namespace + "/textures" + dir + name + ".png";

    if (textureCache.hasOwnProperty(path)) {
        resolve(textureCache[path]);
        return;
    }

    // https://gist.github.com/oliyh/db3d1a582aefe6d8fee9 / https://stackoverflow.com/questions/20035615/using-raw-image-data-from-ajax-request-for-data-uri
    let xhr = new XMLHttpRequest();
    xhr.open('GET', path, true);
    xhr.responseType = 'arraybuffer';
    xhr.onloadend = function () {
        if (xhr.status === 200) {
            let arr = new Uint8Array(this.response);
            let raw = String.fromCharCode.apply(null, arr);
            let b64 = btoa(raw);
            let dataURL = "data:image/png;base64," + b64;

            textureCache[path] = dataURL;

            resolve(dataURL);
        } else {
            loadTexture(DEFAULT_ROOT, namespace, dir, name, resolve, reject)
        }
    };
    xhr.send();
}

export function scaleUv(uv, size, scale) {
    if (uv === 0) return 0;
    return size / (scale || 16) * uv;
}

export function attachTo(self, target) {
    console.log("Attaching " + self.constructor.name + " to " + target.constructor.name);

    self._scene = target._scene;
    // self._camera = target._camera;
    // self._renderer = target._renderer;
    // self._composer = target._composer;
    // self._canvas = target._canvas;
    self.attached = true;
}