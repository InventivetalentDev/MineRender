import { SceneObject } from "../../../renderer/SceneObject";
import { BlockState, BlockStateVariant } from "../BlockState";
import { SceneObjectOptions } from "../../../renderer/SceneObjectOptions";
import { isModelObject, ModelObject, ModelObjectOptions } from "../../scene/ModelObject";
import { Caching } from "../../../cache/Caching";
import { Models } from "../../../assets/Models";
import merge from "ts-deepmerge";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { Maybe } from "../../../util/util";
import { MineRenderError } from "../../../error/MineRenderError";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../BlockStateProperties";
import { InstanceReference, isInstanceReference } from "../../../instance/InstanceReference";
import { AssetKey, BasicAssetKey } from "../../../assets/AssetKey";
import { BlockTints } from "../BlockTints";
import { ModelCulling } from "../../ModelCulling";
import { BlockStateResolver } from "../BlockStateResolver";
import { FluidKind, FluidSampler, getBlockFluidState, getFluidKind } from "../../fluid/FluidGeometry";
import { BlockEntities, ResolvedBlockEntity } from "../../../assets/BlockEntities";
import { Entities } from "../../../assets/Entities";
import type { EntityObject } from "../../../entity/scene/EntityObject";

export class BlockObject extends SceneObject {

    public readonly isBlockObject: true = true;

    public static readonly DEFAULT_OPTIONS: BlockObjectOptions = merge({}, ModelObject.DEFAULT_OPTIONS, <BlockObjectOptions>{
        applyDefaultState: true
    });
    public readonly options: BlockObjectOptions;

    private _previousState: BlockStateProperties = {};
    private _state: BlockStateProperties = {};
    private _variant: Maybe<BlockStateVariant> = undefined;

    private _instanceState: BlockStateProperties[] = [];
    private _instanceVariant: BlockStateVariant[][] = [];
    private _instanceModel: (ModelObject | InstanceReference<ModelObject>)[] = [];

    private _variants: BlockStateVariant[] = [];
    private _models: (ModelObject | InstanceReference<ModelObject>)[] = [];
    private _cullMask = 0;
    private _fluidKey?: string;
    private _fluidSampler?: FluidSampler;
    private _fluidModel?: ModelObject | InstanceReference<ModelObject>;
    private _entities: EntityObject[] = [];
    private _entityPlacement = new Matrix4();
    private _entityGeneration = 0;

    constructor(readonly blockState: BlockState, options?: Partial<BlockObjectOptions>) {
        super(options);
        this.options = merge({}, BlockObject.DEFAULT_OPTIONS, options ?? {});
        //TODO
    }

    async init(): Promise<void> {
        if (this.options.applyDefaultState) {
            this._setState(await BlockStateResolver.defaults(this.blockState));
        }
        if (this.options.initialState !== undefined) this._setState(this.options.initialState);
        await this.recreateModels();
        //TODO
    }

    dispose() {
        this.clearModels();
        super.dispose();
    }

    removeFromScene() {
        this.clearModels();
        super.removeFromScene();
    }

    private clearModels() {
        this.removeModels(this._models.splice(0));
        this._entityGeneration++;
        this.removeEntities(this._entities.splice(0));
        this._fluidKey = undefined;
        this._fluidModel = undefined;
        this._isInstanced = false;
        this._instanceCounter = 0;
    }

    private removeModels(models: (ModelObject | InstanceReference<ModelObject>)[]) {
        for (const model of models) {
            model.removeFromScene();
            if (!isInstanceReference(model)) model.dispose();
        }
    }

    private removeEntities(entities: EntityObject[]) {
        for (const entity of entities) {
            entity.removeFromScene();
            entity.dispose();
        }
    }

    /** Entity models drawn for this block instead of its block model; they are scene children, unlike the block. */
    public get blockEntities(): readonly EntityObject[] {
        return this._entities;
    }

