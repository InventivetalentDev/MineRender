import { AssetKey, BlockStates, Entities, Models, type BlockState, type MultipartCondition, type SceneObjectDefinition } from "minerender";

export async function validateMinecraftVersion(version: string): Promise<void> {
    if (!version) throw new Error("Enter a Minecraft version, such as 1.21.11.");
    const unavailable = () => new Error(`Minecraft version "${version}" is not available on MC Assets. Check the spelling; for example, 1.21.11.`);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(version)) throw unavailable();
    const signal = AbortSignal.timeout(10000);
    let found = false;
    try {
        const response = await fetch("https://assets.mcasset.cloud/versions.json", { signal });
        if (!response.ok) throw new Error("Version list request failed");
        const manifest: { versions?: { name?: unknown }[] } = await response.json();
        if (!Array.isArray(manifest?.versions) || !manifest.versions.length
            || !manifest.versions.every(entry => typeof entry?.name === "string")) throw new Error("Invalid version list");
        found = manifest.versions.some(entry => entry.name === version);
        if (!found && ["latest", "release", "snapshot"].includes(version)) {
            const aliasResponse = await fetch(`https://assets.mcasset.cloud/${version}/version.json`, { signal });
            if (aliasResponse.status !== 404) {
                if (!aliasResponse.ok) throw new Error("Version alias request failed");
                const alias: { id?: unknown } = await aliasResponse.json();
                if (typeof alias?.id !== "string" || !alias.id) throw new Error("Invalid version alias");
                found = true;
            }
        }
    } catch {
        throw new Error("Could not check Minecraft versions on MC Assets. Check your connection and try again.");
    }
    if (!found) throw unavailable();
}

export function getObjectListHint(type: SceneObjectDefinition["type"]): string {
    if (type === "model") return "Model suggestions are unavailable. Enter a model ID, such as minecraft:block/stone.";
    if (type === "skin") return "Player suggestions are unavailable. Enter a name, UUID, or PNG URL, or leave blank for Steve.";
    if (type === "gui") return "GUI texture suggestions are unavailable. Enter a texture ID, or leave blank for text.";
    return "";
}

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
