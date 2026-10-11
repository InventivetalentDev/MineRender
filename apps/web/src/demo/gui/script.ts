import { GuiObject } from "minerender";
import { OrthographicCamera, PerspectiveCamera, Vector2 } from "three";
import { Playground } from "../../playground/Playground";
import { asGuiLayers, codeFor, defaults, layersFor, validateLayers, type EditableLayer, type GuiState } from "./config";

const app = new Playground<GuiState>({
    title: "GUI layers",
    defaults,
    renderer: {
        camera: { type: "orthographic", position: [0, 0, 100] },
        render: { antialias: false },
        composer: { enabled: false }
    },
    presets: {
        chest: { label: "Chest", state: {} },
        shaped: { label: "Shaped recipe", state: { mode: "shaped" } },
        shapeless: { label: "Shapeless recipe", state: { mode: "shapeless", ingredients: ["blue_dye", "red_dye", "", "", "", "", "", "", ""], result: "purple_dye" } },
        bossbar: { label: "Boss bar", state: { mode: "bossbar" } },
        book: { label: "Book", state: { mode: "book" } }
    },
    code: codeFor,
    load: async (ctx, state) => {
        const layers = await layersFor(state);
        const gui = new GuiObject(asGuiLayers(layers));
        gui.scene = ctx.renderer.scene;
        ctx.onCleanup(() => { gui.removeFromScene(); gui.dispose(); });
        await gui.init();
        ctx.renderer.scene.add(gui);
        return {
            object: gui,
            activate: () => syncControls(layers),
            fit: () => {
                const camera = ctx.renderer.camera;
                const size = gui.bounds.getSize(new Vector2());
                const center = gui.bounds.getCenter(new Vector2());
                const canvas = ctx.renderer.renderer.domElement;
                if (camera instanceof OrthographicCamera) {
                    camera.position.set(center.x, -center.y, 100);
                    camera.zoom = state.scale === "fit"
                        ? Math.min(canvas.clientWidth / (size.x + 32), canvas.clientHeight / (size.y + 32))
                        : Number(state.scale);
                } else if (camera instanceof PerspectiveCamera) {
                    const tangent = Math.tan(camera.fov * Math.PI / 360);
                    const distance = Math.max((size.y + 32) / (2 * tangent), (size.x + 32) / (2 * tangent * camera.aspect));
                    camera.position.set(center.x, -center.y, distance);
                    camera.zoom = 1;
                }
                camera.lookAt(center.x, -center.y, 0);
                if (camera instanceof OrthographicCamera || camera instanceof PerspectiveCamera) camera.updateProjectionMatrix();
                ctx.renderer.orbitControls?.target.set(center.x, -center.y, 0);
                ctx.renderer.orbitControls?.update();
                ctx.renderer.dirty = true;
            }
        };
    }
});

