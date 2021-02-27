import { SceneObject } from "../../SceneObject";
import { Model, TextureAsset } from "../../model/Model";
import { Materials } from "../../Materials";
import { ModelTextures } from "../../ModelTextures";
import webpack from "webpack";
import { Assets } from "../../Assets";
import { Maybe } from "../../util";

export class ModelObject extends SceneObject {

    private textureSrc?: string;
    private textureWidth: number = 16;
    private textureHeight: number = 16;

    private textureMap: { [key: string]: Maybe<TextureAsset>; } = {};

    constructor(readonly model: Model, readonly options: ModelObjectOptions) {
        super();
        this.createMeshes();
        this.loadTextures().then(()=>{
            this.applyTextures();
        })
    }

    protected createMeshes() {
        const mat = Materials.MISSING_TEXTURE;

        //TODO: merge geometries
        this.model.elements?.forEach(el => {
            const elGeo = this._getBoxGeometryFromElement(el, [16, 16], [this.textureWidth, this.textureHeight]);
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

    protected async loadTextures(): Promise<void> {
        if (this.model.textures) {
            let promises: Promise<void>[] = [];
            for (let textureKey in this.model.textures) {
                let textureValue = this.model.textures[textureKey];
                promises.push(ModelTextures.preload(Assets.parseAssetKey("textures", textureValue, this.model.key)).then(asset => {
                    this.textureMap[textureKey] = asset;
                }));
            }
            await Promise.all(promises);
        }
    }

    protected applyTextures() {
        if (this.model.textures) {
            for (let textureKey in this.model.textures) {
                let asset = this.textureMap[textureKey];
                if (asset) {
                    //TODO: transparency
                    let mat = Materials.get({
                        texture: {src: asset.src!},
                        transparent: true
                    });
                    this.iterateAllMeshes(mesh=>{
                        mesh.material = mat;
                    })
                }
            }
        }
    }


}

export interface ModelObjectOptions {

}
