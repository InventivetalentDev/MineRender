import * as THREE from "three";
import * as $ from 'jquery';
import merge from 'deepmerge'
import Render, { defaultOptions } from "../renderBase";
import { loadTextureAsBase64, scaleUv, DEFAULT_ROOT, loadJsonFromPath, loadBlockState, loadTextureMeta } from "../functions";
import GuiRender from "../gui";


const FACE_ORDER = ["left", "right", "top", "bottom", "front", "back"];


/**
 * @see defaultOptions
 * @property {string} [assetRoot=DEFAULT_ROOT] root to get asset files from
 */
let defOptions = {
    camera: {
        type: "perspective",
        x: 35,
        y: 25,
        z: 20,
        target: [0, 16, 0]
    },
    assetRoot: DEFAULT_ROOT
};

/**
 * A renderer for Minecraft entities
 */
class EntityRender extends Render {


    /**
     * @param {Object} [options] The options for this renderer, see {@link defaultOptions}
     * @param {string} [options.assetRoot=DEFAULT_ROOT] root to get asset files from
     *
     * @param {HTMLElement} [element=document.body] DOM Element to attach the renderer to - defaults to document.body
     * @constructor
     */
    constructor(options, element) {
        super(options, defOptions, element);

        this.renderType = "EntityRender";

        this.entities = [];
        this.attached = false;
    }


    render(entities, cb) {
        let entityRender = this;

        if (!entityRender.attached && !entityRender._scene) {// Don't init scene if attached, since we already have an available scene
            super.initScene(function () {
                entityRender.element.dispatchEvent(new CustomEvent("entityRender", {detail: {entities: entityRender.entities}}));
            });
        } else {
            console.log("[EntityRender] is attached - skipping scene init");
        }

        let promises = [];
        for (let i = 0; i < entities.length; i++) {
            promises.push(new Promise((resolve) => {
                let entity = entities[i];
                console.log(entity)

                if (typeof entity !== "object") {
                    entity = {
                        model: entity,
                        texture: entity,
                        textureScale: 1
                    }
                }

                if (!entity.textureScale) entity.textureScale = 1;

                getEntityModel(entity.model)
                    .then(modelData => mergeParents(modelData))
                    .then((mergedModel) => {
                        console.log("Merged:")
                        console.log(mergedModel)
                        loadTextureAsBase64(entityRender.options.assetRoot, "minecraft", "/entity/", entity.texture).then((texture) => {
                            new THREE.TextureLoader().load(texture, function (textureData) {
                                textureData.magFilter = THREE.NearestFilter;
                                textureData.minFilter = THREE.NearestFilter;
                                textureData.anisotropy = 0;
                                textureData.needsUpdate = true;

                                renderEntity(entityRender, mergedModel, textureData, entity.textureScale).then((renderedEntity) => {
                                    entityRender.addToScene(renderedEntity);
                                    entityRender.entities.push(renderedEntity);
                                    resolve();
                                })
                            });
                        }).catch(() => {
                            console.warn("Missing texture for entity " + entity.texture);
                        })
                    }).catch(() => {
                    console.warn("No model file found for entity " + entity.model);
                })
            }))
        }

        Promise.all(promises).then(() => {
            if (typeof cb === "function") cb();
        })
    }


}

