import { Object3D, Scene } from "three";
import { SceneObject } from "./SceneObject";
import { isSceneObject } from "../util/three";
import merge from "ts-deepmerge";
import { Model } from "../model/Model";
import { ModelObject, ModelObjectOptions } from "./model/ModelObject";
import { InstanceReference } from "../instance/InstanceReference";
import { serializeAssetKey } from "../cache/CacheKey";
import { SceneStats } from "../SceneStats";
import { SSAOPassOUTPUT } from "three/examples/jsm/postprocessing/SSAOPass";

export class MineRenderScene extends Scene {

    public readonly isMineRenderScene: true = true;

    public static readonly DEFAULT_OPTIONS: MineRenderSceneOptions = merge({}, <MineRenderSceneOptions>{

    });
    public readonly options: MineRenderSceneOptions;

    readonly stats: SceneStats = new SceneStats();
    protected readonly instanceCache: { [key: string]: InstanceReference<SceneObject>; } = {};

    constructor(options?: Partial<MineRenderSceneOptions>) {
        super();
        this.options = merge({}, MineRenderScene.DEFAULT_OPTIONS, options ?? {});
    }

    add(...object): this {
        this.stats.objectCount += object.length;
        for (let obj of object) {
            if (isSceneObject(obj)) {
                this.stats.sceneObjectCount++;
            }
        }
        return super.add(...object);
    }

    public async initAndAdd(...object: SceneObject[]): Promise<this> {
        for (let obj of object) {
            await obj.init();
        }
        return this.add(...object);
    }

    public async addModel(model: Model, options?: Partial<ModelObjectOptions>): Promise<ModelObject | InstanceReference<ModelObject>> {
        console.log(this.instanceCache)
        if (options?.instanceMeshes && model.key) {
            console.log("instanceMeshes + key")
            // check for existing instances
            const key = serializeAssetKey(model.key);
            console.log(key)
            if (key in this.instanceCache) {
                console.log("key in cache")
                return this.instanceCache[key].nextInstance() as InstanceReference<ModelObject>;
            } else {
                console.log("key not in cache")
                const obj = new ModelObject(model, options);
                await this.initAndAdd(obj);
                const inst = obj.nextInstance();
                console.log(inst);
                this.instanceCache[key] = inst;
                return inst;
            }
        } else {
            console.log("!instanceMeshes | !key")
            const obj = new ModelObject(model, options);
            await this.initAndAdd(obj);
            return obj;
        }
    }

}

export interface MineRenderSceneOptions {

}


export function isMineRenderScene(obj: any): obj is MineRenderScene {
    return (<MineRenderScene>obj).isMineRenderScene;
}
