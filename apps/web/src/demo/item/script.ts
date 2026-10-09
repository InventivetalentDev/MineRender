import { AssetKey, BannerPatterns, DISPLAY_POSITIONS, DisplayPosition, ItemGlint, ModelMerger, Models, isGuiObject, isInstanceReference, isModelObject, type GuiObject, type ItemModel, type ItemModelContext } from "minerender";
import { Box3, OrthographicCamera, PerspectiveCamera, Vector2 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { button, field, group, input, note, section, select, suggestions } from "../../playground/controls";
import { assetKey, loadModel, modelControls, modelDefaults, modelOptions, selectModel, type ModelSettings } from "../../playground/models";
import { CUSTOM_MODEL_DATA_ITEM, customModelDataCode, loadCustomModelData, withCustomModelData } from "./customModelData";
import { SHULKER_DIRECTIONS, loadShulkerPreview, shulkerPreviewCode, withShulkerPreview, type ShulkerDirection } from "./shulkerPreview";
import { bannerControls, hasBannerControls } from "./bannerControls";
import type { ViewSettings } from "../../playground/config";

interface ItemSettings extends ModelSettings {
    /** An item ID (`minecraft:apple`) or a model path (`minecraft:item/apple`, `minecraft:block/stone`). */
    item: string;
    display: DisplayPosition | "";
    preview: "model" | "slot";
    properties: Record<string, boolean | string | number>;
    itemReferences: Record<string, string>;
    components: Record<string, unknown>;
    count: number;
    shulkerOpenness: number;
    shulkerOrientation: ShulkerDirection;
}

const defaults: ItemSettings = { ...modelDefaults, item: "minecraft:iron_sword", display: "", preview: "model", properties: {}, itemReferences: {}, components: {}, count: 1,
    shulkerOpenness: 0, shulkerOrientation: "up" };
const shulkerItems: Array<[string, string]> = [
    ["minecraft:shulker_box", "Undyed"],
    ...["white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black"]
        .map(color => [`minecraft:${color}_shulker_box`, color.replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase())] as [string, string])
];
const guiView: Partial<ViewSettings> = {
    projection: "orthographic", antialias: false, camera: { position: [0, 0, 100], target: [0, 0, 0], zoom: 24 }
};
const app = new Playground<ItemSettings>({
    title: "Items and models",
    defaults,
    renderer: { camera: { position: [20, 14, 30] } },
    presets: {
        sword: { label: "Iron sword (flat item)", state: {} },
        sapling: { label: "Oak sapling (cutout)", state: { item: "minecraft:oak_sapling" } },
        apple: { label: "Apple in GUI pose", state: { item: "minecraft:apple", display: DisplayPosition.GUI } },
        stack: { label: "Inventory slot: 64 apples", state: { item: "minecraft:apple", preview: "slot", count: 64 }, view: guiView },
        damaged: { label: "Inventory slot: damaged pickaxe", state: { item: "minecraft:diamond_pickaxe", preview: "slot",
            components: { "minecraft:damage": 781, "minecraft:max_damage": 1561 } }, view: guiView },
        enchanted: { label: "Inventory slot: enchanted pickaxe", state: { item: "minecraft:diamond_pickaxe", preview: "slot",
            components: { "minecraft:enchantments": { "minecraft:efficiency": 3 } } }, view: guiView },
        nether_star: { label: "Inventory slot: nether star", state: { item: "minecraft:nether_star", preview: "slot" }, view: guiView },
        potion: { label: "Potion (tinted)", state: { item: "minecraft:potion", tints: { 0: 0xd557ef } } },
        dyed_leather: { label: "Dyed leather (blue component)", state: { item: "minecraft:leather_chestplate", display: DisplayPosition.GUI,
            components: { "minecraft:dyed_color": 0x3f76e4 } }, view: guiView },
        potion_color: { label: "Potion (custom color component)", state: { item: "minecraft:potion", display: DisplayPosition.GUI,
            components: { "minecraft:potion_contents": { custom_color: 0xd557ef } } }, view: guiView },
        map_color: { label: "Map (gold color component)", state: { item: "minecraft:filled_map", display: DisplayPosition.GUI,
            components: { "minecraft:map_color": 0xe0a63a } }, view: guiView },
        firework_color: { label: "Firework star (red and blue colors)", state: { item: "minecraft:firework_star", display: DisplayPosition.GUI,
            components: { "minecraft:firework_explosion": { shape: "small_ball", colors: [0xff0000, 0x0000ff] } } }, view: guiView },
        block: { label: "Block model: diamond ore", state: { item: "minecraft:block/diamond_ore", display: DisplayPosition.GUI } },
        shulker: { label: "Shulker box (color and opening)", state: { item: "minecraft:shulker_box", display: DisplayPosition.GUI }, view: guiView },
        banner: { label: "Banner with ordered patterns", state: { item: "minecraft:red_banner", display: DisplayPosition.GUI,
            components: { "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_bottom", color: "white" }, { pattern: "minecraft:cross", color: "black" }] } }, view: guiView },
        shield: { label: "Shield with a colored pattern", state: { item: "minecraft:shield", display: DisplayPosition.GUI,
            properties: { "minecraft:using_item": false }, components: { "minecraft:base_color": "blue",
                "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_center", color: "white" }] } }, view: guiView },
        enchanted_shield: { label: "Inventory slot: enchanted patterned shield", state: { item: "minecraft:shield", preview: "slot", display: DisplayPosition.GUI,
            properties: { "minecraft:using_item": false }, components: { "minecraft:base_color": "blue",
                "minecraft:banner_patterns": [{ pattern: "minecraft:stripe_center", color: "white" }],
                "minecraft:enchantments": { "minecraft:unbreaking": 3 } } }, view: guiView },
        trident: { label: "Trident (held or throwing)", state: { item: "minecraft:trident", display: DisplayPosition.THIRDPERSON_RIGHTHAND,
            properties: { "minecraft:using_item": false } }, view: { camera: { position: [40, 24, 70], target: [0, 0, 0], zoom: 1 } } },
        enchanted_trident: { label: "Enchanted trident (held or throwing)", state: { item: "minecraft:trident", display: DisplayPosition.THIRDPERSON_RIGHTHAND,
            properties: { "minecraft:using_item": false }, components: { "minecraft:enchantments": { "minecraft:loyalty": 3 } } },
            view: { projection: "perspective", camera: { position: [40, 24, 70], target: [0, 0, 0], zoom: 1 } } },
        conduit: { label: "Conduit in GUI pose", state: { item: "minecraft:conduit", display: DisplayPosition.GUI }, view: guiView },
        bundle: {
            label: "Bundle with a selected item",
            state: { item: "minecraft:bundle", display: DisplayPosition.GUI,
                properties: { "minecraft:bundle/has_selected_item": true },
                itemReferences: { "minecraft:bundle/selected_item": "minecraft:apple" } },
            view: guiView
        },
        bow: { label: "Bow pulling (duration in ticks)", state: { item: "minecraft:bow", display: DisplayPosition.GUI,
            properties: { "minecraft:using_item": true, "minecraft:use_duration": 0 } } },
        crossbow: { label: "Crossbow with an arrow", state: { item: "minecraft:crossbow", display: DisplayPosition.GUI,
            properties: { "minecraft:charge_type": "arrow" } } },
        custom_model_data: { label: "Custom model data: two float indices", state: { item: CUSTOM_MODEL_DATA_ITEM, display: DisplayPosition.GUI,
            components: { "minecraft:custom_model_data": { floats: [0, 0] } } } },
        custom_model_color: { label: "Custom model data: color index 1", state: { item: CUSTOM_MODEL_DATA_ITEM, display: DisplayPosition.GUI,
            components: { "minecraft:custom_model_data": { floats: [0, 1], colors: [0xff0000, 0x55ff55] } } }, view: guiView },
        legacy: { label: "Model path: item/iron_sword", state: { item: "minecraft:item/iron_sword" } }
    },
    load,
    code(state) {
        const key = modelKey(state.item);
        const context = itemContext(state);
        const references = Object.entries(context.itemReferences ?? {}).map(([id, key]) => `${JSON.stringify(id)}: ${keyCode(key)}`);
        const contextCode = `{ ${state.preview === "slot" ? "" : `displayContext: ${JSON.stringify(context.displayContext)}, `}count: ${context.count}`
            + (Object.keys(context.components ?? {}).length ? `, components: ${JSON.stringify(context.components)}` : "")
            + (Object.keys(context.properties ?? {}).length ? `, properties: ${JSON.stringify(context.properties)}` : "")
            + (references.length ? `, itemReferences: { ${references.join(", ")} }` : "") + " }";
        if (state.preview === "slot") {
            const load = `renderer.scene.addGui([{ name: "item", item: ${keyCode(key)}, position: [-8, -8], context: ${contextCode}, tints: ${JSON.stringify(state.tints)} }])`;
            if (state.count === 0) return `const gui = await ${load};\n`;
            return state.item === CUSTOM_MODEL_DATA_ITEM ? customModelDataCode(load, "gui")
                : hasShulkerPreview(state) ? shulkerPreviewCode(key, state.shulkerOpenness, state.shulkerOrientation, load, "gui") : `const gui = await ${load};\n`;
        }
        const load = isModelPath(state.item) ? `MineRender.ModelMerger.mergeWithParents(await MineRender.Models.getRaw(${keyCode(key)}))` : `MineRender.Models.getMerged(${keyCode(key)}, ${contextCode})`;
        const modelCode = state.item === CUSTOM_MODEL_DATA_ITEM ? customModelDataCode(load)
            : hasShulkerPreview(state) ? shulkerPreviewCode(key, state.shulkerOpenness, state.shulkerOrientation, load) : `const model = await ${load};\n`;
        return `${modelCode}
await renderer.scene.addModel(model, ${JSON.stringify({ ...modelOptions(state), displayPosition: state.display || undefined }, null, 2)});\n`;
    }
});

