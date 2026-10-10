import itemDefaults from "./itemDefaults.json";

/** Bundled vanilla 1.21.11 stack-size and durability components. */
export class ItemDefaults {
    /** Returns a fresh map with namespaced component IDs. Unknown items have no defaults. */
    public static get(itemId: string): Record<string, number> {
        const id = itemId.replace(/^minecraft:/, "");
        if (!Object.prototype.hasOwnProperty.call(itemDefaults, id)) return {};
        return Object.fromEntries(Object.entries(itemDefaults[id as keyof typeof itemDefaults])
            .map(([component, value]) => [`minecraft:${component}`, value]));
    }
}
