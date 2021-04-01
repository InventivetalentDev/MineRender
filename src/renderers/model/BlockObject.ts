import { SceneObject } from "../SceneObject";
import { BlockState, BlockStateVariant, BlockStateVariants } from "../../model/BlockState";
import { SceneObjectOptions } from "../SceneObjectOptions";
import { ModelObject, ModelObjectOptions } from "./ModelObject";
import { Caching } from "../../cache/Caching";
import { Models } from "../../model/Models";
import { Assets } from "../../assets/Assets";
import merge from "ts-deepmerge";

export class BlockObject extends SceneObject {

    public static readonly DEFAULT_OPTIONS: BlockObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <BlockObjectOptions>{});
    public readonly options: ModelObjectOptions;

    private _state: { [key: string]: string; } = {};

    constructor(readonly blockState: BlockState, options?: Partial<BlockObjectOptions>) {
        super();
        this.options = merge({}, BlockObject.DEFAULT_OPTIONS, options ?? {});
        //TODO
    }

    async init(): Promise<void> {
        await this.recreateModels();
        //TODO
    }

    dispose() {
        super.dispose();
    }

    public get state(): { [key: string]: string; } {
        return this._state;
    }

    public async recreateModels() {
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
            //TODO
        }
    }

    protected async createAVariant(variants: BlockStateVariant | BlockStateVariant[]) {
        let variant: BlockStateVariant;
        if (Array.isArray(variants)) {
            //TODO: randomizer option
            variant = (<BlockStateVariant[]>variants)[0];
        } else {
            variant = variants as BlockStateVariant;
        }

        await this.createVariant(variant);
    }

    protected async createVariant(variant: BlockStateVariant) {
        //TODO: rotation
        return Models.getMerged(Assets.parseAssetKey("models", variant.model!)).then(model => {
            const obj = new ModelObject(model!, this.options);
            obj.init();
            this.add(obj);
        });
    }

    public resetState() {
        this._state = {};
    }

    public setState(string: string);
    public setState(key: string, value: string);
    public setState(stringOrKey: string, value?: string) {
        this._setState(stringOrKey, value);
        this.recreateModels();
    }

    protected _setState(stringOrKey: string, value?: string) {
        if (!value) { // a=b,c=d,...
            const split = stringOrKey.split(",");
            for (let s of split) {
                let [k, v] = s.split("=");
                this._setState(k, v);
            }
        } else {
            this._state[stringOrKey] = value;
        }
    }

    //TODO

}

export interface BlockObjectOptions extends SceneObjectOptions {

}