    /**
     * Draws the block through the dataset's block-entity index. Returns false, leaving nothing behind,
     * when the block is not listed or one of its models cannot be loaded.
     */
    private async createBlockEntities(): Promise<boolean> {
        const key = this.blockState.key;
        if (!key || this.options.displayPosition) return false;
        const generation = this._entityGeneration;
        const created: EntityObject[] = [];
        let resolved: Maybe<ResolvedBlockEntity>;
        try {
            resolved = BlockEntities.resolve(await BlockEntities.getIndex(key.root), key.toNamespacedString(), this.state);
            if (!resolved) return false;
            for (const part of resolved.parts) {
                const [namespace, path] = part.model.includes(":") ? part.model.split(":") : [key.namespace, part.model];
                const texture = part.textureLocation === undefined ? undefined
                    : AssetKey.parse("textures", part.textureLocation.replace(/^([^:]+:)?textures\//, "$1"));
                if (texture) texture.root = key.root;
                const entity = await Entities.getEntity(new BasicAssetKey(namespace, path), texture, { layer: part.layer });
                if (!entity) throw new MineRenderError(`Missing entity model ${part.model}`);
                created.push(await this.scene.addEntity(entity, { wireframe: this.options.wireframe }) as EntityObject);
            }
        } catch (error) {
            console.warn(`Could not draw block entity ${key.toNamespacedString()}, using its block model`, error);
            this.removeEntities(created);
            return false;
        }
        // The block was cleared while the models loaded.
        if (generation !== this._entityGeneration) {
            this.removeEntities(created);
            return true;
        }
        BlockEntities.matrix(resolved, this._entityPlacement);
        this._entities = created;
        this.placeEntities();
        return true;
    }

    private placeEntities() {
        // Block models are centred on the block position; entity transforms use the block's 0..16 space.
        const matrix = new Matrix4().makeTranslation(this.position.x - 8, this.position.y - 8, this.position.z - 8).multiply(this._entityPlacement);
        for (const entity of this._entities) {
            matrix.decompose(entity.position, entity.quaternion, entity.scale);
        }
    }

    public get isOccluding(): boolean {
        return this._models.some(model => {
            const object = isInstanceReference(model) ? model.instanceable : model;
            return object.isOpaqueFullCube && this.getModelCullMask(model, 63) === 63;
        });
    }

    private getModelMatrix(model: ModelObject | InstanceReference<ModelObject>): Matrix4 {
        if (isInstanceReference(model)) return model.getMatrix();
        if (model.matrixAutoUpdate) model.updateMatrix();
        return model.matrix.clone();
    }

    private getModelCullMask(model: ModelObject | InstanceReference<ModelObject>, worldMask: number): number {
        const object = isInstanceReference(model) ? model.instanceable : model;
        if (object.options.displayPosition) return 0;
        const position = new Vector3();
        const rotation = new Quaternion();
        const scale = new Vector3();
        this.getModelMatrix(model).decompose(position, rotation, scale);
        if (position.distanceToSquared(this.position) > 1e-10
            || scale.distanceToSquared(new Vector3(1, 1, 1)) > 1e-10) return 0;
        return ModelCulling.toLocalMask(worldMask, new Euler().setFromQuaternion(rotation));
    }

    public async setCullMask(worldMask: number): Promise<void> {
        worldMask &= 63;
        const replacements: (ModelObject | InstanceReference<ModelObject>)[] = [];
        try {
            for (const model of this._models) {
                if (model === this._fluidModel) {
                    replacements.push(model);
                    continue;
                }
                const object = isInstanceReference(model) ? model.instanceable : model;
                const cullMask = this.getModelCullMask(model, worldMask);
                if (cullMask === (object.options.cullMask ?? 0)) {
                    replacements.push(model);
                    continue;
                }
                const matrix = this.getModelMatrix(model);
                const replacement = await this.scene.addModel(object.originalModel, { ...object.options, cullMask });
                replacements.push(replacement);
                if (isInstanceReference(replacement)) {
                    replacement.setMatrix(matrix);
                } else {
                    replacement.matrix.copy(matrix);
                    matrix.decompose(replacement.position, replacement.quaternion, replacement.scale);
                    replacement.matrixAutoUpdate = object.matrixAutoUpdate;
                    replacement.visible = object.visible;
                }
            }
        } catch (error) {
            this.removeModels(replacements.filter(model => !this._models.includes(model)));
            throw error;
        }
        const previous = this._models;
        this._models = replacements;
        this._cullMask = worldMask;
        this.removeModels(previous.filter(model => !replacements.includes(model)));
        this.notifyDirty();
    }

    public get state(): { [key: string]: string; } {
        return this._state;
    }

    public get fluidKind(): FluidKind | undefined {
        return getFluidKind(this.blockState.key, this.state);
    }

    public get fluidLevel(): number {
        return getBlockFluidState(this.blockState.key, this.state)?.level ?? 0;
    }

    /** Refreshes fluid surfaces from relative neighbors; standalone previews use air around the block. */
    public async updateFluid(sample?: FluidSampler): Promise<void> {
        const kind = this.fluidKind;
        if (!kind) return;
        const { FluidModelObject, sampleFluid } = await import("../../fluid/FluidModelObject");
        this._fluidSampler = sample;
        const surface = sampleFluid(kind, (x, y, z) => x === 0 && y === 0 && z === 0
            ? { fluid: kind, level: this.fluidLevel } : sample?.(x, y, z) ?? {});
        if (this._fluidKey === surface.key) return;
        const key = new AssetKey("minecraft", `${kind}/${surface.key}`, "models", "fluid", "assets", ".json", this.blockState.key?.root);
        const replacement = await this.scene.addSceneObject({ key },
            () => new FluidModelObject(kind, surface.sample, this.blockState.key, this.options));
        const previous = this._fluidModel;
        const matrix = previous ? this.getModelMatrix(previous) : new Matrix4().makeTranslation(...this.position.toArray());
        if (isInstanceReference(replacement)) replacement.setMatrix(matrix);
        else matrix.decompose(replacement.position, replacement.quaternion, replacement.scale);
        this._models = this._models.filter(model => model !== previous);
        this._models.push(replacement);
        this._fluidModel = replacement;
        this._fluidKey = surface.key;
        this._isInstanced ||= isInstanceReference(replacement);
        this._instanceCounter = this._isInstanced ? 1 : 0;
        if (previous) this.removeModels([previous]);
        this.notifyDirty();
    }

    nextInstance(): InstanceReference<SceneObject> {

        const ref = super.nextInstance();
        for (let child of this.children) {
            if (isModelObject(child)) {
                child._instanceCounter = this.instanceCounter;
            }
        }
        return ref;
    }

    protected async mapStateToVariant(state: BlockStateProperties): Promise<BlockStateVariant[]> {
        return BlockStateResolver.select(this.blockState, state, variants => this.getSingleVariant(variants));
    }

    public async recreateModels(): Promise<void> {
        //TODO: change this to create models once, and then modify rotations when updating the state

        // Remove all children
        // this.disposeAndRemoveAllChildren(); //TODO: just removes all children of all instances atm...

        // TODO: try to reuse models instead of just removing them and creating new ones
        this.clearModels();

        if (getBlockFluidState(this.blockState.key, this.state)?.renderModel === false) {
            await this.updateFluid(this._fluidSampler);
            return;
        }


        //TODO: might want to preload all possible states & cache their data
        //TODO: make sure to only instance stuff with different rotations together; i.e. not those with different multipart settings, or different models

        /*
        if (this.isInstanced) {
            //TODO: only map once per state
            for (let i = 0; i < this.instanceCounter; i++) {
                this._instanceVariant[i] = await this.mapStateToVariant(this._instanceState[i]);
                for (let variant of this._instanceVariant[i]) {
                    this._instanceModel[i] = await this.createVariant(variant);
                }
            }
            //TODO: actually create
            //TODO: group by model
            this._isInstanced = true;
        } else {
         */
        const hasEntities = await this.createBlockEntities();
        const variantsToCreate = await this.mapStateToVariant(this.state);
        this._variants = variantsToCreate;
        for (let blockStateVariant of variantsToCreate) {
            // A block entity replaces only block models without geometry (a chest); a bell keeps its frame.
            if (hasEntities && !await this.hasGeometry(blockStateVariant)) continue;
            this._models.push(await this.createVariant(blockStateVariant));
        }
        await this.updateFluid(this._fluidSampler);
        /*
    }

         */

    }

    private async hasGeometry(variant: BlockStateVariant): Promise<boolean> {
        const modelKey = AssetKey.parse("models", variant.model!);
        modelKey.root = this.blockState.key?.root;
        return !!(await Models.getMerged(modelKey))?.elements?.length;
    }

    protected getSingleVariant(variants: BlockStateVariant | BlockStateVariant[]): BlockStateVariant {
        return BlockStateResolver.choose(variants);
    }

    // @deprecated
    protected async createAVariant(variants: BlockStateVariant | BlockStateVariant[], instanceInfo: Matrix4[]) {
        const variant = this.getSingleVariant(variants);
        await this.createVariant(variant);
    }

    protected async createVariant(variant: BlockStateVariant): Promise<ModelObject | InstanceReference<ModelObject>> {
        const rotation = BlockStateResolver.rotation(variant);

        // The model and its textures must come from the same asset root as the blockstate.
        const modelKey = AssetKey.parse("models", variant.model!);
        modelKey.root = this.blockState.key?.root;
        const model = await Models.getMerged(modelKey);
        const options: Partial<ModelObjectOptions> = {
            ...this.options,
            tints: model ? await BlockTints.get(this.blockState.key, this.state, model, this.options.tints) : this.options.tints,
            uvLockRotation: variant.uvlock && (rotation.x !== 0 || rotation.y !== 0)
                ? [rotation.x, rotation.y, rotation.z] : undefined,
            cullMask: this.options.displayPosition ? 0 : ModelCulling.toLocalMask(this._cullMask, rotation)
        };
        const obj = await this.scene.addModel(model!, options);
        if (isInstanceReference(obj) || (<ModelObject>obj).isInstanced) {
            this._isInstanced = true;
            this._instanceCounter = 1;//TODO: BlockObject itself isn't technically instanced, but needs the id for the get/setMatrix calls to work properly
        }
        obj.setRotation(rotation);
        obj.setPosition(this.position);
        return obj;
    }

    public async resetState() {
        this._previousState = this._state;
        this._state = {};
        await this.recreateModels();
    }

    // TODO: support state per instance
    public async setState(string: string);
    public async setState(state: BlockStateProperties);
    public async setState(key: string, value: string);
    public async setState(stringOrKeyOrState: string | BlockStateProperties, value?: string) {
        this._setState(stringOrKeyOrState, value);
        await this.recreateModels();
    }

    protected _setState(stringOrKeyOrState: string | BlockStateProperties, value?: string): void {
        this._previousState = this._state;
        if (typeof value === "undefined") { // a=b,c=d,... or state object
            if (typeof stringOrKeyOrState === "string") {
                if (stringOrKeyOrState === "") return;
                const split = stringOrKeyOrState.split(",");
                for (let s of split) {
                    let [k, v] = s.split("=");
                    this._setState(k, v);
                }
            } else if (typeof stringOrKeyOrState === "object") {
                for (let k in stringOrKeyOrState) {
                    this._state[k] = stringOrKeyOrState[k];
                }
            }
        } else {
            this._state[stringOrKeyOrState as string] = value;
        }
    }

    /*
    public async setStateAt(index: number, string: string);
    public async setStateAt(index: number, state: BlockStateProperties);
    public async setStateAt(index: number, key: string, value: string);
    public async setStateAt(index: number, stringOrKeyOrState: string | BlockStateProperties, value?: string);
    public async setStateAt(index: number, stringOrKeyOrState: string | BlockStateProperties, value?: string) {
        this._setStateAt(index, stringOrKeyOrState, value);
        await this.recreateModels();
    }

    protected _setStateAt(index: number, stringOrKeyOrState: string | BlockStateProperties, value?: string): void {
        if (!this._instanceState[index]) this._instanceState[index] = {};
        if (typeof value === "undefined") { // a=b,c=d,... or state object
            if (typeof stringOrKeyOrState === "string") {
                if (stringOrKeyOrState === "") return;
                const split = stringOrKeyOrState.split(",");
                for (let s of split) {
                    let [k, v] = s.split("=");
                    this._setStateAt(index, k, v);
                }
            } else if (typeof stringOrKeyOrState === "object") {
                for (let k in stringOrKeyOrState) {
                    this._instanceState[index][k] = stringOrKeyOrState[k];
                }
            }
        } else {
            this._instanceState[index][stringOrKeyOrState as string] = value;
        }
    }

    _getStateAt(index: number): BlockStateProperties {
        return this._instanceState[index];
    }

     */

    setPositionRotationScaleAt(index: number, position?: Vector3, rotation?: Euler, scale?: Vector3) {
        super.setPositionRotationScaleAt(index, position, rotation, scale);
    }

    getMatrixAt(index: number, matrix: Matrix4 = new Matrix4()): Matrix4 {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const child = this._models[0];
        if (child && isModelObject(child)) {
            child.getMatrixAt(index, matrix);
        } else if (child && isInstanceReference(child)) {
            child.getMatrix(matrix);
        }
        /*
        const child = this.children[0];
        if (child && isModelObject(child)) {
            if (!child.isInstanced) throw new MineRenderError("Object is not instanced");
            child.getMatrixAt(index, matrix);
        }
        return matrix;
         */
        // return super.getMatrixAt(0, matrix);
        return matrix;
    }

    setMatrixAt(index: number, matrix: Matrix4) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        // const child = this._models[0];
        for(let child of this._models) {
            if (child && isModelObject(child)) {
                child.setMatrixAt(index, matrix);
            } else if (child && isInstanceReference(child)) {
                child.setMatrix(matrix);
            }
        }
        /*
      for (let child of this.children) {
          if (isModelObject(child)) {
              if (!child.isInstanced) throw new MineRenderError("Object is not instanced");
              child.setMatrixAt(index, matrix);
          }
      }
       */
    }

    setPosition(position: Vector3) {
        this.position.copy(position);
        // Each part keeps its own variant rotation when the block moves.
        for (let model of this._models) {
            model.setPosition(position);
        }
        this.placeEntities();
        this.notifyDirty();
    }

    //TODO: should override rotation + scale methods

    //TODO

}

export interface BlockObjectOptions extends ModelObjectOptions {
    applyDefaultState: boolean;
    /** Properties applied before model creation, overriding defaults when applyDefaultState is enabled. */
    initialState?: BlockStateProperties;
}

export function isBlockObject(obj: any): obj is BlockObject {
    return (<BlockObject>obj).isBlockObject;
}
