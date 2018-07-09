import * as THREE from "three";
import EffectComposer, { RenderPass, ShaderPass, CopyShader } from "@johh/three-effectcomposer";
import { SSAARenderPass, OrbitControls } from 'threejs-ext';
import * as $ from 'jquery';
import mergeDeep from "../lib/merge";
import { Base64 } from 'js-base64';

const colors = [
    0xFF0000,
    0x00FFFF,
    0x0000FF,
    0x000080,
    0xFF00FF,
    0x800080,
    0x808000,
    0x00FF00,
    0x008000,
    0xFFFF00,
    0x800000,
    0x008080,
];

const FACE_ORDER = ["east", "west", "up", "down", "south", "north"];

let defaultOptions = {
    showAxes: false,
    showGrid: false,
    controls: {
        enabled: true,
        zoom: true,
        rotate: true,
        pan: true
    },
    camera: {
        x: 35,
        y: 25,
        z: 20
    },
    canvas: {
        width: undefined,
        height: undefined
    },
    type: "block"
};

function ModelRender(models, options) {

    this.options = Object.assign({}, defaultOptions, options);
    this.element = this.options.element || document.body;

    initScene(this);

    let type = this.options.type;
    for (let i = 0; i < models.length; i++) {
        let model = models[i];

        let offset;
        let rotation;
        if (typeof model === "string") {
            let parsed = parseModelType(model);
            model = parsed.model;
            type = parsed.type;
        } else if (typeof model === "object") {
            if (model.hasOwnProperty("offset")) {
                offset = model["offset"];
            }
            if (model.hasOwnProperty("rotation")) {
                rotation = model["rotation"];
            }

            if (model.hasOwnProperty("type")) {
                type = model["type"];
            } else {
                let parsed = parseModelType(model["model"]);
                model = parsed.model;
                type = parsed.type;
            }

        }


        let modelRender = this;
        console.log("Loading model " + model + " of type " + type + "...");
        loadModel(model, type)
            .then(modelData => mergeParents(modelData))
            .then((mergedModel) => {
                console.log(mergedModel);
                loadTextures(mergedModel.textures).then((textures) => {
                    console.log(textures);

                    renderModel(modelRender, mergedModel, textures, model, offset, rotation);
                });
            });
    }
}

let parseModelType = function (string) {
    if (string.startsWith("block/")) {
        // if (type === "item") {
        //     throw new Error("Tried to mix block/item models");
        // }
        return {
            type: "block",
            model: string.substr("block/".length)
        }
    } else if (string.startsWith("item/")) {
        // if (type === "block") {
        //     throw new Error("Tried to mix item/block models");
        // }
        return {
            type: "item",
            model: string.substr("item/".length)
        }
    }
};

let initScene = function (modelRender) {
    // Scene INIT
    let scene = new THREE.Scene();
    modelRender._scene = scene;
    let camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 5, 100);
    modelRender._camera = camera;

    let renderer = new THREE.WebGLRenderer({alpha: true, antialias: true, preserveDrawingBuffer: true});
    modelRender._renderer = renderer;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    modelRender.element.appendChild(modelRender._canvas = renderer.domElement);

    let composer = new EffectComposer(renderer);
    modelRender._composer = composer;
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
        let width = modelRender.element ? modelRender.element.offsetWidth : window.innerWidth;
        let height = modelRender.element ? modelRender.element.offsetHeight : window.innerHeight;

        modelRender._resize(width, height);
    }, false)
    modelRender._resize = function (width, height) {
        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height);

        let pixelRatio = renderer.getPixelRatio();
        let newWidth = Math.floor(width / pixelRatio) || 1;
        let newHeight = Math.floor(height / pixelRatio) || 1;
        composer.setSize(newWidth, newHeight);
    };

    // Helpers
    if (modelRender.options.showAxes) {
        scene.add(new THREE.AxesHelper(50));
    }
    if (modelRender.options.showGrid) {
        scene.add(new THREE.GridHelper(100, 100));
    }

    let light = new THREE.AmbientLight(0xFFFFFF); // soft white light
    scene.add(light);

    // Init controls
    let controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = modelRender.options.controls.zoom;
    controls.enableRotate = modelRender.options.controls.rotate;
    controls.enablePan = modelRender.options.controls.pan;
    controls.target.set(0, 18, 0);

    // Set camera location & target
    camera.position.x = modelRender.options.camera.x;
    camera.position.y = modelRender.options.camera.y;
    camera.position.z = modelRender.options.camera.z;
    camera.lookAt(new THREE.Vector3(0, 18, 0));

    // Do the render!
    let animate = function () {
        modelRender._animId = requestAnimationFrame(animate);

        composer.render();
    };
    modelRender._animate = animate;

    animate();
};

