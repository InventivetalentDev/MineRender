import { AssetKey, DISPLAY_POSITIONS, DisplayPosition, ModelMerger, Models, isInstanceReference } from "minerender";
import { Box3 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { assetKey, button, group, loadModel, modelControls, modelDefaults, modelOptions, note, select, selectModel, suggestions, textInput, type ModelSettings } from "../block/modelControls";

interface ItemSettings extends ModelSettings {
    item: string;
    source: "item" | "model";
    display: DisplayPosition | "";
}

const defaults: ItemSettings = { ...modelDefaults, item: "minecraft:iron_sword", source: "item", display: "" };
const app = new Playground<ItemSettings>({
    title: "Item playground",
    defaults,
    renderer: { camera: { position: [20, 14, 30] } },
    presets: {
        sword: { label: "Flat item edges — sword", state: defaults },
        sapling: { label: "Cutout edges — sapling", state: { ...defaults, item: "minecraft:oak_sapling" } },
        apple: { label: "GUI pose — apple", state: { ...defaults, item: "minecraft:apple", display: DisplayPosition.GUI } },
        potion: { label: "Tinted potion", state: { ...defaults, item: "minecraft:potion", tints: { 0: 0xd557ef } } },
        block: { label: "Block model — diamond ore", state: { ...defaults, item: "minecraft:block/diamond_ore", source: "model", display: DisplayPosition.GUI } },
        legacy: { label: "Raw item model — iron sword", state: { ...defaults, item: "minecraft:item/iron_sword", source: "model" } }
    },
    load,
    code(state) {
        const key = itemKey(state);
        const keyCode = `new MineRender.AssetKey(${JSON.stringify(key.namespace)}, ${JSON.stringify(key.path)}, "models", ${JSON.stringify(key.type)})`;
        const load = state.source === "model" ? `MineRender.ModelMerger.mergeWithParents(await MineRender.Models.getRaw(${keyCode}))` : `MineRender.Models.getMerged(${keyCode})`;
        return `const model = await ${load};
await renderer.scene.addModel(model, ${JSON.stringify({ ...modelOptions(state), displayPosition: state.display || undefined }, null, 2)});`;
    }
});
const assets = group(app.controls, "Item or model");
const source = select(assets, "Source", { item: "Item definition with legacy fallback", model: "Model JSON directly" }, app.state.source, value => {
    void app.update({ source: value as ItemSettings["source"] });
});
const input = textInput(assets, "Asset ID (namespace:name)", app.state.item, item => void app.update({ item }));
input.id = "item-input";
button(assets, "Load asset", () => void app.update({ item: input.value.trim() }));
note(assets, "Direct models accept paths such as minecraft:item/iron_sword and minecraft:block/stone. Item definitions use GUI selection, false conditions, and zero numeric properties.");
const display = select(assets, "Display pose", Object.fromEntries([["", "None"], ...DISPLAY_POSITIONS.map(value => [value, value])]), app.state.display, value => {
    void app.update({ display: value as ItemSettings["display"] });
});
const syncModelControls = modelControls(app);
syncModelControls();

async function load(ctx: DemoContext, state: ItemSettings): Promise<DemoContent> {
    if (state.source !== "item" && state.source !== "model") throw new Error("Choose an item definition or direct model source.");
    if (state.display !== "" && !DISPLAY_POSITIONS.includes(state.display)) throw new Error("Choose a supported display pose.");
    const key = itemKey(state);
    const [loaded, list] = await Promise.all([
        state.source === "model" ? Models.getRaw(key) : Models.getMerged(key),
        Models.getItemList().catch(() => [])
    ]);
    const model = state.source === "model" && loaded ? await ModelMerger.mergeWithParents(loaded) : loaded;
    if (!model) throw new Error(`Model not found: ${state.item}`);
    const object = await loadModel(ctx, model, { ...modelOptions(state), displayPosition: state.display || undefined });
    const visual = isInstanceReference(object) ? object.instanceable : object;
    return {
        object: visual,
        bounds: new Box3().setFromObject(visual),
        activate() {
            source.value = state.source;
            input.value = state.item;
            display.value = state.display;
            syncModelControls();
            selectModel(app, object!);
            Object.assign(window, { item: object });
            suggestions(input, list);
        }
    };
}

function itemKey(state: ItemSettings): AssetKey {
    const key = assetKey(state.item, "models", "item");
    if (state.source !== "model" || !key.path.includes("/")) return key;
    const [type, ...path] = key.path.split("/");
    return new AssetKey(key.namespace, path.join("/"), "models", type);
}

Object.assign(window, { setItem: (item: string, display = app.state.display) => app.update({ item, display }) });
void app.start();
