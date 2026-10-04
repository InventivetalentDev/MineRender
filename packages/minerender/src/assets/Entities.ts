import { AssetKey, BasicAssetKey } from "./AssetKey";
import type { EntityModel, EntityModelFile } from "../entity/EntityModel";
import { AssetLoader } from "./AssetLoader";
import { AssetParser } from "./source";
import { Maybe } from "../util";
import { Caching } from "../cache/Caching";
import { DEFAULT_NAMESPACE } from "./Assets";
import type { ListAsset } from "../ListAsset";
import { MineRenderError } from "../error/MineRenderError";

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
        const key = new AssetKey(modelKey.namespace, modelKey.path, undefined, undefined, "entity-models", ".json");
        const model = await Caching.entityModelCache.get(key.serialize(), () => AssetLoader.get<EntityModelFile>(key, AssetParser.JSON));
        if (!model) return undefined;
        const layerName = options?.layer ?? "main";
        const layer = model.layers[layerName];
        if (!layer) {
            throw new MineRenderError(`Entity ${model.id} has no layer "${layerName}". Available layers: ${Object.keys(model.layers).join(", ")}`);
        }
        return { key: textureKey ?? modelKey, layer, id: model.id };
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
