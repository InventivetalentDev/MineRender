import * as THREE from "three";

require("three-instanced-mesh")(THREE);
import * as $ from 'jquery';
import merge from 'deepmerge'
import Render, { defaultOptions, deepDisposeMesh, mergeCubeMeshes } from "../renderBase";
import { loadTextureAsBase64, scaleUv, DEFAULT_ROOT, loadJsonFromPath, loadBlockState, loadTextureMeta } from "../functions";
import ModelConverter from "./modelConverter";
import * as md5 from "md5";

import { parseModel, loadAndMergeModel, loadModelTexture, modelCacheKey, toRadians, deleteObjectProperties, loadTextures } from "./modelFunctions";

import work from 'webworkify-webpack';
import SkinRender from "../skin";
import off from "onscreen/lib/methods/off";

const ModelWorker = require.resolve("./ModelWorker.js");


String.prototype.replaceAll = function (search, replacement) {
    let target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};

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
const TINTS = ["lightgreen"];

const mergedModelCache = {};
const loadedTextureCache = {};
const modelInstances = {};

const textureCache = {};
const canvasCache = {};
const materialCache = {};
const geometryCache = {};
const instanceCache = {};

const animatedTextures = [];

/**
 * @see defaultOptions
 * @property {string} type alternative way to specify the model type (block/item)
 * @property {boolean} [centerCubes=false] center the cube's rotation point
 * @property {string} [assetRoot=DEFAULT_ROOT] root to get asset files from
 */
let defOptions = {
    camera: {
        type: "perspective",
        x: 35,
        y: 25,
        z: 20,
        target: [0, 0, 0]
    },
    type: "block",
    centerCubes: false,
    assetRoot: DEFAULT_ROOT,
    useWebWorkers: false
};

/**
 * A renderer for Minecraft models, i.e. blocks & items
 */
class ModelRender extends Render {

    /**
     * @param {Object} [options] The options for this renderer, see {@link defaultOptions}
     * @param {string} [options.assetRoot=DEFAULT_ROOT] root to get asset files from
     *
     * @param {HTMLElement} [element=document.body] DOM Element to attach the renderer to - defaults to document.body
     * @constructor
     */
    constructor(options, element) {
        super(options, defOptions, element);

        this.renderType = "ModelRender";

        this.models = [];
        this.instancePositionMap = {};
        this.attached = false;
    }

    /**
     * Does the actual rendering
     * @param {(string[]|Object[])} models Array of models to render - Either strings in the format <block|item>/<model name> or objects
     * @param {string} [models[].type=block] either 'block' or 'item'
     * @param {string} models[].model if 'type' is given, just the block/item name otherwise '<block|item>/<model name>'
     * @param {number[]} [models[].offset] [x,y,z] array of the offset
     * @param {number[]} [models[].rotation] [x,y,z] array of the rotation
     * @param {string} [models[].blockstate] name of a blockstate to be used to determine the models (only for blocks)
     * @param {string} [models[].variant=normal] if 'blockstate' is given, the block variant to use
     * @param {function} [cb] Callback when rendering finished
     */
    render(models, cb) {
        let modelRender = this;

        if (!modelRender.attached && !modelRender._scene) {// Don't init scene if attached, since we already have an available scene
            super.initScene(function () {
                // Animate textures
                for (let i = 0; i < animatedTextures.length; i++) {
                    animatedTextures[i]();
                }

                modelRender.element.dispatchEvent(new CustomEvent("modelRender", {detail: {models: modelRender.models}}));
            });
        } else {
            console.log("[ModelRender] is attached - skipping scene init");
        }

        let parsedModelList = [];

        parseModels(modelRender, models, parsedModelList)
            .then(() => loadAndMergeModels(modelRender, parsedModelList))
            .then(() => loadModelTextures(modelRender, parsedModelList))
            .then(() => doModelRender(modelRender, parsedModelList))
            .then((renderedModels) => {
                console.timeEnd("doModelRender");
                console.debug(renderedModels)
                if (typeof cb === "function") cb();
            })

    }

}


function parseModels(modelRender, models, parsedModelList) {
    console.time("parseModels");
    console.log("Parsing Models...");
    let parsePromises = [];
    for (let i = 0; i < models.length; i++) {
        let model = models[i];

        // parsePromises.push(parseModel(model, model, parsedModelList, modelRender.options.assetRoot))
        parsePromises.push(new Promise(resolve => {
            if (modelRender.options.useWebWorkers) {
                let w = work(ModelWorker);
                w.addEventListener('message', event => {
                    parsedModelList.push(...event.data.parsedModelList);
                    resolve();
                });
                w.postMessage({
                    func: "parseModel",
                    model: model,
                    modelOptions: model,
                    parsedModelList: parsedModelList,
                    assetRoot: modelRender.options.assetRoot
                })
            } else {
                parseModel(model, model, parsedModelList, modelRender.options.assetRoot).then(() => {
                    resolve();
                })
            }
        }))

    }

    return Promise.all(parsePromises);
}


