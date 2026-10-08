import { AssetKey, BasicAssetKey, isAssetKey } from "./AssetKey";
import type { EntityLayer, EntityModel, EntityModelFile, EntityModelPass } from "../entity/EntityModel";
import type { EntityAnimation, EntityAnimationFile } from "../entity/EntityAnimation";
import { AssetLoader } from "./AssetLoader";
import type { AssetContext } from "./AssetContext";
import { AssetParser } from "./source";
import { Maybe } from "../util";
import { Caching } from "../cache/Caching";
import { DEFAULT_NAMESPACE } from "./AssetDefaults";
import type { ListAsset } from "../ListAsset";
import { MineRenderError } from "../error/MineRenderError";
import type { MinecraftAsset } from "../MinecraftAsset";

/** Loads entity and block-entity geometry, texture selections, and animation clips from the dataset. */
export class Entities {

    constructor(private readonly assets: AssetContext) {
    }

    public static getEntityList(): Promise<string[]> {
        return AssetLoader.context.entities.getEntityList();
    }

    public static getLayerList(modelKey: BasicAssetKey): Promise<string[]> {
        return AssetLoader.context.entities.getLayerList(modelKey);
    }

    public static getPassList(modelKey: BasicAssetKey): Promise<EntityModelPass[]> {
        return AssetLoader.context.entities.getPassList(modelKey);
    }

    public static getEntity(modelKey: BasicAssetKey, textureKey?: BasicAssetKey, options?: EntityModelOptions): Promise<Maybe<EntityModel>> {
        return AssetLoader.context.entities.getEntity(modelKey, textureKey, options);
    }

    public static getAnimations(modelKey: BasicAssetKey): Promise<Maybe<Record<string, EntityAnimation>>> {
        return AssetLoader.context.entities.getAnimations(modelKey);
    }

    public static resolveTexture(modelKey: BasicAssetKey): Promise<Maybe<AssetKey>> {
        return AssetLoader.context.entities.resolveTexture(modelKey);
    }

    /** Lists model paths in the `minecraft` namespace, including subdirectories and excluding `.json`. */
    public async getEntityList(): Promise<string[]> {
        const collect = async (path: string): Promise<string[]> => {
            const prefix = path ? `${path}/` : "";
            const key = new AssetKey(DEFAULT_NAMESPACE, `${prefix}_list`, undefined, undefined, "entity-models", ".json");
            const list = await Caching.listAssetCache.get(this.assets.cacheKey(key), () => this.assets.get<ListAsset>(key, AssetParser.LIST));
            if (!list) return [];
            const files = list.files.filter(file => file.endsWith(".json") && file !== "_list.json")
                .map(file => `${prefix}${file.slice(0, -5)}`);
            const children = await Promise.all(list.directories.map(directory => collect(`${prefix}${directory}`)));
            return [...files, ...children.flat()];
        };
        return collect("");
    }

    private async getModelFile(modelKey: BasicAssetKey): Promise<Maybe<EntityModelFile>> {
        const path = isAssetKey(modelKey) ? modelKey.getFullPath() : modelKey.path;
        const key = new AssetKey(modelKey.namespace, path, undefined, undefined, "entity-models", ".json", isAssetKey(modelKey) ? modelKey.root : undefined);
        return Caching.entityModelCache.get(this.assets.cacheKey(key), async () => {
            const model = await this.assets.get<EntityModelFile>(key, AssetParser.JSON);
            return model ? this.assets.bind({ ...model }) : undefined;
        });
    }

    /** Returns selectable geometry-layer names, or an empty list when the model is missing. */
    public async getLayerList(modelKey: BasicAssetKey): Promise<string[]> {
        return Object.keys((await this.getModelFile(modelKey))?.layers ?? {});
    }

    /** The dataset's extra draws on top of `main`; their `when` labels are the states `EntityModelOptions.when` can enable. */
    public async getPassList(modelKey: BasicAssetKey): Promise<EntityModelPass[]> {
        return (await this.getModelFile(modelKey))?.passes ?? [];
    }

