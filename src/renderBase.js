import { OrbitControls, SSAARenderPass } from "threejs-ext";
import EffectComposer, { RenderPass, ShaderPass, CopyShader } from "@johh/three-effectcomposer";
import * as THREE from "three";

export function initScene(renderObj) {
    // Scene INIT
    let scene = new THREE.Scene();
    renderObj._scene = scene;
    let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 5, 500);
    renderObj._camera = camera;

    let renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: true});
    renderObj._renderer = renderer;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderObj.element.appendChild(renderObj._canvas = renderer.domElement);

    let composer = new EffectComposer(renderer);
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

    window.addEventListener("resize", function () {
        let width = renderObj.element ? renderObj.element.offsetWidth : window.innerWidth;
        let height = renderObj.element ? renderObj.element.offsetHeight : window.innerHeight;

        renderObj._resize(width, height);
    }, false)
    renderObj._resize = function (width, height) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height);

        let pixelRatio = renderer.getPixelRatio();
        let newWidth = Math.floor(width / pixelRatio) || 1;
        let newHeight = Math.floor(height / pixelRatio) || 1;
        composer.setSize(newWidth, newHeight);
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
    renderObj._controls=controls;
    controls.enableZoom = renderObj.options.controls.zoom;
    controls.enableRotate = renderObj.options.controls.rotate;
    controls.enablePan = renderObj.options.controls.pan;
    controls.target.set(0, 18, 0);

    // Set camera location & target
    camera.position.x = renderObj.options.camera.x;
    camera.position.y = renderObj.options.camera.y;
    camera.position.z = renderObj.options.camera.z;
    camera.lookAt(new THREE.Vector3(0, 18, 0));

    // Do the render!
    let animate = function () {
        renderObj._animId = requestAnimationFrame(animate);

        composer.render();
    };
    renderObj._animate = animate;

    animate();
};

export function loadTextureAsBase64(namespace, dir, name) {
    return new Promise((resolve, reject) => {
        let path = "/res/mc/assets/" + namespace + "/textures" + dir + name + ".png";

        // https://gist.github.com/oliyh/db3d1a582aefe6d8fee9 / https://stackoverflow.com/questions/20035615/using-raw-image-data-from-ajax-request-for-data-uri
        let xhr = new XMLHttpRequest();
        xhr.open('GET', path, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
            let arr = new Uint8Array(this.response);
            let raw = String.fromCharCode.apply(null, arr);
            let b64 = btoa(raw);
            let dataURL = "data:image/png;base64," + b64;
            resolve(dataURL);
        };
        xhr.send();
    })
};
