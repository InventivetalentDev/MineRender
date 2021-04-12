import { Renderer, RendererOptions } from "../Renderer";
import { SceneObjectOptions } from "../SceneObjectOptions";
import { SceneObject } from "../SceneObject";
import merge from "ts-deepmerge";
import { BlockStateProperties } from "../../model/BlockStateProperties";
import { BlockState } from "../../model/BlockState";
import { BlockEntityObject, BlockEntityObjectOptions } from "./BlockEntityObject";

export class EntityObject extends SceneObject {

    public readonly isEntityObject: true = true;

    public static readonly DEFAULT_OPTIONS: EntityObjectOptions = merge({}, SceneObject.DEFAULT_OPTIONS, <EntityObjectOptions>{
    });
    public readonly options: EntityObjectOptions;

    constructor(readonly blockState: BlockState, options?: Partial<EntityObjectOptions>) {
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

export interface EntityObjectOptions extends SceneObjectOptions {

}

export function isEntityObject(obj: any): obj is EntityObject {
    return (<EntityObject>obj).isEntityObject;
}
