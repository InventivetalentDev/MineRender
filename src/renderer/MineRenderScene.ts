import { Object3D, Scene } from "three";
import { SceneObject } from "./SceneObject";
import { isSceneObject } from "../util/three";
import merge from "ts-deepmerge";
import { Model } from "../model/Model";
import { ModelObject, ModelObjectOptions } from "../model/scene/ModelObject";
import { InstanceReference } from "../instance/InstanceReference";
import { SceneStats } from "../SceneStats";
import { SSAOPassOUTPUT } from "three/examples/jsm/postprocessing/SSAOPass";
import { BasicMinecraftAsset, MinecraftAsset } from "../MinecraftAsset";
import { SceneObjectOptions } from "./SceneObjectOptions";
import { BlockState } from "../model/block/BlockState";
import { BlockObject, BlockObjectOptions, isBlockObject } from "../model/block/scene/BlockObject";
import { InstanceManager } from "../instance/InstanceManager";
import { DeepPartial, sleep } from "../util/util";
import { SkinObject, SkinObjectOptions } from "../skin/scene/SkinObject";
import { EntityObject, EntityObjectOptions } from "../entity/scene/EntityObject";
import { EntityModel } from "../entity/EntityModel";
import { isAssetKey } from "../assets/AssetKey";

export class MineRenderScene extends Scene {

    public readonly isMineRenderScene: true = true;

    public static readonly DEFAULT_OPTIONS: MineRenderSceneOptions = merge({}, <MineRenderSceneOptions>{});
    public readonly options: MineRenderSceneOptions;

    readonly stats: SceneStats = new SceneStats();
    protected readonly instanceManager: InstanceManager = new InstanceManager();

    constructor(options?: DeepPartial<MineRenderSceneOptions>) {
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

    async addSceneObject<A extends BasicMinecraftAsset, T extends SceneObject, O extends SceneObjectOptions>(asset: A, objectSupplier: () => T | Promise<T>, options?: Partial<O>, parent: Object3D = this): Promise<T | InstanceReference<T>> {
        console.log("addSceneObject")
        console.log("parent", parent)
        // console.log(this.instanceCache)
        if (options?.instanceMeshes && asset.key && (isAssetKey(asset.key) && asset.key.assetType === "models")/*TODO*/) {
            // console.log("instanceMeshes + key")
            // check for existing instances
            const key = asset.key.serialize();
            return this.instanceManager.getOrCreate(key, async () => {
                const obj = await objectSupplier();
                obj.scene = this;
                await obj.init();
                parent.add(obj);
                // await sleep(500)//TODO
                return obj;
            });
        } else {
            // console.log("!instanceMeshes | !key")
            const obj = await objectSupplier();
            obj.scene = this;
            // await this.initAndAdd(obj);
            await obj.init();
            if (!isBlockObject(obj)) { //TODO: adding block objects slows things down (since each block has its own)
                parent.add(obj);
            }
            // await sleep(500)//TODO
            return obj;
        }
    }

    public async addModel(model: Model, options?: Partial<ModelObjectOptions>, parent: Object3D = this): Promise<ModelObject | InstanceReference<ModelObject>> {
        return this.addSceneObject<Model, ModelObject, ModelObjectOptions>(model, () => new ModelObject(model, options), options, parent);
    }

    public async addBlock(blockState: BlockState, options?: Partial<BlockObjectOptions>, parent: Object3D = this): Promise<BlockObject | InstanceReference<BlockObject>> {
        return this.addSceneObject<BlockState, BlockObject, BlockObjectOptions>(blockState, () => new BlockObject(blockState, options), options, parent);
    }

    public async addSkin(skin?: string, options?: Partial<SkinObjectOptions>, parent: Object3D = this): Promise<SkinObject> {
        const obj = new SkinObject(options);
        obj.scene = this;
        await obj.init();
        if (skin) {
            obj.setSkinTexture(skin);
        }
        parent.add(obj);
        return obj;
    }

    public async addEntity(entity: EntityModel, options?: Partial<EntityObjectOptions>, parent: Object3D = this): Promise<EntityObject | InstanceReference<EntityObject>> {
        return this.addSceneObject<EntityModel, EntityObject, BlockObjectOptions>(entity, () => new EntityObject(entity, options), options, parent);
    }

}

export interface MineRenderSceneOptions {

}


export function isMineRenderScene(obj: any): obj is MineRenderScene {
    return (<MineRenderScene>obj).isMineRenderScene;
}