let renderModel = function (modelRender, model, textures, name, offset, rotation) {

    // Render the elements
    for (let i = 0; i < model.elements.length; i++) {
        let element = model.elements[i];

        createCube(element.to[0] - element.from[0], element.to[1] - element.from[1], element.to[2] - element.from[2], name + "_" + Date.now(), element.faces, textures)
            .then((cube) => {
                let cubeGroup = new THREE.Object3D();
                cubeGroup.applyMatrix(new THREE.Matrix4().makeTranslation(element.from[0], element.from[1], element.from[2]));
                if (offset) {
                    cubeGroup.applyMatrix(new THREE.Matrix4().makeTranslation(offset[0], offset[1], offset[2]))
                }
                if (rotation) {
                    cubeGroup.rotation.set(rotation[0], rotation[1], rotation[2]);
                }

                // center
                cube.applyMatrix(new THREE.Matrix4().makeTranslation((element.to[0] - element.from[0]) / 2, (element.to[1] - element.from[1]) / 2, (element.to[2] - element.from[2]) / 2));


                cubeGroup.add(cube);
                modelRender._scene.add(cubeGroup);
            })

    }

};


/// From https://github.com/InventivetalentDev/SkinRender/blob/master/js/render/skin.js#L353
let createCube = function (width, height, depth, name, faces, textures) {
    return new Promise((resolve) => {
        let geometry = new THREE.BoxGeometry(width, height, depth);

        let materialsLoaded = function (materials) {
            let cube = new THREE.Mesh(geometry, materials);
            cube.name = name;
            cube.receiveShadow = true;

            resolve(cube);
        };
        if (textures) {
            let promises = [];
            for (let i = 0; i < 6; i++) {
                promises.push(new Promise((resolve) => {
                    let f = FACE_ORDER[i];
                    if (!faces.hasOwnProperty(f)) {
                        console.warn("Missing face: " + f + " in model " + name);
                        resolve(null);
                        return;
                    }
                    let face = faces[f];
                    let textureRef = face.texture.substr(1);

                    let img = new Image();
                    img.onload = function () {
                        let uv = face.uv;

                        let canvas = document.createElement("canvas");
                        canvas.width = uv[2] - uv[0];
                        canvas.height = uv[3] - uv[1];
                        let context = canvas.getContext("2d");
                        context.drawImage(img, uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1], 0, 0, uv[2] - uv[0], uv[3] - uv[1]);

                        let texture = new THREE.TextureLoader().load(canvas.toDataURL("image/png"), function () {
                            texture.magFilter = THREE.NearestFilter;
                            texture.minFilter = THREE.NearestFilter;
                            texture.anisotropy = 0;
                            texture.needsUpdate = true;

                            let material = new THREE.MeshPhongMaterial({
                                map: texture,
                                side: THREE.FrontSide
                            });

                            // mapUV(geometry, texture, face, i);

                            resolve(material);
                        });
                    };
                    img.src = textures[textureRef];

                }));
            }
            Promise.all(promises).then(materials => materialsLoaded(materials))
        } else {
            let materials = [];
            for (let i = 0; i < 6; i++) {
                materials.push(new THREE.MeshBasicMaterial({
                    color: colors[i + 2],
                    wireframe: true
                }))
            }
            materialsLoaded(materials);
        }

        // if (textures) {
        //     applyCubeTextureToGeometry(geometry, texture, uv, width, height, depth);
        // }


    })
};