function loadAndMergeModels(modelRender, parsedModelList) {
    console.timeEnd("parseModels");
    console.time("loadAndMergeModels");

    let jsonPromises = [];

    console.log("Loading Model JSON data & merging...");
    let uniqueModels = {};
    for (let i = 0; i < parsedModelList.length; i++) {
        let cacheKey = modelCacheKey(parsedModelList[i]);
        modelInstances[cacheKey] = (modelInstances[cacheKey] || 0) + 1;
        uniqueModels[cacheKey] = parsedModelList[i];
    }
    let uniqueModelList = Object.values(uniqueModels);
    console.debug(uniqueModelList.length + " unique models");
    for (let i = 0; i < uniqueModelList.length; i++) {
        jsonPromises.push(new Promise(resolve => {
            let model = uniqueModelList[i];
            let cacheKey = modelCacheKey(model);
            console.debug("loadAndMerge " + cacheKey);


            if (mergedModelCache.hasOwnProperty(cacheKey)) {
                resolve();
                return;
            }

            if (modelRender.options.useWebWorkers) {
                let w = work(ModelWorker);
                w.addEventListener('message', event => {
                    mergedModelCache[cacheKey] = event.data.mergedModel;
                    resolve();
                });
                w.postMessage({
                    func: "loadAndMergeModel",
                    model: model,
                    assetRoot: modelRender.options.assetRoot
                });
            } else {
                loadAndMergeModel(model, modelRender.options.assetRoot).then((mergedModel) => {
                    mergedModelCache[cacheKey] = mergedModel;
                    resolve();
                })
            }
        }))
    }

    return Promise.all(jsonPromises);
}

function loadModelTextures(modelRender, parsedModelList) {
    console.timeEnd("loadAndMergeModels");
    console.time("loadModelTextures");

    let texturePromises = [];

    console.log("Loading Textures...");
    let uniqueModels = {};
    for (let i = 0; i < parsedModelList.length; i++) {
        uniqueModels[modelCacheKey(parsedModelList[i])] = parsedModelList[i];
    }
    let uniqueModelList = Object.values(uniqueModels);
    console.debug(uniqueModelList.length + " unique models");
    for (let i = 0; i < uniqueModelList.length; i++) {
        texturePromises.push(new Promise(resolve => {
            let model = uniqueModelList[i];
            let cacheKey = modelCacheKey(model);
            console.debug("loadTexture " + cacheKey);
            let mergedModel = mergedModelCache[cacheKey];

            if (loadedTextureCache.hasOwnProperty(cacheKey)) {
                resolve();
                return;
            }

            if (!mergedModel) {
                console.warn("Missing merged model");
                console.warn(model.name);
                resolve();
                return;
            }

            if (!mergedModel.textures) {
                console.warn("The model doesn't have any textures!");
                console.warn("Please make sure you're using the proper file.");
                console.warn(model.name);
                resolve();
                return;
            }

            if (modelRender.options.useWebWorkers) {
                let w = work(ModelWorker);
                w.addEventListener('message', event => {
                    loadedTextureCache[cacheKey] = event.data.textures;
                    resolve();
                });
                w.postMessage({
                    func: "loadTextures",
                    textures: mergedModel.textures,
                    assetRoot: modelRender.options.assetRoot
                });
            } else {
                loadTextures(mergedModel.textures, modelRender.options.assetRoot).then((textures) => {
                    loadedTextureCache[cacheKey] = textures;
                    resolve();
                })
            }
        }))
    }


    return Promise.all(texturePromises);
}

