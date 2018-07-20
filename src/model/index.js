import * as THREE from "three";
import * as $ from 'jquery';
import mergeDeep from "../lib/merge";
import Render, { loadTextureAsBase64, scaleUv, defaultOptions, DEFAULT_ROOT, loadJsonFromPath, loadBlockState, loadTextureMeta } from "../renderBase";
import ModelConverter from "./modelConverter";

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

const textureCache = {};

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

        let type = this.options.type;
        let promises = [];
        for (let i = 0; i < models.length; i++) {
            promises.push(new Promise((resolve) => {
                let model = models[i];

                let doModelLoad = function (model, type, offset, rotation, resolve) {
                    console.log("Loading model " + model + " of type " + type + "...");
                    loadModel(model, type, modelRender.options.assetRoot)
                        .then(modelData => mergeParents(modelData, modelRender.options.assetRoot))
                        .then((mergedModel) => {
                            if (!PRODUCTION) {
                                console.log("Merged Model: ");
                                console.log(mergedModel);
                            }

                            if (!mergedModel.textures) {
                                console.warn("The model doesn't have any textures!");
                                console.warn("Please make sure you're using the proper file.")
                                console.warn("(e.g. 'grass.json' is invalid - 'grass_normal.json' would be the correct file.");
                                return;
                            }

                            loadTextures(mergedModel.textures, modelRender.options.assetRoot).then((textures) => {
                                renderModel(modelRender, mergedModel, textures, mergedModel.textures, type, model, offset, rotation).then((renderedModel) => {
                                    modelRender.models.push(renderedModel);
                                    modelRender._scene.add(renderedModel);

                                    resolve();
                                })
                            });
                        });
                };

                let offset;
                let rotation;

                if (typeof model === "string") {
                    let parsed = parseModelType(model);
                    model = parsed.model;
                    type = parsed.type;

                    doModelLoad(model, type, offset, rotation, resolve);
                } else if (typeof model === "object") {
                    if (model.hasOwnProperty("offset")) {
                        offset = model["offset"];
                    }
                    if (model.hasOwnProperty("rotation")) {
                        rotation = model["rotation"];
                    }

                    if (model.hasOwnProperty("model")) {
                        if (model.hasOwnProperty("type")) {
                            type = model["type"];
                        } else {
                            let parsed = parseModelType(model["model"]);
                            model = parsed.model;
                            type = parsed.type;
                        }

                        doModelLoad(model, type, offset, rotation, resolve);
                    } else if (model.hasOwnProperty("blockstate")) {
                        type = "block";

                        loadBlockState(model.blockstate, modelRender.options.assetRoot).then((blockstate) => {
                            modelRender.blockstate = blockstate;

                            if (blockstate.hasOwnProperty("variants")) {

                                if (model.hasOwnProperty("variant")) {
                                    if (!blockstate.variants.hasOwnProperty(model.variant)) {
                                        console.warn("Missing variant for " + model.blockstate + ": " + model.variant);
                                        return;
                                    }
                                    let variant = blockstate.variants[model.variant];


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
                                    doModelLoad(parsed.model, "block", offset, rotation, resolve);
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
                                    doModelLoad(parsed.model, "block", offset, rotation, resolve);
                                }
                            } else if (blockstate.hasOwnProperty("multipart")) {
                                let promises1 = [];

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
                                        promises1.push(new Promise((resolve) => {
                                            doModelLoad(parsed.model, "block", offset, rotation, resolve);
                                        }))
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
                                                    let expected = when[c];
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
                                            promises1.push(new Promise((resolve) => {
                                                doModelLoad(parsed.model, "block", offset, rotation, resolve);
                                            }))
                                        }
                                    }
                                }

                                Promise.all(promises1).then(() => {
                                    resolve();
                                })
                            }
                        })
                    }

                }


            }))
        }

        Promise.all(promises).then(() => {
            if (typeof cb === "function") cb();
        })
    };

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


