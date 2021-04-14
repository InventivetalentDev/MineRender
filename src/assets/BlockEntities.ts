import blockEntityModels from "../entity/blockEntityModels.json";
import { BasicAssetKey } from "./AssetKey";
import { BlockEntityModel } from "../entity/BlockEntityModel";

export class BlockEntities {

    // BlockEntity names are hardcoded
    public static async getList(): Promise<string[]> {
        return Object.keys(blockEntityModels);
    }

    public static async get(modelKey: BasicAssetKey, textureKey?: BasicAssetKey): Promise<BlockEntityModel> {
        if (!textureKey) {
            textureKey = modelKey
        }
        const baseKey = modelKey.path.includes("/") ? new BasicAssetKey(modelKey.namespace, modelKey.path.split("\/")[0]) : modelKey;
        return {
            key: textureKey,
            parts: blockEntityModels[baseKey.toNamespacedString()]
        }
    }


}
