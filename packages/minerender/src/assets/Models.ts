import { ItemModel, ItemTintSource, Model, SpecialItemRenderer } from "../model/Model";
import { Caching } from "../cache/Caching";
import { Maybe } from "../util/util";
import { ModelMerger } from "../model/ModelMerger";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE } from "./Assets";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetKey } from "./AssetKey";
import { ListAsset } from "../ListAsset";
import { AssetParser } from "./source/parser/AssetParsers";
import { DisplayPosition } from "../model/DisplayPosition";

/** Item-preview state passed to {@link Models.getMerged}. Other gameplay properties use their defaults. */
export interface ItemModelContext {
    /** Context used by item-definition selectors. Defaults to GUI. */
    displayContext?: DisplayPosition | "none";
    /** Selected bundle item, such as `AssetKey.parse("models", "minecraft:item/apple")`. Omit for a closed bundle. */
    bundleSelectedItem?: AssetKey;
}

/** Loads and caches Java block/item models, including inherited geometry and textures. */
export class Models {

    private static _persistentCache: PersistentCache | undefined;

    // opened lazily: touching the store at import time would hit IndexedDB/disk just for loading
    // the library, and would require an EnvProvider before any entry has had a chance to register
    private static get PERSISTENT_CACHE(): PersistentCache {
        return this._persistentCache ??= PersistentCache.open("minerender-models");
    }

    /** Lists item filenames from the asset source's `_list.json`, with a legacy model-directory fallback. */
    public static async getItemList(): Promise<string[]> {
        const key = new AssetKey(DEFAULT_NAMESPACE, "_list", "items");
        const legacyKey = new AssetKey(DEFAULT_NAMESPACE, "_list", "models", "item");
        return Caching.listAssetCache.get(key.serialize(), async () => {
            return (await AssetLoader.getFirst<ListAsset>([key, legacyKey], AssetParser.LIST))?.asset;
        }).then(r => r?.files ?? []);
    }

    public static async loadAndMerge(key: AssetKey, context: ItemModelContext = {}): Promise<Maybe<Model>> {
        const model = key.type === "item" ? await this.getItemModel(key, context) : await this.getRaw(key);
        if (!model) {
            return undefined;
        }
        return ModelMerger.mergeWithParents(model);
    }

    private static async getItemModel(key: AssetKey, context: ItemModelContext = {}): Promise<Maybe<Model>> {
        context = this.snapshotContext(key, context);
        const itemKey = new AssetKey(key.namespace, key.path, "items", undefined, key.rootType, ".json", key.root);
        const cacheKey = itemKey.serialize() + this.contextKey(context);
        const model = await this.PERSISTENT_CACHE.getOrLoad(`item-v2:${AssetLoader.persistentKey(cacheKey)}`, async () => {
            const result = await AssetLoader.getFirst<Model & { model?: ItemModelNode }>([itemKey, key], AssetParser.JSON);
            if (!result) return undefined;
            if (result.key.assetType !== "items") return { ...result.asset, key } as ItemModel;

            const load = async (selected: SelectedItemModel): Promise<ItemModel> => {
                if ("parts" in selected) {
                    return { key, parts: await Promise.all(selected.parts.map(load)) };
                }
                if ("item" in selected) {
                    // The selected stack has its own contents, not the outer bundle's selection.
                    const model = await this.getItemModel(selected.item, { displayContext: context.displayContext });
                    if (!model) throw new Error(`Item ${key.toNamespacedString()} references missing bundle item ${selected.item.toNamespacedString()}`);
                    return model as ItemModel;
                }
                const modelKey = AssetKey.parse("models", selected.model);
                modelKey.root = key.root;
                const model = await this.getRaw(modelKey);
                if (!model) throw new Error(`Item ${key.toNamespacedString()} references missing model ${selected.model}`);
                // Relative texture paths belong to the referenced model's namespace.
                return { ...model, ...(selected.special && { special: selected.special }), ...(selected.tints && { tints: selected.tints }) } as ItemModel;
            };
            return load(this.selectItemModel(result.asset.model, key, context));
        });
        const restore = (model: ItemModel): ItemModel => ({
            ...model, key: Object.assign(new AssetKey("", ""), model.key),
            ...(model.parts && { parts: model.parts.map(restore) })
        });
        return model ? restore(model) : undefined;
    }

    private static snapshotContext(key: AssetKey, context: ItemModelContext): ItemModelContext {
        const selected = context.bundleSelectedItem;
        return {
            displayContext: context.displayContext ?? DisplayPosition.GUI,
            bundleSelectedItem: selected && Object.assign(new AssetKey("", ""), selected, { root: selected.root ?? key.root })
        };
    }

    private static contextKey(context: ItemModelContext): string {
        if (context.displayContext === DisplayPosition.GUI && !context.bundleSelectedItem) return "";
        return `|item:${JSON.stringify([context.displayContext, context.bundleSelectedItem?.serialize() ?? null])}`;
    }

