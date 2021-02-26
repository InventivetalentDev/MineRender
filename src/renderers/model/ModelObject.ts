import { SceneObject } from "../../SceneObject";
import { Model } from "../../model/Model";
import { Materials } from "../../Materials";

export class ModelObject extends SceneObject {

    private textureSrc?: string;
    private textureWidth: number = 16;
    private textureHeight: number = 16;

    constructor(readonly model: Model, readonly options: ModelObjectOptions) {
        super();
        this.createMeshes();
    }

    protected createMeshes() {
        const mat = Materials.MISSING_TEXTURE;

        //TODO: merge geometries
        this.model.elements?.forEach(el=>{
            const elGeo = this._getBoxGeometryFromElement(el, [16,16],[this.textureWidth, this.textureHeight]);
            const mesh = this.createAndAddMesh(undefined, undefined, elGeo, mat);
            if (el.from[0] > 0) {
                mesh.translateX(el.from[0]);
            }
            if (el.from[1] > 0) {
                mesh.translateY(el.from[1]);
            }
            if (el.from[2] > 0) {
                mesh.translateZ(el.from[2]);
            }
            //TODO: rotation

        })
    }



}

export interface ModelObjectOptions {

}