const itemGroup = group(app.controls, "Item");
const itemInput = input(itemGroup, "Item ID or model path", app.state.item);
itemInput.id = "item-input";
itemInput.addEventListener("change", () => void app.update({ item: itemInput.value.trim() }));
button(itemGroup, "Load", () => void app.update({ item: itemInput.value.trim() }));
note(itemGroup, "minecraft:apple loads the item definition; minecraft:item/apple or minecraft:block/stone loads that model file.");
const preview = select(itemGroup, "Preview", [["model", "Model"], ["slot", "Inventory slot"]], app.state.preview);
preview.id = "item-preview";
preview.addEventListener("change", async () => {
    const previous = app.renderer;
    await app.update({ preview: preview.value as ItemSettings["preview"] });
    if (app.renderer !== previous) app.fit();
});
const display = select(itemGroup, "Display pose", [["", "None"], ...DISPLAY_POSITIONS], app.state.display);
display.id = "item-display";
display.addEventListener("change", () => void app.update({ display: display.value as ItemSettings["display"] }));
const shulkerGroup = group(app.controls, "Shulker preview");
shulkerGroup.hidden = true;
const shulkerColor = select(shulkerGroup, "Color", shulkerItems, app.state.item);
shulkerColor.id = "item-shulker-color";
shulkerColor.addEventListener("change", () => void app.update({ item: shulkerColor.value }));
const shulkerOpenness = input(shulkerGroup, "Openness (0 closed, 1 open)", app.state.shulkerOpenness, "range");
shulkerOpenness.id = "item-shulker-openness";
Object.assign(shulkerOpenness, { min: "0", max: "1", step: "0.05" });
const shulkerOpennessValue = document.createElement("output");
shulkerOpennessValue.htmlFor.value = shulkerOpenness.id;
shulkerOpennessValue.value = String(app.state.shulkerOpenness);
shulkerOpenness.after(shulkerOpennessValue);
shulkerOpenness.addEventListener("input", () => { shulkerOpennessValue.value = shulkerOpenness.value; });
shulkerOpenness.addEventListener("change", () => void app.update({ shulkerOpenness: shulkerOpenness.valueAsNumber }));
const shulkerOrientation = select(shulkerGroup, "Direction", SHULKER_DIRECTIONS.map(direction => [direction,
    direction.replace(/^./, letter => letter.toUpperCase())]), app.state.shulkerOrientation);