    // Unspecified conditions are false and numeric properties are zero.
    private static selectItemModel(node: ItemModelNode | undefined, key: AssetKey, context: ItemModelContext): SelectedItemModel {
        if (!node || typeof node.type !== "string") {
            throw new Error(`Unsupported item model definition for ${key.toNamespacedString()}`);
        }
        switch (node.type.replace(/^minecraft:/, "")) {
            case "composite":
                if (Array.isArray(node.models)) return { parts: node.models.map(child => this.selectItemModel(child, key, context)) };
                break;
            case "bundle/selected_item":
                return context.bundleSelectedItem ? { item: context.bundleSelectedItem } : { parts: [] };
            case "model":
                if (typeof node.model === "string" && node.model) return { model: node.model, tints: node.tints };
                break;
            case "special": {
                if (!node.base || !node.model || typeof node.model !== "object") break;
                const special = node.model;
                switch (special.type) {
                    case "chest":
                    case "minecraft:chest":
                    case "bed":
                    case "minecraft:bed":
                        if (typeof special.texture === "string" && special.texture) return { model: node.base, special };
                        break;
                    case "head":
                    case "minecraft:head":
                        if (typeof special.kind === "string" && special.kind) return { model: node.base, special };
                        break;
                }
                throw new Error(`Unsupported special item renderer ${special.type} for ${key.toNamespacedString()}`);
            }
            case "condition": {
                const selected = node.property?.replace(/^minecraft:/, "") === "bundle/has_selected_item" && !!context.bundleSelectedItem;
                return this.selectItemModel(selected ? node.on_true : node.on_false, key, context);
            }
            case "select": {
                const selected = node.property?.replace(/^minecraft:/, "") === "display_context"
                    ? node.cases?.find(entry => Array.isArray(entry.when) ? entry.when.includes(context.displayContext!) : entry.when === context.displayContext)?.model
                    : undefined;
                return this.selectItemModel(selected ?? node.fallback, key, context);
            }
            case "range_dispatch": {
                const selected = node.entries?.reduce<{ threshold: number; model: ItemModelNode } | undefined>((match, entry) => {
                    return entry.threshold <= 0 && (!match || entry.threshold >= match.threshold) ? entry : match;
                }, undefined);
                return this.selectItemModel(selected?.model ?? node.fallback, key, context);
            }
        }
        throw new Error(`Unsupported item model ${node?.type ?? "definition"} for ${key.toNamespacedString()}`);
    }

    /** Loads one model file without resolving its parents. Returns `undefined` when the file is missing. */
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
            return this.PERSISTENT_CACHE.getOrLoad(AssetLoader.persistentKey(keyStr), k1 => {
                return AssetLoader.get<Model>(key, AssetParser.MODEL);
            })
        }).then(asset => {
            if (asset) {
                asset.key = key;
            }
            return asset;
        })
    }

    /**
     * Loads a model and resolves its parent chain. Returns `undefined` when the model is missing.
     * Item keys default to GUI context, false conditions, and zero numeric properties.
     * Pass `context` to select a display context or preview a bundle's selected item.
     * Composite items retain independently merged children in `ItemModel.parts`.
     *
     * @param key - Model key, for example `AssetKey.parse("models", "minecraft:item/diamond_sword")`.
     */
    public static async getMerged(key: AssetKey, context: ItemModelContext = {}): Promise<Maybe<Model>> {
        if (!key.assetType) {
            key.assetType = "models";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        context = this.snapshotContext(key, context);
        const keyStr = key.serialize() + (key.type === "item" ? this.contextKey(context) : "");
        return Caching.mergedModelCache.get(keyStr, k => {
            //TODO: persistent cache
            return Models.loadAndMerge(key, context);
        });
    }

    /** Alias for {@link getMerged}. */
    public static async get(key: AssetKey, context: ItemModelContext = {}): Promise<Maybe<Model>> {
        return this.getMerged(key, context);
    }

    /** Clears persisted models. Use {@link Caching.clear} to also discard in-memory assets. */
    public static async clearCache() {
        return this.PERSISTENT_CACHE.clear();
    }

}

interface ItemModelNode {
    type: string;
    model?: string | SpecialItemRenderer;
    tints?: ItemTintSource[];
    base?: string;
    property?: string;
    on_false?: ItemModelNode;
    on_true?: ItemModelNode;
    fallback?: ItemModelNode;
    cases?: Array<{ when: string | string[]; model: ItemModelNode }>;
    entries?: Array<{ threshold: number; model: ItemModelNode }>;
    models?: ItemModelNode[];
}

type SelectedItemModel = { model: string; special?: SpecialItemRenderer; tints?: ItemTintSource[] }
    | { parts: SelectedItemModel[] }
    | { item: AssetKey };
