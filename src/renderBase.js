import OrbitControls from "./lib/OrbitControls";
import { SSAARenderPass, OBJExporter, GLTFExporter, PLYExporter } from "threejs-ext";
import EffectComposer, { ShaderPass, CopyShader } from "@johh/three-effectcomposer";
import * as THREE from "three";
import OnScreen from "onscreen";
import * as $ from "jquery";
import { trimCanvas, DEFAULT_ROOT } from "./functions";

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
 * @property {string} [camera.type=perspective] Camera type
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
    forceContext: false,
    sendStats: true
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

        this.renderType = "_Base_";
    }

    /**
     * @param {boolean} [trim=false] whether to trim transparent pixels
     * @param {string} [mime=image/png] mime type of the image
     * @returns {string} The content of the renderer's canvas as a Base64 encoded image
     */
    toImage(trim, mime) {
        if (!mime) mime = "image/png";
        if (this._renderer) {
            if (!trim) {
                return this._renderer.domElement.toDataURL(mime);
            } else {
                // Clone the canvas onto a 2d context, so we can trim it properly
                let newCanvas = document.createElement('canvas');
                let context = newCanvas.getContext('2d');

                newCanvas.width = this._renderer.domElement.width;
                newCanvas.height = this._renderer.domElement.height;

                context.drawImage(this._renderer.domElement, 0, 0);

                let trimmed = trimCanvas(newCanvas);
                return trimmed.toDataURL(mime);
            }
        }
    };

    /**
     * Export the current scene content in the .obj format (only geometries, no textures)
     * @returns {string} the .obj file content
     */
    toObj() {
        if (this._scene) {
            let exporter = new OBJExporter();
            return exporter.parse(this._scene);
        }
    }

    /**
     * Export the current scene content in the .gltf format (geometries + textures)
     * @returns {Promise<any>} a promise which resolves with the .gltf file content
     */
    toGLTF(exportOptions) {
        return new Promise((resolve, reject) => {
            if (this._scene) {
                let exporter = new GLTFExporter();
                exporter.parse(this._scene, (gltf) => {
                    resolve(gltf);
                }, exportOptions)
            } else {
                reject();
            }
        })
    }

    toPLY(exportOptions) {
        if (this._scene) {
            let exporter = new PLYExporter();
            return exporter.parse(this._scene, exportOptions);
        }
    }

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
        console.log("MineRender/" + (renderObj.renderType || renderObj.constructor.name) + "/" + VERSION);
        console.log((PRODUCTION ? "PRODUCTION" : "DEVELOPMENT") + " build");
        console.log("Built @ " + BUILD_DATE);
        console.log(" ");

        if (renderObj.options.sendStats) {
            // Send stats

            let iframe = false;
            try {
                iframe = window.self !== window.top;
            } catch (e) {
                return true;
            }
            let hostname;
            try{
                hostname = new URL(iframe ? document.referrer : window.location).hostname;
            }catch (e) {
                console.warn("Failed to get hostname");
            }

            $.post({
                url: "https://minerender.org/stats.php",
                data: {
                    action: "init",
                    type: renderObj.renderType,
                    host: hostname,
                    source: (iframe ? "iframe" : "javascript")
                }
            });
        }

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

    /**
     * Adds an object to the scene & sets userData.renderType to this renderer's type
     * @param toAdd object to add
     */
    addToScene(toAdd) {
        let renderObj = this;
        if (renderObj._scene && toAdd) {
            toAdd.userData.renderType = renderObj.renderType;
            renderObj._scene.add(toAdd);
        }
    }

    /**
     * Clears the scene
     * @param onlySelfType whether to remove only objects whose type is equal to this renderer's type (useful for combined render)
     * @param filterFn Filter function to check which children of the scene to remove
     */
    clearScene(onlySelfType, filterFn) {
        if (onlySelfType || filterFn) {
            for (let i = this._scene.children.length - 1; i >= 0; i--) {
                let child = this._scene.children[i];
                if (filterFn) {
                    let shouldKeep = filterFn(child);
                    if (shouldKeep) {
                        continue;
                    }
                }
                if (onlySelfType) {
                    if (child.userData.renderType !== this.renderType) {
                        continue;
                    }
                }
                deepDisposeMesh(child, true);
                this._scene.remove(child);
            }
        } else {
            while (this._scene.children.length > 0) {
                this._scene.remove(this._scene.children[0]);
            }
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

// https://stackoverflow.com/questions/27217388/use-multiple-materials-for-merged-geometries-in-three-js/44485364#44485364
export function deepDisposeMesh(obj, removeChildren) {
    if (!obj) return;
    if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
    if (obj.material && obj.material.dispose) obj.material.dispose();
    if (obj.texture && obj.texture.dispose) obj.texture.dispose();
    if (obj.children) {
        let children = obj.children;
        for (let i = 0; i < children.length; i++) {
            deepDisposeMesh(children[i], removeChildren);
        }

        if (removeChildren) {
            for (let i = obj.children.length - 1; i >= 0; i--) {
                obj.remove(children[i]);
            }
        }
    }
}

export function mergeMeshes__(meshes, toBufferGeometry) {
    let finalGeometry,
        materials = [],
        mergedGeometry = new THREE.Geometry(),
        mergedMesh;

    meshes.forEach(function (mesh, index) {
        mesh.updateMatrix();
        mesh.geometry.faces.forEach(function (face) {
            face.materialIndex = 0;
        });
        mergedGeometry.merge(mesh.geometry, mesh.matrix, index);
        materials.push(mesh.material);
    });

    mergedGeometry.groupsNeedUpdate = true;

    if (toBufferGeometry) {
        finalGeometry = new THREE.BufferGeometry().fromGeometry(mergedGeometry);
    } else {
        finalGeometry = mergedGeometry;
    }

    mergedMesh = new THREE.Mesh(finalGeometry, materials);
    mergedMesh.geometry.computeFaceNormals();
    mergedMesh.geometry.computeVertexNormals();

    return mergedMesh;

}

export function mergeCubeMeshes(cubes, toBuffer) {
    cubes = cubes.filter(c => !!c);

    let mergedCubes = new THREE.Geometry();
    let mergedMaterials = [];
    for (let i = 0; i < cubes.length; i++) {
        let offset = i * Math.max(cubes[i].material.length, 1);
        mergedCubes.merge(cubes[i].geometry, cubes[i].matrix, offset);
        for (let j = 0; j < cubes[i].material.length; j++) {
            mergedMaterials.push(cubes[i].material[j]);
        }
        // for (let j = 0; j < cubes[i].geometry.faces.length; j++) {
        //     cubes[i].geometry.faces[j].materialIndex=offset-1+j;
        // }

        deepDisposeMesh(cubes[i], true);
    }
    mergedCubes.mergeVertices();
    return {
        geometry: toBuffer ? new THREE.BufferGeometry().fromGeometry(mergedCubes) : mergedCubes,
        materials: mergedMaterials
    };
}
