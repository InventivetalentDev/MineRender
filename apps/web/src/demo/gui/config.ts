import { GUI_CONTAINER_LAYOUTS, GuiHelper, type GuiBookButtonState, type GuiBossBarColor, type GuiLayer, type GuiText, type GuiTextOptions } from "minerender";

export type EditableLayer = {
    name?: string;
    position?: [number, number];
    size?: [number, number];
    texture?: string;
    crop?: [number, number, number, number];
    item?: string;
    tints?: Record<number, number>;
    text?: GuiText;
    font?: string;
} & Omit<GuiTextOptions, "font">;

export interface GuiState {
    mode: "chest" | "shaped" | "shapeless" | "bossbar" | "book" | "custom";
    /** Item IDs by chest slot; empty strings are empty slots. */
    slots: string[];
    /** Explicit tint overrides by chest slot; items without an entry use their automatic tints. */
    slotTints: Record<number, Record<number, number>>;
    ingredients: string[];
    result: string;
    bossBarColor: GuiBossBarColor;
    bossBarProgress: number;
    bookPrevious: GuiBookButtonState;
    bookNext: GuiBookButtonState;
    bookText: string;
    layers: EditableLayer[];
    scale: "fit" | "1" | "2" | "4";
}

export const defaults: GuiState = {
    mode: "chest",
    slots: ["apple", "diamond", "stone", "grass_block", "oak_stairs", "leather_helmet", "chest", "red_bed", "creeper_head", "potion", "tipped_arrow", "filled_map", "firework_star", "leather_chestplate"],
    slotTints: { 13: { 0: 0xc060d0 } },
    ingredients: ["diamond", "diamond", "diamond", "", "stick", "", "", "stick", ""],
    result: "diamond_pickaxe",
    bossBarColor: "purple",
    bossBarProgress: 0.65,
    bookPrevious: "hidden",
    bookNext: "normal",
    bookText: "Welcome to MineRender!\n\nBuild a scene, choose its assets, and share the result.",
    layers: [],
    scale: "fit"
};

export function itemId(value: string): string {
    const id = value.trim();
    if (!/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(id)) throw new Error("Use a concrete item ID, such as minecraft:diamond.");
    const [namespace, path] = id.includes(":") ? id.split(":") : ["minecraft", id];
    return `${namespace}:${path.replace(/^item\//, "")}`;
}

export async function layersFor(state: GuiState): Promise<EditableLayer[]> {
    if (!["chest", "shaped", "shapeless", "bossbar", "book", "custom"].includes(state.mode)) throw new Error("Choose a chest, recipe, boss bar, book, or custom GUI layout.");
    if (!["fit", "1", "2", "4"].includes(state.scale)) throw new Error("Choose Fit, 1×, 2×, or 4× GUI scale.");
    if (state.mode === "custom") return validateLayers(state.layers);
    if (state.mode === "chest") {
        return [...editableLayers(await GuiHelper.container("generic_54")), ...chestItems(state)];
    }
    if (state.mode === "bossbar") return editableLayers(await GuiHelper.bossBar({ color: state.bossBarColor, progress: state.bossBarProgress }));
    if (state.mode === "book") {
        if (typeof state.bookText !== "string") throw new Error("Book text must be a string.");
        return editableLayers(await GuiHelper.book({ previous: state.bookPrevious, next: state.bookNext, text: state.bookText }));
    }
    return editableLayers(recipeLayers(state));
}

function chestItems(state: GuiState): EditableLayer[] {
    const layout = GUI_CONTAINER_LAYOUTS.generic_54;
    if (!Array.isArray(state.slots) || state.slots.length > layout.slotCount || state.slots.some(item => typeof item !== "string")) throw new Error("A chest has 54 slots.");
    if (!state.slotTints || typeof state.slotTints !== "object" || Array.isArray(state.slotTints)) throw new Error("Slot tints must be an object keyed by slot.");
    return state.slots.flatMap((item, slot): EditableLayer[] => item.trim() ? [validateLayers([{
        name: `slot-${slot}`, item: modelId(item),
        position: GuiHelper.inventorySlot(slot, [...layout.slotOrigin], [...layout.slotOffset], layout.rowSize), tints: state.slotTints[slot]
    }])[0]] : []);
}

function recipeLayers(state: GuiState): GuiLayer[] {
    if (!Array.isArray(state.ingredients) || state.ingredients.length !== 9 || state.ingredients.some(item => typeof item !== "string")) throw new Error("Recipes require nine cells; leave unused cells empty.");
    const result = { id: itemId(state.result) };
    return state.mode === "shapeless"
        ? GuiHelper.recipe({ type: "crafting_shapeless", ingredients: state.ingredients.filter(Boolean).map(itemId), result })
        : GuiHelper.recipe({
            type: "crafting_shaped", result,
            pattern: [0, 3, 6].map(offset => state.ingredients.slice(offset, offset + 3).map((item, i) => item.trim() ? String(offset + i) : " ").join("")),
            key: Object.fromEntries(state.ingredients.map((item, i) => [String(i), item.trim() ? itemId(item) : ""]))
        });
}

