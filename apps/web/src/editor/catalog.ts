import { AssetKey, BlockStates, Entities, Models, type BlockState, type MultipartCondition } from "minerender";

export async function getObjectList(type: string): Promise<string[]> {
    const values = type === "block" ? await BlockStates.getList()
        : type === "item" ? await Models.getItemList()
            : type === "entity" ? await Entities.getEntityList() : [];
    return values.map(value => {
        const path = value.replace(/\.json$/, "");
        return path.includes(":") ? path : `minecraft:${type === "item" && !path.startsWith("item/") ? "item/" : ""}${path}`;
    }).sort();
}

export async function getBlockProperties(asset: string): Promise<{ choices: Record<string, string[]>; defaults: Record<string, string> }> {
    const key = AssetKey.parse("blockstates", asset);
    const [state, defaults] = await Promise.all([BlockStates.get(key), BlockStates.getDefaultState(key)]);
    if (!state) throw new Error(`Blockstate not found: ${asset}`);
    const choices = collectBlockProperties(state);
    for (const [name, property] of Object.entries(defaults ?? {})) {
        choices[name] = [...new Set([...(choices[name] ?? []), ...property.values.map(String)])];
    }
    return {
        choices: Object.fromEntries(Object.entries(choices).sort(([a], [b]) => a.localeCompare(b))),
        defaults: Object.fromEntries(Object.entries(defaults ?? {}).map(([name, property]) => [name, String(property.default)]))
    };
}

function collectBlockProperties(state: BlockState): Record<string, string[]> {
    const choices: Record<string, Set<string>> = {};
    const add = (name: string, values: string[]) => {
        choices[name] ??= new Set();
        values.forEach(value => choices[name].add(value));
    };
    for (const variant of Object.keys(state.variants ?? {})) {
        for (const property of variant.split(",")) {
            const [name, value] = property.split("=");
            if (name && value !== undefined) add(name, value.split("|"));
        }
    }
    const condition = (when: MultipartCondition) => {
        for (const [name, value] of Object.entries(when)) {
            if (Array.isArray(value)) value.forEach(condition);
            else {
                const values = String(value).split("|");
                if (values.includes("true") || values.includes("false")) values.push("false", "true");
                add(name, values);
            }
        }
    };
    for (const part of state.multipart ?? []) if (part.when) condition(part.when);
    return Object.fromEntries(Object.entries(choices).map(([name, values]) => [name, [...values]]));
}
