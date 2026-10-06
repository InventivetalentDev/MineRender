import { GuiObject } from "minerender";
import { OrthographicCamera, PerspectiveCamera, Vector2 } from "three";
import { Playground } from "../../playground/Playground";
import { asGuiLayers, defaults, layersFor, validateLayers, type EditableLayer, type GuiState } from "./config";

const app = new Playground<GuiState>({
    title: "GUI playground",
    defaults,
    renderer: {
        camera: { type: "orthographic", position: [0, 0, 100] },
        render: { antialias: false },
        composer: { enabled: false }
    },
    presets: {
        chest: { label: "Chest", state: { ...defaults } },
        shaped: { label: "Shaped recipe", state: { ...defaults, mode: "shaped" } },
        shapeless: { label: "Shapeless recipe", state: { ...defaults, mode: "shapeless", ingredients: ["blue_dye", "red_dye", "", "", "", "", "", "", ""], result: "purple_dye" } }
    },
    code: state => `const gui = await renderer.scene.addGui(${JSON.stringify(layersFor(state), null, 2)});\n`,
    load: async (ctx, state) => {
        const layers = layersFor(state);
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
                ctx.renderer.controls?.target.set(center.x, -center.y, 0);
                ctx.renderer.controls?.update();
                ctx.renderer.dirty = true;
            }
        };
    }
});

app.controls.innerHTML = `
    <label>Layout<select id="gui-mode"><option value="chest">Chest</option><option value="shaped">Shaped recipe</option><option value="shapeless">Shapeless recipe</option><option value="custom">Custom layers</option></select></label>
    <label>GUI scale<select id="gui-scale"><option value="fit">Fit</option><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
    <p>GUI scale uses CSS pixels with the orthographic camera. Stack counts and text are not drawn.</p>
    <fieldset id="chest-editor"><legend>Inventory slot</legend>
        <label>Slot (0–53)<input id="slot-index" type="number" min="0" max="53" value="0"></label>
        <label>Item ID (empty clears slot)<input id="slot-item" placeholder="minecraft:apple"></label>
        <button id="slot-apply" type="button">Apply slot</button>
    </fieldset>
    <fieldset id="recipe-editor"><legend>Recipe ingredients</legend>
        <p>Enter concrete item IDs. Leave unused cells empty. Shapeless recipes ignore the cell positions.</p>
        <div id="recipe-cells" class="playground-grid"></div>
        <label>Result item<input id="recipe-result"></label>
        <button id="recipe-apply" type="button">Apply recipe</button>
    </fieldset>
    <details open><summary>Ordered layers</summary>
        <p>Later layers draw above earlier layers. Editing a layer switches to Custom layers.</p>
        <label>Selected layer<select id="layer-list" size="5"></select></label>
        <div class="playground-actions"><button id="layer-up" type="button">Move earlier</button><button id="layer-down" type="button">Move later</button><button id="layer-remove" type="button">Remove</button></div>
        <label>Layer type<select id="layer-kind"><option value="item">Item</option><option value="texture">Texture</option></select></label>
        <label>Name<input id="layer-name"></label>
        <label>Asset ID<input id="layer-asset" placeholder="minecraft:item/diamond"></label>
        <label>Position: x, y<input id="layer-position" placeholder="0, 0"></label>
        <label>Size: width, height (empty uses default)<input id="layer-size" placeholder="16, 16"></label>
        <label id="crop-label">Crop: x, y, width, height<input id="layer-crop" placeholder="0, 0, 176, 222"></label>
        <label id="tint-label">Tints JSON (RGB integers)<input id="layer-tints" placeholder='{"0": 9551193}'></label>
        <div class="playground-actions"><button id="layer-apply" type="button">Apply layer</button><button id="layer-add" type="button">Add layer</button></div>
    </details>
    <details><summary>Layer JSON</summary>
        <label>GUI layers<textarea id="layers-json" rows="12" spellcheck="false"></textarea></label>
        <div class="playground-actions"><button id="json-import" type="button">Apply JSON</button><button id="json-export" type="button">Download JSON</button></div>
        <label>Import JSON file<input id="json-file" type="file" accept=".json,application/json"></label>
    </details>`;

const input = (id: string) => document.getElementById(id) as HTMLInputElement;
const select = (id: string) => document.getElementById(id) as HTMLSelectElement;
const json = document.getElementById("layers-json") as HTMLTextAreaElement;
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
    input("slot-item").value = app.state.slots[Number(input("slot-index").value)] ?? "";
    recipeInputs.forEach((field, index) => field.value = app.state.ingredients[index] ?? "");
    input("recipe-result").value = app.state.result;
    select("layer-list").replaceChildren(...layers.map((layer, index) => new Option(`${index + 1}. ${layer.name || layer.item || layer.texture}`, String(index))));
    selectedLayer = Math.max(0, Math.min(selectedLayer, layers.length - 1));
    select("layer-list").value = String(selectedLayer);
    json.value = JSON.stringify(layers, null, 2);
    syncLayer();
}

function syncLayer() {
    const layer = displayedLayers[selectedLayer];
    if (!layer) return;
    select("layer-kind").value = layer.item ? "item" : "texture";
    input("layer-name").value = layer.name ?? "";
    input("layer-asset").value = layer.item ?? layer.texture ?? "";
    input("layer-position").value = (layer.position ?? [0, 0]).join(", ");
    input("layer-size").value = layer.size?.join(", ") ?? "";
    input("layer-crop").value = layer.crop?.join(", ") ?? "";
    input("layer-tints").value = layer.tints ? JSON.stringify(layer.tints) : "";
    syncKind();
}

function syncKind() {
    const isItem = select("layer-kind").value === "item";
    document.getElementById("crop-label")!.hidden = isItem;
    document.getElementById("tint-label")!.hidden = !isItem;
}

function readLayer(): EditableLayer {
    const layer: Record<string, unknown> = { name: input("layer-name").value };
    const kind = select("layer-kind").value;
    layer[kind] = input("layer-asset").value.trim();
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

select("gui-mode").addEventListener("change", () => guard(async () => {
    await app.update({ mode: select("gui-mode").value as GuiState["mode"], layers: displayedLayers });
    app.fit();
}));
select("gui-scale").addEventListener("change", () => guard(async () => {
    await app.update({ scale: select("gui-scale").value as GuiState["scale"] });
    app.fit();
}));
input("slot-index").addEventListener("input", () => input("slot-item").value = app.state.slots[Number(input("slot-index").value)] ?? "");
document.getElementById("slot-apply")!.addEventListener("click", () => guard(() => {
    const slot = Number(input("slot-index").value);
    if (!Number.isInteger(slot) || slot < 0 || slot > 53) throw new Error("Choose a slot from 0 to 53.");
    const slots = Array.from({ length: 54 }, (_, index) => app.state.slots[index] ?? "");
    slots[slot] = input("slot-item").value.trim();
    return app.update({ slots });
}));
document.getElementById("recipe-apply")!.addEventListener("click", () => guard(() => app.update({ ingredients: recipeInputs.map(field => field.value.trim()), result: input("recipe-result").value.trim() })));
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
    if (!file) return;
    if (file.size > 1024 * 1024) throw new Error("Choose a GUI JSON file smaller than 1 MiB.");
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
