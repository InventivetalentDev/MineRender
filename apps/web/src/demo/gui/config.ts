import { GuiHelper, type GuiLayer } from "minerender";

export type EditableLayer = {
    name?: string;
    position?: [number, number];
    size?: [number, number];
    texture?: string;
    crop?: [number, number, number, number];
    item?: string;
    tints?: Record<number, number>;
};

export interface GuiState {
    mode: "chest" | "shaped" | "shapeless" | "custom";
    /** Item IDs by chest slot; empty strings are empty slots. */
    slots: string[];
    /** Explicit tint overrides by chest slot; items without an entry use their automatic tints. */
    slotTints: Record<number, Record<number, number>>;
    ingredients: string[];
    result: string;
    layers: EditableLayer[];
    scale: "fit" | "1" | "2" | "4";
}

export const defaults: GuiState = {
    mode: "chest",
    slots: ["apple", "diamond", "stone", "grass_block", "oak_stairs", "leather_helmet", "chest", "red_bed", "creeper_head", "potion", "tipped_arrow", "filled_map", "firework_star", "leather_chestplate"],
    slotTints: { 13: { 0: 0xc060d0 } },
    ingredients: ["diamond", "diamond", "diamond", "", "stick", "", "", "stick", ""],
    result: "diamond_pickaxe",
    layers: [],
    scale: "fit"
};

export function itemId(value: string): string {
    const id = value.trim();
    if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(id)) throw new Error("Use a concrete item ID, such as minecraft:diamond.");
    const [namespace, path] = id.includes(":") ? id.split(":") : ["minecraft", id];
    return `${namespace}:${path.replace(/^item\//, "")}`;
}

export function layersFor(state: GuiState): EditableLayer[] {
    if (!["chest", "shaped", "shapeless", "custom"].includes(state.mode)) throw new Error("Choose a chest, recipe, or custom GUI layout.");
    if (!["fit", "1", "2", "4"].includes(state.scale)) throw new Error("Choose Fit, 1×, 2×, or 4× GUI scale.");
    if (state.mode === "custom") return validateLayers(state.layers);
    if (state.mode === "chest") {
        if (!Array.isArray(state.slots) || state.slots.length > 54 || state.slots.some(item => typeof item !== "string")) throw new Error("A chest has 54 slots.");
        if (!state.slotTints || typeof state.slotTints !== "object" || Array.isArray(state.slotTints)) throw new Error("Slot tints must be an object keyed by slot.");
        return [
            { name: "chest", texture: "minecraft:gui/container/generic_54", crop: [0, 0, 176, 222] },
            ...state.slots.flatMap((item, slot): EditableLayer[] => item.trim() ? [validateLayers([{
                name: `slot-${slot}`, item: modelId(item), position: GuiHelper.inventorySlot(slot, [8, 18]), tints: state.slotTints[slot]
            }])[0]] : [])
        ];
    }
    if (!Array.isArray(state.ingredients) || state.ingredients.length !== 9 || state.ingredients.some(item => typeof item !== "string")) throw new Error("Recipes require nine cells; leave unused cells empty.");
    const result = { id: itemId(state.result) };
    const layers = state.mode === "shapeless"
        ? GuiHelper.recipe({ type: "crafting_shapeless", ingredients: state.ingredients.filter(Boolean).map(itemId), result })
        : GuiHelper.recipe({
            type: "crafting_shaped", result,
            pattern: [0, 3, 6].map(offset => state.ingredients.slice(offset, offset + 3).map((item, i) => item.trim() ? String(offset + i) : " ").join("")),
            key: Object.fromEntries(state.ingredients.map((item, i) => [String(i), item.trim() ? itemId(item) : ""]))
        });
    // The layer editor handles texture and item layers; text layers (stack counts) are not editable here.
    return layers.flatMap((layer): EditableLayer[] => "item" in layer
        ? [{ ...layer, item: typeof layer.item === "string" ? layer.item : layer.item.toNamespacedString() }]
        : "texture" in layer ? [{ ...layer, texture: typeof layer.texture === "string" ? layer.texture : layer.texture.toNamespacedString() }] : []);
}

function modelId(item: string): string {
    const [namespace, path] = itemId(item).split(":");
    return `${namespace}:item/${path}`;
}

export function validateLayers(value: unknown): EditableLayer[] {
    if (!Array.isArray(value) || !value.length || value.length > 128) throw new Error("Provide an array of 1–128 GUI layers.");
    return value.map((value, index) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Layer ${index + 1} must be an object.`);
        const layer = value as Record<string, unknown>;
        const texture = typeof layer.texture === "string" && layer.texture.trim();
        const item = typeof layer.item === "string" && layer.item.trim();
        if (!!texture === !!item) throw new Error(`Layer ${index + 1} requires either texture or item.`);
        const result: EditableLayer = texture ? { texture } : { item: item as string };
        const asset = (texture || item) as string;
        if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(asset)) throw new Error(`Layer ${index + 1} has an invalid asset ID.`);
        if (layer.name !== undefined) {
            if (typeof layer.name !== "string" || layer.name.length > 128) throw new Error(`Layer ${index + 1} name must be at most 128 characters.`);
            result.name = layer.name;
        }
        for (const [key, length] of [["position", 2], ["size", 2], ["crop", 4]] as const) {
            if (layer[key] === undefined) continue;
            const numbers = layer[key];
            if (!Array.isArray(numbers) || numbers.length !== length || numbers.some(n => typeof n !== "number" || !Number.isFinite(n) || Math.abs(n) > 8192)) {
                throw new Error(`Layer ${index + 1} ${key} requires ${length} finite numbers between -8192 and 8192.`);
            }
            if (key !== "position" && numbers.slice(key === "crop" ? 2 : 0).some(n => n <= 0)) throw new Error(`Layer ${index + 1} dimensions must be positive.`);
            if (key === "crop" && (item || numbers[0] < 0 || numbers[1] < 0)) throw new Error(`Layer ${index + 1} crops require a texture and nonnegative source coordinates.`);
            (result as Record<string, unknown>)[key] = [...numbers];
        }
        if (layer.tints !== undefined) {
            if (texture || !layer.tints || typeof layer.tints !== "object" || Array.isArray(layer.tints)) throw new Error(`Layer ${index + 1} tints require an item and an object of tint indices and RGB numbers.`);
            const tints: Record<number, number> = {};
            for (const [key, color] of Object.entries(layer.tints)) {
                if (!/^\d+$/.test(key) || typeof color !== "number" || !Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error(`Layer ${index + 1} tint values must be integers from 0 to 16777215.`);
                tints[Number(key)] = color;
            }
            result.tints = tints;
        }
        return result;
    });
}

export function asGuiLayers(layers: EditableLayer[]): GuiLayer[] {
    return validateLayers(layers) as GuiLayer[];
}
