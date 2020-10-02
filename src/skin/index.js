import * as THREE from "three";

import texturePositions from "./texturePositions";
import Render, { defaultOptions } from "../renderBase";

/**
 * @see defaultOptions
 */
let defOptions = {
    camera: {
        type: "perspective",
        x: 20,
        y: 35,
        z: 20,
        target: [0, 18, 0]
    },
    makeNonTransparentOpaque: true
};

/**
 * A renderer for Minecraft player models/skins
 */
class SkinRender extends Render {

    /**
     * @param {Object} [options] The options for this renderer, see {@link defaultOptions}
     * @param {HTMLElement} [element=document.body] DOM Element to attach the renderer to - defaults to document.body
     * @constructor
     */
    constructor(options, element) {
        super(options, defOptions, element);

        this.renderType = "SkinRender";
        this._animId = -1;

        // bind this renderer to the element
        this.element.skinRender = this;
        this.attached = false;

    }


    /**
     * Does the actual rendering
     *
     * @param {(string|Object)} texture The texture to render - May be a string with the playername/URL/Base64 or an Object
     * @param {string} texture.url URL to the texture image
     * @param {string} texture.data Base64 encoded image data of the texture
     * @param {string} texture.username Player username
     * @param {string} texture.uuid Player UUID
     * @param {number} texture.mineskin ID of a MineSkin.org skin
     * @param {boolean} [texture.slim=false] Whether the provided texture uses the slim skin format
     *
     * @param {string} [texture.cape=latest] Cape to render using capes.dev - Either a direct link to the cape data (api.capes.dev/get/...) OR a specific cape type
     * @param {string} [texture.capeUser] Specify this to use a different user for the cape texture than the skin
     * @param {string} [texture.capeUrl] URL to a cape texture
     * @param {string} [texture.capeData] Base64 encoded image data of the cape texture
     * @param {string} [texture.mineskin] deprecated; ID of a MineSkin.org skin with a cape
     * @param {boolean} [texture.optifine=false] deprecated; Whether the provided cape texture is an optifine cape
     *
     * @param {function} [cb] Callback when rendering finished
     */
    render(texture, cb) {
        let skinRender = this;

        let renderStarted = false;

        let imagesLoaded = (skinTexture, capeTexture) => {
            renderStarted = true;
            skinTexture.needsUpdate = true;
            if (capeTexture) capeTexture.needsUpdate = true;

            let textureVersion = -1;
            if (skinTexture.image.height === 32) {
                textureVersion = 0;
            } else if (skinTexture.image.height === 64) {
                textureVersion = 1;
            } else {
                console.error("Couldn't detect texture version. Invalid dimensions: " + skinTexture.image.width + "x" + skinTexture.image.height)
            }
            console.log("Skin Texture Version: " + textureVersion)

            // To keep the pixelated texture
            skinTexture.magFilter = THREE.NearestFilter;
            skinTexture.minFilter = THREE.NearestFilter;
            skinTexture.anisotropy = 0;
            if (capeTexture) {
                capeTexture.magFilter = THREE.NearestFilter;
                capeTexture.minFilter = THREE.NearestFilter;
                capeTexture.anisotropy = 0;
                capeTexture.format = THREE.RGBFormat; // no transparency
            }

            if (skinTexture.image.height === 32) {
                skinTexture.format = THREE.RGBFormat; // 64x32 don't have transparency
            }

            if (!skinRender.attached && !skinRender._scene) {// Don't init scene if attached, since we already have an available scene
                super.initScene(function () {
                    skinRender.element.dispatchEvent(new CustomEvent("skinRender", {detail: {playerModel: skinRender.playerModel}}));
                });
            } else {
                console.log("[SkinRender] is attached - skipping scene init");
            }

            console.log("Slim: " + slim)
            let playerModel = createPlayerModel(skinTexture, capeTexture, textureVersion, slim, texture._capeType ? texture._capeType : texture.optifine ? "optifine" : "minecraft");
            skinRender.addToScene(playerModel);
            // console.log(playerModel);
            skinRender.playerModel = playerModel;

            if (typeof cb === "function") cb();
        }

        skinRender._skinImage = new Image();
        skinRender._skinImage.crossOrigin = "anonymous";
        skinRender._capeImage = new Image();
        skinRender._capeImage.crossOrigin = "anonymous";
        let hasCape = texture.cape !== undefined || texture.capeUrl !== undefined || texture.capeData !== undefined || texture.mineskin !== undefined;
        let slim = false;
        let skinLoaded = false;
        let capeLoaded = false;

        let skinTexture = new THREE.Texture();
        let capeTexture = new THREE.Texture();
        skinTexture.image = skinRender._skinImage;
        skinRender._skinImage.onload = function () {
            if (!skinRender._skinImage) return;

            skinLoaded = true;
            console.log("Skin Image Loaded");

            if (texture.slim === undefined) {
                if (skinRender._skinImage.height !== 32) {

                    let detectCanvas = document.createElement("canvas");
                    let detectCtx = detectCanvas.getContext("2d");
                    // detectCanvas.style.display = "none";
                    detectCanvas.width = skinRender._skinImage.width;
                    detectCanvas.height = skinRender._skinImage.height;
                    detectCtx.drawImage(skinRender._skinImage, 0, 0);

                    console.log("Slim Detection:")

                    // Check the 2 columns that should be transparent on slim skins
                    let px1 = detectCtx.getImageData(46, 52, 1, 12).data;
                    let px2 = detectCtx.getImageData(54, 20, 1, 12).data;
                    let allTransparent = true;
                    for (let i = 3; i < 12 * 4; i += 4) {
                        if (px1[i] === 255) {
                            allTransparent = false;
                            break;
                        }
                        if (px2[i] === 255) {
                            allTransparent = false;
                            break;
                        }
                    }
                    console.log(allTransparent)

                    if (allTransparent) slim = true;
                }
            }

            if (skinRender.options.makeNonTransparentOpaque && skinRender._skinImage.height !== 32) { // 64x32 don't have transparency
                let sourceCanvas = document.createElement("canvas");
                let sourceContext = sourceCanvas.getContext("2d");
                sourceCanvas.width = skinRender._skinImage.width;
                sourceCanvas.height = skinRender._skinImage.height;
                // draw skin texture
                sourceContext.drawImage(skinRender._skinImage, 0, 0);

                // remove partial transparency
                let opaqueCanvas = document.createElement("canvas");
                let opaqueContext = opaqueCanvas.getContext("2d");
                opaqueCanvas.width = skinRender._skinImage.width;
                opaqueCanvas.height = skinRender._skinImage.height;

                let imageData = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
                let pixels = imageData.data;

                function removeTransparency(x, y) {
                    if (x > 0 && y > 0 && x < 32 && y < 32) return true; // top left, face + right leg + half of body
                    if (x > 32 && y > 16 && x < 32 + 32 && y < 16 + 16) return true;// mid right, other body half + right arm
                    if (x > 16 && y > 48 && x < 16 + 32 && y < 48 + 16) return true;// bottom mid, left leg + left arm
                    return false;
                }

                // check every pixel for transparency
                for (let i = 0; i < pixels.length; i += 4) {
                    let a = pixels[i + 3];
                    let x = (i / 4) % sourceCanvas.width;
                    let y = Math.floor((i / 4) / sourceCanvas.width);
                    if (a > 178 || removeTransparency(x, y)) { // alpha over threshold OR area not supposed to have transparency at all
                        pixels[i + 3] = 255; // max the alpha
                    }
                }

                // update destination canvas
                opaqueContext.putImageData(imageData, 0, 0);

                console.log(opaqueCanvas.toDataURL())

                skinTexture = new THREE.CanvasTexture(opaqueCanvas);
            }

            if (skinLoaded && (capeLoaded || !hasCape)) {
                if (!renderStarted) imagesLoaded(skinTexture, capeTexture);
            }
        };
        skinRender._skinImage.onerror = function (e) {
            console.warn("Skin Image Error")
            console.warn(e)
        }
        console.log("Has Cape: " + hasCape)
        if (hasCape) {
            capeTexture.image = skinRender._capeImage;
            skinRender._capeImage.onload = function () {
                if (!skinRender._capeImage) return;

                capeLoaded = true;
                console.log("Cape Image Loaded");

                if (capeLoaded && skinLoaded) {
                    if (!renderStarted) imagesLoaded(skinTexture, capeTexture);
                }
            }
            skinRender._capeImage.onerror = function (e) {
                console.warn("Cape Image Error")
                console.warn(e);

                // Continue anyway, just without the cape
                capeLoaded = true;
                if (skinLoaded) {
                    if (!renderStarted) imagesLoaded(skinTexture);
                }
            }
        } else {
            capeTexture = null;
            skinRender._capeImage = null;
        }

        if (typeof texture === "string") {
            // console.log(texture)
            if (texture.indexOf("http") === 0) {// URL
                skinRender._skinImage.src = texture
            } else if (texture.length <= 16) {// Probably a Minecraft username
                getJSON("https://minerender.org/nameToUuid.php?name=" + texture, function (err, data) {
                    if (err) return console.log(err);
                    console.log(data);
                    skinRender._skinImage.src = "https://crafatar.com/skins/" + (data.id ? data.id : texture);
                });
            } else if (texture.length <= 36) {// Probably player UUID
                image.src = "https://crafatar.com/skins/" + texture + "?overlay";
            } else {// taking a guess that it's a Base64 image
                skinRender._skinImage.src = texture;
            }
        } else if (typeof texture === "object") {
            if (texture.url) {
                skinRender._skinImage.src = texture.url;
            } else if (texture.data) {
                skinRender._skinImage.src = texture.data;
            } else if (texture.username) {
                getJSON("https://minerender.org/nameToUuid.php?name=" + texture.username, function (err, data) {
                    if (err) return console.log(err);
                    skinRender._skinImage.src = "https://crafatar.com/skins/" + (data.id ? data.id : texture.username) + "?overlay";
                });
            } else if (texture.uuid) {
                skinRender._skinImage.src = "https://crafatar.com/skins/" + texture.uuid + "?overlay";
            } else if (texture.mineskin) {
                skinRender._skinImage.src = "https://api.mineskin.org/render/texture/" + texture.mineskin;
            }
            if (texture.cape) {
                if (texture.cape.length > 36) { // Likely either a cape ID or URL
                    let capeDataUrl = texture.cape.startsWith("http") ? texture.cape : "https://api.capes.dev/get/" + texture.cape;
                    getJSON(capeDataUrl, function (err, data) {
                        if (err) return console.log(err);
                        if (data.exists) {
                            texture._capeType = data.type;
                            skinRender._capeImage.src = data.imageUrls.base.full;
                        }
                    })
                } else { // Type
                    let capeLoadUrl = "https://api.capes.dev/load/";
                    if (texture.capeUser) {// Try to find a player to use
                        capeLoadUrl += texture.capeUser;
                    } else if (texture.username) {
                        capeLoadUrl += texture.username;
                    } else if (texture.uuid) {
                        capeLoadUrl += texture.uuid;
                    } else {
                        console.warn("Couldn't find a user to get a cape from");
                    }
                    capeLoadUrl += "/" + texture.cape; // append type

                    getJSON(capeLoadUrl, function (err, data) {
                        if (err) return console.log(err);
                        // Should be a single object of the requested type
                        if (data.exists) {
                            texture._capeType = data.type;
                            skinRender._capeImage.src = data.imageUrls.base.full;
                        }
                    })
                }
            } else if (texture.capeUrl) {
                skinRender._capeImage.src = texture.capeUrl;
            } else if (texture.capeData) {
                skinRender._capeImage.src = texture.capeData;
            } else if (texture.mineskin) {
                skinRender._capeImage.src = "https://api.mineskin.org/render/texture/" + texture.mineskin + "/cape";
            }

            slim = texture.slim;
        } else {
            throw new Error("Invalid texture value")
        }
    };


