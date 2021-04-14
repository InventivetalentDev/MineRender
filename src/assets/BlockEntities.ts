import blockEntityModels from "../entity/blockEntityModels.json";
import { BasicAssetKey } from "./AssetKey";
import { BlockEntityModel } from "../entity/BlockEntityModel";

export class BlockEntities {

    // BlockEntity names are hardcoded
    public static async getList(): Promise<string[]> {
        return Object.keys(blockEntityModels);
    }

    public static async get(key: BasicAssetKey): Promise<BlockEntityModel> {
        return {
            key: key,
            parts: blockEntityModels[key.toNamespacedString()]
        }
    }


}