app.controls.innerHTML = `
    <label>Layout<select id="gui-mode"><option value="chest">Chest</option><option value="shaped">Shaped recipe</option><option value="shapeless">Shapeless recipe</option><option value="bossbar">Boss bar</option><option value="book">Book</option><option value="custom">Custom layers</option></select></label>
    <label>Scale<select id="gui-scale"><option value="fit">Fit</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
    <fieldset id="chest-editor"><legend>Chest slot</legend>
        <label>Slot (0–53)<input id="slot-index" type="number" min="0" max="53" value="0"></label>
        <label>Item ID (empty clears the slot)<input id="slot-item" placeholder="minecraft:apple"></label>
        <label>Tints JSON (empty uses the item's own)<input id="slot-tints" placeholder='{"0": 12607696}'></label>
        <button id="slot-apply" type="button">Apply</button>
    </fieldset>
    <fieldset id="recipe-editor"><legend>Recipe</legend>
        <div id="recipe-cells" class="playground-grid"></div>
        <label>Result<input id="recipe-result"></label>
        <button id="recipe-apply" type="button">Apply</button>
    </fieldset>
    <fieldset id="bossbar-editor"><legend>Boss bar</legend>
        <label>Color<select id="bossbar-color">${["pink", "blue", "red", "green", "yellow", "purple", "white"].map(color => `<option value="${color}">${color[0].toUpperCase()}${color.slice(1)}</option>`).join("")}</select></label>
        <label>Progress (0–100%)<input id="bossbar-progress" type="number" min="0" max="100" step="1"></label>
        <button id="bossbar-apply" type="button">Apply</button>
    </fieldset>
    <fieldset id="book-editor"><legend>Book</legend>
        <label>Previous button<select id="book-previous"><option value="hidden">Hidden</option><option value="normal">Normal</option><option value="hover">Hover</option></select></label>
        <label>Next button<select id="book-next"><option value="hidden">Hidden</option><option value="normal">Normal</option><option value="hover">Hover</option></select></label>
        <label>Page text<textarea id="book-text" rows="5"></textarea></label>
        <button id="book-apply" type="button">Apply</button>
    </fieldset>
    <details open><summary>Layers</summary>
        <p class="control-note">Later layers draw on top. Editing a layer switches the layout to Custom layers.</p>
        <select id="layer-list" size="6" aria-label="Layers"></select>
        <div class="playground-actions"><button id="layer-up" type="button">Move up</button><button id="layer-down" type="button">Move down</button><button id="layer-remove" type="button">Remove</button></div>
        <label>Type<select id="layer-kind"><option value="item">Item</option><option value="texture">Texture</option><option value="text">Text</option></select></label>
        <label>Name<input id="layer-name"></label>
        <label id="asset-label">Asset ID<input id="layer-asset" placeholder="minecraft:item/diamond"></label>
        <div id="text-editor">
            <label>Text format<select id="layer-text-format"><option value="plain">Plain text</option><option value="runs">Styled runs (JSON)</option></select></label>
            <label>Text<textarea id="layer-text" rows="4"></textarea></label>
            <label>Text style JSON<input id="layer-text-style" placeholder='{"color": 0, "shadow": false}'></label>
        </div>
        <label>Position (x, y)<input id="layer-position" placeholder="0, 0"></label>
        <label>Size (width, height)<input id="layer-size" placeholder="16, 16"></label>
        <label id="crop-label">Crop (x, y, width, height)<input id="layer-crop" placeholder="0, 0, 176, 222"></label>
        <label id="tint-label">Tints JSON<input id="layer-tints" placeholder='{"0": 9551193}'></label>
        <div class="playground-actions"><button id="layer-apply" type="button">Apply to layer</button><button id="layer-add" type="button">Add as new layer</button></div>
    </details>
    <details><summary>Layer JSON</summary>
        <textarea id="layers-json" rows="12" spellcheck="false" aria-label="Layer JSON"></textarea>
        <div class="playground-actions"><button id="json-import" type="button">Apply JSON</button><button id="json-export" type="button">Download JSON</button></div>
        <label>Import JSON file<input id="json-file" type="file" accept=".json,application/json"></label>
    </details>`;

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
const textarea = (id: string) => document.getElementById(id) as HTMLTextAreaElement;
const json = document.getElementById("layers-json") as HTMLTextAreaElement;
const textStyleKeys = ["font", "color", "bold", "italic", "shadow", "maxWidth", "lineHeight"] as const;
let displayedLayers: EditableLayer[] = [];
let selectedLayer = 0;
const recipeInputs: HTMLInputElement[] = [];
for (let i = 0; i < 9; i++) {
    const label = document.createElement("label");
    label.textContent = `Cell ${Math.floor(i / 3) + 1}, ${i % 3 + 1}`;
    const field = document.createElement("input");
    field.placeholder = "Item ID";
    label.append(field);
    document.getElementById("recipe-cells")!.append(label);
    recipeInputs.push(field);
}

function guard(task: () => void | Promise<void>) {
    void Promise.resolve().then(task).catch(error => app.report(error instanceof Error ? error.message : String(error), true));
}

