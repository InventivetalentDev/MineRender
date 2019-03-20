import * as THREE from "three";
import Render, { defaultOptions } from "../renderBase";
import { loadTextureAsBase64, DEFAULT_ROOT } from "../functions";
import guiPositions from "./guiPositions";
import guiHelper from "./guiHelper";
import ModelRender from "../model";

/**
 * @see defaultOptions
 * @property {string} [assetRoot=DEFAULT_ROOT] root to get asset files from
 */
let defOptions = {
    controls: {
        enabled: true,
        zoom: true,
        rotate: false,
        pan: true
    },
    camera: {
        type: "perspective",
        x: 0,
        y: 0,
        z: 50,
        target: [0, 0, 0]
    },
    assetRoot: DEFAULT_ROOT
};

/**
 * A renderer for Minecraft GUIs
 */
class GuiRender extends Render {

    /**
     * @param {Object} [options] The options for this renderer, see {@link defaultOptions}
     * @param {string} [options.assetRoot=DEFAULT_ROOT] root to get asset files from
     *
     * @param {HTMLElement} [element=document.body] DOM Element to attach the renderer to - defaults to document.body
     * @constructor
     */
    constructor(options, element) {
        super(options, defOptions, element);

        this.renderType = "GuiRender";

        this.gui = null;
        this.attached = false;
    }

    /**
     * Does the actual rendering
     *
     * @param {(string[]|Object[])} layers Array of GUI layers - either strings or objects
     * @param {string} layers[].texture path to the layer's texture (starting at assets/minecraft/textures/), e.g. '/items/apple'
     * @param {number} [layers[].textureScale=1] scale of the given texture, can be used to get different sized textures aligned proerly
     * @param {number[]} [layers[].uv] [x1,y1,x2,y2] array UV mapping of the texture
     * @param {number[]} [layers[].pos=[0,0]] [x,y] array position of the layer
     *
     * @param {function} [cb] Callback when rendering finished
     */
    render(layers, cb) {
        let guiRender = this;

        if (!guiRender.attached && !guiRender._scene) {// Don't init scene if attached, since we already have an available scene
            super.initScene(function () {
                guiRender.element.dispatchEvent(new CustomEvent("guiRender", {detail: {gui: guiRender.gui}}));
            });

            guiRender._controls.target.set(0, 0, 0);
            guiRender._camera.lookAt(new THREE.Vector3(0, 0, 0));
        } else {
            console.log("[GuiRender] is attached - skipping scene init");
        }

        let promises = [];
        for (let i = 0; i < layers.length; i++) {
            promises.push(new Promise((resolve, reject) => {
                let layer = layers[i];
                if (typeof layer === "string") {
                    layer = {
                        texture: layer
                    }
                }
                if (!layer.textureScale) layer.textureScale = 1;

                loadTextureAsBase64(guiRender.options.assetRoot, "minecraft", "", layer.texture).then((url) => {
                    let imgDone = function (url) {
                        let texture = new THREE.TextureLoader().load(url, function () {
                            texture.magFilter = THREE.NearestFilter;
                            texture.minFilter = THREE.NearestFilter;
                            texture.anisotropy = 0;
                            texture.needsUpdate = true;

                            let material = new THREE.MeshBasicMaterial({
                                map: texture,
                                transparent: true,
                                side: THREE.DoubleSide,
                                alphaTest: 0.5
                            });

                            material.userData.layer = layer;

                            resolve(material);
                        })
                    };

                    if (!layer.uv) {
                        imgDone(url);
                    } else {
                        layer.uv = [
                            layer.uv[0] * layer.textureScale,
                            layer.uv[1] * layer.textureScale,
                            layer.uv[2] * layer.textureScale,
                            layer.uv[3] * layer.textureScale
                        ];

                        let img = new Image();
                        img.onload = function () {
                            let canvas = document.createElement("canvas");
                            canvas.width = layer.uv[2] - layer.uv[0];
                            canvas.height = layer.uv[3] - layer.uv[1];
                            let context = canvas.getContext("2d");
                            context.drawImage(img, layer.uv[0], layer.uv[1], layer.uv[2] - layer.uv[0], layer.uv[3] - layer.uv[1], 0, 0, layer.uv[2] - layer.uv[0], layer.uv[3] - layer.uv[1]);

                            imgDone(canvas.toDataURL("image/png"));
                        };
                        img.crossOrigin = "anonymous";
                        img.src = url;
                    }
                });
            }));
        }

        Promise.all(promises).then((materials) => {
            let planeGroup = new THREE.Object3D();

            let w = 0, h = 0;
            for (let i = 0; i < materials.length; i++) {
                let material = materials[i];

                let width = material.map.image.width;
                let height = material.map.image.height;


                let uv = material.userData.layer.uv;
                if (!uv) {
                    // default to full image size if uv isn't set
                    uv = [0, 0, width, height];
                }
                // uv = [
                //     uv[0]/4,
                //     uv[1]/4,
                //     uv[2]/4,
                //     uv[3]/4
                // ];

                let uvW = (uv[2] - uv[0]) / material.userData.layer.textureScale;
                let uvH = (uv[3] - uv[1]) / material.userData.layer.textureScale;

                if (uvW > w) w = uvW;
                if (uvH > h) h = uvH;

                let geometry = new THREE.PlaneGeometry(uvW, uvH);
                let plane = new THREE.Mesh(geometry, material);
                plane.name = material.userData.layer.texture.toLowerCase() + (material.userData.layer.name ? "_" + material.userData.layer.name.toLowerCase() : "");
                plane.position.set(0, 0, 0);

                plane.applyMatrix(new THREE.Matrix4().makeTranslation(uvW / 2, uvH / 2, 0));

                if (material.userData.layer.pos) {
                    plane.applyMatrix(new THREE.Matrix4().makeTranslation(material.userData.layer.pos[0], -uvH - material.userData.layer.pos[1], 0));
                } else {
                    plane.applyMatrix(new THREE.Matrix4().makeTranslation(0, -uvH, 0));
                }

                if (material.userData.layer.layer) {
                    plane.layers.set(material.userData.layer.layer);
                    guiRender._camera.layers.enable(material.userData.layer.layer);
                }


                planeGroup.add(plane);


                if (guiRender.options.showOutlines) {
                    let box = new THREE.BoxHelper(plane, 0xff0000);
                    planeGroup.add(box);

                    if (material.userData.layer.layer) {
                        box.layers.set(material.userData.layer.layer);
                    }

                }
            }

            planeGroup.applyMatrix(new THREE.Matrix4().makeTranslation(-w / 2, h / 2, 0));
            guiRender.addToScene(planeGroup);

            guiRender.gui = planeGroup;

            if (!guiRender.attached) {
                guiRender._camera.position.set(0, 0, Math.max(w, h));
                // https://stackoverflow.com/a/11278936
                guiRender._camera.fov = 2 * Math.atan(Math.max(w, h) / (2 * Math.max(w, h))) * (180 / Math.PI);
                guiRender._camera.updateProjectionMatrix();
            }

            if (typeof cb === "function") cb();
        });
    };
}

GuiRender.Positions = guiPositions;
GuiRender.Helper = guiHelper;

if (typeof window !== "undefined")
    window.GuiRender = GuiRender;
if (typeof global !== "undefined")
    global.GuiRender = GuiRender;


export default GuiRender;