import { SceneObject } from "../../SceneObject";
import { BoxGeometry, Mesh, Vector3 } from "three";
import { SKIN_PARTS, SkinPart } from "./SkinPart";
import { classicSkinTextureCoordinates, SkinTextureCoordinates, slimSkinTextureCoordinates } from "./SkinTextureCoordinates";
import { classicSkinGeometries, SkinGeometries, slimSkinGeometries } from "./SkinGeometries";
import { Axis } from "../../Axis";
import { Materials } from "../../Materials";

export class SkinObject extends SceneObject {

    private slim: boolean = false;

    private skinTextureSrc?: string;
    private skinTextureWidth: number = 64;
    private skinTextureHeight: number = 64;

    private capeTextureSrc?: string;

    private meshes: Partial<Record<SkinPart, Mesh>> = {};

    constructor(readonly options: SkinObjectOptions) {
        super();
        this.createMesh();
    }

    protected createMesh() {
        const mat = Materials.MISSING_TEXTURE;

        const headGroup = this.createAndAddGroup("head", 0, 28, 0, Axis.Y, -4);
        const headGeo = this.getBoxGeometry(SkinPart.HEAD);
        const head = new Mesh(headGeo, mat);
        head.translateOnAxis(new Vector3(0, 1, 0), 4);
        this.meshes[SkinPart.HEAD] = head;
        headGroup.add(head);

        const bodyGroup = this.createAndAddGroup("body", 0, 18, 0);
        const bodyGeo = this.getBoxGeometry(SkinPart.BODY);
        const body = new Mesh(bodyGeo, mat);
        this.meshes[SkinPart.BODY] = body;
        bodyGroup.add(body);


    }


    public async setSkinTexture(src: string): Promise<void> {
        this.skinTextureSrc = src;

        const mat = Materials.get({ texture: { src: src } });
        for (let part of SKIN_PARTS) {
            let mesh = this.meshes[part];
            if (mesh) {
                mesh.material = mat;
            }
        }
    }


    protected getBoxGeometry(part: SkinPart): BoxGeometry {
        const coordinates: SkinTextureCoordinates = this.slim ? slimSkinTextureCoordinates : classicSkinTextureCoordinates;
        const geometries: SkinGeometries = this.slim ? slimSkinGeometries : classicSkinGeometries;
        return this._getBoxGeometryFromDimensions(geometries[part], coordinates[part], this.skinTextureWidth, this.skinTextureHeight);
    }


}

export interface SkinObjectOptions {

}