shulkerOrientation.id = "item-shulker-orientation";
shulkerOrientation.addEventListener("change", () => void app.update({ shulkerOrientation: shulkerOrientation.value as ShulkerDirection }));
note(shulkerGroup, "Preview the lid opening and direction.");
const syncBannerControls = bannerControls(app.controls, () => app.state, patch => { void app.update(patch); });
const stackGroup = group(app.controls, "Item stack");
const count = input(stackGroup, "Count", app.state.count, "number");
count.id = "item-count";
Object.assign(count, { min: "0", max: String(Number.MAX_SAFE_INTEGER), step: "1" });
count.addEventListener("change", () => void app.update({ count: count.valueAsNumber }));
let stackState: ItemSettings | undefined;
const glint = select(stackGroup, "Enchantment glint", [["auto", "Auto"], ["on", "On"], ["off", "Off"]], "auto");
glint.id = "item-glint";
glint.addEventListener("change", () => {
    if (glint.disabled || !stackState || app.state.item !== stackState.item
        || JSON.stringify(app.state.components) !== JSON.stringify(stackState.components)) return;
    const next = structuredClone(app.state.components);
    delete next.enchantment_glint_override;
    delete next["minecraft:enchantment_glint_override"];
    if (glint.value !== "auto") next["minecraft:enchantment_glint_override"] = glint.value === "on";
    glint.disabled = true;
    void app.update({ components: next });
});
note(stackGroup, "Auto follows the item's default glint and supplied enchantments. On and Off override the shimmer without changing enchantments.");
const damageFields = (["damage", "max_damage"] as const).map(name => {
    const control = input(stackGroup, name === "damage" ? "Damage (optional)" : "Maximum damage (optional)", "", "number");
    control.id = `item-${name.replace(/_/g, "-")}`;
    control.placeholder = "Not supplied";
    Object.assign(control, { min: name === "damage" ? "0" : "1", max: "2147483647", step: "1" });
    control.addEventListener("change", () => {
        if (control.disabled || !stackState || app.state.item !== stackState.item
            || JSON.stringify(app.state.components) !== JSON.stringify(stackState.components)) return;
        const current = app.state.components;
        if (!current || typeof current !== "object" || Array.isArray(current)) return;
        const next = structuredClone(current);
        const id = Object.prototype.hasOwnProperty.call(next, name) ? name : `minecraft:${name}`;
        if (control.value === "") delete next[id];
        else {
            const value = control.valueAsNumber;
            if (!Number.isInteger(value) || value < Number(control.min) || value > Number(control.max)) {
                app.report(`${name === "damage" ? "Damage" : "Maximum damage"} must be a whole number from ${control.min} to ${control.max}.`, true);
                return;
            }
            next[id] = value;
        }
        damageFields.forEach(({ control }) => { control.disabled = true; });
        void app.update({ components: next });
    });
    return { name, control };
});
const slotNote = note(stackGroup, "Count 0 leaves the slot empty. A durability bar needs both damage values and no unbreakable component. Blank fields remove damage values.");
const componentColors = document.createElement("div");
stackGroup.append(componentColors);
const components = field(stackGroup, "Components (JSON)", document.createElement("textarea"));
components.id = "item-components";
components.rows = 6;
button(stackGroup, "Apply components", () => {
    try { void app.update({ components: JSON.parse(components.value) }); }
    catch (error) { app.report((error as Error).message, true); }
});
const propertiesGroup = group(app.controls, "Item properties");
const propertyEntries = document.createElement("div");
propertiesGroup.append(propertyEntries);
const addProperty = section(propertiesGroup, "Add property");
const propertyId = input(addProperty, "Property ID", "");
propertyId.placeholder = "minecraft:using_item";
const propertyType = select(addProperty, "Value type", ["boolean", "string", "number"], "boolean");
button(addProperty, "Add property", () => {
    try {
        const id = stateId(propertyId.value.trim());
        const value = propertyType.value === "boolean" ? false : propertyType.value === "number" ? 0 : "";
        void app.update({ properties: { ...app.state.properties, [id]: value } });
    } catch (error) { app.report((error as Error).message, true); }
});
note(propertiesGroup, "Use the property IDs and value types from the item definition. Model paths ignore item state.");
const referencesGroup = group(app.controls, "Item references");
const referenceEntries = document.createElement("div");
referencesGroup.append(referenceEntries);
const addReference = section(referencesGroup, "Add reference");
const referenceId = input(addReference, "Reference ID", "");
referenceId.placeholder = "minecraft:bundle/selected_item";
const referenceItem = input(addReference, "Item ID", "");
referenceItem.id = "item-reference-input";
referenceItem.placeholder = "minecraft:apple";
button(addReference, "Add reference", () => {
    try {
        const id = stateId(referenceId.value.trim());
        const item = referenceItem.value.trim();
        referenceKey(item);
        void app.update({ itemReferences: { ...app.state.itemReferences, [id]: item } });
    } catch (error) { app.report((error as Error).message, true); }
});
const syncModelControls = modelControls(app);
const modelOptionsGroup = Array.from(app.controls.querySelectorAll("fieldset")).find(group => group.querySelector("legend")?.textContent === "Model options")!;
syncModelControls();

