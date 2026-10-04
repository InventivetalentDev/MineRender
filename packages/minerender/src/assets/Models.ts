import { Model } from "../model/Model";
import { Caching } from "../cache/Caching";
import { Maybe } from "../util/util";
import { ModelMerger } from "../model/ModelMerger";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE } from "./Assets";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetKey } from "./AssetKey";
import { ListAsset } from "../ListAsset";
import { AssetParser } from "./source/parser/AssetParsers";

export class Models {

    private static _persistentCache: PersistentCache | undefined;

    // opened lazily: touching the store at import time would hit IndexedDB/disk just for loading
    // the library, and would require an EnvProvider before any entry has had a chance to register
    private static get PERSISTENT_CACHE(): PersistentCache {
        return this._persistentCache ??= PersistentCache.open("minerender-models");
    }

    public static async getItemList(): Promise<string[]> {
        const key = new AssetKey(DEFAULT_NAMESPACE, "_list", "items");
        const legacyKey = new AssetKey(DEFAULT_NAMESPACE, "_list", "models", "item");
        return Caching.listAssetCache.get(key.serialize(), async () => {
            return (await AssetLoader.getFirst<ListAsset>([key, legacyKey], AssetParser.LIST))?.asset;
        }).then(r => r?.files ?? []);
    }

    public static async loadAndMerge(key: AssetKey): Promise<Maybe<Model>> {
        const model = key.type === "item" ? await this.getItemModel(key) : await this.getRaw(key);
        if (!model) {
            return undefined;
        }
        return ModelMerger.mergeWithParents(model);
    }

    private static async getItemModel(key: AssetKey): Promise<Maybe<Model>> {
        const itemKey = new AssetKey(key.namespace, key.path, "items", undefined, key.rootType, ".json", key.root);
        const model = await this.PERSISTENT_CACHE.getOrLoad(itemKey.serialize(), async () => {
            const result = await AssetLoader.getFirst<Model & { model?: ItemModelNode }>([itemKey, key], AssetParser.JSON);
            if (!result) return undefined;
            if (result.key.assetType !== "items") return { ...result.asset, key };

            const reference = this.defaultItemModel(result.asset.model, key);
            const modelKey = AssetKey.parse("models", reference);
            modelKey.root = key.root;
            const model = await this.getRaw(modelKey);
            if (!model) throw new Error(`Item ${key.toNamespacedString()} references missing model ${reference}`);
            // Relative texture paths belong to the referenced model's namespace.
            return model;
        });
        return model ? { ...model, key: Object.assign(new AssetKey("", ""), model.key) } : undefined;
    }

    // Item previews use the GUI context, false conditions, and zero numeric properties.
    private static defaultItemModel(node: ItemModelNode | undefined, key: AssetKey): string {
        if (!node || typeof node.type !== "string") {
            throw new Error(`Unsupported item model definition for ${key.toNamespacedString()}`);
        }
        switch (node.type.replace(/^minecraft:/, "")) {
            case "model":
                if (typeof node.model === "string" && node.model) return node.model;
                break;
            case "condition":
                return this.defaultItemModel(node.on_false, key);
            case "select": {
                const selected = node.property?.replace(/^minecraft:/, "") === "display_context"
                    ? node.cases?.find(entry => Array.isArray(entry.when) ? entry.when.includes("gui") : entry.when === "gui")?.model
                    : undefined;
                return this.defaultItemModel(selected ?? node.fallback, key);
            }
            case "range_dispatch": {
                const selected = node.entries?.reduce<{ threshold: number; model: ItemModelNode } | undefined>((match, entry) => {
                    return entry.threshold <= 0 && (!match || entry.threshold >= match.threshold) ? entry : match;
                }, undefined);
                return this.defaultItemModel(selected?.model ?? node.fallback, key);
            }
        }
        throw new Error(`Unsupported item model ${node?.type ?? "definition"} for ${key.toNamespacedString()}`);
    }

    public static async getRaw(key: AssetKey): Promise<Maybe<Model>> {
        if (!key.assetType) {
            key.assetType = "models";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        const keyStr = key.serialize();
        //TODO: maybe add the asset source to the key
        return Caching.rawModelCache.get(keyStr, k => {
            return this.PERSISTENT_CACHE.getOrLoad(keyStr, k1 => {
                return AssetLoader.get<Model>(key, AssetParser.MODEL);
            })
        }).then(asset => {
            if (asset) {
                asset.key = key;
            }
            return asset;
        })
    }

    public static async getMerged(key: AssetKey): Promise<Maybe<Model>> {
        if (!key.assetType) {
            key.assetType = "models";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        const keyStr = key.serialize();
        return Caching.mergedModelCache.get(keyStr, k => {
            //TODO: persistent cache
            return Models.loadAndMerge(key);
        });
    }

    public static async get(key: AssetKey): Promise<Maybe<Model>> {
        return this.getMerged(key);
    }

    public static async clearCache() {
        return this.PERSISTENT_CACHE.clear();
    }

}

interface ItemModelNode {
    type: string;
    model?: string;
    property?: string;
    on_false?: ItemModelNode;
    fallback?: ItemModelNode;
    cases?: Array<{ when: string | string[]; model: ItemModelNode }>;
    entries?: Array<{ threshold: number; model: ItemModelNode }>;
}
