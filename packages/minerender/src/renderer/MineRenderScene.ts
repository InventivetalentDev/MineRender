import { Event, Object3D, Scene } from "three";
import {isSceneObject, SceneObject} from "./SceneObject";
import merge from "ts-deepmerge";
import { Model } from "../model/Model";
import { isModelObject, ModelObject, ModelObjectOptions } from "../model/scene/ModelObject";
import { InstanceReference } from "../instance/InstanceReference";
import { SceneStats } from "../SceneStats";
import { BasicMinecraftAsset, MinecraftAsset } from "../MinecraftAsset";
import { SceneObjectOptions } from "./SceneObjectOptions";
import { BlockState } from "../model/block/BlockState";
import { BlockObject, BlockObjectOptions, isBlockObject } from "../model/block/scene/BlockObject";
import { InstanceManager } from "../instance/InstanceManager";
import { DeepPartial, sleep } from "../util/util";
import { SkinObject, SkinObjectOptions } from "../skin/scene/SkinObject";
import { EntityObject, EntityObjectOptions } from "../entity/scene/EntityObject";
import { EntityModel } from "../entity/EntityModel";
import { AssetKey, isAssetKey } from "../assets/AssetKey";
import { GuiLayer } from "../gui/GuiLayer";
import { GuiObject, GuiObjectOptions } from "../gui/scene/GuiObject";
import { ItemTints } from "../model/ItemTints";

export class MineRenderScene extends Scene {

    public readonly isMineRenderScene: true = true;

    public static readonly DEFAULT_OPTIONS: MineRenderSceneOptions = merge({}, <MineRenderSceneOptions>{});
    public readonly options: MineRenderSceneOptions;

    readonly stats: SceneStats = new SceneStats();
    protected readonly instanceManager: InstanceManager = new InstanceManager();

    public dirty: boolean = true;

    private readonly observedObjects = new Set<Object3D>();
    private readonly onObjectChange = (event: Event<'change', Object3D>) => {
        if (event.target?.parent === this) {
            this.dirty = true;
        }
    };

    constructor(options?: DeepPartial<MineRenderSceneOptions>) {
        super();
        this.options = merge({}, MineRenderScene.DEFAULT_OPTIONS, options ?? {});
    }

    add(...objects: Object3D[]): this {
        for (const object of objects) {
            this.dirty = true;
            try {
                super.add(object);
            } finally {
                // Added handlers may remove or reparent the object before add returns.
                if (object?.isObject3D && object !== this) {
                    this.updateObjectRegistration(object, object.parent === this);
                }
            }
        }
        return this;
    }

    remove(...objects: Object3D[]): this {
        for (const object of objects) {
            if (!this.children.includes(object)) continue;
            this.dirty = true;
            this.updateObjectRegistration(object, false);
            try {
                super.remove(object);
            } finally {
                // Removed handlers may add the object back to this scene.
                this.updateObjectRegistration(object, object.parent === this);
            }
        }
        return this;
    }

    private updateObjectRegistration(object: Object3D, attached: boolean) {
        if (this.observedObjects.has(object) === attached) return;
        if (attached) {
            this.observedObjects.add(object);
            object.addEventListener('change', this.onObjectChange);
        } else {
            this.observedObjects.delete(object);
            object.removeEventListener('change', this.onObjectChange);
        }
        const change = attached ? 1 : -1;
        this.stats.objectCount += change;
        if (isSceneObject(object)) {
            this.stats.sceneObjectCount += change;
        }
    }

    public async initAndAdd(...object: SceneObject[]): Promise<this> {
        this.dirty = true;
        for (let obj of object) {
            await obj.init();
        }
        return this.add(...object);
    }

    async addSceneObject<A extends BasicMinecraftAsset, T extends SceneObject, O extends SceneObjectOptions>(asset: A, objectSupplier: () => T | Promise<T>, _options?: Partial<O>, parent: Object3D = this): Promise<T | InstanceReference<T>> {
        this.dirty = true;
        //TODO: we need a way to call objectSupplier in the instance supplier below
        // but we also need to get the options that have been merged with the defaults properly
        // so maybe to the option merging _somewhere_ else, not in the object constructor
        const obj = await objectSupplier();
        if (obj?.options?.instanceMeshes && asset.key &&  (<AssetKey>asset.key)?.assetType === "models"/*TODO*/) {
            // Geometry options need separate instance pools while sharing the texture atlas.
            let key = asset.key.serialize();
            if (isModelObject(obj)) {
                const { displayPosition, uvLockRotation, tints, cullMask } = obj.options;
                if (displayPosition) key += `|display:${displayPosition}`;
                if (uvLockRotation) key += `|uvlock:${uvLockRotation.join(",")}`;
                const palette = Object.entries(tints ?? {}).sort(([a], [b]) => Number(a) - Number(b));
                if (palette.length) key += `|tints:${JSON.stringify(palette)}`;
                if (cullMask) key += `|cull:${cullMask}`;
            }
            return this.instanceManager.getOrCreate(key, async () => {
                // const obj = await objectSupplier();
                obj.scene = this;
                await obj.init();
                parent.add(obj);
                // await sleep(500)//TODO
                return obj;
            });
        } else {
            // const obj = await objectSupplier();
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
        options = { ...options, tints: await ItemTints.get(model, options?.tints) };
        return this.addSceneObject<Model, ModelObject, ModelObjectOptions>(model, () => new ModelObject(model, options), options, parent);
    }

    public async addBlock(blockState: BlockState, options?: Partial<BlockObjectOptions>, parent: Object3D = this): Promise<BlockObject | InstanceReference<BlockObject>> {
        return this.addSceneObject<BlockState, BlockObject, BlockObjectOptions>(blockState, () => new BlockObject(blockState, options), options, parent);
    }

    public async addSkin(skin?: string, options?: Partial<SkinObjectOptions>, parent: Object3D = this): Promise<SkinObject> {
        this.dirty = true;
        const obj = new SkinObject(options);
        obj.scene = this;
        if (skin) {
            await obj.setSkinTexture(skin);
        }
        await obj.init();
        parent.add(obj);
        return obj;
    }

    public async addEntity(entity: EntityModel, options?: Partial<EntityObjectOptions>, parent: Object3D = this): Promise<EntityObject | InstanceReference<EntityObject>> {
        return this.addSceneObject<EntityModel, EntityObject, EntityObjectOptions>(entity, () => new EntityObject(entity, options), options, parent);
    }

    public async addGui(layers: readonly GuiLayer[], options?: Partial<GuiObjectOptions>, parent: Object3D = this): Promise<GuiObject> {
        const obj = new GuiObject(layers, options);
        obj.scene = this;
        await obj.init();
        parent.add(obj);
        this.dirty = true;
        return obj;
    }

}

export interface MineRenderSceneOptions {

}


export function isMineRenderScene(obj: any): obj is MineRenderScene {
    return (<MineRenderScene>obj).isMineRenderScene;
}
