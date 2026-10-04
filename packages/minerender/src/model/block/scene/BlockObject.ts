import { SceneObject } from "../../../renderer/SceneObject";
import { BlockState, BlockStateVariant, BlockStateVariants, MultipartCondition } from "../BlockState";
import { SceneObjectOptions } from "../../../renderer/SceneObjectOptions";
import { isModelObject, ModelObject, ModelObjectOptions } from "../../scene/ModelObject";
import { Caching } from "../../../cache/Caching";
import { Models } from "../../../assets/Models";
import merge from "ts-deepmerge";
import { Euler, Matrix4, Vector3 } from "three";
import { clampRotationDegrees, Maybe, toRadians } from "../../../util/util";
import { MineRenderError } from "../../../error/MineRenderError";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../BlockStateProperties";
import { BlockStates } from "../../../assets/BlockStates";
import { InstanceReference, isInstanceReference } from "../../../instance/InstanceReference";
import { AssetKey } from "../../../assets/AssetKey";
import { prefix } from "../../../util/log";

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
                await this.setState(state);
            } else { // fallback to guessing from blockState definition
                if (this.blockState.variants) {
                    await this.setState(Object.keys(this.blockState.variants)[0]);
                } else if (this.blockState.multipart) {
                    // Guess preview values only from a flat condition; logical groups need a known state.
                    const condition = this.blockState.multipart.map(part => part.when)
                        .find((when): when is Record<string, string> =>
                            when !== undefined && Object.values(when).every(value => typeof value === "string"));
                    const state = Object.fromEntries(Object.entries(condition ?? {})
                        .map(([key, value]) => [key, value.split("|")[0]]));
                    await this.setState(state);
                }
            }
        } else {
            await this.recreateModels();
        }
        //TODO
    }

    dispose() {
        super.dispose();
    }

    removeFromScene() {
        for (let model of this._models) {
            if (isModelObject(model)) {
                model.removeFromScene();
            } else if (isInstanceReference(model)) {
                model.setScale(new Vector3(0, 0, 0));
            }
        }
        super.removeFromScene();
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

        // Copy current instance info
        const instanceInfo: Matrix4[] = [];
        if (this.isInstanced) {
            for (let i = 0; i < this.instanceCounter; i++) {
                instanceInfo[i] = this.getMatrixAt(i);
            }
        }

        // Remove all children
        // this.disposeAndRemoveAllChildren(); //TODO: just removes all children of all instances atm...

        // TODO: try to reuse models instead of just removing them and creating new ones
        for (let model of this._models) {
            if (isInstanceReference(model)) {
                model.setScale(new Vector3(0, 0, 0));//TODO
            } else {
                model.dispose();
            }
        }
        while (this._models.length > 0) {
            this._models.shift();
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
        const variantsToCreate = await this.mapStateToVariant(this.state);
        this._variants = variantsToCreate;
        for (let blockStateVariant of variantsToCreate) {
            this._models.push(await this.createVariant(blockStateVariant));
        }
        /*
    }

         */

        // console.log(instanceInfo);
        // // Re-apply instances
        // if (instanceInfo.length>0) {
        //     for (let i = 0; i < instanceInfo.length; i++) {
        //         this.setMatrixAt(i, instanceInfo[i]);
        //     }
        // }
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
        //TODO: uvlock
        //TODO: default state?
        const model = await Models.getMerged(AssetKey.parse("models", variant.model!));
        const obj: ModelObject | InstanceReference<ModelObject> = await this.scene.addModel(model!, this.options);
        /*
        const obj = new ModelObject(model!, this.options);
        await obj.init();
         */
        if (isInstanceReference(obj) || (<ModelObject>obj).isInstanced) {
            this._isInstanced = true;
            this._instanceCounter = 1;//TODO: BlockObject itself isn't technically instanced, but needs the id for the get/setMatrix calls to work properly
            /*
            if (isInstanceReference(obj)) {
                this._instanceCounter = obj.index;
            } else {
                this._instanceCounter = (<ModelObject>obj).instanceCounter;
            }
            */
        }


        /*
        // Re-apply instance info as a base
        if (instanceInfo.length > 0) {
            for (let i = 0; i < instanceInfo.length; i++) {
                obj.setMatrixAt(i, instanceInfo[i]);
            }
        }
         */

        let rotation = new Euler(0, 0, 0);
        if (typeof variant.x !== "undefined") {
            // obj.rotation.x = toRadians(variant.x);
            // obj.rotation.set(obj.rotation.x + toRadians(variant.x), obj.rotation.y, obj.rotation.z);
            // for (let child of obj.children) {
            //     // applyGenericRotation(Axis.X, variant.x, child);
            //     child.rotation.x = toRadians(variant.x);
            // }
            // this.setRotationAt(0, new Euler(variant.x, 0, 0));
            rotation.x = toRadians(clampRotationDegrees(variant.x));
        }
        if (typeof variant.y !== "undefined") {
            // obj.rotation.y = toRadians(variant.y);
            // obj.rotation.set(obj.rotation.x, obj.rotation.y + toRadians(variant.y), obj.rotation.z);
            // for (let child of obj.children) {
            //     // applyGenericRotation(Axis.Y, variant.y, child);
            //     child.rotation.y = toRadians(variant.y);
            // }
            // this.setRotationAt(0, new Euler(0, variant.y, 0));
            // Y-Rotations are weird...
            if(typeof variant.x!=="undefined"){
                rotation.y = toRadians(clampRotationDegrees(variant.y));
            }else{
                rotation.y = toRadians(clampRotationDegrees(360-variant.y));
            }
        }
        // console.log(obj.isInstanced);
        obj.setRotation(rotation);
        console.log(obj)

        /*
        this.add(obj);

        if (this.options.wireframe) {
            addWireframeToObject(this, 0xff0000, 2)
        }
         */
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
}

export function isBlockObject(obj: any): obj is BlockObject {
    return (<BlockObject>obj).isBlockObject;
}