let mapUV = function (geometry, texture, uv, i) {
    //TODO: don't guess the dimensions
    let w = texture.image ? texture.image.width : 16;
    let h = texture.image ? texture.image.height : 16;


    geometry.computeBoundingBox();
    geometry.faceVertexUvs[0][i] = [];
    geometry.faceVertexUvs[0][i + 1] = [];

    let tx1 = uv[0];
    let ty1 = uv[1];
    let tx2 = uv[2];
    let ty2 = uv[3];

    let flipX = false;
    let flipY = false;

    // /// The following is pretty much just a big mess of trial-end-error to get the mapping right...
    // if (i === 0) {// right
    //     tx1 += depth + width;
    //     ty1 -= depth + height;
    //     tx2 += depth + width + depth;
    //     ty2 -= depth;
    // }
    // if (i === 1) {// left
    //     tx1 += 0;
    //     ty1 -= depth + height;
    //     tx2 += depth;
    //     ty2 -= depth;
    // }
    // if (i === 2) {// top
    //     tx1 += depth;
    //     ty1 -= depth;
    //     tx2 += depth + width;
    //     ty2 -= 0;
    // }
    // if (i === 3) {// bottom
    //     tx1 += depth + width;
    //     ty1 -= depth;
    //     tx2 += depth + width + width;
    //     ty2 -= 0;
    //     // this will probably stab me in the back at some point... plz don't hate ~haylee
    //     flipY = true;
    // }
    // if (i === 4) {// front
    //     tx1 += depth;
    //     ty1 -= depth + height;
    //     tx2 += depth + width;
    //     ty2 -= depth;
    // }
    // if (i === 5) {// back
    //     tx1 += depth + width + depth;
    //     ty1 -= depth + height;
    //     tx2 += depth + width + depth + width;
    //     ty2 -= depth;
    // }

    tx1 /= w;
    ty1 /= h;
    tx2 /= w;
    ty2 /= h;

    let faceUvs = [
        new THREE.Vector2(tx1, ty2),
        new THREE.Vector2(tx1, ty1),
        new THREE.Vector2(tx2, ty1),
        new THREE.Vector2(tx2, ty2)
    ];

    // let temp;
    // if (flipY) {
    //     temp = faceUvs[i].slice(0);
    //     faceUvs[i][0] = temp[2];
    //     faceUvs[i][1] = temp[3];
    //     faceUvs[i][2] = temp[0];
    //     faceUvs[i][3] = temp[1]
    // }
    // if (flipX) {//flip x
    //     temp = faceUvs[i].slice(0);
    //     faceUvs[i][0] = temp[3];
    //     faceUvs[i][1] = temp[2];
    //     faceUvs[i][2] = temp[1];
    //     faceUvs[i][3] = temp[0]
    // }


    geometry.faceVertexUvs[0][i] = [faceUvs[0], faceUvs[1], faceUvs[3]];
    geometry.faceVertexUvs[0][i + 1] = [faceUvs[1], faceUvs[2], faceUvs[3]];

    geometry.uvsNeedUpdate = true;
};

let loadModel = function (model, type/* block OR item */) {
    return new Promise((resolve, reject) => {
        if (typeof model === "string") {
            if (model.startsWith("{") && model.endsWith("}")) {// JSON string
                resolve(JSON.parse(model));
            } else if (model.startsWith("http")) {// URL
                $.ajax(model).done((data) => {
                    resolve(data);
                })
            } else {// model name -> use local data
                let path = "/res/mc/assets/minecraft/models/" + (type || "block") + "/" + model + ".json";
                $.ajax(path).done((data) => {
                    resolve(data);
                });
            }
        } else if (typeof model === "object") {// JSON object
            resolve(model);
        } else {
            console.warn("Invalid model");
            reject();
        }
    });
};

let loadTextures = function (textures) {
    return new Promise((resolve) => {
        let promises = [];
        let filteredNames = [];

        let names = Object.keys(textures);
        for (let i = 0; i < names.length; i++) {
            let name = names[i];
            let texture = textures[name];
            if (texture.startsWith("#")) {// reference to another texture, no need to load
                continue;
            }
            filteredNames.push(name);
            promises.push(loadTexture(texture));
        }
        Promise.all(promises).then((textures) => {
            let mappedTextures = {};
            for (let i = 0; i < textures.length; i++) {
                mappedTextures[filteredNames[i]] = textures[i];
            }

            // Fill in the referenced textures
            for (let name in names) {
                if (!mappedTextures.hasOwnProperty(name) && textures.hasOwnProperty(name)) {
                    let ref = textures[name].substr(1);
                    mappedTextures[name] = mappedTextures[ref];
                }
            }

            resolve(mappedTextures);
        });
    })
};

let loadTexture = function (name) {
    return new Promise((resolve, reject) => {
        let path = "/res/mc/assets/minecraft/textures/" + name + ".png";

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

let mergeParents = function (model) {
    return new Promise((resolve, reject) => {
        mergeParents_(model, [], resolve, reject);
    });
};
let mergeParents_ = function (model, stack, resolve, reject) {
    stack.push(model);

    if (!model.hasOwnProperty("parent")) {// already at the highest parent
        let merged = {};
        for (let i = stack.length - 1; i >= 0; i--) {
            console.log(stack[i])
            merged = mergeDeep(merged, stack[i]);
        }

        resolve(merged);
        return;
    }

    let parent = model["parent"];
    delete model["parent"];// remove the child's parent so it will be replaced by the parent's parent

    let path = "/res/mc/assets/minecraft/models/" + parent + ".json";
    $.ajax(path).done((parentData) => {
        let mergedModel = Object.assign({}, model, parentData);
        mergeParents_(mergedModel, stack, resolve, reject);
    });

};

window.ModelRender = ModelRender;