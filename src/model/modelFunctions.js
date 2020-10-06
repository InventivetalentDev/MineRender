import { loadBlockState, loadJsonFromPath, loadTextureAsBase64 } from "../functions";
import merge from "deepmerge";

export function parseModel(model, modelOptions, parsedModelList, assetRoot) {
    return new Promise(resolve => {
        let type = "block";
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
            resolve(parsedModelList);
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
                resolve(parsedModelList);
            } else if (model.hasOwnProperty("blockstate")) {
                type = "block";

                loadBlockState(model.blockstate, assetRoot).then((blockstate) => {
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
                            resolve(parsedModelList);
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
                            resolve(parsedModelList);
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

                        resolve(parsedModelList);
                    }
                }).catch(()=>{
                    resolve(parsedModelList);
                })
            }

        }
    })
}

export function loadAndMergeModel(model, assetRoot) {
    return loadModel(model.name, model.type, assetRoot)
        .then(modelData => mergeParents(modelData, model.name, assetRoot))
        .then(merged => {
            console.debug(model.name + " merged:");
            console.debug(merged);
            if (!merged.hasOwnProperty("elements")) {
                if (model.name === "lava" || model.name === "water") {
                    merged.elements = [
                        {
                            "from": [0, 0, 0],
                            "to": [16, 16, 16],
                            "faces": {
                                "down": {"texture": "#particle", "cullface": "down"},
                                "up": {"texture": "#particle", "cullface": "up"},
                                "north": {"texture": "#particle", "cullface": "north"},
                                "south": {"texture": "#particle", "cullface": "south"},
                                "west": {"texture": "#particle", "cullface": "west"},
                                "east": {"texture": "#particle", "cullface": "east"}
                            }
                        }
                    ]
                }
            }
            return merged;
        })
}



// Utils

export function modelCacheKey(model) {
    return model.type + "__" + model.name /*+ "[" + (model.variant || "default") + "]"*/;
}

export function findMatchingVariant(variants, selector) {
    if (!Array.isArray(variants)) variants = Object.keys(variants);

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

export function variantStringToObject(str) {
    let split = str.split(",");
    let obj = {};
    for (let i = 0; i < split.length; i++) {
        let spl = split[i];
        let split1 = spl.split("=");
        obj[split1[0]] = split1[1];
    }
    return obj;
}

export function parseModelType(string) {
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
}

export function loadModel(model, type/* block OR item */, assetRoot) {
    return new Promise((resolve, reject) => {
        if (typeof model === "string") {
            if (model.startsWith("{") && model.endsWith("}")) {// JSON string
                resolve(JSON.parse(model));
            } else if (model.startsWith("http")) {// URL
                fetch(model, {
                    mode: "cors",
                    redirect: "follow"
                })
                    .then(response => response.json())
                    .then(data => {
                        console.log("model data:", data);
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

export function loadTextures(textureNames, assetRoot) {
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


export function mergeParents(model, modelName, assetRoot) {
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
    }).catch(reject);

};

export function toRadians(angle) {
    return angle * (Math.PI / 180);
}

export function deleteObjectProperties(obj) {
    Object.keys(obj).forEach(function (key) {
        delete obj[key];
    });
}
