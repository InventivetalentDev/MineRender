import { AssetKey, BasicAssetKey } from "./AssetKey";
import { EntityModel } from "../entity/EntityModel";
import { MinecraftAsset } from "../MinecraftAsset";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source";
import { Maybe } from "../util";
import { Memoize } from "typescript-memoize";

export class Entities {

    @Memoize()
    public static async getBlockEntityModels(): Promise<Maybe<BlockEntityModels>> {
        const key = AssetKey.parse("models", "minerender:blockEntityModels");
        console.log(key);
        return AssetLoader.get<BlockEntityModels>(key, AssetParser.JSON);
    }

    @Memoize()
    public static async getEntityModels(): Promise<Maybe<EntityModels>> {
        const key = AssetKey.parse("models", "minerender:entityModels");
        console.log(key);
        return AssetLoader.get<EntityModels>(key, AssetParser.JSON);
    }

    // BlockEntity names are hardcoded
    public static async getBlockList(): Promise<string[]> {
        const models = await this.getBlockEntityModels();
        if (!models) {
            return [];
        }
        return Object.keys(models);
    }

    public static async getEntityList(): Promise<string[]> {
        const models = await this.getEntityModels();
        if (!models) {
            return [];
        }
        return Object.keys(models);
    }

    public static async getBlock(modelKey: BasicAssetKey, textureKey?: BasicAssetKey): Promise<Maybe<EntityModel>> {
        const models = await this.getBlockEntityModels();
        if (!models) {
            return undefined;
        }
        if (!textureKey) {
            textureKey = modelKey;
        }
        const baseKey = modelKey.path.includes("/") ? new BasicAssetKey(modelKey.namespace, modelKey.path.split("\/")[0]) : modelKey;
        return {
            key: textureKey,
            parts: models[baseKey.toNamespacedString()]
        }
    }

    public static async getEntity(modelKey: BasicAssetKey, textureKey?: BasicAssetKey): Promise<Maybe<EntityModel>> {
        const models = await this.getEntityModels();
        if (!models) {
            return undefined;
        }
        if (!textureKey) {
            textureKey = modelKey
        }
        const baseKey = modelKey.path.includes("/") ? new BasicAssetKey(modelKey.namespace, modelKey.path.split("\/")[0]) : modelKey;
        return {
            key: textureKey,
            parts: models[baseKey.toNamespacedString()]
        }
    }


}

export class EntityModels implements MinecraftAsset {
    [k: string]: any;
}

export class BlockEntityModels implements MinecraftAsset {
    [k: string]: any;
}
