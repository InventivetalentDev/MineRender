import { SceneObject } from "../SceneObject";
import { BlockState, BlockStateVariant, BlockStateVariants, MultipartCondition } from "../../model/BlockState";
import { SceneObjectOptions } from "../SceneObjectOptions";
import { Caching } from "../../cache/Caching";
import { Models } from "../../assets/Models";
import { Assets } from "../../assets/Assets";
import merge from "ts-deepmerge";
import { Euler, Matrix4, Vector3 } from "three";
import { Maybe, toRadians } from "../../util/util";
import { addWireframeToObject, applyGenericRotation } from "../../util/model";
import { Axis } from "../../Axis";
import { MineRenderError } from "../../error/MineRenderError";
import { isInstancedMesh } from "../../util/three";
import { dbg } from "../../util/debug";
import { types } from "util";
import { BlockStateProperties, BlockStatePropertyDefaults } from "../../model/BlockStateProperties";
import { BlockStates } from "../../assets/BlockStates";
import { InstanceReference } from "../../instance/InstanceReference";
import { EntityObject } from "./EntityObject";

export class BlockEntityObject extends SceneObject {

    public readonly isBlockEntityObject: true = true;

    public static readonly DEFAULT_OPTIONS: BlockEntityObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <BlockEntityObjectOptions>{
    });
    public readonly options: BlockEntityObjectOptions;


    constructor(readonly blockState: BlockState, options?: Partial<BlockEntityObjectOptions>) {
        super();
        this.options = merge({}, SceneObject.DEFAULT_OPTIONS, options ?? {});
        //TODO
    }

    async init(): Promise<void> {
        //TODO
    }

    dispose() {
        super.dispose();
    }

}

export interface BlockEntityObjectOptions extends SceneObjectOptions {
}

export function isBlockEntityObject(obj: any): obj is BlockEntityObject {
    return (<BlockEntityObject>obj).isBlockEntityObject;
}