    /**
     * Loads the layers and textures to pass to {@link MineRenderScene.addEntity}.
     * By default, selects `main`, unconditional passes, and passes enabled by `options.when`.
     *
     * @param modelKey - Dataset model, such as `new BasicAssetKey("minecraft", "zombie")`.
     * @param textureKey - Texture override for the first selected layer.
     * @param options - Layer selection, conditional passes, and per-layer texture overrides.
     * @returns The selected model, or `undefined` when its dataset file is missing.
     */
    public async getEntity(modelKey: BasicAssetKey, textureKey?: BasicAssetKey, options?: EntityModelOptions): Promise<Maybe<EntityModel>> {
        modelKey = this.assets.bind(isAssetKey(modelKey) ? Object.assign(new AssetKey("", ""), modelKey) : new BasicAssetKey(modelKey));
        const model = await this.getModelFile(modelKey);
        if (!model) return undefined;
        // Without an explicit selection, draw what vanilla draws: main, then the passes enabled for the requested state.
        const passes = options?.layers || options?.layer !== undefined ? [] :
            (model.passes ?? []).filter(pass => pass.when === undefined || options?.when?.includes(pass.when));
        const draws: EntityModelPass[] = [...new Set(options?.layers ?? [options?.layer ?? "main"])].map(layer => ({ layer }));
        if (draws.length === 0) throw new MineRenderError(`Entity ${model.id} requires at least one layer`);
        draws.push(...passes);
        const names: string[] = [];
        const selected = draws.map(pass => {
            const layer = model.layers[pass.layer];
            if (!layer) {
                throw new MineRenderError(`Entity ${model.id} has no layer "${pass.layer}". Available layers: ${Object.keys(model.layers).join(", ")}`);
            }
            // A pass may draw geometry that is already selected with another texture.
            let name = pass.layer;
            for (let n = 2; names.includes(name); n++) name = `${pass.layer}#${n}`;
            names.push(name);
            return { name, layer, pass };
        });
        const layers: Record<string, EntityLayer> = Object.fromEntries(await Promise.all(selected.map(async ({ name, layer, pass }, index) => {
            const override = options?.textures?.[name] ?? (index === 0 ? textureKey : undefined);
            const textureLocation = pass.textureLocation ?? layer.textureLocation;
            let texture: Maybe<AssetKey>;
            if (override) {
                const path = isAssetKey(override) ? override.getFullPath() : override.path;
                texture = isAssetKey(override) && override.assetType === "textures" && path.startsWith("entity/")
                    ? override
                    : this.assets.bind(new AssetKey(override.namespace, path, "textures", "entity", "assets", ".png", isAssetKey(override) ? override.root : undefined));
            } else if (textureLocation !== undefined) {
                texture = this.assets.bind(AssetKey.parse("textures", textureLocation.replace(/^([^:]+:)?textures\//, "$1")));
                if (isAssetKey(modelKey)) texture.root = modelKey.root;
            } else {
                texture = await this.resolveTexture(modelKey);
            }
            const render = pass.render ?? layer.render;
            return [name, this.assets.bind({ key: override ?? modelKey, texture, layer, ...(render && { render }), ...(pass.tint && { tint: pass.tint }) })];
        })));
        return this.assets.bind({ ...layers[names[0]], id: model.id, layers, ...(model.transform && { transform: model.transform }) });
    }

    /**
     * Native and sampled vanilla clips by name, or undefined when the model or selected version has none.
     */
    public async getAnimations(modelKey: BasicAssetKey): Promise<Maybe<Record<string, EntityAnimation>>> {
        const path = isAssetKey(modelKey) ? modelKey.getFullPath() : modelKey.path;
        const key = new AssetKey(modelKey.namespace, path, undefined, undefined, "entity-models/animations", ".json", isAssetKey(modelKey) ? modelKey.root : undefined);
        const file = await Caching.entityAnimationCache.get(this.assets.cacheKey(key), () => this.assets.get<EntityAnimationFile>(key, AssetParser.JSON));
        return file?.animations;
    }

    /** Finds a fallback texture using the model path, its directory, and vanilla variant data. */
    public async resolveTexture(modelKey: BasicAssetKey): Promise<Maybe<AssetKey>> {
        const path = isAssetKey(modelKey) ? modelKey.getFullPath() : modelKey.path;
        const root = isAssetKey(modelKey) ? modelKey.root : undefined;
        const key = new AssetKey(modelKey.namespace, path, undefined, undefined, "entity-models", ".json", root);
        return Caching.entityTextureCache.get(this.assets.cacheKey(key), async () => {
            const name = path.split("/").pop()!;
            for (const candidate of [path, `${path}/${name}`]) {
                const texture = new AssetKey(modelKey.namespace, candidate, "textures", "entity", "assets", ".png", root);
                if (await this.assets.modelTextures.get(texture)) return this.assets.bind(texture);
            }
            const listKey = new AssetKey(modelKey.namespace, "_list", `${name}_variant`, undefined, "data", ".json", root);
            const list = await this.assets.get<ListAsset>(listKey, AssetParser.LIST);
            const files = list?.files.filter(file => file.endsWith(".json") && file !== "_list.json");
            const file = files?.find(file => file === "temperate.json") ?? files?.[0];
            if (!file) return undefined;
            const variantKey = new AssetKey(modelKey.namespace, file.slice(0, -5), `${name}_variant`, undefined, "data", ".json", root);
            const variant = await this.assets.get<EntityVariant>(variantKey, AssetParser.JSON);
            const variantAssets = variant?.assets;
            const textureId = variant?.asset_id ?? (typeof variantAssets?.wild === "string" ? variantAssets.wild :
                Object.values(variantAssets ?? {}).find(value => typeof value === "string"));
            if (typeof textureId !== "string") return undefined;
            const texture = AssetKey.parse("textures", textureId);
            texture.root = root;
            return this.assets.bind(texture);
        });
    }

    /** @deprecated Use getEntityList(); block entities share the entity dataset. */
    public static getBlockList(): Promise<string[]> {
        return AssetLoader.context.entities.getEntityList();
    }

    /** @deprecated Use getEntity(); block entities share the entity dataset. */
    public static getBlock(modelKey: BasicAssetKey, textureKey?: BasicAssetKey, options?: EntityModelOptions): Promise<Maybe<EntityModel>> {
        return AssetLoader.context.entities.getEntity(modelKey, textureKey, options);
    }

}

/** Selection settings passed as the third argument to {@link Entities.getEntity}. */
export interface EntityModelOptions {
    /** Selects one geometry layer without dataset passes. `layers` takes precedence when supplied. */
    layer?: string;
    /** Layer names in draw order; an explicit selection draws exactly these layers and no dataset passes. */
    layers?: string[];
    /**
     * Entity states that enable the dataset's conditional passes, e.g. `["powered"]` for a charged creeper.
     * Without `layer`/`layers`, `main` and every unconditional pass are always drawn.
     */
    when?: string[];
    /** Per-layer texture overrides, keyed like `EntityModel.layers`. The positional texture key applies to the first selected layer. */
    textures?: Record<string, BasicAssetKey>;
}

interface EntityVariant extends MinecraftAsset {
    asset_id?: string;
    assets?: Record<string, unknown>;
}