function doModelRender(modelRender, parsedModelList) {
    console.timeEnd("loadModelTextures");
    console.time("doModelRender");

    console.log("Rendering Models...");

    let renderPromises = [];

    for (let i = 0; i < parsedModelList.length; i++) {
        renderPromises.push(new Promise(resolve => {
            let model = parsedModelList[i];

            let mergedModel = mergedModelCache[modelCacheKey(model)];
            let textures = loadedTextureCache[modelCacheKey(model)];

            let offset = model.offset || [0, 0, 0];
            let rotation = model.rotation || [0, 0, 0];
            let scale = model.scale || [1, 1, 1];

            if (model.options.hasOwnProperty("display")) {
                if (mergedModel.hasOwnProperty("display")) {
                    if (mergedModel.display.hasOwnProperty(model.options.display)) {
                        let displayData = mergedModel.display[model.options.display];

                        if (displayData.hasOwnProperty("translation")) {
                            offset = [offset[0] + displayData.translation[0], offset[1] + displayData.translation[1], offset[2] + displayData.translation[2]];
                        }
                        if (displayData.hasOwnProperty("rotation")) {
                            rotation = [rotation[0] + displayData.rotation[0], rotation[1] + displayData.rotation[1], rotation[2] + displayData.rotation[2]];
                        }
                        if (displayData.hasOwnProperty("scale")) {
                            scale = [displayData.scale[0], displayData.scale[1], displayData.scale[2]];
                        }

                    }
                }
            }


            renderModel(modelRender, mergedModel, textures, mergedModel.textures, model.type, model.name, model.variant, offset, rotation, scale).then((renderedModel) => {

                if (renderedModel.firstInstance) {
                    let container = new THREE.Object3D();
                    container.add(renderedModel.mesh);

                    modelRender.models.push(container);
                    modelRender.addToScene(container);
                }

                resolve(renderedModel);
            })
        }))
    }

    return Promise.all(renderPromises);
}


