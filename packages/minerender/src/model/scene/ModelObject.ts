import { SceneObject } from "../../renderer/SceneObject";
import { Model, TextureAsset, TripleArray } from "../Model";
import { Materials } from "../../Materials";
import { Maybe, toRadians } from "../../util/util";
import { UVMapper } from "../../UVMapper";
import { TextureAtlas } from "../../texture/TextureAtlas";
import { BoxGeometry, BoxHelper, BufferAttribute, Color, EdgesGeometry, Euler, InstancedMesh, LineBasicMaterial, LineSegments, Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, ShaderMaterial } from "three";
import { mergeBufferGeometries } from "../../three/BufferGeometryUtils";
import { SceneObjectOptions } from "../../renderer/SceneObjectOptions";
import { addBox3WireframeToObject, addWireframeToMesh, addWireframeToObject, applyElementRotation } from "../../util/model";
import { Ticker } from "../../Ticker";
import merge from "ts-deepmerge";
import type { BufferGeometry } from "three";
import { BlockObject } from "../block/scene/BlockObject";
import { prefix } from "../../util/log";
import { CUBE_FACES } from "../../CubeFace";
import { DisplayPosition } from "../DisplayPosition";
import { DisplayTransforms } from "../DisplayTransforms";


const p = prefix("ModelObject");

//TODO: might want to abstract this out into a generic model, and create a separate class for Block models
export class ModelObject extends SceneObject {

    public readonly isModelObject: true = true;

