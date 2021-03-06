import { SceneObject } from "../../SceneObject";
import { Model, TextureAsset } from "../../model/Model";
import { Materials } from "../../Materials";
import { ModelTextures } from "../../ModelTextures";
import webpack from "webpack";
import { Assets } from "../../Assets";
import { Maybe, toRadians } from "../../util/util";
import { UVMapper } from "../../UVMapper";
import { TextureAtlas } from "../../TextureAtlas";
import { BoxHelper, BufferAttribute, EdgesGeometry, LineBasicMaterial, LineSegments, Matrix4 } from "three";
import * as THREE from "three";
import { Axis } from "../../Axis";

require("three/examples/js/utils/BufferGeometryUtils");

export class ModelObject extends SceneObject {

    private atlas?: TextureAtlas;

    private meshesCreated: boolean = false;

    constructor(readonly originalModel: Model, readonly options: ModelObjectOptions) {
        super();
        if (originalModel.name) {
            this.userData["modelName"] = originalModel.name;
        }
        // load textures first so we have the updated UV coordinates from the atlas
        this.loadTextures().then(() => {
            this.createMeshes();
            this.applyTextures();
        });
    }

    public get textureAtlas(): Maybe<TextureAtlas> {
        return this.atlas;
    }

    protected async loadTextures(): Promise<void> {
        this.atlas = await UVMapper.getAtlas(this.originalModel);
        console.log(this.atlas);
    }


    protected createMeshes(force: boolean = false) {
        if(this.meshesCreated && !force) return;

        const mat = Materials.MISSING_TEXTURE;

        // const combinedGeo = new THREE.Geometry()

        let allGeos: THREE.BufferGeometry[] = [];

        //TODO: merge geometries
        this.atlas!.model.elements?.forEach(el => {
            console.log(el);
            const elGeo = this._getBoxGeometryFromElement(el).clone();

            elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation((el.to[0] - el.from[0]) / 2, (el.to[1] - el.from[1]) / 2, (el.to[2] - el.from[2]) / 2));
            elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(el.from[0], el.from[1], el.from[2]));

            // const mesh = this.createAndAddMesh(undefined, undefined, elGeo, mat);

            if(el.rotation) {
                // subtract origin
                elGeo.translate(-el.rotation.origin[0], -el.rotation.origin[1], -el.rotation.origin[2]);
                // elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(-el.rotation.origin[0],-el.rotation.origin[1],-el.rotation.origin[2]));
                // apply rotation
                switch (el.rotation.axis) {
                    case Axis.X:
                        elGeo.rotateX(toRadians(el.rotation.angle));
                        break;
                    case Axis.Y:
                        elGeo.rotateY(toRadians(el.rotation.angle));
                        break;
                    case Axis.Z:
                        elGeo.rotateZ(toRadians(el.rotation.angle));
                        break;
                }
                // add back origin
                elGeo.translate(el.rotation.origin[0], el.rotation.origin[1], el.rotation.origin[2]);
                // elGeo.applyMatrix4(new THREE.Matrix4().makeTranslation(el.rotation.origin[0],el.rotation.origin[1],el.rotation.origin[2]));
            }


            // let wireGeo = new EdgesGeometry(elGeo);
            // let wireMat = new LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
            // let wireframe = new LineSegments(wireGeo, wireMat);
            // mesh.add(wireframe);

            // mesh.add(new BoxHelper(mesh));

            // mesh.updateMatrix();

            // combinedGeo.merge(mesh.geometry);
            allGeos.push(elGeo);
        });

        let combinedGeo = THREE.BufferGeometryUtils.mergeBufferGeometries(allGeos);
        const combinedMesh = this.createAndAddMesh(undefined, undefined, combinedGeo, mat);

        let wireGeo = new EdgesGeometry(combinedGeo);
        let wireMat = new LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
        let wireframe = new LineSegments(wireGeo, wireMat);
        combinedMesh.add(wireframe);

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

export interface ModelObjectOptions {

}
