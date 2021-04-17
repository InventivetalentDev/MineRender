import blockEntityModels from "../entity/blockEntityModels.json";
import entityModels from "../entity/entityModels.json";
import { BasicAssetKey } from "./AssetKey";
import { EntityModel } from "../entity/EntityModel";

export class Entities {

    // BlockEntity names are hardcoded
    public static async getBlockList(): Promise<string[]> {
        return Object.keys(blockEntityModels);
    }

    public static async getEntityList(): Promise<string[]> {
        return Object.keys(entityModels);
    }

    public static async getBlock(modelKey: BasicAssetKey, textureKey?: BasicAssetKey): Promise<EntityModel> {
        if (!textureKey) {
            textureKey = modelKey
        }
        const baseKey = modelKey.path.includes("/") ? new BasicAssetKey(modelKey.namespace, modelKey.path.split("\/")[0]) : modelKey;
        return {
            key: textureKey,
            parts: blockEntityModels[baseKey.toNamespacedString()]
        }
    }

    public static async getEntity(modelKey: BasicAssetKey, textureKey?: BasicAssetKey): Promise<EntityModel> {
        if (!textureKey) {
            textureKey = modelKey
        }
        const baseKey = modelKey.path.includes("/") ? new BasicAssetKey(modelKey.namespace, modelKey.path.split("\/")[0]) : modelKey;
        return {
            key: textureKey,
            parts: entityModels[baseKey.toNamespacedString()]
        }
    }


}