    public static readonly DEFAULT_OPTIONS: ModelObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <ModelObjectOptions>{});
    public readonly options: ModelObjectOptions;

    private atlas?: TextureAtlas;

    public blockParent: Maybe<BlockObject>;

    private meshesCreated: boolean = false;

    constructor(readonly originalModel: Model, options?: Partial<ModelObjectOptions>) {
        super(options);
        this.options = merge({}, ModelObject.DEFAULT_OPTIONS, options ?? {});
        if (this.options.tints) this.options.tints = { ...this.options.tints };
        console.log("ModelObject options", this.options);
    }

    async init(): Promise<void> {
        // load textures first so we have the updated UV coordinates from the atlas
        await this.loadTextures();

        this.createMeshes();
        this.applyTextures();
    }

    dispose() {
        super.dispose();
        this.atlas?.dispose();
    }

    public get textureAtlas(): Maybe<TextureAtlas> {
        return this.atlas;
    }

    //TODO: support for replacing textures

    protected async loadTextures(): Promise<void> {
        this.atlas = await UVMapper.getAtlas(this.originalModel);
    }


    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const mat = Materials.MISSING_TEXTURE;
        const displayTransform = this.options.displayPosition
            ? DisplayTransforms.getMatrix(this.originalModel.display, this.options.displayPosition) : undefined;

        let allGeos: BufferGeometry[] = [];

        if (this.atlas) {
            if (this.atlas.model.elements) {
                this.atlas.model.elements?.forEach(el => {
                    const elGeo = this._getBoxGeometryFromElement(el).clone();
                    if (this.options.uvLockRotation) {
                        UVMapper.lockUvs(elGeo, el.faces, this.atlas!, new Euler(...this.options.uvLockRotation));
                    }
                    if (this.options.tints) {
                        const colors = new Float32Array(elGeo.getAttribute("position").count * 3).fill(1);
                        for (const [faceIndex, faceName] of CUBE_FACES.entries()) {
                            const tintIndex = el.faces[faceName]?.tintindex;
                            if (tintIndex === undefined || tintIndex < 0) continue;
                            const tint = this.options.tints[tintIndex];
                            if (tint === undefined) continue;
                            const color = new Color(tint);
                            for (let vertex = 0; vertex < 4; vertex++) {
                                color.toArray(colors, (faceIndex * 4 + vertex) * 3);
                            }
                        }
                        elGeo.setAttribute("color", new BufferAttribute(colors, 3));
                    }

                    // elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(-8,-8,-8));


                    elGeo.applyMatrix4(new Matrix4().makeTranslation((el.to[0] - el.from[0]) / 2, (el.to[1] - el.from[1]) / 2, (el.to[2] - el.from[2]) / 2));
                    elGeo.applyMatrix4(new Matrix4().makeTranslation(el.from[0], el.from[1], el.from[2]));

                    if (el.rotation) {
                        applyElementRotation(el.rotation, elGeo);
                    }


                    elGeo.applyMatrix4(new Matrix4().makeTranslation(-8, -8, -8));
                    if (displayTransform) DisplayTransforms.apply(elGeo, displayTransform);

                    if (this.options.mergeMeshes) {
                        allGeos.push(elGeo);
                    } else {
                        const mesh = this.createAndAddMesh(undefined, undefined, elGeo, mat);
                        if (this.options.wireframe) {
                            addWireframeToMesh(elGeo, mesh);
                        }
                    }
                });
            } else {
                console.debug(p, this.atlas.model, "has no elements")
            }
        } else {
            console.debug(p, "Missing atlas for", this);
        }

        if (this.options.mergeMeshes) {
            let combinedGeo: BufferGeometry;
            if (allGeos.length > 0) {
                // if (this.options.wireframe) {
                //     allGeos.push(new BoxGeometry(16, 16, 16, 1, 1, 1))
                // }

                combinedGeo = mergeBufferGeometries(allGeos);
            } else {
                combinedGeo = new BoxGeometry(16, 16, 16);
                if (displayTransform) DisplayTransforms.apply(combinedGeo, displayTransform);
            }
            combinedGeo.computeBoundingBox();
            // combinedGeo.translate(-8, -8, -8);
            // TODO: cache the combined geometry
            let mesh: Mesh;
            if (this.options.instanceMeshes) {
                mesh = this.createInstancedMesh(undefined, combinedGeo, mat, this.options.maxInstanceCount || 50);
                this.add(mesh);
                this._isInstanced = true;
                //TODO
            } else {
                mesh = this.createAndAddMesh(undefined, undefined, combinedGeo, mat)
            }
            if (this.options.wireframe) {
                addWireframeToMesh(combinedGeo, mesh, 0x0000ff, 4);
                addBox3WireframeToObject(combinedGeo.boundingBox!, mesh, 0x00ffff, 3);
            }
        }

        if (this.options.wireframe) {
            addWireframeToObject(this, 0x00ff00, 3)
        }

        this.meshesCreated = true;
    }


    protected applyTextures() {
        // if (this.atlas!.model.textures) {
        //     for (let textureKey in this.atlas!.model.textures) {
        //         let asset = this.textureMap[textureKey];
        //         if (asset) {
        //TODO: transparency
        if (this.atlas) {
            let mat = Materials.createShadedCanvasMaterial(this.atlas.image!.canvas! as HTMLCanvasElement, this.atlas.hasTransparency, false/*TODO: get this from render options*/);
            this.iterateAllMeshes(mesh => {
                if (mesh.geometry.hasAttribute("color")) mat.vertexColors = true;
                mesh.material = mat;
            });

            //TODO: move this somewhere else
            //TODO: this seems to be ticking way too fast atm
            if (this.atlas.hasAnimation) {
                if (typeof this.atlas.ticker === "undefined") { //TODO: fix missing texture update for reused atlas
                    this.atlas.ticker = Ticker.add(() => {
                        for (let key in this.atlas!.animatorFunctions) {
                            this.atlas!.animatorFunctions[key]();
                        }
                        Materials.needsUpdate(mat);
                    });
                }
            }
        }
        //         }
        //     }
        // }
    }


}

export interface ModelObjectOptions extends SceneObjectOptions {
    /** Minecraft display pose applied around the model center, before scene transforms. */
    displayPosition?: DisplayPosition;
    /** Quarter-turn block rotation in radians to compensate when locking UVs. */
    uvLockRotation?: TripleArray;
    /** sRGB 0xRRGGBB colors by face tint index; omitted indices stay white. */
    tints?: Record<number, number>;
}

export function isModelObject(obj: any): obj is ModelObject {
    return (<ModelObject>obj).isModelObject;
}