    resize(width, height) {
        return this._resize(width, height);
    };

    reset() {
        this._skinImage = null;
        this._capeImage = null;

        if (this._animId) {
            cancelAnimationFrame(this._animId);
        }
        if (this._canvas) {
            this._canvas.remove();
        }
    };

    getPlayerModel() {
        return this.playerModel;
    };


    getModelByName(name) {
        return this._scene.getObjectByName(name, true);
    };

    toggleSkinPart(name, visible) {
        this._scene.getObjectByName(name, true).visible = visible;
    };


}

function createCube(texture, width, height, depth, textures, slim, name, transparent) {
    let textureWidth = texture.image.width;
    let textureHeight = texture.image.height;

    let geometry = new THREE.BoxGeometry(width, height, depth);
    let material = new THREE.MeshBasicMaterial({
        /*color: 0x00ff00,*/map: texture, transparent: transparent || false, alphaTest: 0.1, side: transparent ? THREE.DoubleSide : THREE.FrontSide//TODO: double sided not working properly
    });

    geometry.computeBoundingBox();

    geometry.faceVertexUvs[0] = [];

    let faceNames = ["right", "left", "top", "bottom", "front", "back"];
    let faceUvs = [];
    for (let i = 0; i < faceNames.length; i++) {
        let face = textures[faceNames[i]];
        if (faceNames[i] === "back") {
            //     console.log(face)
            // console.log("X: " + (slim && face.sx ? face.sx : face.x))
            // console.log("W: " + (slim && face.sw ? face.sw : face.w))
        }
        let w = textureWidth;
        let h = textureHeight;
        let tx1 = ((slim && face.sx ? face.sx : face.x) / w);
        let ty1 = (face.y / h);
        let tx2 = (((slim && face.sx ? face.sx : face.x) + (slim && face.sw ? face.sw : face.w)) / w);
        let ty2 = ((face.y + face.h) / h);

        faceUvs[i] = [
            new THREE.Vector2(tx1, ty2),
            new THREE.Vector2(tx1, ty1),
            new THREE.Vector2(tx2, ty1),
            new THREE.Vector2(tx2, ty2)
        ];
        // console.log(faceUvs[i])

        let flipX = face.flipX;
        let flipY = face.flipY;

        let temp;
        if (flipY) {
            temp = faceUvs[i].slice(0);
            faceUvs[i][0] = temp[2];
            faceUvs[i][1] = temp[3];
            faceUvs[i][2] = temp[0];
            faceUvs[i][3] = temp[1]
        }
        if (flipX) {//flip x
            temp = faceUvs[i].slice(0);
            faceUvs[i][0] = temp[3];
            faceUvs[i][1] = temp[2];
            faceUvs[i][2] = temp[1];
            faceUvs[i][3] = temp[0]
        }
    }

    let j = 0;
    for (let i = 0; i < faceUvs.length; i++) {
        geometry.faceVertexUvs[0][j] = [faceUvs[i][0], faceUvs[i][1], faceUvs[i][3]];
        geometry.faceVertexUvs[0][j + 1] = [faceUvs[i][1], faceUvs[i][2], faceUvs[i][3]];
        j += 2;
    }
    geometry.uvsNeedUpdate = true;

    let cube = new THREE.Mesh(geometry, material);
    cube.name = name;
    // cube.position.set(x, y, z);
    cube.castShadow = true;
    cube.receiveShadow = false;

    return cube;
};


