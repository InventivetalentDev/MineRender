import { AssetKey, AssetLoader, AssetParser, AssetSource, Caching, Models, type ItemModelContext, type MinecraftAsset } from "minerender";

export const SHULKER_DIRECTIONS = ["up", "down", "north", "south", "west", "east"] as const;
export type ShulkerDirection = typeof SHULKER_DIRECTIONS[number];
const SOURCE_NAME = "playground-shulker-preview";

interface ShulkerDefinition extends MinecraftAsset {
    model?: { type?: string; model?: { type?: string; openness?: number; orientation?: string } };
}

class ShulkerPreviewSource extends AssetSource {
    constructor(private readonly itemKey: AssetKey, private readonly definition: ShulkerDefinition) { super(); }
    get cacheId(): string { return `shulker-preview-v1:${this.itemKey.serialize()}:${JSON.stringify(this.definition)}`; }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<T | undefined> {
        if (key.serialize() === this.itemKey.serialize() && parser === AssetParser.JSON) {
            return structuredClone(this.definition) as unknown as T;
        }
        return undefined;
    }
}

export async function loadShulkerPreview(key: AssetKey, context: ItemModelContext, openness: number, orientation: ShulkerDirection) {
    return withShulkerPreview(key, openness, orientation, () => Models.getMerged(key, context));
}

export async function withShulkerPreview<T>(key: AssetKey, openness: number, orientation: ShulkerDirection, load: () => Promise<T>): Promise<T> {
    const itemKey = new AssetKey(key.namespace, key.path, "items", undefined, key.rootType, ".json", key.root);
    const definition = structuredClone(await AssetLoader.get<ShulkerDefinition>(itemKey, AssetParser.JSON));
    const node = definition?.model;
    if (node?.type?.replace(/^minecraft:/, "") !== "special" || node.model?.type?.replace(/^minecraft:/, "") !== "shulker_box") {
        if (openness === 0 && orientation === "up") return load();
        throw new Error("This item definition does not use a shulker box renderer.");
    }
    if ((node.model.openness ?? 0) === openness && (node.model.orientation ?? "up") === orientation) return load();
    Object.assign(node.model, { openness, orientation });
    AssetLoader.addSource(SOURCE_NAME, new ShulkerPreviewSource(itemKey, definition!));
    Caching.clear();
    try { return await load(); }
    finally {
        AssetLoader.removeSource(SOURCE_NAME);
        Caching.clear();
    }
}

export function shulkerPreviewCode(key: AssetKey, openness: number, orientation: ShulkerDirection, load: string, result = "model"): string {
    return `async function loadShulkerPreview() {
    const itemKey = new MineRender.AssetKey(${JSON.stringify(key.namespace)}, ${JSON.stringify(key.path)}, "items");
    const definition = structuredClone(await MineRender.AssetLoader.get(itemKey, MineRender.AssetParser.JSON));
    const node = definition?.model;
    const openness = ${openness}, orientation = ${JSON.stringify(orientation)};
    if (node?.type?.replace(/^minecraft:/, "") !== "special" || node.model?.type?.replace(/^minecraft:/, "") !== "shulker_box") {
        if (openness === 0 && orientation === "up") return ${load};
        throw new Error("This item definition does not use a shulker box renderer.");
    }
    if ((node.model.openness ?? 0) === openness && (node.model.orientation ?? "up") === orientation) return ${load};
    Object.assign(node.model, { openness, orientation });
    class ShulkerPreviewSource extends MineRender.AssetSource {
        get cacheId() { return "shulker-preview-v1:" + itemKey.serialize() + ":" + JSON.stringify(definition); }
        async get(key, parser) {
            if (key.serialize() === itemKey.serialize() && parser === MineRender.AssetParser.JSON) {
                return structuredClone(definition);
            }
        }
    }
    MineRender.AssetLoader.addSource(${JSON.stringify(SOURCE_NAME)}, new ShulkerPreviewSource());
    MineRender.Caching.clear();
    try { return await ${load}; }
    finally {
        MineRender.AssetLoader.removeSource(${JSON.stringify(SOURCE_NAME)});
        MineRender.Caching.clear();
    }
}
const ${result} = await loadShulkerPreview();\n`;
}