function isModelPath(item: string): boolean {
    return /^(?:[a-z0-9_.-]+:)?(?:item|block)\//.test(item.trim());
}

function shulkerItem(item: string): string | undefined {
    return shulkerItems.find(([id]) => id === (item.includes(":") ? item : `minecraft:${item}`))?.[0];
}

function hasShulkerPreview(state: ItemSettings): boolean {
    if (!shulkerItem(state.item)) return false;
    if (!Number.isFinite(state.shulkerOpenness) || state.shulkerOpenness < 0 || state.shulkerOpenness > 1) {
        throw new Error("Shulker openness must be a number from 0 to 1.");
    }
    if (!SHULKER_DIRECTIONS.includes(state.shulkerOrientation)) throw new Error("Choose a supported shulker direction.");
    return true;
}

function modelKey(item: string): AssetKey {
    const key = assetKey(item, "models", "item");
    if (!isModelPath(item)) return key;
    const [type, ...path] = key.path.split("/");
    return new AssetKey(key.namespace, path.join("/"), "models", type);
}

function keyCode(key: AssetKey): string {
    return `new MineRender.AssetKey(${JSON.stringify(key.namespace)}, ${JSON.stringify(key.path)}, "models", ${JSON.stringify(key.type)})`;
}

function stateId(value: string): string {
    const match = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)$/.exec(value);
    if (!match) throw new Error("Enter a namespaced ID such as minecraft:using_item or minecraft:apple.");
    return `${match[1] ?? "minecraft"}:${match[2]}`;
}