function createPlayerModel(skinTexture, capeTexture, v, slim, capeType) {
    console.log("capeType: " + capeType);

    let headGroup = new THREE.Object3D();
    headGroup.name = "headGroup";
    headGroup.position.x = 0;
    headGroup.position.y = 28;
    headGroup.position.z = 0;
    headGroup.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
    let head = createCube(skinTexture,
        8, 8, 8,
        texturePositions.head[v],
        slim,
        "head"
    );
    head.translateOnAxis(new THREE.Vector3(0, 1, 0), 4);
    headGroup.add(head);
    if (v >= 1) {
        let hat = createCube(skinTexture,
            8.504, 8.504, 8.504,
            texturePositions.hat,
            slim,
            "hat",
            true
        );
        hat.translateOnAxis(new THREE.Vector3(0, 1, 0), 4);
        headGroup.add(hat);
    }

    let bodyGroup = new THREE.Object3D();
    bodyGroup.name = "bodyGroup";
    bodyGroup.position.x = 0;
    bodyGroup.position.y = 18;
    bodyGroup.position.z = 0;
    let body = createCube(skinTexture,
        8, 12, 4,
        texturePositions.body[v],
        slim,
        "body"
    );
    bodyGroup.add(body);
    if (v >= 1) {
        let jacket = createCube(skinTexture,
            8.504, 12.504, 4.504,
            texturePositions.jacket,
            slim,
            "jacket",
            true
        );
        bodyGroup.add(jacket);
    }

    let leftArmGroup = new THREE.Object3D();
    leftArmGroup.name = "leftArmGroup";
    leftArmGroup.position.x = slim ? -5.5 : -6;
    leftArmGroup.position.y = 18;
    leftArmGroup.position.z = 0;
    leftArmGroup.translateOnAxis(new THREE.Vector3(0, 1, 0), 4);
    let leftArm = createCube(skinTexture,
        slim ? 3 : 4, 12, 4,
        texturePositions.leftArm[v],
        slim,
        "leftArm"
    );
    leftArm.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
    leftArmGroup.add(leftArm);
    if (v >= 1) {
        let leftSleeve = createCube(skinTexture,
            slim ? 3.504 : 4.504, 12.504, 4.504,
            texturePositions.leftSleeve,
            slim,
            "leftSleeve",
            true
        );
        leftSleeve.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
        leftArmGroup.add(leftSleeve);
    }

    let rightArmGroup = new THREE.Object3D();
    rightArmGroup.name = "rightArmGroup";
    rightArmGroup.position.x = slim ? 5.5 : 6;
    rightArmGroup.position.y = 18;
    rightArmGroup.position.z = 0;
    rightArmGroup.translateOnAxis(new THREE.Vector3(0, 1, 0), 4);
    let rightArm = createCube(skinTexture,
        slim ? 3 : 4, 12, 4,
        texturePositions.rightArm[v],
        slim,
        "rightArm"
    );
    rightArm.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
    rightArmGroup.add(rightArm);
    if (v >= 1) {
        let rightSleeve = createCube(skinTexture,
            slim ? 3.504 : 4.504, 12.504, 4.504,
            texturePositions.rightSleeve,
            slim,
            "rightSleeve",
            true
        );
        rightSleeve.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
        rightArmGroup.add(rightSleeve);
    }

    let leftLegGroup = new THREE.Object3D();
    leftLegGroup.name = "leftLegGroup";
    leftLegGroup.position.x = -2;
    leftLegGroup.position.y = 6;
    leftLegGroup.position.z = 0;
    leftLegGroup.translateOnAxis(new THREE.Vector3(0, 1, 0), 4);
    let leftLeg = createCube(skinTexture,
        4, 12, 4,
        texturePositions.leftLeg[v],
        slim,
        "leftLeg"
    );
    leftLeg.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
    leftLegGroup.add(leftLeg);
    if (v >= 1) {
        let leftTrousers = createCube(skinTexture,
            4.504, 12.504, 4.504,
            texturePositions.leftTrousers,
            slim,
            "leftTrousers",
            true
        );
        leftTrousers.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
        leftLegGroup.add(leftTrousers);
    }

    let rightLegGroup = new THREE.Object3D();
    rightLegGroup.name = "rightLegGroup";
    rightLegGroup.position.x = 2;
    rightLegGroup.position.y = 6;
    rightLegGroup.position.z = 0;
    rightLegGroup.translateOnAxis(new THREE.Vector3(0, 1, 0), 4);
    let rightLeg = createCube(skinTexture,
        4, 12, 4,
        texturePositions.rightLeg[v],
        slim,
        "rightLeg"
    );
    rightLeg.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
    rightLegGroup.add(rightLeg);
    if (v >= 1) {
        let rightTrousers = createCube(skinTexture,
            4.504, 12.504, 4.504,
            texturePositions.rightTrousers,
            slim,
            "rightTrousers",
            true
        );
        rightTrousers.translateOnAxis(new THREE.Vector3(0, 1, 0), -4);
        rightLegGroup.add(rightTrousers);
    }

    let playerGroup = new THREE.Object3D();
    playerGroup.add(headGroup);
    playerGroup.add(bodyGroup);
    playerGroup.add(leftArmGroup);
    playerGroup.add(rightArmGroup);
    playerGroup.add(leftLegGroup);
    playerGroup.add(rightLegGroup);

    if (capeTexture) {
        console.log(texturePositions);
        let capeTextureCoordinates = texturePositions.capeRelative;
        if (capeType === "optifine") {
            capeTextureCoordinates = texturePositions.capeOptifineRelative;
        }
        if (capeType === "labymod") {
            capeTextureCoordinates = texturePositions.capeLabymodRelative;
        }
        capeTextureCoordinates = JSON.parse(JSON.stringify(capeTextureCoordinates)); // bad clone to keep the below scaling from affecting everything

        console.log(capeTextureCoordinates);

        // Multiply coordinates by image dimensions
        for (let cord in capeTextureCoordinates) {
            capeTextureCoordinates[cord].x *= capeTexture.image.width;
            capeTextureCoordinates[cord].w *= capeTexture.image.width;
            capeTextureCoordinates[cord].y *= capeTexture.image.height;
            capeTextureCoordinates[cord].h *= capeTexture.image.height;
        }

        console.log(capeTextureCoordinates);

        let capeGroup = new THREE.Object3D();
        capeGroup.name = "capeGroup";
        capeGroup.position.x = 0;
        capeGroup.position.y = 16;
        capeGroup.position.z = -2.5;
        capeGroup.translateOnAxis(new THREE.Vector3(0, 1, 0), 8);
        capeGroup.translateOnAxis(new THREE.Vector3(0, 0, 1), 0.5);
        let cape = createCube(capeTexture,
            10, 16, 1,
            capeTextureCoordinates,
            false,
            "cape");
        cape.rotation.x = toRadians(10); // slight backward angle
        cape.translateOnAxis(new THREE.Vector3(0, 1, 0), -8);
        cape.translateOnAxis(new THREE.Vector3(0, 0, 1), -0.5);
        cape.rotation.y = toRadians(180); // flip front&back to be correct
        capeGroup.add(cape)

        playerGroup.add(capeGroup);
    }

    return playerGroup;
};

