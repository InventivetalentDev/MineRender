import * as THREE from "three";

require("three-instanced-mesh")(THREE);
import * as $ from 'jquery';
import merge from 'deepmerge'
import Render, { loadTextureAsBase64, scaleUv, defaultOptions, DEFAULT_ROOT, loadJsonFromPath, loadBlockState, loadTextureMeta, mergeMeshes, deepDisposeMesh, mergeCubeMeshes } from "../renderBase";
import ModelConverter from "./modelConverter";
import * as md5 from "md5";

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

const parsedModelList = [];

const mergedModelCache = {};
const loadedTextureCache = {};
const modelInstances = {};

const textureCache = {};
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
    assetRoot: DEFAULT_ROOT
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

        parseModels(modelRender, models)
            .then(() => loadAndMergeModels(modelRender))
            .then(() => loadModelTextures(modelRender))
            .then(() => doModelRender(modelRender))
            .then((renderedModels) => {
                console.debug(renderedModels)
                if (typeof cb === "function") cb();
            })

    }

}


function parseModels(modelRender, models) {
    console.log("Parsing Models...");
    let parsePromises = [];
    for (let i = 0; i < models.length; i++) {
        let model = models[i];
        let modelOptions = model;


        parsePromises.push(new Promise(resolve => {
            let type = modelRender.options.type;
            let offset;
            let rotation;
            let scale;

            if (typeof model === "string") {
                let parsed = parseModelType(model);
                model = parsed.model;
                type = parsed.type;

                parsedModelList.push({
                    name: model,
                    type: type,
                    options: modelOptions
                });
                resolve();
            } else if (typeof model === "object") {
                if (model.hasOwnProperty("offset")) {
                    offset = model["offset"];
                }
                if (model.hasOwnProperty("rotation")) {
                    rotation = model["rotation"];
                }
                if (model.hasOwnProperty("scale")) {
                    scale = model["scale"];
                }

                if (model.hasOwnProperty("model")) {
                    if (model.hasOwnProperty("type")) {
                        type = model["type"];
                        model = model["model"];
                    } else {
                        let parsed = parseModelType(model["model"]);
                        model = parsed.model;
                        type = parsed.type;
                    }

                    parsedModelList.push({
                        name: model,
                        type: type,
                        offset: offset,
                        rotation: rotation,
                        scale: scale,
                        options: modelOptions
                    });
                    resolve();
                } else if (model.hasOwnProperty("blockstate")) {
                    type = "block";

                    loadBlockState(model.blockstate, modelRender.options.assetRoot).then((blockstate) => {
                        modelRender.blockstate = blockstate;

                        if (blockstate.hasOwnProperty("variants")) {

                            if (model.hasOwnProperty("variant")) {
                                let variantKey = findMatchingVariant(blockstate.variants, model.variant);
                                if (variantKey === null) {
                                    console.warn("Missing variant key for " + model.blockstate + ": " + model.variant);
                                    console.warn(blockstate.variants);
                                    resolve(null);
                                    return;
                                }
                                let variant = blockstate.variants[variantKey];
                                if (!variant) {
                                    console.warn("Missing variant for " + model.blockstate + ": " + model.variant);
                                    resolve(null);
                                    return;
                                }

                                let variants = [];
                                if (!Array.isArray(variant)) {
                                    variants = [variant];
                                } else {
                                    variants = variant;
                                }

                                rotation = [0, 0, 0];

                                let v = variants[Math.floor(Math.random() * variants.length)];
                                if (variant.hasOwnProperty("x")) {
                                    rotation[0] = v.x;
                                }
                                if (variant.hasOwnProperty("y")) {
                                    rotation[1] = v.y;
                                }
                                if (variant.hasOwnProperty("z")) {// Not actually used by MC, but why not?
                                    rotation[2] = v.z;
                                }
                                let parsed = parseModelType(v.model);
                                parsedModelList.push({
                                    name: parsed.model,
                                    type: "block",
                                    variant: model.variant,
                                    offset: offset,
                                    rotation: rotation,
                                    scale: scale,
                                    options: modelOptions
                                });
                                resolve();
                            } else {
                                let variant;
                                if (blockstate.variants.hasOwnProperty("normal")) {
                                    variant = blockstate.variants.normal;
                                } else if (blockstate.variants.hasOwnProperty("")) {
                                    variant = blockstate.variants[""];
                                } else {
                                    variant = blockstate.variants[Object.keys(blockstate.variants)[0]]
                                }

                                let variants = [];
                                if (!Array.isArray(variant)) {
                                    variants = [variant];
                                } else {
                                    variants = variant;
                                }

                                rotation = [0, 0, 0];

                                let v = variants[Math.floor(Math.random() * variants.length)];
                                if (variant.hasOwnProperty("x")) {
                                    rotation[0] = v.x;
                                }
                                if (variant.hasOwnProperty("y")) {
                                    rotation[1] = v.y;
                                }
                                if (variant.hasOwnProperty("z")) {// Not actually used by MC, but why not?
                                    rotation[2] = v.z;
                                }
                                let parsed = parseModelType(v.model);
                                parsedModelList.push({
                                    name: parsed.model,
                                    type: "block",
                                    variant: model.variant,
                                    offset: offset,
                                    rotation: rotation,
                                    scale: scale,
                                    options: modelOptions
                                })
                                resolve();
                            }
                        } else if (blockstate.hasOwnProperty("multipart")) {
                            for (let j = 0; j < blockstate.multipart.length; j++) {
                                let cond = blockstate.multipart[j];
                                let apply = cond.apply;
                                let when = cond.when;

                                rotation = [0, 0, 0];

                                if (!when) {
                                    if (apply.hasOwnProperty("x")) {
                                        rotation[0] = apply.x;
                                    }
                                    if (apply.hasOwnProperty("y")) {
                                        rotation[1] = apply.y;
                                    }
                                    if (apply.hasOwnProperty("z")) {// Not actually used by MC, but why not?
                                        rotation[2] = apply.z;
                                    }
                                    let parsed = parseModelType(apply.model);
                                    parsedModelList.push({
                                        name: parsed.model,
                                        type: "block",
                                        offset: offset,
                                        rotation: rotation,
                                        scale: scale,
                                        options: modelOptions
                                    });
                                } else if (model.hasOwnProperty("multipart")) {
                                    let multipartConditions = model.multipart;

                                    let applies = false;
                                    if (when.hasOwnProperty("OR")) {
                                        for (let k = 0; k < when.OR.length; k++) {
                                            if (applies) break;
                                            for (let c in when.OR[k]) {
                                                if (applies) break;
                                                if (when.OR[k].hasOwnProperty(c)) {
                                                    let expected = when.OR[k][c];
                                                    let expectedArray = expected.split("|");

                                                    let given = multipartConditions[c];
                                                    for (let k = 0; k < expectedArray.length; k++) {
                                                        if (expectedArray[k] === given) {
                                                            applies = true;
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    } else {
                                        for (let c in when) {// this SHOULD be a single case, but iterating makes it a bit easier
                                            if (applies) break;
                                            if (when.hasOwnProperty(c)) {
                                                let expected = String(when[c]);
                                                let expectedArray = expected.split("|");

                                                let given = multipartConditions[c];
                                                for (let k = 0; k < expectedArray.length; k++) {
                                                    if (expectedArray[k] === given) {
                                                        applies = true;
                                                        break;
                                                    }
                                                }
                                            }
                                        }
                                    }

                                    if (applies) {
                                        if (apply.hasOwnProperty("x")) {
                                            rotation[0] = apply.x;
                                        }
                                        if (apply.hasOwnProperty("y")) {
                                            rotation[1] = apply.y;
                                        }
                                        if (apply.hasOwnProperty("z")) {// Not actually used by MC, but why not?
                                            rotation[2] = apply.z;
                                        }
                                        let parsed = parseModelType(apply.model);
                                        parsedModelList.push({
                                            name: parsed.model,
                                            type: "block",
                                            offset: offset,
                                            rotation: rotation,
                                            scale: scale,
                                            options: modelOptions
                                        })
                                    }
                                }
                            }

                            resolve();
                        }
                    });
                }

            }
        }))
    }

    return Promise.all(parsePromises);
}


function loadAndMergeModels(modelRender) {
    let jsonPromises = [];

    console.log("Loading Model JSON data & merging...");
    for (let i = 0; i < parsedModelList.length; i++) {
        jsonPromises.push(new Promise(resolve => {
            let model = parsedModelList[i];

            modelInstances[modelCacheKey(model)] = (modelInstances[modelCacheKey(model)] || 0) + 1;

            if (mergedModelCache.hasOwnProperty(modelCacheKey(model))) {
                resolve();
                return;
            }

            loadModel(model.name, model.type, modelRender.options.assetRoot)
                .then(modelData => mergeParents(modelData, model.name, modelRender.options.assetRoot))
                .then((mergedModel) => {
                    mergedModelCache[modelCacheKey(model)] = mergedModel;
                    resolve()
                });
        }))
    }

    return Promise.all(jsonPromises);
}

function loadModelTextures(modelRender) {
    let texturePromises = [];

    console.log("Loading Textures...");
    for (let i = 0; i < parsedModelList.length; i++) {
        texturePromises.push(new Promise(resolve => {
            let model = parsedModelList[i];
            let mergedModel = mergedModelCache[modelCacheKey(model)];

            if (loadedTextureCache.hasOwnProperty(modelCacheKey(model))) {
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

            loadTextures(mergedModel.textures, modelRender.options.assetRoot).then((textures) => {
                loadedTextureCache[modelCacheKey(model)] = textures;
                resolve();
            });
        }))
    }


    return Promise.all(texturePromises);
}

function doModelRender(modelRender) {
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
                    modelRender.models.push(renderedModel);
                    modelRender.addToScene(renderedModel.mesh);
                }

                resolve(renderedModel);
            })
        }))
    }

    return Promise.all(renderPromises);
}

