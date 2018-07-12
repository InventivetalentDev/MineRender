import * as THREE from "three";
import * as $ from 'jquery';
import mergeDeep from "../lib/merge";
import { loadTextureAsBase64, initScene } from "../renderBase";
import guiPositions from "./guiPositions";
import guiHelper from "./guiHelper";

let defaultOptions = {
    showOutlines: false,
    showAxes: false,
    controls: {
        enabled: true,
        zoom: true,
        rotate: false,
        pan: true
    },
    camera: {
        x: 0,
        y: 0,
        z: 50,
        target: [0, 0, 0]
    },
    canvas: {
        width: undefined,
        height: undefined
    },
};

let LAYER_OFFSET = 0.5;

function GuiRender(options,element) {

    this.options = Object.assign({}, defaultOptions, options);
    this.element = element || document.body;

    this.gui = null;
}

GuiRender.prototype.render = function (layers, cb) {
    let guiRender = this;

    initScene(this, function () {
        guiRender.element.dispatchEvent(new CustomEvent("guiRender", {detail: {gui: guiRender.gui}}));
    });

    guiRender._controls.target.set(0, 0, 0);
    guiRender._camera.lookAt(new THREE.Vector3(0, 0, 0));

    let promises = [];
    for (let i = 0; i < layers.length; i++) {
        promises.push(new Promise((resolve, reject) => {
            let layer = layers[i];
            if (typeof layer === "string") {
                layer = {
                    texture: layer
                }
            }

            loadTextureAsBase64("minecraft", "", layer.texture).then((url) => {

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
                    let img = new Image();
                    img.onload = function () {
                        let canvas = document.createElement("canvas");
                        canvas.width = layer.uv[2] - layer.uv[0];
                        canvas.height = layer.uv[3] - layer.uv[1];
                        let context = canvas.getContext("2d");
                        context.drawImage(img, layer.uv[0], layer.uv[1], layer.uv[2] - layer.uv[0], layer.uv[3] - layer.uv[1], 0, 0, layer.uv[2] - layer.uv[0], layer.uv[3] - layer.uv[1]);

                        imgDone(canvas.toDataURL("image/png"));
                    };
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

            if (width > w) w = width;
            if (height > h) h = height;

            let geometry = new THREE.PlaneGeometry(width, height);
            let plane = new THREE.Mesh(geometry, material);
            plane.name = material.userData.layer.texture.toLowerCase() + (material.userData.layer.name ? "_" + material.userData.layer.name.toLowerCase() : "");
            plane.position.set(0, 0, 0);

            console.log(plane.name);
            console.log(material.userData.layer.pos);

            let uv = material.userData.layer.uv;
            if (!uv) {
                // default to full image size if uv isn't set
                uv = [0, 0, width, height];
            }

            plane.applyMatrix(new THREE.Matrix4().makeTranslation((uv[2] - uv[0]) / 2, (uv[3] - uv[1]) / 2, 0));

            if (material.userData.layer.pos) {
                plane.applyMatrix(new THREE.Matrix4().makeTranslation(material.userData.layer.pos[0], -(uv[3] - uv[1]) - material.userData.layer.pos[1], (material.userData.layer.layer ? material.userData.layer.layer : i) * LAYER_OFFSET));
            } else {
                plane.applyMatrix(new THREE.Matrix4().makeTranslation(0, 0, (material.userData.layer.layer ? material.userData.layer.layer : i) * LAYER_OFFSET));
            }

            planeGroup.add(plane);


            if (guiRender.options.showOutlines) {
                let box = new THREE.BoxHelper(plane, 0xff0000);
                planeGroup.add(box);
            }
        }

        planeGroup.applyMatrix(new THREE.Matrix4().makeTranslation(-w / 2, h / 2, 0));
        guiRender._scene.add(planeGroup);

        guiRender.gui = planeGroup;

        guiRender._camera.position.set(0, 0, Math.max(w, h));
        // https://stackoverflow.com/a/11278936
        guiRender._camera.fov = 2 * Math.atan(Math.max(w, h) / (2 * Math.max(w, h))) * (180 / Math.PI);
        guiRender._camera.updateProjectionMatrix();

        if (typeof cb === "function") cb();
    });
};

window.GuiRender = GuiRender;
window.GuiRender.Positions = guiPositions;
window.GuiRender.Helper = guiHelper;