// From https://soledadpenades.com/articles/three-js-tutorials/drawing-the-coordinate-axes/
function buildAxes(length) {
    let axes = new THREE.Object3D();

    axes.add(buildAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(length, 0, 0), 0xFF0000, false)); // +X
    axes.add(buildAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-length, 0, 0), 0xFF0000, true)); // -X
    axes.add(buildAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, length, 0), 0x00FF00, false)); // +Y
    axes.add(buildAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -length, 0), 0x00FF00, true)); // -Y
    axes.add(buildAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, length), 0x0000FF, false)); // +Z
    axes.add(buildAxis(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -length), 0x0000FF, true)); // -Z

    return axes;

};

function buildAxis(src, dst, colorHex, dashed) {
    let geom = new THREE.Geometry(),
        mat;

    if (dashed) {
        mat = new THREE.LineDashedMaterial({linewidth: 3, color: colorHex, dashSize: 3, gapSize: 3});
    } else {
        mat = new THREE.LineBasicMaterial({linewidth: 3, color: colorHex});
    }

    geom.vertices.push(src.clone());
    geom.vertices.push(dst.clone());
    geom.computeLineDistances(); // This one is SUPER important, otherwise dashed lines will appear as simple plain lines

    return new THREE.Line(geom, mat, THREE.LinePieces);
};

function toRadians(angle) {
    return angle * (Math.PI / 180);
}

function getJSON(url, callback) {
    let xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'json';
    xhr.onload = function () {
        let status = xhr.status;
        let r = xhr.response || xhr.responseText;
        if (typeof r === "string") {
            r = JSON.parse(r);
        }
        if (status === 200) {
            callback(null, r);
        } else {
            callback(xhr.statusText, r);
        }
    };
    xhr.send();
}

if (typeof window !== "undefined")
    window.SkinRender = SkinRender;
if (typeof global !== "undefined")
    global.SkinRender = SkinRender;

export default SkinRender;
