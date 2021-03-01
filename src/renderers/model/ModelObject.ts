import { SceneObject } from "../../SceneObject";
import { Model, TextureAsset } from "../../model/Model";
import { Materials } from "../../Materials";
import { ModelTextures } from "../../ModelTextures";
import webpack from "webpack";
import { Assets } from "../../Assets";
import { Maybe } from "../../util";
import { UVMapper } from "../../UVMapper";
import { TextureAtlas } from "../../TextureAtlas";
import { EdgesGeometry, LineBasicMaterial, LineSegments } from "three";

export class ModelObject extends SceneObject {

    private textureSrc?: string;
    private textureWidth: number = 16;
    private textureHeight: number = 16;

    private textureMap: { [key: string]: Maybe<TextureAsset>; } = {};

    private atlas?: TextureAtlas;

    constructor(readonly originalModel: Model, readonly options: ModelObjectOptions) {
        super();
        // load textures first so we have the updated UV coordinates from the atlas
        this.loadTextures().then(() => {
            this.createMeshes();
            this.applyTextures();
        })
    }

    protected async loadTextures(): Promise<void> {
        this.atlas = await UVMapper.getAtlas(this.originalModel);
        console.log(this.atlas)

        // if (this.model.textures) {
        //     let promises: Promise<void>[] = [];
        //     for (let textureKey in this.model.textures) {
        //         let textureValue = this.model.textures[textureKey];
        //         promises.push(ModelTextures.preload(Assets.parseAssetKey("textures", textureValue, this.model.key)).then(asset => {
        //             this.textureMap[textureKey] = asset;
        //         }));
        //     }
        //     await Promise.all(promises);
        // }
    }


    protected createMeshes() {
        const mat = Materials.MISSING_TEXTURE;

        //TODO: merge geometries
        this.atlas!.model.elements?.forEach(el => {
            console.log(el);
            const elGeo = this._getBoxGeometryFromElement(el);
            const mesh = this.createAndAddMesh(undefined, undefined, elGeo, mat);
            if (el.from[0] !== 0) {
                mesh.translateX(el.from[0]);
            }
            if (el.from[1] !== 0) {
                mesh.translateY(el.from[1]);
            }
            if (el.from[2] !== 0) {
                mesh.translateZ(el.from[2]);
            }
            //TODO: rotation


            let wireGeo = new EdgesGeometry(elGeo);
            let wireMat = new LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
            let wireframe = new LineSegments(wireGeo, wireMat);
            mesh.add(wireframe);

        })
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
