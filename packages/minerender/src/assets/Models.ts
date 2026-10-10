import { ItemModel, ItemTintSource, Model, SpecialItemRenderer } from "../model/Model";
import { Caching } from "../cache/Caching";
import { Maybe } from "../util/util";
import { ModelMerger } from "../model/ModelMerger";
import { AssetLoader } from "./AssetLoader";
import { DEFAULT_NAMESPACE } from "./Assets";
import { PersistentCache } from "../cache/PersistentCache";
import { AssetKey, isAssetKey, isResourceLocation } from "./AssetKey";
import { ListAsset } from "../ListAsset";
import { AssetParser } from "./source/parser/AssetParsers";
import { DisplayPosition } from "../model/DisplayPosition";
import { DYE_COLORS } from "./BannerPatterns";
import { ItemDefaults } from "../model/ItemDefaults";
import { MineRenderData } from "./MineRenderData";
import { ItemTints } from "../model/ItemTints";

/** Caller-supplied item-preview state passed to {@link Models.getMerged}. */
export interface ItemModelContext {
    /** Context used by display-context selectors, overriding `properties`. Defaults to GUI. */
    displayContext?: DisplayPosition | "none";
    /** Explicit property overrides. Nodes with the same ID share one override, regardless of their parameters. */
    properties?: Record<string, boolean | string | number>;
    /** Supplied component JSON by ID, overriding built-in defaults. Component selectors compare structural JSON values. */
    components?: Record<string, unknown>;
    /** Stack count, as a nonnegative integer. Defaults to 1; items without listed defaults stack to 64. */
    count?: number;
    /** Item-model keys by reference-node ID, such as `minecraft:bundle/selected_item`. Unset references draw nothing. */
    itemReferences?: Record<string, AssetKey>;
}

/** Loads and caches Java block/item models, including inherited geometry and textures. */
export class Models {

