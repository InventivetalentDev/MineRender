import { AssetKey, BasicAssetKey, isAssetKey } from "./AssetKey";
import type { EntityModel, EntityModelFile } from "../entity/EntityModel";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source";
import { Maybe } from "../util";
import { Caching } from "../cache/Caching";
import { DEFAULT_NAMESPACE } from "./Assets";
import type { ListAsset } from "../ListAsset";
import { MineRenderError } from "../error/MineRenderError";
import { ModelTextures } from "./ModelTextures";
import type { MinecraftAsset } from "../MinecraftAsset";

export class Entities {

    public static async getEntityList(): Promise<string[]> {
        const collect = async (path: string): Promise<string[]> => {
            const prefix = path ? `${path}/` : "";
            const key = new AssetKey(DEFAULT_NAMESPACE, `${prefix}_list`, undefined, undefined, "entity-models", ".json");
            const list = await Caching.listAssetCache.get(key.serialize(), () => AssetLoader.get<ListAsset>(key, AssetParser.LIST));
            if (!list) return [];
            const files = list.files.filter(file => file.endsWith(".json") && file !== "_list.json")
                .map(file => `${prefix}${file.slice(0, -5)}`);
            const children = await Promise.all(list.directories.map(directory => collect(`${prefix}${directory}`)));
            return [...files, ...children.flat()];
        };
        return collect("");
    }

    public static async getEntity(modelKey: BasicAssetKey, textureKey?: BasicAssetKey, options?: EntityModelOptions): Promise<Maybe<EntityModel>> {
        const path = isAssetKey(modelKey) ? modelKey.getFullPath() : modelKey.path;
        const key = new AssetKey(modelKey.namespace, path, undefined, undefined, "entity-models", ".json");
        const model = await Caching.entityModelCache.get(key.serialize(), () => AssetLoader.get<EntityModelFile>(key, AssetParser.JSON));
        if (!model) return undefined;
        const layerName = options?.layer ?? "main";
        const layer = model.layers[layerName];
        if (!layer) {
            throw new MineRenderError(`Entity ${model.id} has no layer "${layerName}". Available layers: ${Object.keys(model.layers).join(", ")}`);
        }
        let texture: Maybe<AssetKey>;
        if (textureKey) {
            const path = isAssetKey(textureKey) ? textureKey.getFullPath() : textureKey.path;
            texture = isAssetKey(textureKey) && textureKey.assetType === "textures" && path.startsWith("entity/")
                ? textureKey
                : new AssetKey(textureKey.namespace, path, "textures", "entity", "assets", ".png", isAssetKey(textureKey) ? textureKey.root : undefined);
        } else {
            texture = await this.resolveTexture(modelKey);
        }
        return { key: textureKey ?? modelKey, texture, layer, id: model.id };
    }

    public static async resolveTexture(modelKey: BasicAssetKey): Promise<Maybe<AssetKey>> {
        const path = isAssetKey(modelKey) ? modelKey.getFullPath() : modelKey.path;
        const key = new AssetKey(modelKey.namespace, path, undefined, undefined, "entity-models", ".json");
        return Caching.entityTextureCache.get(key.serialize(), async () => {
            const name = path.split("/").pop()!;
            for (const candidate of [path, `${path}/${name}`]) {
                const texture = new AssetKey(modelKey.namespace, candidate, "textures", "entity", "assets", ".png");
                if (await ModelTextures.get(texture)) return texture;
            }
            const listKey = new AssetKey(modelKey.namespace, "_list", `${name}_variant`, undefined, "data", ".json");
            const list = await AssetLoader.get<ListAsset>(listKey, AssetParser.LIST);
            const files = list?.files.filter(file => file.endsWith(".json") && file !== "_list.json");
            const file = files?.find(file => file === "temperate.json") ?? files?.[0];
            if (!file) return undefined;
            const variantKey = new AssetKey(modelKey.namespace, file.slice(0, -5), `${name}_variant`, undefined, "data", ".json");
            const variant = await AssetLoader.get<EntityVariant>(variantKey, AssetParser.JSON);
            const assets = variant?.assets;
            const textureId = variant?.asset_id ?? (typeof assets?.wild === "string" ? assets.wild :
                Object.values(assets ?? {}).find(value => typeof value === "string"));
            return typeof textureId === "string" ? AssetKey.parse("textures", textureId) : undefined;
        });
    }

    /** @deprecated Use getEntityList(); block entities share the entity dataset. */
    public static getBlockList(): Promise<string[]> {
        return this.getEntityList();
    }

    /** @deprecated Use getEntity(); block entities share the entity dataset. */
    public static getBlock(modelKey: BasicAssetKey, textureKey?: BasicAssetKey, options?: EntityModelOptions): Promise<Maybe<EntityModel>> {
        return this.getEntity(modelKey, textureKey, options);
    }

}

export interface EntityModelOptions {
    layer?: string;
}

interface EntityVariant extends MinecraftAsset {
    asset_id?: string;
    assets?: Record<string, unknown>;
}
