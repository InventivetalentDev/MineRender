import { SceneObject } from "../../SceneObject";
import { Object3D } from "three";

export class SkinObject extends Object3D implements SceneObject{

    private skinTextureSrc?: string;
    private capeTextureSrc?: string;


    constructor(readonly options: SkinObjectOptions) {
        super();
        this.createMesh();
    }

    protected async createMesh() {

    }


    public async setSkinTexture(src: string): Promise<void> {
        this.skinTextureSrc = src;

    }




}

export interface SkinObjectOptions {

}