function referenceKey(value: unknown): AssetKey {
    if (typeof value !== "string" || !value.trim() || isModelPath(value)) {
        throw new Error("Enter a referenced item ID such as minecraft:diamond_block.");
    }
    return modelKey(stateId(value.trim()));
}

function syncComponentColors(state: ItemSettings): void {
    componentColors.replaceChildren();
    const add = (id: string, title: string, value: unknown, path: Array<string | number> = [], allowTriple = false) => {
        let rgb: number;
        if (typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 2147483647) rgb = value & 0xffffff;
        else if (allowTriple && Array.isArray(value) && value.length === 3 && value.every(channel => typeof channel === "number" && Number.isFinite(channel))) {
            const [red, green, blue] = value.map(channel => Math.floor(Math.fround(Math.fround(channel) * 255)) & 255);
            rgb = red << 16 | green << 8 | blue;
        } else return;
        const picker = input(componentColors, title, `#${rgb.toString(16).padStart(6, "0")}`, "color");
        picker.dataset.itemColor = id;
        const index = path[path.length - 1];
        if (typeof index === "number") picker.dataset.colorIndex = String(index);
        picker.addEventListener("change", () => {
            const current = app.state.components;
            if (!current || typeof current !== "object" || Array.isArray(current)) return;
            const next = structuredClone(current);
            const keys = [id, ...path];
            let target: Record<string | number, unknown> = next;
            for (const key of keys.slice(0, -1)) {
                const value = target[key];
                if (!value || typeof value !== "object") return;
                target = value as Record<string | number, unknown>;
            }
            const key = keys[keys.length - 1];
            if (!Object.prototype.hasOwnProperty.call(target, key)) return;
            target[key] = parseInt(picker.value.slice(1), 16);
            void app.update({ components: next });
        });
    };
    for (const [id, value] of Object.entries(state.components)) {
        const name = id.replace(/^minecraft:/, "");
        if (name === "dyed_color") add(id, "Dye color", value, [], true);
        else if (name === "map_color") add(id, "Map color", value);
        else if (value && typeof value === "object" && !Array.isArray(value)) {
            const data = value as Record<string, unknown>;
            if (name === "potion_contents") add(id, "Potion color", data.custom_color, ["custom_color"]);
            else if ((name === "firework_explosion" || name === "custom_model_data") && Array.isArray(data.colors)) {
                data.colors.forEach((color, index) => add(id,
                    name === "firework_explosion" ? `Firework color ${index + 1}` : `Custom model color (index ${index})`,
                    color, ["colors", index], name === "custom_model_data"));
            }
        }
    }
}