function renderEntity(entityRender, modelData, texture, textureScale) {
    console.log(modelData)
    return new Promise((resolve) => {
        let entityGroup = new THREE.Object3D();
        for (let g in modelData.groups) {
            if (modelData.groups.hasOwnProperty(g)) {
                let group = modelData.groups[g];

                let cubeGroup = new THREE.Object3D();
                cubeGroup.name = group.name;

                if (group.pivot) {
                    cubeGroup.applyMatrix(new THREE.Matrix4().makeTranslation(group.pivot[0], group.pivot[1], group.pivot[2]));
                }
                if (group.pos) {// There's a pos tag and I have absolutely no idea why the f* it's even there, since it just messes up everything
                    // cubeGroup.applyMatrix(new THREE.Matrix4().makeTranslation(group.pos[0], group.pos[1], group.pos[2]))
                }
                if (group.rotation && group.rotation.length === 3) {
                    cubeGroup.rotation.x = group.rotation[0];
                    cubeGroup.rotation.y = group.rotation[1];
                    cubeGroup.rotation.z = group.rotation[2];
                }


                for (let i = 0; i < group.cubes.length; i++) {
                    let cube = group.cubes[i];

                    let cubeContainer = new THREE.Object3D();
                    cubeContainer.applyMatrix(new THREE.Matrix4().makeTranslation(cube.origin[0], cube.origin[1], -cube.origin[2]));
                    if (group.pivot)
                        cubeContainer.applyMatrix(new THREE.Matrix4().makeTranslation(-group.pivot[0], -group.pivot[1], -group.pivot[2]));


                    let cubeMesh = createCube(cube.size[0], cube.size[1], cube.size[2], group.name + "_" + i, cube.uv, 0x000000, texture, cube.mirror || group.mirror, textureScale);


                    cubeMesh.translateOnAxis(new THREE.Vector3(0, 0, 1), cube.size[2]);
                    // Center the cube
                    cubeMesh.applyMatrix(new THREE.Matrix4().makeTranslation(cube.size[0] / 2, cube.size[1] / 2, -cube.size[2] / 2));

                    cubeContainer.add(cubeMesh);

                    if (entityRender.options.showOutlines) {
                        let geo = new THREE.WireframeGeometry(cubeMesh.geometry);
                        let mat = new THREE.LineBasicMaterial({color: 0x000000, linewidth: 2});
                        let line = new THREE.LineSegments(geo, mat);
                        line.name = cubeMesh.name + "_outline";

                        line.position.x = cubeMesh.position.x;
                        line.position.y = cubeMesh.position.y;
                        line.position.z = cubeMesh.position.z;

                        line.rotation.x = cubeMesh.rotation.x;
                        line.rotation.y = cubeMesh.rotation.y;
                        line.rotation.z = cubeMesh.rotation.z;

                        line.scale.set(1.01, 1.01, 1.01);

                        cubeContainer.add(line);

                        let box = new THREE.BoxHelper(cubeMesh, 0xff0000);
                        cubeContainer.add(box);
                    }


                    cubeGroup.add(cubeContainer);
                }

                entityGroup.add(cubeGroup);
            }
        }

        resolve(entityGroup);
    })
}


let createCube = function (width, height, depth, name, uv, color, texture, mirror, textureScale) {
    let geometry = new THREE.BoxGeometry(width, height, depth);
    let material;
    if (texture) {
        material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.5
        });
    } else {
        material = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: true
        });
    }

    if (texture) {
        applyCubeTextureToGeometry(geometry, texture, uv, mirror, textureScale);
    }


    let cube = new THREE.Mesh(geometry, material);
    cube.name = name;
    cube.receiveShadow = true;

    return cube;
};

let applyCubeTextureToGeometry = function (geometry, texture, uv, mirror, textureScale) {
    let w = texture.image.width;
    let h = texture.image.height;

    geometry.computeBoundingBox();
    geometry.faceVertexUvs[0] = [];
    let faceUvs = [];
    for (let i = 0; i < 6; i++) {
        let tx1 = uv[FACE_ORDER[i]][0] * textureScale;
        let ty1 = h - uv[FACE_ORDER[i]][1] * textureScale;
        let tx2 = uv[FACE_ORDER[i]][2] * textureScale;
        let ty2 = h - uv[FACE_ORDER[i]][3] * textureScale;


        let flipY = false;
        let flipX = false;

        if (mirror) {
            flipX = true;
        }
        if (FACE_ORDER[i] === "front" || FACE_ORDER[i] === "left" || FACE_ORDER[i] === "right") flipY = true;

        tx1 /= w;
        ty1 /= h;
        tx2 /= w;
        ty2 /= h;

        faceUvs[i] = [
            new THREE.Vector2(tx1, ty2),
            new THREE.Vector2(tx1, ty1),
            new THREE.Vector2(tx2, ty1),
            new THREE.Vector2(tx2, ty2)
        ];

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
};


function getEntityModel(entity) {
    return new Promise((resolve, reject) => {
        $.ajax("https://minerender.org/res/models/entities/" + entity + ".json")
            .done((data) => {
                resolve(data);
            })
            .fail(() => {
                reject();
            })
    })
}

const overwriteMerge = (destinationArray, sourceArray, options) => {
    return sourceArray;
};

let mergeParents = function (model) {
    return new Promise((resolve, reject) => {
        mergeParents_(model, [], resolve, reject);
    });
};
let mergeParents_ = function (model, stack, resolve, reject) {
    console.log(stack)

    stack.push(model);

    if (!model.hasOwnProperty("parent")) {// already at the highest parent
        stack.reverse();
        let merged = {};
        for (let i = 0; i < stack.length; i++) {
            console.log(i)
            merged = merge(merged, stack[i], {arrayMerge: overwriteMerge});
            console.log(merged)
        }

        resolve(merged);
        return;
    }

    let parent = model["parent"];
    delete model["parent"];// remove the child's parent so it will be replaced by the parent's parent

    getEntityModel(parent).then((parentData) => {
        // let mergedModel = Object.assign({}, model, parentData);
        mergeParents_(parentData, stack, resolve, reject);
    })


};

if (typeof window !== "undefined")
    window.EntityRender = EntityRender;
if (typeof global !== "undefined")
    global.EntityRender = EntityRender;

export default EntityRender;