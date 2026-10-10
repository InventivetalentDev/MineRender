import itemDefaults from "./itemDefaults.json";

/** Bundled vanilla 1.21.11 item components; unlisted items stack to 64. */
export class ItemDefaults {
    /** Returns a fresh map with namespaced component IDs; unlisted items get max_stack_size 64. */
    public static get(itemId: string): Record<string, number | boolean> {
        const id = itemId.replace(/^minecraft:/, "");
        if (!Object.prototype.hasOwnProperty.call(itemDefaults, id)) return { "minecraft:max_stack_size": 64 };
        return Object.fromEntries(Object.entries(itemDefaults[id as keyof typeof itemDefaults])
            .map(([component, value]) => [`minecraft:${component}`, value]));
    }
}
