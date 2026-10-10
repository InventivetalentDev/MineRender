import { MineRenderData } from "../assets/MineRenderData";

/** Item components extracted from the selected Minecraft version; unlisted items stack to 64. */
export class ItemDefaults {
    /** Returns a fresh map with namespaced component IDs; unlisted items get max_stack_size 64. */
    public static async get(itemId: string, root?: string): Promise<Record<string, unknown>> {
        const id = itemId.includes(":") ? itemId : `minecraft:${itemId}`;
        const defaults = await MineRenderData.get("itemDefaults", root);
        return Object.prototype.hasOwnProperty.call(defaults, id) ? structuredClone(defaults[id]) : { "minecraft:max_stack_size": 64 };
    }
}