let renderModel = function (modelRender, model, textures, textureNames, type, name, offset, rotation) {
    return new Promise((resolve) => {
        if (model.hasOwnProperty("elements")) {// block OR item with block parent
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
                let cubeGroup = new THREE.Object3D();


                for (let i = 0; i < cubes.length; i++) {
                    cubeGroup.add(cubes[i]);

                    if (modelRender.options.showOutlines) {
                        let geo = new THREE.WireframeGeometry(cubes[i].geometry);
                        let mat = new THREE.LineBasicMaterial({color: 0x000000, linewidth: 2});
                        let line = new THREE.LineSegments(geo, mat);

                        line.position.x = cubes[i].position.x;
                        line.position.y = cubes[i].position.y;
                        line.position.z = cubes[i].position.z;

                        line.rotation.x = cubes[i].rotation.x;
                        line.rotation.y = cubes[i].rotation.y;
                        line.rotation.z = cubes[i].rotation.z;

                        line.scale.set(1.01, 1.01, 1.01);

                        cubeGroup.add(line);


                        let box = new THREE.BoxHelper(cubes[i], 0xff0000);
                        cubeGroup.add(box);
                    }

                }


                let centerContainer = new THREE.Object3D();
                centerContainer.add(cubeGroup);

                centerContainer.applyMatrix(new THREE.Matrix4().makeTranslation(-8, -8, -8));

                // Note to self: apply rotation AFTER adding objects to it, or it'll just be ignored


                // if (modelRender.options.centerCubes) {
                //     cubeContainer.applyMatrix(new THREE.Matrix4().makeTranslation(-8, -8, -8));
                // }


                let rotationContainer = new THREE.Object3D();
                rotationContainer.add(centerContainer);

                if (offset) {
                    rotationContainer.applyMatrix(new THREE.Matrix4().makeTranslation(offset[0], offset[1], offset[2]))
                }

                if (rotation) {
                    rotationContainer.rotation.set(toRadians(rotation[0]), toRadians(Math.abs(rotation[0]) > 0 ? rotation[1] : -rotation[1]), toRadians(rotation[2]));
                }


                resolve(rotationContainer);
            })
        } else {// 2d item
            createPlane(name + "_" + Date.now(), textures).then((plane) => {
                resolve(plane);
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


                //TODO: figure out a good way to cache these
                new THREE.TextureLoader().load(canvas.toDataURL("image/png"), function (texture) {
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

                    materialLoaded(material, w, h);
                });
            });
        }

    })
};


/// From https://github.com/InventivetalentDev/SkinRender/blob/master/js/render/skin.js#L353
let createCube = function (width, height, depth, name, faces, fallbackFaces, textures, textureNames, assetRoot) {
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
                        canvas.width = uv[2] - uv[0];
                        canvas.height = uv[3] - uv[1];
                        let context = canvas.getContext("2d");
                        context.drawImage(img, uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1], 0, 0, uv[2] - uv[0], uv[3] - uv[1]);

                        if (face.hasOwnProperty("tintindex")) {
                            context.fillStyle = TINTS[face.tintindex];
                            context.globalCompositeOperation = 'multiply';
                            context.fillRect(0, 0, uv[2] - uv[0], uv[3] - uv[1]);

                            context.globalAlpha = 1;
                            context.globalCompositeOperation = 'destination-in';
                            context.drawImage(img, uv[0], uv[1], uv[2] - uv[0], uv[3] - uv[1], 0, 0, uv[2] - uv[0], uv[3] - uv[1]);

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
                            // TODO: figure out a good way to cache these
                            new THREE.TextureLoader().load(canvas.toDataURL("image/png"), function (texture) {
                                texture.magFilter = THREE.NearestFilter;
                                texture.minFilter = THREE.NearestFilter;
                                texture.anisotropy = 0;
                                texture.needsUpdate = true;

                                let material = new THREE.MeshBasicMaterial({
                                    map: texture,
                                    transparent: hasTransparency,
                                    side: hasTransparency ? THREE.DoubleSide : THREE.FrontSide,
                                    alphaTest: 0.5
                                });

                                resolve(material);
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

                                    new THREE.TextureLoader().load(canvas1.toDataURL("image/png"), function (texture) {
                                        texture.magFilter = THREE.NearestFilter;
                                        texture.minFilter = THREE.NearestFilter;
                                        texture.anisotropy = 0;
                                        texture.needsUpdate = true;

                                        resolve(texture);
                                    });
                                }));
                            }

                            Promise.all(promises1).then((textures) => {

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

                        if (canvas.height > canvas.width) {// Taking a guess that this is an animated texture
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


let mergeParents = function (model, assetRoot) {
    return new Promise((resolve, reject) => {
        mergeParents_(model, [], assetRoot, resolve, reject);
    });
};
let mergeParents_ = function (model, stack, assetRoot, resolve, reject) {
    stack.push(model);

    if (!model.hasOwnProperty("parent") || model["parent"] === "builtin/generated" || model["parent"] === "builtin/entity") {// already at the highest parent OR we reach the builtin parent which seems to be the hardcoded stuff that's not in the json files
        let merged = {};
        for (let i = stack.length - 1; i >= 0; i--) {
            merged = mergeDeep(merged, stack[i]);
        }

        resolve(merged);
        return;
    }

    let parent = model["parent"];
    delete model["parent"];// remove the child's parent so it will be replaced by the parent's parent

    loadJsonFromPath(assetRoot, "/assets/minecraft/models/" + parent + ".json").then((parentData) => {
        let mergedModel = Object.assign({}, model, parentData);
        mergeParents_(mergedModel, stack, assetRoot, resolve, reject);
    })

};

function toRadians(angle) {
    return angle * (Math.PI / 180);
}


window.ModelRender = ModelRender;
window.ModelConverter = ModelConverter;

export default ModelRender;