function syncControls(layers: EditableLayer[]) {
    displayedLayers = layers;
    select("gui-mode").value = app.state.mode;
    select("gui-scale").value = app.state.scale;
    document.getElementById("chest-editor")!.hidden = app.state.mode !== "chest";
    document.getElementById("recipe-editor")!.hidden = !["shaped", "shapeless"].includes(app.state.mode);
    document.getElementById("bossbar-editor")!.hidden = app.state.mode !== "bossbar";
    document.getElementById("book-editor")!.hidden = app.state.mode !== "book";
    syncSlot();
    recipeInputs.forEach((field, index) => field.value = app.state.ingredients[index] ?? "");
    input("recipe-result").value = app.state.result;
    select("bossbar-color").value = app.state.bossBarColor;
    input("bossbar-progress").value = String(app.state.bossBarProgress * 100);
    select("book-previous").value = app.state.bookPrevious;
    select("book-next").value = app.state.bookNext;
    textarea("book-text").value = app.state.bookText;
    select("layer-list").replaceChildren(...layers.map((layer, index) => new Option(`${index + 1}. ${layer.name || layer.item || layer.texture || "Text"}`, String(index))));
    selectedLayer = Math.max(0, Math.min(selectedLayer, layers.length - 1));
    select("layer-list").value = String(selectedLayer);
    json.value = JSON.stringify(layers, null, 2);
    syncLayer();
}

function syncSlot() {
    const slot = Number(input("slot-index").value);
    input("slot-item").value = app.state.slots[slot] ?? "";
    input("slot-tints").value = app.state.slotTints[slot] ? JSON.stringify(app.state.slotTints[slot]) : "";
}

function syncLayer() {
    const layer = displayedLayers[selectedLayer];
    if (!layer) return;
    select("layer-kind").value = layer.item ? "item" : layer.texture ? "texture" : "text";
    input("layer-name").value = layer.name ?? "";
    input("layer-asset").value = layer.item ?? layer.texture ?? "";
    input("layer-position").value = (layer.position ?? [0, 0]).join(", ");
    input("layer-size").value = layer.size?.join(", ") ?? "";
    input("layer-crop").value = layer.crop?.join(", ") ?? "";
    input("layer-tints").value = layer.tints ? JSON.stringify(layer.tints) : "";
    select("layer-text-format").value = Array.isArray(layer.text) ? "runs" : "plain";
    textarea("layer-text").value = typeof layer.text === "string" ? layer.text : layer.text ? JSON.stringify(layer.text, null, 2) : "";
    input("layer-text-style").value = JSON.stringify(Object.fromEntries(textStyleKeys.filter(key => layer[key] !== undefined).map(key => [key, layer[key]])));
    syncKind();
}

function syncKind() {
    const kind = select("layer-kind").value;
    document.getElementById("asset-label")!.hidden = kind === "text";
    document.getElementById("text-editor")!.hidden = kind !== "text";
    document.getElementById("crop-label")!.hidden = kind !== "texture";
    document.getElementById("tint-label")!.hidden = kind !== "item";
}

function readLayer(): EditableLayer {
    const layer: Record<string, unknown> = { name: input("layer-name").value };
    const kind = select("layer-kind").value;
    if (kind === "text") {
        layer.text = select("layer-text-format").value === "runs" ? JSON.parse(textarea("layer-text").value) : textarea("layer-text").value;
        const style = JSON.parse(input("layer-text-style").value.trim() || "{}");
        if (!style || typeof style !== "object" || Array.isArray(style)) throw new Error("Text style must be a JSON object.");
        Object.assign(layer, Object.fromEntries(textStyleKeys.filter(key => style[key] !== undefined).map(key => [key, style[key]])));
    } else {
        layer[kind] = input("layer-asset").value.trim();
    }
    for (const key of ["position", "size", ...(kind === "texture" ? ["crop"] : [])]) {
        const value = input(`layer-${key}`).value.trim();
        if (value) layer[key] = value.split(",").map(Number);
    }
    if (kind === "item" && input("layer-tints").value.trim()) layer.tints = JSON.parse(input("layer-tints").value);
    return validateLayers([layer])[0];
}

