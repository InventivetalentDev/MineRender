import { AssetKey, DISPLAY_POSITIONS, DisplayPosition, ModelMerger, Models, isInstanceReference, type ItemModelContext } from "minerender";
import { Box3 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { button, field, group, input, note, section, select, suggestions } from "../../playground/controls";
import { assetKey, loadModel, modelControls, modelDefaults, modelOptions, selectModel, type ModelSettings } from "../../playground/models";
import { CUSTOM_MODEL_DATA_ITEM, customModelDataCode, loadCustomModelData } from "./customModelData";

interface ItemSettings extends ModelSettings {
    /** An item ID (`minecraft:apple`) or a model path (`minecraft:item/apple`, `minecraft:block/stone`). */
    item: string;
    display: DisplayPosition | "";
    properties: Record<string, boolean | string | number>;
    itemReferences: Record<string, string>;
    components: Record<string, unknown>;
    count: number;
}

const defaults: ItemSettings = { ...modelDefaults, item: "minecraft:iron_sword", display: "", properties: {}, itemReferences: {}, components: {}, count: 1 };
const app = new Playground<ItemSettings>({
    title: "Items and models",
    defaults,
    renderer: { camera: { position: [20, 14, 30] } },
    presets: {
        sword: { label: "Iron sword (flat item)", state: {} },
        sapling: { label: "Oak sapling (cutout)", state: { item: "minecraft:oak_sapling" } },
        apple: { label: "Apple in GUI pose", state: { item: "minecraft:apple", display: DisplayPosition.GUI } },
        potion: { label: "Potion (tinted)", state: { item: "minecraft:potion", tints: { 0: 0xd557ef } } },
        block: { label: "Block model: diamond ore", state: { item: "minecraft:block/diamond_ore", display: DisplayPosition.GUI } },
        bundle: {
            label: "Bundle with a selected item",
            state: { item: "minecraft:bundle", display: DisplayPosition.GUI,
                properties: { "minecraft:bundle/has_selected_item": true },
                itemReferences: { "minecraft:bundle/selected_item": "minecraft:apple" } },
            view: { projection: "orthographic", antialias: false, camera: { position: [0, 0, 100], target: [0, 0, 0], zoom: 24 } }
        },
        bow: { label: "Bow pulling (duration in ticks)", state: { item: "minecraft:bow", display: DisplayPosition.GUI,
            properties: { "minecraft:using_item": true, "minecraft:use_duration": 0 } } },
        crossbow: { label: "Crossbow with an arrow", state: { item: "minecraft:crossbow", display: DisplayPosition.GUI,
            properties: { "minecraft:charge_type": "arrow" } } },
        custom_model_data: { label: "Custom model data: two float indices", state: { item: CUSTOM_MODEL_DATA_ITEM, display: DisplayPosition.GUI,
            components: { "minecraft:custom_model_data": { floats: [0, 0] } } } },
        legacy: { label: "Model path: item/iron_sword", state: { item: "minecraft:item/iron_sword" } }
    },
    load,
    code(state) {
        const key = modelKey(state.item);
        const context = itemContext(state);
        const references = Object.entries(context.itemReferences ?? {}).map(([id, key]) => `${JSON.stringify(id)}: ${keyCode(key)}`);
        const contextCode = `{ displayContext: ${JSON.stringify(context.displayContext)}`
            + `, count: ${context.count}`
            + (Object.keys(context.components ?? {}).length ? `, components: ${JSON.stringify(context.components)}` : "")
            + (Object.keys(context.properties ?? {}).length ? `, properties: ${JSON.stringify(context.properties)}` : "")
            + (references.length ? `, itemReferences: { ${references.join(", ")} }` : "") + " }";
        const load = isModelPath(state.item) ? `MineRender.ModelMerger.mergeWithParents(await MineRender.Models.getRaw(${keyCode(key)}))` : `MineRender.Models.getMerged(${keyCode(key)}, ${contextCode})`;
        return `${state.item === CUSTOM_MODEL_DATA_ITEM ? customModelDataCode(load) : `const model = await ${load};\n`}
await renderer.scene.addModel(model, ${JSON.stringify({ ...modelOptions(state), displayPosition: state.display || undefined }, null, 2)});\n`;
    }
});

const itemGroup = group(app.controls, "Item");
const itemInput = input(itemGroup, "Item ID or model path", app.state.item);
itemInput.id = "item-input";
itemInput.addEventListener("change", () => void app.update({ item: itemInput.value.trim() }));
button(itemGroup, "Load", () => void app.update({ item: itemInput.value.trim() }));
note(itemGroup, "minecraft:apple loads the item definition; minecraft:item/apple or minecraft:block/stone loads that model file.");
const display = select(itemGroup, "Display pose", [["", "None"], ...DISPLAY_POSITIONS], app.state.display);
display.id = "item-display";
display.addEventListener("change", () => void app.update({ display: display.value as ItemSettings["display"] }));
const stackGroup = group(app.controls, "Item stack");
const count = input(stackGroup, "Count", app.state.count, "number");
count.id = "item-count";
Object.assign(count, { min: "0", max: String(Number.MAX_SAFE_INTEGER), step: "1" });
count.addEventListener("change", () => void app.update({ count: count.valueAsNumber }));
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
syncModelControls();

function isModelPath(item: string): boolean {
    return /^(?:[a-z0-9_.-]+:)?(?:item|block)\//.test(item.trim());
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

function syncStateControls(state: ItemSettings, items: string[]): void {
    count.value = String(state.count);
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
    const context: ItemModelContext = { displayContext: state.display || "none", properties: {}, itemReferences: {}, components: {}, count: state.count };
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
    if (state.display !== "" && !DISPLAY_POSITIONS.includes(state.display)) throw new Error("Choose a supported display pose.");
    const key = modelKey(state.item);
    const direct = isModelPath(state.item);
    const context = itemContext(state);
    const [loaded, list] = await Promise.all([direct ? Models.getRaw(key) : state.item === CUSTOM_MODEL_DATA_ITEM
        ? loadCustomModelData(key, context) : Models.getMerged(key, context), Models.getItemList().catch(() => [])]);
    const model = direct && loaded ? await ModelMerger.mergeWithParents(loaded) : loaded;
    if (!model) throw new Error(`Model not found: ${state.item}`);
    const object = await loadModel(ctx, model, { ...modelOptions(state), displayPosition: state.display || undefined });
    const visual = isInstanceReference(object) ? object.instanceable : object;
    return {
        object: visual,
        bounds: new Box3().setFromObject(visual),
        activate() {
            itemInput.value = state.item;
            suggestions(itemInput, list);
            display.value = state.display;
            syncStateControls(state, list);
            syncModelControls();
            selectModel(app, object);
            Object.assign(window, { item: object });
        }
    };
}

Object.assign(window, { setItem: (item: string, display = app.state.display) => app.update({ item, display }) });
void app.start();