function editableLayers(layers: readonly GuiLayer[]): EditableLayer[] {
    return validateLayers(layers.map(layer => "item" in layer
        ? { ...layer, item: typeof layer.item === "string" ? layer.item : layer.item.toNamespacedString() }
        : "texture" in layer ? { ...layer, texture: typeof layer.texture === "string" ? layer.texture : layer.texture.toNamespacedString() }
            : { ...layer, font: typeof layer.font === "string" ? layer.font : layer.font?.toNamespacedString() }));
}

export function codeFor(state: GuiState): string {
    let code: string;
    if (state.mode === "chest") {
        code = `const layers = await MineRender.GuiHelper.container("generic_54");\nlayers.push(...${JSON.stringify(chestItems(state), null, 2)});`;
    } else if (state.mode === "bossbar") {
        code = `const layers = await MineRender.GuiHelper.bossBar(${JSON.stringify({ color: state.bossBarColor, progress: state.bossBarProgress }, null, 2)});`;
    } else if (state.mode === "book") {
        code = `const layers = await MineRender.GuiHelper.book(${JSON.stringify({ previous: state.bookPrevious, next: state.bookNext, text: state.bookText }, null, 2)});`;
    } else {
        code = `const layers = ${JSON.stringify(state.mode === "custom" ? validateLayers(state.layers) : editableLayers(recipeLayers(state)), null, 2)};`;
    }
    return `${code}\nconst gui = await renderer.scene.addGui(layers);\n`;
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
        const text = layer.text !== undefined;
        if (Number(!!texture) + Number(!!item) + Number(text) !== 1) throw new Error(`Layer ${index + 1} requires one of texture, item, or text.`);
        const result: EditableLayer = texture ? { texture } : item ? { item } : { text: validateText(layer.text, index) };
        const asset = (texture || item) as string;
        if (!text && !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(asset)) throw new Error(`Layer ${index + 1} has an invalid asset ID.`);
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
            if (key === "crop" && (!texture || numbers[0] < 0 || numbers[1] < 0)) throw new Error(`Layer ${index + 1} crops require a texture and nonnegative source coordinates.`);
            (result as Record<string, unknown>)[key] = [...numbers];
        }
        if (layer.tints !== undefined) {
            if (!item || !layer.tints || typeof layer.tints !== "object" || Array.isArray(layer.tints)) throw new Error(`Layer ${index + 1} tints require an item and an object of tint indices and RGB numbers.`);
            const tints: Record<number, number> = {};
            for (const [key, color] of Object.entries(layer.tints)) {
                if (!/^\d+$/.test(key) || typeof color !== "number" || !Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error(`Layer ${index + 1} tint values must be integers from 0 to 16777215.`);
                tints[Number(key)] = color;
            }
            result.tints = tints;
        }
        if (text) {
            Object.assign(result, validateTextStyle(layer, index));
            if (layer.font !== undefined) {
                if (typeof layer.font !== "string" || !/^(?:[a-z0-9_.-]+:)?[a-z0-9_./-]+$/.test(layer.font)) throw new Error(`Layer ${index + 1} has an invalid font ID.`);
                result.font = layer.font;
            }
            if (layer.shadow !== undefined) {
                if (typeof layer.shadow !== "boolean") throw new Error(`Layer ${index + 1} shadow must be true or false.`);
                result.shadow = layer.shadow;
            }
            for (const key of ["maxWidth", "lineHeight"] as const) {
                if (layer[key] === undefined) continue;
                if (typeof layer[key] !== "number" || !Number.isFinite(layer[key]) || layer[key] <= 0 || layer[key] > 8192) throw new Error(`Layer ${index + 1} ${key} must be greater than 0 and at most 8192.`);
                result[key] = layer[key];
            }
        }
        return result;
    });
}

function validateText(value: unknown, index: number): GuiText {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) throw new Error(`Layer ${index + 1} text must be a string or an array of styled text runs.`);
    return value.map(run => {
        if (!run || typeof run !== "object" || Array.isArray(run) || typeof run.text !== "string") throw new Error(`Layer ${index + 1} text runs require a text string.`);
        return { text: run.text, ...validateTextStyle(run, index) };
    });
}

function validateTextStyle(value: Record<string, unknown>, index: number): Pick<GuiTextOptions, "color" | "bold" | "italic"> {
    const style: Pick<GuiTextOptions, "color" | "bold" | "italic"> = {};
    if (value.color !== undefined) {
        if (typeof value.color !== "number" || !Number.isInteger(value.color) || value.color < 0 || value.color > 0xffffff) throw new Error(`Layer ${index + 1} text color must be an integer from 0 to 16777215.`);
        style.color = value.color;
    }
    for (const key of ["bold", "italic"] as const) {
        if (value[key] === undefined) continue;
        if (typeof value[key] !== "boolean") throw new Error(`Layer ${index + 1} ${key} must be true or false.`);
        style[key] = value[key];
    }
    return style;
}

export function asGuiLayers(layers: EditableLayer[]): GuiLayer[] {
    return validateLayers(layers) as GuiLayer[];
}