function syncStateControls(state: ItemSettings, items: string[]): void {
    stackState = state;
    count.value = String(state.count);
    const override = state.components["minecraft:enchantment_glint_override"] ?? state.components.enchantment_glint_override;
    glint.value = override === true ? "on" : override === false ? "off" : "auto";
    glint.disabled = isModelPath(state.item);
    for (const { name, control } of damageFields) {
        const value = state.components[name] ?? state.components[`minecraft:${name}`];
        control.value = value === undefined ? "" : String(value);
        control.disabled = false;
    }
    slotNote.hidden = state.preview !== "slot";
    syncComponentColors(state);
    components.value = JSON.stringify(state.components, null, 2);
    propertyEntries.replaceChildren();
    for (const [id, value] of Object.entries(state.properties)) {
        const row = document.createElement("div");
        const control = typeof value === "boolean" ? select(row, id, [["false", "False"], ["true", "True"]], String(value))
            : input(row, id, value, typeof value === "number" ? "number" : "text");
        if (typeof value === "number") (control as HTMLInputElement).step = "any";
        control.dataset.itemProperty = id;
        control.addEventListener("change", () => {
            const next = typeof value === "boolean" ? control.value === "true" : typeof value === "number" ? (control as HTMLInputElement).valueAsNumber : control.value;
            void app.update({ properties: { ...app.state.properties, [id]: next } });
        });
        button(row, "Remove property", () => {
            const properties = { ...app.state.properties };
            delete properties[id];
            void app.update({ properties });
        });
        propertyEntries.append(row);
    }
    referenceEntries.replaceChildren();
    for (const [id, item] of Object.entries(state.itemReferences)) {
        const row = document.createElement("div");
        const control = input(row, id, item);
        control.id = `item-reference-${referenceEntries.children.length}`;
        control.dataset.itemReference = id;
        suggestions(control, items);
        control.addEventListener("change", () => void app.update({ itemReferences: { ...app.state.itemReferences, [id]: control.value.trim() } }));
        button(row, "Remove reference", () => {
            const itemReferences = { ...app.state.itemReferences };
            delete itemReferences[id];
            void app.update({ itemReferences });
        });
        referenceEntries.append(row);
    }
    suggestions(referenceItem, items);
}

function itemContext(state: ItemSettings): ItemModelContext {
    if (!Number.isSafeInteger(state.count) || state.count < 0) throw new Error("Item count must be a nonnegative safe integer.");
    const context: ItemModelContext = { displayContext: state.preview === "slot" ? DisplayPosition.GUI : state.display || "none", properties: {}, itemReferences: {}, components: {}, count: state.count };
    for (const entries of [state.properties, state.itemReferences, state.components]) {
        if (!entries || typeof entries !== "object" || Array.isArray(entries)) throw new Error("Item properties, references, and components must be objects keyed by ID.");
        const ids = Object.keys(entries).map(stateId);
        if (new Set(ids).size !== ids.length) throw new Error("Each item property, reference, or component ID must occur once, including namespace aliases.");
    }
    for (const [id, value] of Object.entries(state.properties)) {
        if (!["boolean", "string", "number"].includes(typeof value) || (typeof value === "number" && !Number.isFinite(value))) {
            throw new Error("Item property values must be booleans, strings, or finite numbers.");
        }
        context.properties![stateId(id)] = value;
    }
    for (const [id, value] of Object.entries(state.itemReferences)) context.itemReferences![stateId(id)] = referenceKey(value);
    for (const [id, value] of Object.entries(state.components)) context.components![stateId(id)] = value;
    return context;
}