let renderModel = function (modelRender, model, textures, textureNames, type, name, variant, offset, rotation, scale) {
    return new Promise((resolve) => {
        if (model.hasOwnProperty("elements")) {// block OR item with block parent
            let modelKey = modelCacheKey({type: type, name: name, variant: variant});
            let instanceCount = modelInstances[modelKey];

            let applyModelTransforms = function (mesh, instanceIndex) {
                mesh.userData.modelType = type;
                mesh.userData.modelName = name;

                let _v3o = new THREE.Vector3();
                let _v3s = new THREE.Vector3();
                let _q = new THREE.Quaternion();

                let instanceInfo = {
                    key: modelKey,
                    index: instanceIndex,
                    offset: offset,
                    scale: scale,
                    rotation: rotation
                };

                if (rotation) {
                    mesh.setQuaternionAt(instanceIndex, _q.setFromEuler(new THREE.Euler(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]))));
                }
                if (offset) {
                    mesh.setPositionAt(instanceIndex, _v3o.set(offset[0], offset[1], offset[2]));
                    modelRender.instancePositionMap[offset[0] + "_" + offset[1] + "_" + offset[2]] = instanceInfo;
                }
                if (scale) {
                    mesh.setScaleAt(instanceIndex, _v3s.set(scale[0], scale[1], scale[2]));
                }

                mesh.needsUpdate();

                // mesh.position = _v3o;
                // Object.defineProperty(mesh.position,"x",{
                //     get:function () {
                //         return this._x||0;
                //     },
                //     set:function (x) {
                //         this._x=x;
                //         mesh.setPositionAt(instanceIndex, _v3o.set(x, this.y, this.z));
                //     }
                // });
                // Object.defineProperty(mesh.position,"y",{
                //     get:function () {
                //         return this._y||0;
                //     },
                //     set:function (y) {
                //         this._y=y;
                //         mesh.setPositionAt(instanceIndex, _v3o.set(this.x, y, this.z));
                //     }
                // });
                // Object.defineProperty(mesh.position,"z",{
                //     get:function () {
                //         return this._z||0;
                //     },
                //     set:function (z) {
                //         this._z=z;
                //         mesh.setPositionAt(instanceIndex, _v3o.set(this.x, this.y, z));
                //     }
                // })
                //
                // mesh.rotation = new THREE.Euler(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]));
                // Object.defineProperty(mesh.rotation,"x",{
                //     get:function () {
                //         return this._x||0;
                //     },
                //     set:function (x) {
                //         this._x=x;
                //         mesh.setQuaternionAt(instanceIndex, _q.setFromEuler(new THREE.Euler(toRadians(x), toRadians(this.y), toRadians(this.z))));
                //     }
                // });
                // Object.defineProperty(mesh.rotation,"y",{
                //     get:function () {
                //         return this._y||0;
                //     },
                //     set:function (y) {
                //         this._y=y;
                //         mesh.setQuaternionAt(instanceIndex, _q.setFromEuler(new THREE.Euler(toRadians(this.x), toRadians(y), toRadians(this.z))));
                //     }
                // });
                // Object.defineProperty(mesh.rotation,"z",{
                //     get:function () {
                //         return this._z||0;
                //     },
                //     set:function (z) {
                //         this._z=z;
                //         mesh.setQuaternionAt(instanceIndex, _q.setFromEuler(new THREE.Euler(toRadians(this.x), toRadians(this.y), toRadians(z))));
                //     }
                // });
                //
                // mesh.scale = _v3s;

                resolve({
                    mesh: mesh,
                    firstInstance: instanceIndex === 0
                });
            };

            let finalizeCubeModel = function (geometry, materials) {
                geometry.translate(-8, -8, -8);


                let cachedInstance;

                if (!instanceCache.hasOwnProperty(modelKey)) {
                    console.debug("Caching new model instance " + modelKey + " (with " + instanceCount + " instances)");
                    let newInstance = new THREE.InstancedMesh(
                        geometry,
                        materials,
                        instanceCount,
                        false,
                        false,
                        false);
                    cachedInstance = {
                        instance: newInstance,
                        index: 0
                    };
                    instanceCache[modelKey] = cachedInstance;
                    let _v3o = new THREE.Vector3();
                    let _v3s = new THREE.Vector3(1, 1, 1);
                    let _q = new THREE.Quaternion();

                    for (let i = 0; i < instanceCount; i++) {

                        newInstance.setQuaternionAt(i, _q);
                        newInstance.setPositionAt(i, _v3o);
                        newInstance.setScaleAt(i, _v3s);

                    }
                } else {
                    console.debug("Using cached instance (" + modelKey + ")");
                    cachedInstance = instanceCache[modelKey];

                }

                applyModelTransforms(cachedInstance.instance, cachedInstance.index++);
            };

            if (instanceCache.hasOwnProperty(modelKey)) {
                console.debug("Using cached model instance (" + modelKey + ")");
                let cachedInstance = instanceCache[modelKey];
                applyModelTransforms(cachedInstance.instance, cachedInstance.index++);
                return;
            }

            // Render the elements
            let promises = [];
            for (let i = 0; i < model.elements.length; i++) {
                let element = model.elements[i];

                // // From net.minecraft.client.renderer.block.model.BlockPart.java#47 - https://yeleha.co/2JcqSr4
                let fallbackFaces = {
                    down: {
                        uv: [element.from[0], 16 - element.to[2], element.to[0], 16 - element.from[2]],
                        texture: "#down"
                    },
                    up: {
                        uv: [element.from[0], element.from[2], element.to[0], element.to[2]],
                        texture: "#up"
                    },
                    north: {
                        uv: [16 - element.to[0], 16 - element.to[1], 16 - element.from[0], 16 - element.from[1]],
                        texture: "#north"
                    },
                    south: {
                        uv: [element.from[0], 16 - element.to[1], element.to[0], 16 - element.from[1]],
                        texture: "#south"
                    },
                    west: {
                        uv: [element.from[2], 16 - element.to[1], element.to[2], 16 - element.from[2]],
                        texture: "#west"
                    },
                    east: {
                        uv: [16 - element.to[2], 16 - element.to[1], 16 - element.from[2], 16 - element.from[1]],
                        texture: "#east"
                    }
                };

                promises.push(new Promise((resolve) => {
                    let baseName = name.replaceAll(" ", "_").replaceAll("-", "_").toLowerCase() + "_" + (element.__comment ? element.__comment.replaceAll(" ", "_").replaceAll("-", "_").toLowerCase() + "_" : "");
                    createCube(element.to[0] - element.from[0], element.to[1] - element.from[1], element.to[2] - element.from[2],
                        baseName + Date.now(),
                        element.faces, fallbackFaces, textures, textureNames, modelRender.options.assetRoot, baseName)
                        .then((cube) => {
                            cube.applyMatrix(new THREE.Matrix4().makeTranslation((element.to[0] - element.from[0]) / 2, (element.to[1] - element.from[1]) / 2, (element.to[2] - element.from[2]) / 2));
                            cube.applyMatrix(new THREE.Matrix4().makeTranslation(element.from[0], element.from[1], element.from[2]));

                            if (element.rotation) {
                                rotateAboutPoint(cube,
                                    new THREE.Vector3(element.rotation.origin[0], element.rotation.origin[1], element.rotation.origin[2]),
                                    new THREE.Vector3(element.rotation.axis === "x" ? 1 : 0, element.rotation.axis === "y" ? 1 : 0, element.rotation.axis === "z" ? 1 : 0),
                                    toRadians(element.rotation.angle));
                            }

                            resolve(cube);
                        })
                }));


            }

            Promise.all(promises).then((cubes) => {
                let mergedCubes = mergeCubeMeshes(cubes, true);
                mergedCubes.sourceSize = cubes.length;
                finalizeCubeModel(mergedCubes.geometry, mergedCubes.materials, cubes.length);
                for (let i = 0; i < cubes.length; i++) {
                    deepDisposeMesh(cubes[i], true);
                }
            })
        } else {// 2d item
            createPlane(name + "_" + Date.now(), textures).then((plane) => {
                if (offset) {
                    plane.applyMatrix(new THREE.Matrix4().makeTranslation(offset[0], offset[1], offset[2]))
                }
                if (rotation) {
                    plane.rotation.set(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]));
                }
                if (scale) {
                    plane.scale.set(scale[0], scale[1], scale[2]);
                }

                resolve({
                    mesh: plane,
                    firstInstance: true
                });
            })
        }
    })
};