function editLayers(layers: EditableLayer[]) {
    return app.update({ mode: "custom", layers: validateLayers(layers) });
}

async function updateAndFit(patch: Partial<GuiState>) {
    const previousRenderer = app.renderer;
    await app.update(patch);
    if (app.renderer !== previousRenderer) app.fit();
}

select("gui-mode").addEventListener("change", () => guard(() => updateAndFit({ mode: select("gui-mode").value as GuiState["mode"], layers: displayedLayers })));
select("gui-scale").addEventListener("change", () => guard(() => updateAndFit({ scale: select("gui-scale").value as GuiState["scale"] })));
input("slot-index").addEventListener("input", syncSlot);
document.getElementById("slot-apply")!.addEventListener("click", () => guard(() => {
    const slot = Number(input("slot-index").value);
    if (!Number.isInteger(slot) || slot < 0 || slot > 53) throw new Error("Choose a slot from 0 to 53.");
    const slots = Array.from({ length: 54 }, (_, index) => app.state.slots[index] ?? "");
    slots[slot] = input("slot-item").value.trim();
    const slotTints = { ...app.state.slotTints };
    if (input("slot-tints").value.trim()) slotTints[slot] = JSON.parse(input("slot-tints").value);
    else delete slotTints[slot];
    return app.update({ slots, slotTints });
}));
document.getElementById("recipe-apply")!.addEventListener("click", () => guard(() => app.update({ ingredients: recipeInputs.map(field => field.value.trim()), result: input("recipe-result").value.trim() })));
document.getElementById("bossbar-apply")!.addEventListener("click", () => guard(() => app.update({
    bossBarColor: select("bossbar-color").value as GuiState["bossBarColor"], bossBarProgress: Number(input("bossbar-progress").value) / 100
})));
document.getElementById("book-apply")!.addEventListener("click", () => guard(() => app.update({
    bookPrevious: select("book-previous").value as GuiState["bookPrevious"], bookNext: select("book-next").value as GuiState["bookNext"], bookText: textarea("book-text").value
})));
select("layer-list").addEventListener("change", () => { selectedLayer = Number(select("layer-list").value); syncLayer(); });
select("layer-kind").addEventListener("change", syncKind);
document.getElementById("layer-apply")!.addEventListener("click", () => guard(() => {
    const layers = [...displayedLayers];
    layers[selectedLayer] = readLayer();
    return editLayers(layers);
}));
document.getElementById("layer-add")!.addEventListener("click", () => guard(() => {
    selectedLayer = displayedLayers.length;
    return editLayers([...displayedLayers, readLayer()]);
}));
document.getElementById("layer-remove")!.addEventListener("click", () => guard(() => editLayers(displayedLayers.filter((_, index) => index !== selectedLayer))));
for (const [id, offset] of [["layer-up", -1], ["layer-down", 1]] as const) {
    document.getElementById(id)!.addEventListener("click", () => guard(() => {
        const next = selectedLayer + offset;
        if (next < 0 || next >= displayedLayers.length) return;
        const layers = [...displayedLayers];
        [layers[selectedLayer], layers[next]] = [layers[next], layers[selectedLayer]];
        selectedLayer = next;
        return editLayers(layers);
    }));
}
document.getElementById("json-import")!.addEventListener("click", () => guard(() => editLayers(validateLayers(JSON.parse(json.value)))));
input("json-file").addEventListener("change", () => guard(async () => {
    const file = input("json-file").files?.[0];
    input("json-file").value = "";
    if (!file) return;
    await editLayers(validateLayers(JSON.parse(await file.text())));
}));
document.getElementById("json-export")!.addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(displayedLayers, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "gui-layers.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
});
void app.start();
