import { SceneObject } from "../SceneObject";
import { Model, TextureAsset } from "../../model/Model";
import { Materials } from "../../Materials";
import { ModelTextures } from "../../model/ModelTextures";
import webpack from "webpack";
import { Assets } from "../../assets/Assets";
import { Maybe, toRadians } from "../../util/util";
import { UVMapper } from "../../UVMapper";
import { TextureAtlas } from "../../texture/TextureAtlas";
import { BoxGeometry, BoxHelper, BufferAttribute, EdgesGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh } from "three";
import * as THREE from "three";
import { Axis } from "../../Axis";
import { SceneObjectOptions } from "../SceneObjectOptions";
import { addWireframeToMesh, applyElementRotation } from "../../util/model";
import { dbg } from "../../util/debug";
import { Ticker } from "../../Ticker";
import merge from "ts-deepmerge";

require("three/examples/js/utils/BufferGeometryUtils");

export class ModelObject extends SceneObject {

    public readonly isModelObject: true = true;

    public static readonly DEFAULT_OPTIONS: ModelObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <ModelObjectOptions>{});
    public readonly options: ModelObjectOptions;

    private atlas?: TextureAtlas;

    private meshesCreated: boolean = false;

    constructor(readonly originalModel: Model, options?: Partial<ModelObjectOptions>) {
        super();
        this.options = merge({}, ModelObject.DEFAULT_OPTIONS, options ?? {});

        if (originalModel.name) {
            this.userData["modelName"] = originalModel.name;
        }
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

    protected async loadTextures(): Promise<void> {
        this.atlas = await UVMapper.getAtlas(this.originalModel);
    }


    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const mat = Materials.MISSING_TEXTURE;

        let allGeos: THREE.BufferGeometry[] = [];

        if (this.atlas) {
            if (this.atlas.model.elements) { // block / block item
                this.atlas.model.elements?.forEach(el => {
                    const elGeo = this._getBoxGeometryFromElement(el).clone();

                    elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation((el.to[0] - el.from[0]) / 2, (el.to[1] - el.from[1]) / 2, (el.to[2] - el.from[2]) / 2));
                    elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(el.from[0], el.from[1], el.from[2]));

                    if (el.rotation) {
                        applyElementRotation(el.rotation, elGeo);
                    }

                    if (this.options.mergeMeshes) {
                        allGeos.push(elGeo);
                    } else {
                        const mesh = this.createAndAddMesh(undefined, undefined, elGeo, mat);
                        if (this.options.wireframe) {
                            addWireframeToMesh(elGeo, mesh);
                        }
                    }
                });
            } else { // simple item
                //TODO
            }
        } else {
            dbg("Missing texture atlas for %O", this);
        }

        if (this.options.mergeMeshes) {
            let combinedGeo;
            if (allGeos.length > 0) {
                combinedGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(allGeos);
            } else {
                combinedGeo = new BoxGeometry(16, 16, 16);
            }
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
                addWireframeToMesh(combinedGeo, mesh);
            }
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
            let mat = Materials.createCanvas(this.atlas.image!.canvas! as HTMLCanvasElement);
            this.iterateAllMeshes(mesh => {
                mesh.material = mat;
            });

            //TODO: move this somewhere else
            if (this.atlas.hasAnimation) {
                if (!this.atlas.ticker) {
                    this.atlas.ticker = Ticker.add(() => {
                        for (let key in this.atlas!.animatorFunctions) {
                            this.atlas!.animatorFunctions[key]();
                        }
                        mat.map!.needsUpdate = true;
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

}

export function isModelObject(obj: any): obj is ModelObject {
    return (<ModelObject>obj).isModelObject;
}