    // Bump when the shape of cached item models changes.
    private static readonly ITEM_CACHE_VERSION = "item-v8";
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
        const checkSources = this.sourceCheck();
        const model = key.type === "item" ? await this.getItemModel(key, context) : await this.getRaw(key);
        if (!model) {
            return undefined;
        }
        const merged = await ModelMerger.mergeWithParents(model);
        checkSources();
        return merged;
    }

    private static async getItemModel(key: AssetKey, context: ItemModelContext = {}): Promise<Maybe<Model>> {
        const checkSources = this.sourceCheck();
        const preview = this.snapshotContext(key, context);
        const dataKey = await this.applyDefaults(key, preview);
        checkSources();
        return this.getPreparedItemModel(key, preview, dataKey);
    }

    private static async getPreparedItemModel(key: AssetKey, preview: Required<ItemModelContext>, dataKey: string): Promise<Maybe<Model>> {
        const checkSources = this.sourceCheck();
        const itemId = `${key.namespace}:${key.path}`;
        const itemKey = new AssetKey(key.namespace, key.path, "items", undefined, key.rootType, ".json", key.root);
        const cacheKey = itemKey.serialize() + this.contextKey(preview) + dataKey;
        const model = await this.PERSISTENT_CACHE.getOrLoad(`${this.ITEM_CACHE_VERSION}:${AssetLoader.persistentKey(cacheKey)}`, async () => {
            const result = await AssetLoader.getFirst<Model & { model?: ItemModelNode }>([itemKey, key], AssetParser.JSON);
            checkSources();
            if (!result) return undefined;
            if (result.key.assetType !== "items") return { ...result.asset, key, itemId, components: preview.components } as ItemModel;

            const load = async (selected: SelectedItemModel): Promise<ItemModel> => {
                if ("parts" in selected) {
                    return { key, itemId, parts: await Promise.all(selected.parts.map(load)) };
                }
                if ("item" in selected) {
                    // Referenced items start with their own default stack state and references.
                    const model = await this.getItemModel(selected.item, { displayContext: preview.displayContext });
                    if (!model) throw new Error(`Item ${key.toNamespacedString()} references missing item ${selected.item.toNamespacedString()}`);
                    return model as ItemModel;
                }
                const modelKey = AssetKey.parse("models", selected.model);
                modelKey.root = key.root;
                const model = await this.getRaw(modelKey);
                if (!model) throw new Error(`Item ${key.toNamespacedString()} references missing model ${selected.model}`);
                // Relative texture paths belong to the referenced model's namespace.
                return { ...model, itemId, components: preview.components, ...(selected.special && { special: selected.special }), ...(selected.tints && { tints: selected.tints }) } as ItemModel;
            };
            const model = await load(this.selectItemModel(result.asset.model, key, preview));
            checkSources();
            return model;
        });
        checkSources();
        const restore = (model: ItemModel): ItemModel => ({
            ...model, key: Object.assign(new AssetKey("", ""), model.key),
            ...(model.parts && { parts: model.parts.map(restore) })
        });
        return model ? restore(model) : undefined;
    }

    private static contextIdentifier(id: string): string {
        if (!isResourceLocation(id)) {
            throw new Error(`Invalid item-preview identifier: ${id}`);
        }
        return id.includes(":") ? id : `minecraft:${id}`;
    }

    /** @internal */
    public static componentValue(components: Record<string, unknown>, id: string): unknown {
        const normalized = this.contextIdentifier(id);
        const short = normalized.replace(/^minecraft:/, "");
        if (short !== normalized && Object.prototype.hasOwnProperty.call(components, short)
            && Object.prototype.hasOwnProperty.call(components, normalized)) {
            throw new Error(`Duplicate item-preview component: ${normalized}`);
        }
        return Object.prototype.hasOwnProperty.call(components, short) ? components[short] : components[normalized];
    }

    private static snapshotContext(key: AssetKey, context: ItemModelContext): Required<ItemModelContext> {
        const displayContext = context.displayContext ?? DisplayPosition.GUI;
        if (displayContext !== "none" && !Object.values(DisplayPosition).includes(displayContext)) {
            throw new Error(`Unsupported item display context: ${displayContext}`);
        }
        for (const map of [context.properties, context.components, context.itemReferences]) {
            if (map !== undefined && (!map || typeof map !== "object" || Array.isArray(map))) {
                throw new Error("Item-preview properties, components, and references must be objects keyed by identifier");
            }
        }
        const count = context.count === undefined ? 1 : context.count;
        if (!Number.isSafeInteger(count) || count < 0) throw new Error("Item-preview count must be a nonnegative safe integer");
        const properties: Required<ItemModelContext>["properties"] = {};
        for (const [id, value] of Object.entries(context.properties ?? {})) {
            const property = this.contextIdentifier(id);
            if (!["boolean", "string", "number"].includes(typeof value) || typeof value === "number" && !Number.isFinite(value)) {
                throw new Error(`Item-preview property ${property} must be a boolean, string, or finite number`);
            }
            if (Object.prototype.hasOwnProperty.call(properties, property)) throw new Error(`Duplicate item-preview property: ${property}`);
            properties[property] = value;
        }
        const components: Record<string, unknown> = {};
        for (const [id, value] of Object.entries(context.components ?? {})) {
            const component = this.contextIdentifier(id);
            if (Object.prototype.hasOwnProperty.call(components, component)) throw new Error(`Duplicate item-preview component: ${component}`);
            components[component] = this.snapshotJson(value);
        }
        const itemReferences: Record<string, AssetKey> = {};
        for (const [id, value] of Object.entries(context.itemReferences ?? {})) {
            const reference = this.contextIdentifier(id);
            if (!isAssetKey(value) || value.assetType !== "models" || value.type !== "item") {
                throw new Error(`Item-preview reference ${reference} must be an item-model AssetKey`);
            }
            this.contextIdentifier(`${value.namespace}:${value.path}`);
            if (Object.prototype.hasOwnProperty.call(itemReferences, reference)) throw new Error(`Duplicate item-preview reference: ${reference}`);
            itemReferences[reference] = Object.assign(new AssetKey("", ""), value, { root: value.root ?? key.root });
        }
        return { displayContext, properties, components, count, itemReferences };
    }

    private static async applyDefaults(key: AssetKey, preview: Required<ItemModelContext>): Promise<string> {
        if (key.type !== "item") return "";
        const root = AssetLoader.ROOT, scope = AssetLoader.persistentScope;
        const resolved = await MineRenderData.resolve(key.root);
        const defaults = await ItemDefaults.get(`${key.namespace}:${key.path}`, key.root);
        preview.components = { ...defaults, ...preview.components };
        if (resolved.manifest.dataVersion < 3337 && key.namespace === DEFAULT_NAMESPACE
            && ["potion", "splash_potion", "lingering_potion"].includes(key.path)
            && !Object.prototype.hasOwnProperty.call(preview.components, "minecraft:enchantment_glint_override")
            && await ItemTints.hasPotionEffects(preview.components["minecraft:potion_contents"], key.root)) {
            preview.components["minecraft:enchantment_glint_override"] = true;
        }
        if (AssetLoader.ROOT !== root || AssetLoader.persistentScope !== scope) throw new Error("Asset sources changed while loading item defaults; retry the request");
        return `|data:${resolved.root}:${resolved.manifest.datasets.itemDefaults?.sha256}:${resolved.manifest.datasets.potionColors?.sha256}`;
    }

    private static sourceCheck(): () => void {
        const root = AssetLoader.ROOT, scope = AssetLoader.persistentScope;
        return () => {
            if (AssetLoader.ROOT !== root || AssetLoader.persistentScope !== scope) throw new Error("Asset sources changed while loading item models; retry the request");
        };
    }

    private static contextKey(context: Required<ItemModelContext>): string {
        const itemReferences = Object.fromEntries(Object.entries(context.itemReferences).map(([id, key]) => [id, key.serialize()]));
        return `|${this.ITEM_CACHE_VERSION}:${JSON.stringify(this.snapshotJson({ ...context, itemReferences }))}`;
    }

    private static snapshotJson(value: unknown, ancestors = new Set<object>()): unknown {
        if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value !== "object" || ancestors.has(value) || !Array.isArray(value)
            && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
            throw new Error("Item-preview components must contain finite JSON values without circular references");
        }
        ancestors.add(value);
        const copy = Array.isArray(value) ? Array.from(value, entry => this.snapshotJson(entry, ancestors))
            : Object.fromEntries(Object.keys(value).sort().map(key => [key, this.snapshotJson((value as Record<string, unknown>)[key], ancestors)]));
        ancestors.delete(value);
        return copy;
    }

    private static propertyValue(node: ItemModelNode, context: Required<ItemModelContext>): unknown {
        const kind = node.type.replace(/^minecraft:/, "");
        const property = node.property ? this.contextIdentifier(node.property) : undefined;
        if (kind === "select" && property === "minecraft:display_context") return context.displayContext;
        if (property && Object.prototype.hasOwnProperty.call(context.properties, property)) return context.properties[property];
        const fallback = kind === "condition" ? false : kind === "range_dispatch" ? 0 : undefined;
        const component = (id: string) => context.components[this.contextIdentifier(id)];
        if (property === "minecraft:custom_model_data") {
            const index = node.index ?? 0;
            if (!Number.isSafeInteger(index) || index < 0) throw new Error("Item-model custom_model_data index must be a nonnegative integer");
            const data = component("custom_model_data");
            if (data === undefined) return fallback;
            if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Item-preview custom_model_data must be an object");
            const field = kind === "condition" ? "flags" : kind === "select" ? "strings" : "floats";
            const values = (data as Record<string, unknown>)[field];
            if (values === undefined) return fallback;
            if (!Array.isArray(values)) throw new Error(`Item-preview custom_model_data.${field} must be an array`);
            return index < values.length ? values[index] : fallback;
        }
        if (kind === "condition" && property === "minecraft:has_component") {
            if (node.ignore_default) throw new Error("Item-preview has_component with ignore_default requires an explicit properties override; default component comparisons are unsupported");
            return Object.prototype.hasOwnProperty.call(context.components, this.contextIdentifier(node.component!));
        }
        if (kind === "select") {
            switch (property) {
                case "minecraft:component": return component(node.component!);
                case "minecraft:block_state": {
                    const state = component("block_state");
                    if (state === undefined) return undefined;
                    if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("Item-preview block_state must be an object");
                    if (typeof node.block_state_property !== "string") throw new Error("Item-model block_state requires block_state_property");
                    return Object.prototype.hasOwnProperty.call(state, node.block_state_property)
                        ? (state as Record<string, unknown>)[node.block_state_property] : undefined;
                }
                case "minecraft:charge_type": {
                    const projectiles = component("charged_projectiles");
                    if (projectiles === undefined) return "none";
                    if (!Array.isArray(projectiles)) throw new Error("Item-preview charged_projectiles must be an array of item stacks");
                    const ids = projectiles.map(stack => {
                        if (!stack || typeof stack !== "object" || Array.isArray(stack)) throw new Error("Item-preview charged_projectiles must contain item-stack objects");
                        return this.contextIdentifier((stack as { id: string }).id);
                    });
                    return !ids.length ? "none" : ids.includes("minecraft:firework_rocket") ? "rocket" : "arrow";
                }
            }
        }
        if (kind === "range_dispatch" && (property === "minecraft:damage" || property === "minecraft:count")) {
            const damage = property === "minecraft:damage";
            const maximumComponent = component(damage ? "max_damage" : "max_stack_size");
            const maximum = maximumComponent === undefined ? damage ? 0 : 1 : maximumComponent;
            const damageComponent = component("damage");
            const value = damage ? damageComponent === undefined ? 0 : damageComponent : context.count;
            if (typeof value !== "number" || typeof maximum !== "number" || maximum < 0) throw new Error(`Item-preview ${property} requires numeric components and a nonnegative maximum`);
            const clamped = Math.max(0, Math.min(maximum, value));
            return node.normalize === false ? clamped : clamped / maximum;
        }
        return fallback;
    }

    private static selectItemModel(node: ItemModelNode | undefined, key: AssetKey, context: Required<ItemModelContext>): SelectedItemModel {
        if (!node || typeof node.type !== "string") {
            throw new Error(`Unsupported item model definition for ${key.toNamespacedString()}`);
        }
        switch (node.type.replace(/^minecraft:/, "")) {
            case "composite":
                if (Array.isArray(node.models)) return { parts: node.models.map(child => this.selectItemModel(child, key, context)) };
                break;
            case "bundle/selected_item": {
                const item = context.itemReferences["minecraft:bundle/selected_item"];
                return item ? { item } : { parts: [] };
            }
            case "model":
                if (typeof node.model === "string" && node.model) return { model: node.model, tints: node.tints };
                break;
            case "special": {
                if (!node.base || !node.model || typeof node.model !== "object") break;
                const special = node.model;
                switch (special.type) {
                    case "copper_golem_statue":
                    case "minecraft:copper_golem_statue":
                        if (isResourceLocation(special.texture)
                            && ["standing", "sitting", "running", "star"].includes(special.pose)) return { model: node.base, special };
                        break;
                    case "banner":
                    case "minecraft:banner":
                        if (typeof special.color === "string" && Object.prototype.hasOwnProperty.call(DYE_COLORS, special.color)) return { model: node.base, special };
                        break;
                    case "shield":
                    case "minecraft:shield":
                    case "trident":
                    case "minecraft:trident":
                    case "conduit":
                    case "minecraft:conduit":
                    case "decorated_pot":
                    case "minecraft:decorated_pot":
                    case "player_head":
                    case "minecraft:player_head":
                        return { model: node.base, special };
                    case "shulker_box":
                    case "minecraft:shulker_box":
                        if (typeof special.texture === "string" && special.texture
                            && (special.openness === undefined || typeof special.openness === "number" && Number.isFinite(special.openness))
                            && (special.orientation === undefined || ["down", "up", "north", "south", "west", "east"].includes(special.orientation))) {
                            return { model: node.base, special };
                        }
                        break;
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
                const value = this.propertyValue(node, context);
                if (typeof value !== "boolean") throw new Error(`Item-preview condition ${node.property} requires a boolean`);
                return this.selectItemModel(value ? node.on_true : node.on_false, key, context);
            }
            case "select": {
                const value = this.propertyValue(node, context);
                const component = node.property && this.contextIdentifier(node.property) === "minecraft:component";
                if (!component && value !== undefined && typeof value !== "string") throw new Error(`Item-preview selector ${node.property} requires a string`);
                const matches = (candidate: unknown) => component
                    ? JSON.stringify(this.snapshotJson(candidate)) === JSON.stringify(this.snapshotJson(value)) : candidate === value;
                const selected = value === undefined ? undefined
                    : node.cases?.find(entry => matches(entry.when) || Array.isArray(entry.when) && entry.when.some(matches))?.model;
                return this.selectItemModel(selected ?? node.fallback, key, context);
            }
            case "range_dispatch": {
                const value = this.propertyValue(node, context);
                if (typeof value !== "number") throw new Error(`Item-preview range ${node.property} requires a number`);
                if (Number.isNaN(value)) return this.selectItemModel(node.fallback, key, context);
                const scaled = value * (node.scale ?? 1);
                if (!Number.isFinite(scaled)) throw new Error(`Item-preview range ${node.property} requires a finite value and scale`);
                const selected = node.entries?.reduce<{ threshold: number; model: ItemModelNode } | undefined>((match, entry) => {
                    return entry.threshold <= scaled && (!match || entry.threshold >= match.threshold) ? entry : match;
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
     * Item keys default to GUI context and a stack count of 1. Unresolved conditions are false and numeric properties are zero.
     * Versioned stack-size, durability, and glint defaults apply unless components override them.
     * Pass `context` to supply component values, property overrides, and item references for a preview.
     * Composite items retain independently merged children in `ItemModel.parts`.
     *
     * @param key - Model key, for example `AssetKey.parse("models", "minecraft:item/diamond_sword")`.
     */
    public static async getMerged(key: AssetKey, context: ItemModelContext = {}): Promise<Maybe<Model>> {
        const checkSources = this.sourceCheck();
        if (!key.assetType) {
            key.assetType = "models";
        }
        if (!key.extension) {
            key.extension = ".json";
        }
        const preview = this.snapshotContext(key, context);
        const dataKey = await this.applyDefaults(key, preview);
        checkSources();
        const keyStr = AssetLoader.persistentKey(key.serialize() + (key.type === "item" ? this.contextKey(preview) + dataKey : ""));
        const model = await Caching.mergedModelCache.get(keyStr, async () => {
            //TODO: persistent cache
            const raw = key.type === "item" ? await this.getPreparedItemModel(key, preview, dataKey) : await this.getRaw(key);
            const merged = raw ? await ModelMerger.mergeWithParents(raw) : undefined;
            checkSources();
            return merged;
        });
        checkSources();
        return model;
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
    index?: number;
    component?: string;
    ignore_default?: boolean;
    normalize?: boolean;
    block_state_property?: string;
    on_false?: ItemModelNode;
    on_true?: ItemModelNode;
    fallback?: ItemModelNode;
    cases?: Array<{ when: unknown; model: ItemModelNode }>;
    entries?: Array<{ threshold: number; model: ItemModelNode }>;
    scale?: number;
    models?: ItemModelNode[];
}

type SelectedItemModel = { model: string; special?: SpecialItemRenderer; tints?: ItemTintSource[] }
    | { parts: SelectedItemModel[] }
    | { item: AssetKey };
