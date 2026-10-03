import { AssetKey, BasicAssetKey } from "./AssetKey";
import { EntityModel } from "../entity/EntityModel";
import { MinecraftAsset } from "../MinecraftAsset";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source";
import { Maybe } from "../util";
import { Caching } from "../cache/Caching";
import { ModelTextures } from "./ModelTextures";
import { DEFAULT_NAMESPACE } from "./Assets";

const ENTITY_TEXTURE_PATHS: Record<string, string[]> = {
    chicken: ["chicken", "chicken/temperate_chicken"],
    pig: ["pig", "pig/pig", "pig/temperate_pig"],
    cow: ["cow", "cow/cow", "cow/temperate_cow"]
};

export class Entities {

    public static async getBlockEntityModels(): Promise<Maybe<BlockEntityModels>> {
        const key = AssetKey.parse("models", "minerender:blockEntityModels");
        console.log(key);
        return Caching.entityModelsCache.get(key.serialize(), () => {
            return AssetLoader.get<BlockEntityModels>(key, AssetParser.JSON);
        });
    }

    public static async getEntityModels(): Promise<Maybe<EntityModels>> {
        const key = AssetKey.parse("models", "minerender:entityModels");
        console.log(key);
        return Caching.entityModelsCache.get(key.serialize(), () => {
            return AssetLoader.get<EntityModels>(key, AssetParser.JSON);
        });
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
        const texturePaths = modelKey.namespace === DEFAULT_NAMESPACE && ENTITY_TEXTURE_PATHS[modelKey.path];
        const baseKey = modelKey.path.includes("/") ? new BasicAssetKey(modelKey.namespace, modelKey.path.split("\/")[0]) : modelKey;
        let parts: EntityModel["parts"] = models[baseKey.toNamespacedString()];
        if (!textureKey && texturePaths && parts) {
            const keys = texturePaths.map(path => new AssetKey(modelKey.namespace, path, "textures", "entity", "assets", ".png"));
            const texture = await ModelTextures.preload(keys[0], keys.slice(1));
            textureKey = texture?.key;
        }
        textureKey ??= modelKey;
        if (parts && baseKey.namespace === DEFAULT_NAMESPACE && textureKey.namespace === DEFAULT_NAMESPACE &&
            ["pig", "cow"].includes(baseKey.path) && textureKey.path === `${baseKey.path}/temperate_${baseKey.path}`) {
            // Modern farm-animal atlases keep the legacy regions in the upper half.
            parts = Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, {
                ...part,
                textureHeight: part.textureHeight === 32 ? 64 : part.textureHeight
            }]));
        }
        return {
            key: textureKey,
            parts
        }
    }


}

export class EntityModels implements MinecraftAsset {
    [k: string]: any;
}

export class BlockEntityModels implements MinecraftAsset {
    [k: string]: any;
}
