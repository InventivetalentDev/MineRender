import { SceneObject } from "../SceneObject";
import { BlockState, BlockStateVariant, BlockStateVariants, MultipartCondition } from "../../model/BlockState";
import { SceneObjectOptions } from "../SceneObjectOptions";
import { isModelObject, ModelObject, ModelObjectOptions } from "./ModelObject";
import { Caching } from "../../cache/Caching";
import { Models } from "../../model/Models";
import { Assets } from "../../assets/Assets";
import merge from "ts-deepmerge";
import { Matrix4, Vector3 } from "three";
import { toRadians } from "../../util/util";
import { applyGenericRotation } from "../../util/model";
import { Axis } from "../../Axis";
import { MineRenderError } from "../../error/MineRenderError";
import { isInstancedMesh } from "../../util/three";
import { dbg } from "../../util/debug";
import { types } from "util";

export class BlockObject extends SceneObject {

    public readonly isBlockObject: true = true;

    public static readonly DEFAULT_OPTIONS: BlockObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <BlockObjectOptions>{});
    public readonly options: ModelObjectOptions;

    private _state: { [key: string]: string; } = {};

    constructor(readonly blockState: BlockState, options?: Partial<BlockObjectOptions>) {
        super();
        this.options = merge({}, BlockObject.DEFAULT_OPTIONS, options ?? {});
        //TODO
    }

    async init(): Promise<void> {
        if (this.blockState.variants) {
            await this.setState(Object.keys(this.blockState.variants)[0]);
        } else {
            //TODO: multipart default state
            await this.recreateModels();
        }
        //TODO
    }

    dispose() {
        super.dispose();
    }

    public get state(): { [key: string]: string; } {
        return this._state;
    }

    public async recreateModels(): Promise<void> {
        this.disposeAndRemoveAllChildren();

        //TODO: might want to preload all possible states & cache their data

        if (this.blockState.variants) {
            if (Object.keys(this.blockState.variants).length === 1 && "" in this.blockState.variants) { // default variant
                await this.createAVariant(this.blockState.variants[""]);
            }
            for (let variantKey in this.blockState.variants) {
                const split = variantKey.split(",");
                let matches = true;
                for (let s of split) {
                    const [k, v] = s.split("=");
                    if (this.state[k] !== v) {
                        matches = false;
                        break;
                    }
                }
                if (matches) {
                    const variants = this.blockState.variants[variantKey];
                    await this.createAVariant(variants);
                }
            }
        } else if (this.blockState.multipart) {
            for (let part of this.blockState.multipart) {
                if (!part.apply) {
                    dbg("Missing apply for blockState part %O", part);
                    continue;
                }
                if (!part.when) { // no condition -> always apply
                    await this.createAVariant(part.apply);
                } else {
                    let matches = true;
                    // TODO: apparently AND is a thing too (https://yeleha.co/31Jec6P)
                    if ("OR" in part.when) {
                        const or = part.when.OR as MultipartCondition[];
                        let anyMatch = false;
                        for (let o of or) {
                            for (let k in o) {
                                const split = o[k].split("|");
                                let m = false;
                                for (let s of split) {
                                    if (this.state[k] === s) {
                                        m = true;
                                        break;
                                    }
                                }
                                if (m) {
                                    anyMatch = true;
                                    break;
                                }
                            }
                        }
                        if (!anyMatch) {
                            matches = false;
                        }
                    } else {
                        for (let k in part.when) {
                            const split = part.when[k].split("|");
                            let m = false;
                            for (let s of split) {
                                if (this.state[k] === s) {
                                    m = true;
                                    break;
                                }
                            }
                            if (!m) { // none of the possible values match
                                matches = false;
                                break;
                            }
                        }
                    }
                    if (matches) {
                        const variants = part.apply;
                        await this.createAVariant(variants);
                    }
                }
            }
        }
    }

    protected async createAVariant(variants: BlockStateVariant | BlockStateVariant[]) {
        let variant: BlockStateVariant;
        if (Array.isArray(variants)) {
            //TODO: randomizer option / weights
            variant = (<BlockStateVariant[]>variants)[0];
        } else {
            variant = variants as BlockStateVariant;
        }

        await this.createVariant(variant);
    }

    protected async createVariant(variant: BlockStateVariant): Promise<void> {
        //TODO: uvlock
        //TODO: default state?
        const model = await Models.getMerged(Assets.parseAssetKey("models", variant.model!));
        const obj = new ModelObject(model!, this.options);
        await obj.init();
        if (obj.isInstanced) {
            this._isInstanced = true;
        }

        if (variant.x) {
            applyGenericRotation(Axis.X, variant.x, obj);
        }
        if (variant.y) {
            applyGenericRotation(Axis.Y, variant.y, obj);
        }

        this.add(obj);
    }

    public async resetState() {
        this._state = {};
        await this.recreateModels();
    }

    public async setState(string: string);
    public async setState(key: string, value: string);
    public async setState(stringOrKey: string, value?: string) {
        this._setState(stringOrKey, value);
        await this.recreateModels();
    }

    protected _setState(stringOrKey: string, value?: string): void {
        if (typeof value === "undefined") { // a=b,c=d,...
            if (stringOrKey === "") return;
            const split = stringOrKey.split(",");
            for (let s of split) {
                let [k, v] = s.split("=");
                this._setState(k, v);
            }
        } else {
            this._state[stringOrKey] = value;
        }
    }

    getMatrixAt(index: number, matrix: Matrix4 = new Matrix4()): Matrix4 {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        const child = this.children[0];
        if (isModelObject(child)) {
            if (!child.isInstanced) throw new MineRenderError("Object is not instanced");
            child.getMatrixAt(index, matrix);
        }
        return matrix;
    }

    setMatrixAt(index: number, matrix: Matrix4) {
        if (!this.isInstanced) throw new MineRenderError("Object is not instanced");
        for (let child of this.children) {
            if (isModelObject(child)) {
                if (!child.isInstanced) throw new MineRenderError("Object is not instanced");
                child.setMatrixAt(index, matrix);
            }
        }
    }

    //TODO

}

export interface BlockObjectOptions extends ModelObjectOptions {

}

export function isBlockObject(obj: any): obj is BlockObject {
    return (<BlockObject>obj).isBlockObject;
}
