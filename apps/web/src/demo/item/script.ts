import { AssetKey, AssetLoader, DISPLAY_POSITIONS, DisplayPosition, ModelMerger, Models, isInstanceReference } from "minerender";
import { Box3 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { button, group, input, note, select, suggestions } from "../../playground/controls";
import { assetKey, loadModel, modelControls, modelDefaults, modelOptions, selectModel, type ModelSettings } from "../../playground/models";
import { COMPOSITE_ITEM, compositeSource, compositeSourceCode } from "./composite";

interface ItemSettings extends ModelSettings {
    /** An item ID (`minecraft:apple`) or a model path (`minecraft:item/apple`, `minecraft:block/stone`). */
    item: string;
    display: DisplayPosition | "";
}

const defaults: ItemSettings = { ...modelDefaults, item: "minecraft:iron_sword", display: "" };
AssetLoader.addSource("composite-demo", compositeSource());
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
        composite: { label: "Composite item: three tinted pieces", state: { item: COMPOSITE_ITEM, display: DisplayPosition.GUI } },
        legacy: { label: "Model path: item/iron_sword", state: { item: "minecraft:item/iron_sword" } }
    },
    load,
    code(state) {
        const key = modelKey(state.item);
        const keyCode = `new MineRender.AssetKey(${JSON.stringify(key.namespace)}, ${JSON.stringify(key.path)}, "models", ${JSON.stringify(key.type)})`;
        const load = isModelPath(state.item) ? `MineRender.ModelMerger.mergeWithParents(await MineRender.Models.getRaw(${keyCode}))` : `MineRender.Models.getMerged(${keyCode})`;
        return `${key.namespace === "minerender_demo" ? compositeSourceCode() : ""}const model = await ${load};
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
display.addEventListener("change", () => void app.update({ display: display.value as ItemSettings["display"] }));
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

async function load(ctx: DemoContext, state: ItemSettings): Promise<DemoContent> {
    if (state.display !== "" && !DISPLAY_POSITIONS.includes(state.display)) throw new Error("Choose a supported display pose.");
    const key = modelKey(state.item);
    const direct = isModelPath(state.item);
    const [loaded, list] = await Promise.all([direct ? Models.getRaw(key) : Models.getMerged(key), Models.getItemList().catch(() => [])]);
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
            syncModelControls();
            selectModel(app, object);
            Object.assign(window, { item: object });
        }
    };
}

Object.assign(window, { setItem: (item: string, display = app.state.display) => app.update({ item, display }) });
void app.start();
