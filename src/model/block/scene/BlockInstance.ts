import { InstanceReference } from "../../../instance/InstanceReference";
import { BlockObject } from "./BlockObject";
import { BlockStateProperties } from "../BlockStateProperties";

export class BlockInstance extends InstanceReference<BlockObject> {

    public readonly isBlockInstance: true = true;

    public setState(string: string);
    public setState(state: BlockStateProperties);
    public setState(key: string, value: string);
    public setState(stringOrKeyOrState: string | BlockStateProperties, value?: string) {
        return this.instanceable.setStateAt(this.index, stringOrKeyOrState, value);
    }

    public getState(): BlockStateProperties {
        return this.instanceable._getStateAt(this.index);
    }

}

export function isBlockInstance(obj: any): obj is BlockInstance {
    return (<BlockInstance>obj).isBlockInstance;
}
