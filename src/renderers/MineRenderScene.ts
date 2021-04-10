import { Object3D, Scene } from "three";
import { SceneObject } from "./SceneObject";
import { isSceneObject } from "../util/three";
import merge from "ts-deepmerge";
import { Model } from "../model/Model";
import { ModelObjectOptions } from "./model/ModelObject";

export class MineRenderScene extends Scene {

    public static readonly DEFAULT_OPTIONS: MineRenderSceneOptions = merge({}, <MineRenderSceneOptions>{

    });
    public readonly options: MineRenderSceneOptions;

    constructor(options?: Partial<MineRenderSceneOptions>) {
        super();
        this.options = merge({}, MineRenderScene.DEFAULT_OPTIONS, options ?? {});
    }

    public async initAndAdd(...object: SceneObject[]): Promise<this> {
        for (let obj of object) {
            await obj.init();
        }
        return super.add(...object);
    }

    public async addModel(model: Model, options?: Partial<ModelObjectOptions>) {
        
    }

}

export interface MineRenderSceneOptions {

}