function modelCacheKey(model) {
    return model.type + "__" + model.name /*+ "[" + (model.variant || "default") + "]"*/;
}

function findMatchingVariant(variants, selector) {
    if(!Array.isArray(variants)) variants = Object.keys(variants);

    if (!selector || selector === "" || selector.length === 0) return "";
    let selectorObj = variantStringToObject(selector);
    for (let i = 0; i < variants.length; i++) {
        let variantObj = variantStringToObject(variants[i]);

        let matches = true;
        for (let k in selectorObj) {
            if (selectorObj.hasOwnProperty(k)) {
                if (variantObj.hasOwnProperty(k)) {
                    if (selectorObj[k] !== variantObj[k]) {
                        matches = false;
                        break;
                    }
                }
            }
        }

        if (matches) return variants[i];
    }

    return null;
}

function variantStringToObject(str) {
    let split = str.split(",");
    let obj = {};
    for (let i = 0; i < split.length; i++) {
        let spl = split[i];
        let split1 = spl.split("=");
        obj[split1[0]] = split1[1];
    }
    return obj;
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
    return {
        type: "block",
        model: "string"
    }
};


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

                if (rotation) {
                    mesh.setQuaternionAt(instanceIndex, _q.setFromEuler(new THREE.Euler(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]))));
                }
                if (offset) {
                    mesh.setPositionAt(instanceIndex, _v3o.set(offset[0], offset[1], offset[2]));
                }
                if (scale) {
                    mesh.setScaleAt(instanceIndex, _v3s.set(scale[0], scale[1], scale[2]));
                }

                mesh.needsUpdate();

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
                    cachedInstance = instanceCache[modelKey] = {
                        instance: newInstance,
                        index: 0
                    };
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


                // let mergedCubeMesh = new THREE.Mesh(geometry, materials);
                // mergedCubeMesh.matrixAutoUpdate = false;
                // mergedCubeMesh.updateMatrix();
                //
                //
                // if (!willBeMerged) {
                //     let cubeGroup = new THREE.Object3D();
                //     cubeGroup.add(mergedCubeMesh);
                //
                //
                //     if (modelRender.options.showOutlines) {
                //         let box = new THREE.BoxHelper(mergedCubeMesh, 0xff0000);
                //         cubeGroup.add(box);
                //     }
                //
                //     let centerContainer = new THREE.Object3D();
                //     centerContainer.add(cubeGroup);
                //
                //     centerContainer.applyMatrix(new THREE.Matrix4().makeTranslation(-8, -8, -8));
                //
                //     // Note to self: apply rotation AFTER adding objects to it, or it'll just be ignored
                //
                //
                //     let rotationContainer = new THREE.Object3D();
                //     rotationContainer.add(centerContainer);
                //
                //     if (offset) {
                //         rotationContainer.applyMatrix(new THREE.Matrix4().makeTranslation(offset[0], offset[1], offset[2]))
                //     }
                //     if (rotation) {
                //         rotationContainer.rotation.set(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]));
                //     }
                //     if (scale) {
                //         rotationContainer.scale.set(scale[0], scale[1], scale[2]);
                //     }
                //
                //     resolve(rotationContainer);
                // } else {
                //
                //     mergedCubeMesh.applyMatrix(new THREE.Matrix4().makeTranslation(-8, -8, -8));
                //
                //     // Note to self: apply rotation AFTER adding objects to it, or it'll just be ignored
                //
                //     if (rotation) {
                //         mergedCubeMesh.applyMatrix(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]))));
                //         // mergedCubeMesh.rotation.set(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]));
                //     }
                //     if (offset) {
                //         // mergedCubeMesh.position.set(mergedCubeMesh.position.x+offset[0], mergedCubeMesh.position.y+offset[1], mergedCubeMesh.position.z+offset[2]);
                //         mergedCubeMesh.applyMatrix(new THREE.Matrix4().makeTranslation(offset[0], offset[1], offset[2]));
                //     }
                //     if (scale) {
                //         mergedCubeMesh.applyMatrix(new THREE.Matrix4().makeScale(scale[0], scale[1], scale[2]));
                //         // mergedCubeMesh.scale.set(scale[0], scale[1], scale[2]);
                //     }
                //     mergedCubeMesh.updateMatrix();
                //
                //     mergedCubeMesh.userData.beforeMergeSize = sourceSize;
                //
                //     resolve(mergedCubeMesh);
                //
                // }
            };

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
                    createCube(element.to[0] - element.from[0], element.to[1] - element.from[1], element.to[2] - element.from[2],
                        name.replaceAll(" ", "_").replaceAll("-", "_").toLowerCase() + "_" + (element.__comment ? element.__comment.replaceAll(" ", "_").replaceAll("-", "_").toLowerCase() + "_" : "") + Date.now(),
                        element.faces, fallbackFaces, textures, textureNames, modelRender.options.assetRoot)
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
                console.debug("Caching Model " + modelKey);
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
let createCube = function (width, height, depth, name, faces, fallbackFaces, textures, textureNames, assetRoot) {
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
                        console.warn("Missing face: " + f + " in model " + name);
                        resolve(null);
                        return;
                    }
                    let face = faces[f];
                    let textureRef = face.texture.substr(1);
                    if (!textures.hasOwnProperty(textureRef)) {
                        console.warn("Missing texture '" + textureRef + "' for face " + f + " in model " + name);
                        resolve(null);
                        return;
                    }

                    let img = new Image();
                    img.onload = function () {
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

                        if (face.hasOwnProperty("tintindex")) {
                            context.fillStyle = TINTS[face.tintindex];
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

                        let loadTextureDefault = function (canvas) {
                            let data = canvas.toDataURL("image/png");
                            let hash = md5(data);

                            if (materialCache.hasOwnProperty(hash)) {// Use material from cache
                                console.debug("Using cached Material (" + hash + ")");
                                resolve(materialCache[hash]);
                                return;
                            }

                            let textureLoaded = function (texture) {
                                let n = textureNames[textureRef];
                                if (n.startsWith("#")) {
                                    n = textureNames[name.substr(1)];
                                }

                                let material = new THREE.MeshBasicMaterial({
                                    map: texture,
                                    transparent: hasTransparency,
                                    side: hasTransparency ? THREE.DoubleSide : THREE.FrontSide,
                                    alphaTest: 0.5,
                                    name: f + "_" + textureRef + "_" + n
                                });

                                // Add material to cache
                                console.debug("Caching Material " + hash);
                                materialCache[hash] = material;

                                resolve(material);
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
                            let frametime = 1;
                            if (meta.hasOwnProperty("animation")) {
                                if (meta.animation.hasOwnProperty("frametime")) {
                                    frametime = meta.animation.frametime;
                                }
                            }

                            let parts = Math.floor(canvas.height / canvas.width);

                            let promises1 = [];
                            for (let i = 0; i < parts; i++) {
                                promises1.push(new Promise((resolve) => {
                                    let canvas1 = document.createElement("canvas");
                                    canvas1.width = canvas.width;
                                    canvas1.height = canvas.width;
                                    let context1 = canvas1.getContext("2d");
                                    context1.drawImage(canvas, 0, i * canvas.width, canvas.width, canvas.width, 0, 0, canvas.width, canvas.width);

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

                                        console.debug("Caching Texture " + hash);
                                        // add texture to cache
                                        textureCache[hash] = texture;

                                        resolve(texture);
                                    });
                                }));
                            }

                            Promise.all(promises1).then((textures) => {

                                // Don't cache this material, since it's animated
                                let material = new THREE.MeshBasicMaterial({
                                    map: textures[0],
                                    transparent: hasTransparency,
                                    side: hasTransparency ? THREE.DoubleSide : THREE.FrontSide,
                                    alphaTest: 0.5
                                });

                                let frameCounter = 0;
                                let textureIndex = 0;
                                animatedTextures.push(() => {// called on render
                                    if (frameCounter >= frametime) {
                                        frameCounter = 0;

                                        // Set new texture
                                        material.map = textures[textureIndex];

                                        textureIndex++;
                                    }
                                    if (textureIndex >= textures.length) {
                                        textureIndex = 0;
                                    }
                                    frameCounter += 0.1;// game ticks TODO: figure out the proper value for this
                                })

                                resolve(material);
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

let loadModel = function (model, type/* block OR item */, assetRoot) {
    return new Promise((resolve, reject) => {
        if (typeof model === "string") {
            if (model.startsWith("{") && model.endsWith("}")) {// JSON string
                resolve(JSON.parse(model));
            } else if (model.startsWith("http")) {// URL
                $.ajax(model).done((data) => {
                    resolve(data);
                })
            } else {// model name -> use local data
                loadJsonFromPath(assetRoot, "/assets/minecraft/models/" + (type || "block") + "/" + model + ".json").then((data) => {
                    resolve(data);
                })
            }
        } else if (typeof model === "object") {// JSON object
            resolve(model);
        } else {
            console.warn("Invalid model");
            reject();
        }
    });
};

let loadTextures = function (textureNames, assetRoot) {
    return new Promise((resolve) => {
        let promises = [];
        let filteredNames = [];

        let names = Object.keys(textureNames);
        for (let i = 0; i < names.length; i++) {
            let name = names[i];
            let texture = textureNames[name];
            if (texture.startsWith("#")) {// reference to another texture, no need to load
                continue;
            }
            filteredNames.push(name);
            promises.push(loadTextureAsBase64(assetRoot, "minecraft", "/", texture));
        }
        Promise.all(promises).then((textures) => {
            let mappedTextures = {};
            for (let i = 0; i < textures.length; i++) {
                mappedTextures[filteredNames[i]] = textures[i];
            }

            // Fill in the referenced textures
            for (let i = 0; i < names.length; i++) {
                let name = names[i];
                if (!mappedTextures.hasOwnProperty(name) && textureNames.hasOwnProperty(name)) {
                    let ref = textureNames[name].substr(1);
                    mappedTextures[name] = mappedTextures[ref];
                }
            }

            resolve(mappedTextures);
        });
    })
};


let mergeParents = function (model, modelName, assetRoot) {
    return new Promise((resolve, reject) => {
        mergeParents_(model, modelName, [], [], assetRoot, resolve, reject);
    });
};
let mergeParents_ = function (model, name, stack, hierarchy, assetRoot, resolve, reject) {
    stack.push(model);

    if (!model.hasOwnProperty("parent") || model["parent"] === "builtin/generated" || model["parent"] === "builtin/entity") {// already at the highest parent OR we reach the builtin parent which seems to be the hardcoded stuff that's not in the json files
        let merged = {};
        for (let i = stack.length - 1; i >= 0; i--) {
            merged = merge(merged, stack[i]);
        }

        hierarchy.unshift(name);
        merged.hierarchy = hierarchy;
        resolve(merged);
        return;
    }

    let parent = model["parent"];
    delete model["parent"];// remove the child's parent so it will be replaced by the parent's parent
    hierarchy.push(parent);

    loadJsonFromPath(assetRoot, "/assets/minecraft/models/" + parent + ".json").then((parentData) => {
        let mergedModel = Object.assign({}, model, parentData);
        mergeParents_(mergedModel, name, stack, hierarchy, assetRoot, resolve, reject);
    })

};

function toRadians(angle) {
    return angle * (Math.PI / 180);
}

function deleteObjectProperties(obj) {
    Object.keys(obj).forEach(function (key) {
        delete obj[key];
    });
}


window.ModelRender = ModelRender;
window.ModelConverter = ModelConverter;
window.ModelRender.cache = {
    loadedTextures: loadedTextureCache,
    mergedModels: mergedModelCache,
    instanceCount: modelInstances,

    texture: textureCache,
    material: materialCache,
    geometry: geometryCache,
    instances: instanceCache,


    resetInstances: function () {
        deleteObjectProperties(modelInstances);
        deleteObjectProperties(instanceCache);
    },
    clearAll: function () {
        deleteObjectProperties(loadedTextureCache);
        deleteObjectProperties(mergedModelCache);
        deleteObjectProperties(modelInstances);
        deleteObjectProperties(textureCache);
        deleteObjectProperties(materialCache);
        deleteObjectProperties(geometryCache);
        deleteObjectProperties(instanceCache);
    }
};


export default ModelRender;