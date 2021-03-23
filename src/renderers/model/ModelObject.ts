import { SceneObject } from "../SceneObject";
import { Model, TextureAsset } from "../../model/Model";
import { Materials } from "../../Materials";
import { ModelTextures } from "../../model/ModelTextures";
import webpack from "webpack";
import { Assets } from "../../assets/Assets";
import { Maybe, toRadians } from "../../util/util";
import { UVMapper } from "../../UVMapper";
import { TextureAtlas } from "../../texture/TextureAtlas";
import { BoxHelper, BufferAttribute, EdgesGeometry, InstancedMesh, LineBasicMaterial, LineSegments, Matrix4, Mesh } from "three";
import * as THREE from "three";
import { Axis } from "../../Axis";
import { SceneObjectOptions } from "../SceneObjectOptions";
import { addWireframeToMesh, applyElementRotation } from "../../util/model";

require("three/examples/js/utils/BufferGeometryUtils");

export class ModelObject extends SceneObject {

    private atlas?: TextureAtlas;

    private meshesCreated: boolean = false;

    constructor(readonly originalModel: Model, readonly options: ModelObjectOptions) {
        super();
        if (originalModel.name) {
            this.userData["modelName"] = originalModel.name;
        }
    }

    protected async init(): Promise<void> {
        // load textures first so we have the updated UV coordinates from the atlas
        await this.loadTextures();
        this.createMeshes();
        this.applyTextures();
    }

    public get textureAtlas(): Maybe<TextureAtlas> {
        return this.atlas;
    }

    protected async loadTextures(): Promise<void> {
        this.atlas = await UVMapper.getAtlas(this.originalModel);
        console.log(this.atlas);
    }


    protected createMeshes(force: boolean = false) {
        if (this.meshesCreated && !force) return;

        const mat = Materials.MISSING_TEXTURE;

        let allGeos: THREE.BufferGeometry[] = [];

        this.atlas!.model.elements?.forEach(el => {
            console.log(el);
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

        if (this.options.mergeMeshes) {
            let combinedGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(allGeos);
            let mesh: Mesh;
            if (this.options.instanceMeshes) {
                mesh = this.createInstancedMesh(undefined, combinedGeo, mat, this.options.maxInstanceCount || 50);
                this.add(mesh);
                this.isInstanced = true;
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
        console.log(this.atlas!.model)
        // if (this.atlas!.model.textures) {
        //     for (let textureKey in this.atlas!.model.textures) {
        //         let asset = this.textureMap[textureKey];
        //         if (asset) {
        //TODO: transparency
        console.log(this.atlas!.image!.canvas!)
        let mat = Materials.createCanvas(this.atlas!.image!.canvas! as HTMLCanvasElement);
        console.log(mat)
        this.iterateAllMeshes(mesh => {
            mesh.material = mat;
        })
        //         }
        //     }
        // }
    }


}

export interface ModelObjectOptions extends SceneObjectOptions {

}
