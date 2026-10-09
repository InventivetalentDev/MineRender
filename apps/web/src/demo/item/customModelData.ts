import { AssetKey, AssetLoader, AssetParser, AssetSource, Caching, Models, type ItemModelContext, type MinecraftAsset } from "minerender";

export const CUSTOM_MODEL_DATA_ITEM = "minerender_demo:custom_model_data";
const SOURCE_NAME = "playground-custom-model-data";
const SOURCE_CACHE_ID = "minerender-custom-model-data-demo-v2";
const model = (name: string) => ({ type: "minecraft:model", model: `minecraft:item/${name}_sword`,
    tints: [{ type: "minecraft:custom_model_data", index: 1, default: 0xffffff }] });
const secondFloat = (fallback: string, selected: string) => ({
    type: "minecraft:range_dispatch", property: "minecraft:custom_model_data", index: 1,
    fallback: model(fallback), entries: [{ threshold: 1, model: model(selected) }]
});
const definition = { model: {
    type: "minecraft:range_dispatch", property: "minecraft:custom_model_data", index: 0,
    fallback: secondFloat("wooden", "iron"), entries: [{ threshold: 1, model: secondFloat("golden", "diamond") }]
} };

class CustomModelDataSource extends AssetSource {
    constructor() { super(); }
    get cacheId(): string { return SOURCE_CACHE_ID; }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T | undefined> {
        if (key.assetType === "items" && key.toNamespacedString() === CUSTOM_MODEL_DATA_ITEM && parser === AssetParser.JSON) {
            return structuredClone(definition) as unknown as T;
        }
        return undefined;
    }
}

export async function loadCustomModelData(key: AssetKey, context: ItemModelContext) {
    AssetLoader.addSource(SOURCE_NAME, new CustomModelDataSource());
    Caching.clear();
    try { return await Models.getMerged(key, context); }
    finally {
        AssetLoader.removeSource(SOURCE_NAME);
        Caching.clear();
    }
}

export function customModelDataCode(load: string): string {
    return `const definition = ${JSON.stringify(definition, null, 2)};
class DemoItemSource extends MineRender.AssetSource {
    get cacheId() { return ${JSON.stringify(SOURCE_CACHE_ID)}; }
    async get(key, parser) {
        if (key.assetType === "items" && key.toNamespacedString() === ${JSON.stringify(CUSTOM_MODEL_DATA_ITEM)} && parser === MineRender.AssetParser.JSON) {
            return structuredClone(definition);
        }
    }
}
MineRender.AssetLoader.addSource(${JSON.stringify(SOURCE_NAME)}, new DemoItemSource());
MineRender.Caching.clear();
let model;
try {
    model = await ${load};
} finally {
    MineRender.AssetLoader.removeSource(${JSON.stringify(SOURCE_NAME)});
    MineRender.Caching.clear();
}\n`;
}