function setVisibilityOfInstance(meshKey, visibleScale, instanceIndex, visible) {
    let instance = instanceCache[meshKey];
    if (instance && instance.instance) {
        let mesh = instance.instance;
        let newScale;
        if (visible) {
            if (visibleScale) {
                newScale = visibleScale;
            } else {
                newScale = [1, 1, 1];
            }
        } else {
            newScale = [0, 0, 0];
        }
        let _v3s = new THREE.Vector3();
        mesh.setScaleAt(instanceIndex, _v3s.set(newScale[0], newScale[1], newScale[2]));
        return mesh;
    }
}

function setVisibilityAtMulti(positions, visible) {
    let updatedMeshes = {};
    for (let pos of positions) {
        let info = this.instancePositionMap[pos[0] + "_" + pos[1] + "_" + pos[2]];
        if (info) {
            let mesh = setVisibilityOfInstance(info.key, info.scale, info.index, visible);
            if (mesh) {
                updatedMeshes[info.key] = mesh;
            }
        }
    }
    for (let mesh of Object.values(updatedMeshes)) {
        mesh.needsUpdate();
    }
}

function setVisibilityAt(x, y, z, visible) {
    setVisibilityAtMulti([[x, y, z]], visible);
}

ModelRender.prototype.setVisibilityAtMulti = setVisibilityAtMulti;
ModelRender.prototype.setVisibilityAt = setVisibilityAt;

function setVisibilityOfType(type, name, variant, visible) {
    let instance = instanceCache[modelCacheKey({type: type, name: name, variant: variant})];
    if (instance && instance.instance) {
        let mesh = instance.instance;
        mesh.visible = visible;
    }
}

ModelRender.prototype.setVisibilityOfType = setVisibilityOfType;

let createDot = function (c) {
    let dotGeometry = new THREE.Geometry();
    dotGeometry.vertices.push(new THREE.Vector3());
    let dotMaterial = new THREE.PointsMaterial({size: 5, sizeAttenuation: false, color: c});
    return new THREE.Points(dotGeometry, dotMaterial);
};

let createPlane = function (name, textures) {
    return new Promise((resolve) => {

        let materialLoaded = function (material, width, height) {
            let geometry = new THREE.PlaneGeometry(width, height);
            let plane = new THREE.Mesh(geometry, material);
            plane.name = name;
            plane.receiveShadow = true;

            resolve(plane);
        };

        if (textures) {
            let w = 0, h = 0;
            let promises = [];
            for (let t in textures) {
                if (textures.hasOwnProperty(t)) {
                    promises.push(new Promise((resolve) => {
                        let img = new Image();
                        img.onload = function () {
                            if (img.width > w) w = img.width;
                            if (img.height > h) h = img.height;
                            resolve(img);
                        };
                        img.src = textures[t];
                    }))
                }
            }
            Promise.all(promises).then((images) => {
                let canvas = document.createElement("canvas");
                canvas.width = w;
                canvas.height = h;
                let context = canvas.getContext("2d");

                for (let i = 0; i < images.length; i++) {
                    let img = images[i];
                    context.drawImage(img, 0, 0);
                }

                let data = canvas.toDataURL("image/png");
                let hash = md5(data);

                if (materialCache.hasOwnProperty(hash)) {// Use material from cache
                    console.debug("Using cached Material (" + hash + ")");
                    materialLoaded(materialCache[hash], w, h);
                    return;
                }

                let textureLoaded = function (texture) {
                    let material = new THREE.MeshBasicMaterial({
                        map: texture,
                        transparent: true,
                        side: THREE.DoubleSide,
                        alphaTest: 0.5,
                        name: name
                    });

                    // Add material to cache
                    console.debug("Caching Material " + hash);
                    materialCache[hash] = material;

                    materialLoaded(material, w, h);
                };

                if (textureCache.hasOwnProperty(hash)) {// Use texture to cache
                    console.debug("Using cached Texture (" + hash + ")");
                    textureLoaded(textureCache[hash]);
                    return;
                }

                console.debug("Pre-Caching Texture " + hash);
                textureCache[hash] = new THREE.TextureLoader().load(data, function (texture) {
                    texture.magFilter = THREE.NearestFilter;
                    texture.minFilter = THREE.NearestFilter;
                    texture.anisotropy = 0;
                    texture.needsUpdate = true;

                    console.debug("Caching Texture " + hash);
                    // Add texture to cache
                    textureCache[hash] = texture;

                    textureLoaded(texture);
                });
            });
        }

    })
};


