/**
 * Default asset root
 * @type {string}
 */
export const DEFAULT_ROOT = "https://assets.mcasset.cloud/1.13";
/**
 * Texture cache
 * @type {Object.<string,string>}
 */
const textureCache = {};
/**
 * Texture callbacks
 * @type {Object.<string,function[]>}
 */
const textureCallbacks = {};

/**
 * Model cache
 * @type {Object.<string,string>}
 */
const modelCache = {};
/**
 * Model callbacks
 * @type {Object.<string,function[]>}
 */
const modelCallbacks = {};


/**
 * Loads a Mincraft texture an returns it as Base64
 *
 * @param {string} root Asset root, see {@link DEFAULT_ROOT}
 * @param {string} namespace Namespace, usually 'minecraft'
 * @param {string} dir Directory of the texture
 * @param {string} name Name of the texture
 * @returns {Promise<string>}
 */
export function loadTextureAsBase64(root, namespace, dir, name) {
    return new Promise((resolve, reject) => {
        loadTexture(root, namespace, dir, name, resolve, reject);
    })
};

/**
 * Load a texture as base64 - shouldn't be used directly
 * @see loadTextureAsBase64
 * @ignore
 */
function loadTexture(root, namespace, dir, name, resolve, reject, forceLoad) {
    let path = "/assets/" + namespace + "/textures" + dir + name + ".png";

    if (textureCache.hasOwnProperty(path)) {
        if (textureCache[path] === "__invalid") {
            reject();
            return;
        }
        resolve(textureCache[path]);
        return;
    }

    if (!textureCallbacks.hasOwnProperty(path) || textureCallbacks[path].length === 0 || forceLoad) {
        // https://gist.github.com/oliyh/db3d1a582aefe6d8fee9 / https://stackoverflow.com/questions/20035615/using-raw-image-data-from-ajax-request-for-data-uri
        let xhr = new XMLHttpRequest();
        xhr.open('GET', root + path, true);
        xhr.responseType = 'arraybuffer';
        xhr.onloadend = function () {
            if (xhr.status === 200) {
                let arr = new Uint8Array(xhr.response || xhr.responseText);
                let raw = String.fromCharCode.apply(null, arr);
                let b64 = btoa(raw);
                let dataURL = "data:image/png;base64," + b64;

                textureCache[path] = dataURL;

                if (textureCallbacks.hasOwnProperty(path)) {
                    while (textureCallbacks[path].length > 0) {
                        let cb = textureCallbacks[path].shift(0);
                        cb[0](dataURL);
                    }
                }
            } else {
                if (DEFAULT_ROOT === root) {
                    textureCache[path] = "__invalid";

                    if (textureCallbacks.hasOwnProperty(path)) {
                        while (textureCallbacks[path].length > 0) {
                            let cb = textureCallbacks[path].shift(0);
                            cb[1]();
                        }
                    }
                } else {
                    loadTexture(DEFAULT_ROOT, namespace, dir, name, resolve, reject, true)
                }
            }
        };
        xhr.send();

        // init array
        if (!textureCallbacks.hasOwnProperty(path))
            textureCallbacks[path] = [];
    }

    // add the promise callback
    textureCallbacks[path].push([resolve, reject]);
}


/**
 * Loads a blockstate file and returns the contained JSON
 * @param {string} state Name of the blockstate
 * @param {string} assetRoot Asset root, see {@link DEFAULT_ROOT}
 * @returns {Promise<object>}
 */
export function loadBlockState(state, assetRoot) {
    return loadJsonFromPath(assetRoot, "/assets/minecraft/blockstates/" + state + ".json")
};

export function loadTextureMeta(texture, assetRoot) {
    return loadJsonFromPath(assetRoot, "/assets/minecraft/textures/block/" + texture + ".png.mcmeta")
}

/**
 * Loads a model file and returns the contained JSON
 * @param {string} root Asset root, see {@link DEFAULT_ROOT}
 * @param {string} path Path to the model file
 * @returns {Promise<object>}
 */
export function loadJsonFromPath(root, path) {
    return new Promise((resolve, reject) => {
        loadJsonFromPath_(root, path, resolve, reject);
    })
}

/**
 * Load a model - shouldn't used directly
 * @see loadJsonFromPath
 * @ignore
 */
export function loadJsonFromPath_(root, path, resolve, reject, forceLoad) {
    if (modelCache.hasOwnProperty(path)) {
        if (modelCache[path] === "__invalid") {
            reject();
            return;
        }
        resolve(Object.assign({}, modelCache[path]));
        return;
    }

    if (!modelCallbacks.hasOwnProperty(path) || modelCallbacks[path].length === 0 || forceLoad) {
        console.log(root + path)
        fetch(root + path, {
            mode: "cors",
            redirect: "follow"
        })
            .then(response => response.json())
            .then(data => {
                console.log("json data:", data);
                modelCache[path] = data;

                if (modelCallbacks.hasOwnProperty(path)) {
                    while (modelCallbacks[path].length > 0) {
                        let dataCopy = Object.assign({}, data);
                        let cb = modelCallbacks[path].shift(0);
                        cb[0](dataCopy);
                    }
                }
            })
            .catch((err) => {
                console.warn(err);
                if (DEFAULT_ROOT === root) {
                    modelCache[path] = "__invalid";

                    if (modelCallbacks.hasOwnProperty(path)) {
                        while (modelCallbacks[path].length > 0) {
                            let cb = modelCallbacks[path].shift(0);
                            cb[1]();
                        }
                    }
                } else {
                    // Try again with default root
                    loadJsonFromPath_(DEFAULT_ROOT, path, resolve, reject, true);
                }
            });

        if (!modelCallbacks.hasOwnProperty(path))
            modelCallbacks[path] = [];
    }

    modelCallbacks[path].push([resolve, reject]);
}

/**
 * Scales UV values
 * @param {number} uv UV value
 * @param {number} size
 * @param {number} [scale=16]
 * @returns {number}
 */
export function scaleUv(uv, size, scale) {
    if (uv === 0) return 0;
    return size / (scale || 16) * uv;
}


// https://gist.github.com/remy/784508
export function trimCanvas(c) {
    let ctx = c.getContext('2d'),
        copy = document.createElement('canvas').getContext('2d'),
        pixels = ctx.getImageData(0, 0, c.width, c.height),
        l = pixels.data.length,
        i,
        bound = {
            top: null,
            left: null,
            right: null,
            bottom: null
        },
        x, y;

    for (i = 0; i < l; i += 4) {
        if (pixels.data[i + 3] !== 0) {
            x = (i / 4) % c.width;
            y = ~~((i / 4) / c.width);

            if (bound.top === null) {
                bound.top = y;
            }

            if (bound.left === null) {
                bound.left = x;
            } else if (x < bound.left) {
                bound.left = x;
            }

            if (bound.right === null) {
                bound.right = x;
            } else if (bound.right < x) {
                bound.right = x;
            }

            if (bound.bottom === null) {
                bound.bottom = y;
            } else if (bound.bottom < y) {
                bound.bottom = y;
            }
        }
    }

    let trimHeight = bound.bottom - bound.top,
        trimWidth = bound.right - bound.left,
        trimmed = ctx.getImageData(bound.left, bound.top, trimWidth, trimHeight);

    copy.canvas.width = trimWidth;
    copy.canvas.height = trimHeight;
    copy.putImageData(trimmed, 0, 0);

    // open new window with trimmed image:
    return copy.canvas;
}