import { AssetKey, BasicAssetKey } from "./AssetKey";
import { EntityModel } from "../entity/EntityModel";
import { MinecraftAsset } from "../MinecraftAsset";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source";
import { Maybe } from "../util";
import { Caching } from "../cache/Caching";
import { ModelTextures } from "./ModelTextures";
import { ModelPart } from "../model/ModelPart";
import entityTextures from "../entity/entityTextures.json";

interface EntityTexture {
    // Paths are relative to textures/entity/; unqualified paths use the model namespace.
    path: string;
    // Logical UV dimensions, independent of the resource pack's image resolution.
    textureWidth?: number;
    textureHeight?: number;
}

const ENTITY_TEXTURES: Record<string, EntityTexture[]> = entityTextures;

function withTextureSize(part: ModelPart, texture: EntityTexture): ModelPart {
    return {
        ...part,
        textureWidth: texture.textureWidth ?? part.textureWidth,
        textureHeight: texture.textureHeight ?? part.textureHeight,
        children: part.children.map(child => withTextureSize(child, texture))
    };
}

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
        const modelId = `${modelKey.namespace}:${modelKey.path}`;
        const baseId = `${modelKey.namespace}:${modelKey.path.split("/")[0]}`;
        let parts: EntityModel["parts"] = models[modelId] ?? models[baseId];
        const definitions = ENTITY_TEXTURES[modelId] ?? ENTITY_TEXTURES[baseId] ?? [];
        const textures = definitions.map(definition => {
            const [namespace, path] = definition.path.includes(":") ? definition.path.split(":") : [modelKey.namespace, definition.path];
            return { ...definition, key: new AssetKey(namespace, path, "textures", "entity", "assets", ".png") };
        });
        // Variant paths without their own model or metadata remain explicit texture paths.
        if (!textureKey && parts && textures.length && (models[modelId] || ENTITY_TEXTURES[modelId])) {
            const keys = textures.map(texture => texture.key);
            const texture = await ModelTextures.preload(keys[0], keys.slice(1));
            textureKey = texture?.key;
        }
        textureKey ??= modelKey;
        const texture = textures.find(({ key }) => key.namespace === textureKey.namespace && key.path === textureKey.path);
        if (parts && texture && (texture.textureWidth !== undefined || texture.textureHeight !== undefined)) {
            parts = Object.fromEntries(Object.entries(parts).map(([name, part]) => [name, withTextureSize(part, texture)]));
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