async function load(ctx: DemoContext, state: ItemSettings): Promise<DemoContent> {
    if (state.preview !== "model" && state.preview !== "slot") throw new Error("Choose Model or Inventory slot preview.");
    if (state.display !== "" && !DISPLAY_POSITIONS.includes(state.display)) throw new Error("Choose a supported display pose.");
    const key = modelKey(state.item);
    const direct = isModelPath(state.item);
    if (state.preview === "slot" && direct) throw new Error("Inventory slots need an item ID, such as minecraft:apple. Use Model preview for model paths.");
    const context = itemContext(state);
    const previewShulker = hasShulkerPreview(state);
    const loadSlot = () => ctx.renderer.scene.addGui([{ name: "item", item: key, position: [-8, -8], context, tints: modelOptions(state).tints }]);
    const pending = state.preview === "slot" ? state.count === 0 ? loadSlot() : state.item === CUSTOM_MODEL_DATA_ITEM
        ? withCustomModelData(loadSlot) : previewShulker ? withShulkerPreview(key, state.shulkerOpenness, state.shulkerOrientation, loadSlot) : loadSlot()
        : direct ? Models.getRaw(key) : state.item === CUSTOM_MODEL_DATA_ITEM
        ? loadCustomModelData(key, context) : previewShulker ? loadShulkerPreview(key, context, state.shulkerOpenness, state.shulkerOrientation)
            : Models.getMerged(key, context);
    const [loaded, list, patterns] = await Promise.all([pending, Models.getItemList().catch(() => []), hasBannerControls(state) ? BannerPatterns.getList().catch(() => []) : []]);
    if (loaded && isGuiObject(loaded)) ctx.onCleanup(() => { loaded.removeFromScene(); loaded.dispose(); });
    const model = direct && loaded && !isGuiObject(loaded) ? await ModelMerger.mergeWithParents(loaded) : loaded;
    if (!model) throw new Error(`Model not found: ${state.item}`);
    const object = isGuiObject(model) ? model : await loadModel(ctx, model, { ...modelOptions(state), displayPosition: state.display || undefined });
    const visual = isInstanceReference(object) ? object.instanceable : object;
    let hasGlint = false;
    visual.traverse(child => {
        if (!isModelObject(child)) return;
        const item = child.originalModel as ItemModel;
        const special = item.special?.type.replace(/^minecraft:/, "");
        if (!item.parts && (!special || special === "shield" || special === "trident")) hasGlint ||= ItemGlint.enabled(item.components);
    });
    return {
        object: visual,
        bounds: new Box3().setFromObject(visual),
        fit: isGuiObject(object) ? () => fitSlot(ctx, object) : undefined,
        activate() {
            app.status.dataset.glint = String(hasGlint);
            itemInput.value = state.item;
            suggestions(itemInput, list);
            preview.value = state.preview;
            display.value = state.preview === "slot" ? DisplayPosition.GUI : state.display;
            display.disabled = state.preview === "slot";
            modelOptionsGroup.disabled = state.preview === "slot";
            shulkerGroup.hidden = !shulkerItem(state.item);
            shulkerColor.value = shulkerItem(state.item) ?? "";
            shulkerOpenness.value = String(state.shulkerOpenness);
            shulkerOpennessValue.value = String(state.shulkerOpenness);
            shulkerOrientation.value = state.shulkerOrientation;
            syncBannerControls(state, patterns);
            syncStateControls(state, list);
            syncModelControls();
            if (isGuiObject(object)) app.inspector?.selectObject(object);
            else selectModel(app, object);
            Object.assign(window, { item: object });
        }
    };
}

function fitSlot(ctx: DemoContext, gui: GuiObject): void {
    const center = gui.bounds.getCenter(new Vector2());
    const size = gui.bounds.getSize(new Vector2());
    const camera = ctx.renderer.camera;
    const canvas = ctx.renderer.renderer.domElement;
    let distance = 100;
    if (camera instanceof OrthographicCamera) camera.zoom = Math.min(canvas.clientWidth / (size.x + 16), canvas.clientHeight / (size.y + 16));
    else if (camera instanceof PerspectiveCamera) {
        const tangent = Math.tan(camera.fov * Math.PI / 360);
        distance = Math.max((size.y + 16) / (2 * tangent), (size.x + 16) / (2 * tangent * camera.aspect));
        camera.zoom = 1;
    }
    camera.position.set(center.x, -center.y, distance);
    camera.lookAt(center.x, -center.y, 0);
    if (camera instanceof OrthographicCamera || camera instanceof PerspectiveCamera) camera.updateProjectionMatrix();
    ctx.renderer.controls?.target.set(center.x, -center.y, 0);
    ctx.renderer.controls?.update();
    ctx.renderer.dirty = true;
}

Object.assign(window, { setItem: (item: string, display = app.state.display) => app.update({ item, display }) });
void app.start();
