import { SceneObject } from "../../../renderer/SceneObject";
import { BlockState, BlockStateVariant, BlockStateVariants, MultipartCondition } from "../BlockState";
import { SceneObjectOptions } from "../../../renderer/SceneObjectOptions";
import { isModelObject, ModelObject, ModelObjectOptions } from "../../scene/ModelObject";
import { Caching } from "../../../cache/Caching";
import { Models } from "../../../assets/Models";
import merge from "ts-deepmerge";
import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { clampRotationDegrees, Maybe, toRadians } from "../../../util/util";
import { MineRenderError } from "../../../error/MineRenderError";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../BlockStateProperties";
import { BlockStates } from "../../../assets/BlockStates";
import { InstanceReference, isInstanceReference } from "../../../instance/InstanceReference";
import { AssetKey } from "../../../assets/AssetKey";
import { prefix } from "../../../util/log";
import { BlockTints } from "../BlockTints";
import { ModelCulling } from "../../ModelCulling";

const p = prefix("BlockObject");

function matchesCondition(condition: MultipartCondition, state: BlockStateProperties): boolean {
    return Object.entries(condition).every(([key, value]) => {
        if (Array.isArray(value)) {
            if (key === "OR") return value.some(child => matchesCondition(child, state));
            if (key === "AND") return value.every(child => matchesCondition(child, state));
            return false;
        }
        return typeof value === "string" && state[key] !== undefined && value.split("|").includes(`${state[key]}`);
    });
}

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

    constructor(readonly blockState: BlockState, options?: Partial<BlockObjectOptions>) {
        super(options);
        this.options = merge({}, BlockObject.DEFAULT_OPTIONS, options ?? {});
        //TODO
    }

    async init(): Promise<void> {
        if (this.options.applyDefaultState) {
            const defaultState = this.blockState.key ? await BlockStates.getDefaultState(this.blockState.key) : undefined;
            if (defaultState && Object.keys(defaultState).length > 0) { // use defined state
                const state = {};
                for (let k in defaultState) {
                    state[k] = defaultState[k].default;
                }
                this._setState(state);
            } else { // fallback to guessing from blockState definition
                if (this.blockState.variants) {
                    this._setState(Object.keys(this.blockState.variants)[0]);
                } else if (this.blockState.multipart) {
                    // Guess preview values only from a flat condition; logical groups need a known state.
                    const condition = this.blockState.multipart.map(part => part.when)
                        .find((when): when is Record<string, string> =>
                            when !== undefined && Object.values(when).every(value => typeof value === "string"));
                    const state = Object.fromEntries(Object.entries(condition ?? {})
                        .map(([key, value]) => [key, value.split("|")[0]]));
                    this._setState(state);
                }
            }
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
        this._isInstanced = false;
        this._instanceCounter = 0;
    }

    private removeModels(models: (ModelObject | InstanceReference<ModelObject>)[]) {
        for (const model of models) {
            model.removeFromScene();
            if (!isInstanceReference(model)) model.dispose();
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
        const out: BlockStateVariant[] = [];
        if (this.blockState.variants) {
            if (Object.keys(this.blockState.variants).length === 1 && "" in this.blockState.variants) { // default variant
                out.push(this.getSingleVariant(this.blockState.variants[""]));
            } else {
                for (let variantKey in this.blockState.variants) {
                    const split = variantKey.split(",");
                    let matches = true;
                    for (let s of split) {
                        const [k, v] = s.split("=");
                        if (`${ state[k] }` !== `${ v }`) {
                            matches = false;
                            break;
                        }
                    }
                    if (matches) {
                        const variants = this.blockState.variants[variantKey];
                        out.push(this.getSingleVariant(variants));
                    }
                }
            }
        } else if (this.blockState.multipart) {
            for (let part of this.blockState.multipart) {
                if (!part.apply) {
                    console.debug(p, "Missing apply for blockState part",  part);
                    continue;
                }
                if (!part.when || matchesCondition(part.when, state)) {
                    out.push(this.getSingleVariant(part.apply));
                }
            }
        }

        return out;
    }

    public async recreateModels(): Promise<void> {
        //TODO: change this to create models once, and then modify rotations when updating the state

        // Remove all children
        // this.disposeAndRemoveAllChildren(); //TODO: just removes all children of all instances atm...

        // TODO: try to reuse models instead of just removing them and creating new ones
        this.clearModels();


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
        const variantsToCreate = await this.mapStateToVariant(this.state);
        this._variants = variantsToCreate;
        for (let blockStateVariant of variantsToCreate) {
            this._models.push(await this.createVariant(blockStateVariant));
        }
        /*
    }

         */

    }

    protected getSingleVariant(variants: BlockStateVariant | BlockStateVariant[]): BlockStateVariant {
        if (!Array.isArray(variants)) return variants;
        if (!variants.length) throw new MineRenderError("Blockstate variant arrays must not be empty");
        const total = variants.reduce((sum, variant) => {
            const weight = variant.weight ?? 1;
            if (!Number.isInteger(weight) || weight < 1) {
                throw new MineRenderError(`Invalid blockstate variant weight: ${weight}`);
            }
            return sum + weight;
        }, 0);
        let choice = Math.random() * total;
        for (const variant of variants) {
            choice -= variant.weight ?? 1;
            if (choice < 0) return variant;
        }
        return variants[variants.length - 1];
    }

    // @deprecated
    protected async createAVariant(variants: BlockStateVariant | BlockStateVariant[], instanceInfo: Matrix4[]) {
        const variant = this.getSingleVariant(variants);
        await this.createVariant(variant);
    }

    protected async createVariant(variant: BlockStateVariant): Promise<ModelObject | InstanceReference<ModelObject>> {
        const rotation = new Euler();
        if (typeof variant.x !== "undefined") {
            rotation.x = toRadians(clampRotationDegrees(variant.x));
        }
        if (typeof variant.y !== "undefined") {
            rotation.y = toRadians(clampRotationDegrees(typeof variant.x !== "undefined" ? variant.y : 360 - variant.y));
        }

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
        console.log(this.children)
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
      console.log(this.children)
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