/// From https://github.com/InventivetalentDev/SkinRender/blob/master/js/render/skin.js#L353
let createCube = function (width, height, depth, name, faces, fallbackFaces, textures, textureNames, assetRoot, baseName) {
    return new Promise((resolve) => {
        let geometryKey = width + "_" + height + "_" + depth;
        let geometry;
        if (geometryCache.hasOwnProperty(geometryKey)) {
            console.debug("Using cached Geometry (" + geometryKey + ")");
            geometry = geometryCache[geometryKey];
        } else {
            geometry = new THREE.BoxGeometry(width, height, depth);
            console.debug("Caching Geometry " + geometryKey);
            geometryCache[geometryKey] = geometry;
        }

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
                        // console.warn("Missing face: " + f + " in model " + name);
                        resolve(null);
                        return;
                    }
                    let face = faces[f];
                    let textureRef = face.texture.substr(1);
                    if (!textures.hasOwnProperty(textureRef) || !textures[textureRef]) {
                        console.warn("Missing texture '" + textureRef + "' for face " + f + " in model " + name);
                        resolve(null);
                        return;
                    }

                    let canvasKey = textureRef + "_" + f + "_" + baseName;

                    let processImgToCanvasData = (img) => {
                        let uv = face.uv;
                        if (!uv) {
                            // console.warn("Missing UV mapping for face " + f + " in model " + name + ". Using defaults");
                            uv = fallbackFaces[f].uv;
                        }

                        // Scale the uv values to match the image width, so we can support resource packs with higher-resolution textures
                        uv = [
                            scaleUv(uv[0], img.width),
                            scaleUv(uv[1], img.height),
                            scaleUv(uv[2], img.width),
                            scaleUv(uv[3], img.height)
                        ];


                        let canvas = document.createElement("canvas");
                        canvas.width = Math.abs(uv[2] - uv[0]);
                        canvas.height = Math.abs(uv[3] - uv[1]);

                        let context = canvas.getContext("2d");
                        context.drawImage(img, Math.min(uv[0], uv[2]), Math.min(uv[1], uv[3]), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

                        let tintColor;
                        if (face.hasOwnProperty("tintindex")) {
                            tintColor = TINTS[face.tintindex];
                        } else if (baseName.startsWith("water_")) {
                            tintColor = "blue";
                        }

                        if (tintColor) {
                            context.fillStyle = tintColor;
                            context.globalCompositeOperation = 'multiply';
                            context.fillRect(0, 0, canvas.width, canvas.height);

                            context.globalAlpha = 1;
                            context.globalCompositeOperation = 'destination-in';
                            context.drawImage(img, Math.min(uv[0], uv[2]), Math.min(uv[1], uv[3]), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);

                            // context.globalAlpha = 0.5;
                            // context.beginPath();
                            // context.fillStyle = "green";
                            // context.rect(0, 0, uv[2] - uv[0], uv[3] - uv[1]);
                            // context.fill();
                            // context.globalAlpha = 1.0;
                        }

                        let canvasData = context.getImageData(0, 0, canvas.width, canvas.height).data;
                        let hasTransparency = false;
                        for (let i = 3; i < (canvas.width * canvas.height); i += 4) {
                            if (canvasData[i] < 255) {
                                hasTransparency = true;
                                break;
                            }
                        }

                        let dataUrl = canvas.toDataURL("image/png");
                        let dataHash = md5(dataUrl);

                        let d = {
                            canvas: canvas,
                            data: canvasData,
                            dataUrl: dataUrl,
                            dataUrlHash: dataHash,
                            hasTransparency: hasTransparency,
                            width: canvas.width,
                            height: canvas.height
                        };
                        console.debug("Caching new canvas (" + canvasKey + "/" + dataHash + ")")
                        canvasCache[canvasKey] = d;
                        return d;
                    };

                    let loadTextureFromCanvas = (canvas) => {


                        let loadTextureDefault = function (canvas) {
                            let data = canvas.dataUrl;
                            let hash = canvas.dataUrlHash;
                            let hasTransparency = canvas.hasTransparency;

                            if (materialCache.hasOwnProperty(hash)) {// Use material from cache
                                console.debug("Using cached Material (" + hash + ", without meta)");
                                resolve(materialCache[hash]);
                                return;
                            }

                            let n = textureNames[textureRef];
                            if (n.startsWith("#")) {
                                n = textureNames[name.substr(1)];
                            }
                            console.debug("Pre-Caching Material " + hash + ", without meta");
                            materialCache[hash] = new THREE.MeshBasicMaterial({
                                map: null,
                                transparent: hasTransparency,
                                side: hasTransparency ? THREE.DoubleSide : THREE.FrontSide,
                                alphaTest: 0.5,
                                name: f + "_" + textureRef + "_" + n
                            });

                            let textureLoaded = function (texture) {
                                // Add material to cache
                                console.debug("Finalizing Cached Material " + hash + ", without meta");
                                materialCache[hash].map = texture;
                                materialCache[hash].needsUpdate = true;

                                resolve(materialCache[hash]);
                            };

                            if (textureCache.hasOwnProperty(hash)) {// Use texture from cache
                                console.debug("Using cached Texture (" + hash + ")");
                                textureLoaded(textureCache[hash]);
                                return;
                            }

                            console.debug("Pre-Caching Texture " + hash);
                            textureCache[hash] = new THREE.TextureLoader().load(data, function (texture) {
                                texture.magFilter = THREE.NearestFilter;
                                texture.minFilter = THREE.NearestFilter;
                                texture.anisotropy = 0;
                                texture.needsUpdate = true;

                                if (face.hasOwnProperty("rotation")) {
                                    texture.center.x = .5;
                                    texture.center.y = .5;
                                    texture.rotation = toRadians(face.rotation);
                                }

                                console.debug("Caching Texture " + hash);
                                // Add texture to cache
                                textureCache[hash] = texture;

                                textureLoaded(texture);
                            });
                        };

                        let loadTextureWithMeta = function (canvas, meta) {
                            let hash = canvas.dataUrlHash;
                            let hasTransparency = canvas.hasTransparency;

                            if (materialCache.hasOwnProperty(hash)) {// Use material from cache
                                console.debug("Using cached Material (" + hash + ", with meta)");
                                resolve(materialCache[hash]);
                                return;
                            }

                            console.debug("Pre-Caching Material " + hash + ", with meta");
                            materialCache[hash] = new THREE.MeshBasicMaterial({
                                map: null,
                                transparent: hasTransparency,
                                side: hasTransparency ? THREE.DoubleSide : THREE.FrontSide,
                                alphaTest: 0.5
                            });

                            let frametime = 1;
                            if (meta.hasOwnProperty("animation")) {
                                if (meta.animation.hasOwnProperty("frametime")) {
                                    frametime = meta.animation.frametime;
                                }
                            }

                            let parts = Math.floor(canvas.height / canvas.width);

                            console.log("Generating animated texture...");

                            let promises1 = [];
                            for (let i = 0; i < parts; i++) {
                                promises1.push(new Promise((resolve) => {
                                    let canvas1 = document.createElement("canvas");
                                    canvas1.width = canvas.width;
                                    canvas1.height = canvas.width;
                                    let context1 = canvas1.getContext("2d");
                                    context1.drawImage(canvas.canvas, 0, i * canvas.width, canvas.width, canvas.width, 0, 0, canvas.width, canvas.width);

                                    let data = canvas1.toDataURL("image/png");
                                    let hash = md5(data);

                                    if (textureCache.hasOwnProperty(hash)) {// Use texture to cache
                                        console.debug("Using cached Texture (" + hash + ")");
                                        resolve(textureCache[hash]);
                                        return;
                                    }

                                    console.debug("Pre-Caching Texture " + hash);
                                    textureCache[hash] = new THREE.TextureLoader().load(data, function (texture) {
                                        texture.magFilter = THREE.NearestFilter;
                                        texture.minFilter = THREE.NearestFilter;
                                        texture.anisotropy = 0;
                                        texture.needsUpdate = true;

                                        console.debug("Caching Texture " + hash + ", without meta");
                                        // add texture to cache
                                        textureCache[hash] = texture;

                                        resolve(texture);
                                    });
                                }));
                            }

                            Promise.all(promises1).then((textures) => {

                                let frameCounter = 0;
                                let textureIndex = 0;
                                animatedTextures.push(() => {// called on render
                                    if (frameCounter >= frametime) {
                                        frameCounter = 0;

                                        // Set new texture
                                        materialCache[hash].map = textures[textureIndex];

                                        textureIndex++;
                                    }
                                    if (textureIndex >= textures.length) {
                                        textureIndex = 0;
                                    }
                                    frameCounter += 0.1;// game ticks TODO: figure out the proper value for this
                                })

                                // Add material to cache
                                console.debug("Finalizing Cached Material " + hash + ", with meta");
                                materialCache[hash].map = textures[0];
                                materialCache[hash].needsUpdate = true;

                                resolve(materialCache[hash]);
                            });
                        };

                        if ((canvas.height > canvas.width) && (canvas.height % canvas.width === 0)) {// Taking a guess that this is an animated texture
                            let name = textureNames[textureRef];
                            if (name.startsWith("#")) {
                                name = textureNames[name.substr(1)];
                            }
                            if (name.indexOf("/") !== -1) {
                                name = name.substr(name.indexOf("/") + 1);
                            }
                            loadTextureMeta(name, assetRoot).then((meta) => {
                                loadTextureWithMeta(canvas, meta);
                            }).catch(() => {// Guessed wrong :shrug:
                                loadTextureDefault(canvas);
                            })
                        } else {
                            loadTextureDefault(canvas);
                        }
                    };


                    if (canvasCache.hasOwnProperty(canvasKey)) {
                        let cachedCanvas = canvasCache[canvasKey];

                        if (cachedCanvas.hasOwnProperty("img")) {
                            console.debug("Waiting for canvas image that's already loading (" + canvasKey + ")")
                            let img = cachedCanvas.img;
                            img.waitingForCanvas.push(function (canvas) {
                                loadTextureFromCanvas(canvas);
                            });
                        } else {
                            console.debug("Using cached canvas (" + canvasKey + ")")
                            loadTextureFromCanvas(canvasCache[canvasKey]);
                        }
                    } else {
                        let img = new Image();
                        img.onerror = function (err) {
                            console.warn(err);
                            resolve(null);
                        };
                        img.waitingForCanvas = [];
                        img.onload = function () {
                            let canvasData = processImgToCanvasData(img);
                            loadTextureFromCanvas(canvasData);

                            for (let c = 0; c < img.waitingForCanvas.length; c++) {
                                img.waitingForCanvas[c](canvasData);
                            }
                        };
                        console.debug("Pre-caching canvas (" + canvasKey + ")");
                        canvasCache[canvasKey] = {
                            img: img
                        };
                        img.src = textures[textureRef];
                    }
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

/// https://stackoverflow.com/questions/42812861/three-js-pivot-point/42866733#42866733
// obj - your object (THREE.Object3D or derived)
// point - the point of rotation (THREE.Vector3)
// axis - the axis of rotation (normalized THREE.Vector3)
// theta - radian value of rotation
function rotateAboutPoint(obj, point, axis, theta) {
    obj.position.sub(point); // remove the offset
    obj.position.applyAxisAngle(axis, theta); // rotate the POSITION
    obj.position.add(point); // re-add the offset

    obj.rotateOnAxis(axis, theta); // rotate the OBJECT
}

ModelRender.cache = {
    loadedTextures: loadedTextureCache,
    mergedModels: mergedModelCache,
    instanceCount: modelInstances,

    texture: textureCache,
    canvas: canvasCache,
    material: materialCache,
    geometry: geometryCache,
    instances: instanceCache,

    animated: animatedTextures,


    resetInstances: function () {
        deleteObjectProperties(modelInstances);
        deleteObjectProperties(instanceCache);
    },
    clearAll: function () {
        deleteObjectProperties(loadedTextureCache);
        deleteObjectProperties(mergedModelCache);
        deleteObjectProperties(modelInstances);
        deleteObjectProperties(textureCache);
        deleteObjectProperties(canvasCache);
        deleteObjectProperties(materialCache);
        deleteObjectProperties(geometryCache);
        deleteObjectProperties(instanceCache);
        animatedTextures.splice(0, animatedTextures.length);
    }
};
ModelRender.ModelConverter = ModelConverter;

if (typeof window !== "undefined") {
    window.ModelRender = ModelRender;
    window.ModelConverter = ModelConverter;
}
if (typeof global !== "undefined")
    global.ModelRender = ModelRender;

export default ModelRender;
