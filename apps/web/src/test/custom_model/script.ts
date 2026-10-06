import { AssetKey, DISPLAY_POSITIONS, ModelMerger, Models, isInstanceReference, type DisplayPosition, type BlockModel, type ItemModel, type Model } from "minerender";
import { Box3 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { button, field, group, input, note, select } from "../../playground/controls";
import { assetKey, loadModel, modelControls, modelDefaults, modelOptions, selectModel, type ModelSettings } from "../../playground/models";

interface CustomSettings extends ModelSettings {
    json: string;
    /** Namespace for relative texture and parent references. */
    namespace: string;
    display: DisplayPosition | "";
}

const cube = JSON.stringify({ parent: "minecraft:block/cube_all", textures: { all: "minecraft:block/diamond_block" } }, null, 2);
const generated = JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: "minecraft:item/diamond_sword" } }, null, 2);
const tinted = JSON.stringify({
    textures: { all: "minecraft:block/white_wool" },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(["east", "west", "up", "down", "south", "north"].map(face => [face, { texture: "#all", tintindex: 0 }])) }]
}, null, 2);
const defaults: CustomSettings = { ...modelDefaults, json: cube, namespace: "minecraft", display: "" };
let revision = 0;

const app = new Playground<CustomSettings>({
    title: "Custom model",
    defaults,
    renderer: { camera: { position: [40, 30, 40] } },
    presets: {
        cube: { label: "Cube with a parent model", state: {} },
        generated: { label: "Generated item", state: { json: generated } },
        tinted: { label: "Tinted elements", state: { json: tinted, tints: { 0: 0x5599ee } } }
    },
    load,
    code(state) {
        return `const definition = ${JSON.stringify(parseModel(state.json), null, 2)};
definition.key = new MineRender.AssetKey(${JSON.stringify(state.namespace)}, "custom", "models", "block");
const model = await MineRender.ModelMerger.mergeWithParents(definition);
await renderer.scene.addModel(model, ${JSON.stringify({ ...modelOptions(state), displayPosition: state.display || undefined }, null, 2)});\n`;
    }
});

const modelGroup = group(app.controls, "Java model JSON");
const json = field(modelGroup, "Model", document.createElement("textarea"));
json.rows = 18;
json.spellcheck = false;
const namespace = input(modelGroup, "Namespace for relative references", app.state.namespace);
button(modelGroup, "Apply", () => void app.update({ json: json.value, namespace: namespace.value.trim() }));
button(modelGroup, "Format", () => {
    try { json.value = JSON.stringify(parseModel(json.value), null, 2); }
    catch (error) { app.report(error instanceof Error ? error.message : String(error), true); }
});
const file = input(modelGroup, "Import JSON file", "", "file");
file.accept = ".json,application/json";
file.addEventListener("change", async () => {
    const imported = file.files?.[0];
    file.value = "";
    if (!imported) return;
    const source = await imported.text();
    json.value = source;
    void app.update({ json: source, namespace: namespace.value.trim() });
});
const assetGroup = group(app.controls, "Start from a vanilla model");
const modelId = input(assetGroup, "Model path", "minecraft:block/stone");
button(assetGroup, "Load into editor", async () => {
    try {
        const key = assetKey(modelId.value, "models");
        const [type, ...path] = key.path.split("/");
        if (!path.length) throw new Error("Include the model directory, such as minecraft:block/stone.");
        const imported = await Models.getRaw(new AssetKey(key.namespace, path.join("/"), "models", type));
        if (!imported) throw new Error(`Model not found: ${modelId.value}`);
        const { key: _key, hierarchy: _hierarchy, ...definition } = imported;
        json.value = JSON.stringify(definition, null, 2);
        await app.update({ json: json.value, namespace: key.namespace });
    } catch (error) { app.report(error instanceof Error ? error.message : String(error), true); }
});
const display = select(app.controls, "Display pose", [["", "None"], ...DISPLAY_POSITIONS], app.state.display);
display.addEventListener("change", () => void app.update({ display: display.value as CustomSettings["display"] }));
const syncModelControls = modelControls(app);
syncModelControls();

async function load(ctx: DemoContext, state: CustomSettings): Promise<DemoContent> {
    if (typeof state.namespace !== "string" || !/^[a-z0-9_.-]+$/.test(state.namespace)) throw new Error("Invalid namespace.");
    if (state.display !== "" && !DISPLAY_POSITIONS.includes(state.display)) throw new Error("Choose a supported display pose.");
    const definition = parseModel(state.json);
    // Each edited definition needs its own atlas cache key.
    definition.key = new AssetKey(state.namespace, `playground-${++revision}`, "models", "block");
    const model = await ModelMerger.mergeWithParents(definition);
    const object = await loadModel(ctx, model, { ...modelOptions(state), displayPosition: state.display || undefined });
    const visual = isInstanceReference(object) ? object.instanceable : object;
    return {
        object: visual,
        bounds: new Box3().setFromObject(visual),
        activate() {
            json.value = state.json;
            namespace.value = state.namespace;
            display.value = state.display;
            syncModelControls();
            selectModel(app, object);
            Object.assign(window, { model: object });
        }
    };
}

/** Parse and sanity-check a Java block or item model. */
function parseModel(source: string): Model {
    if (typeof source !== "string") throw new Error("Model JSON must be text.");
    if (source.length > 1024 * 1024) throw new Error("Model JSON must be smaller than 1 MiB.");
    const parsed = JSON.parse(source, (key, value) => {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`Unsupported JSON property: ${key}`);
        return value;
    });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Model JSON must be an object.");
    if (parsed.meta?.model_format || parsed.outliner) throw new Error("This is a Blockbench project. Export it as a Java block/item model first.");
    if (parsed.parent !== undefined && typeof parsed.parent !== "string") throw new Error("The parent must be a model ID string.");
    if (parsed.textures !== undefined && (!parsed.textures || typeof parsed.textures !== "object" || Array.isArray(parsed.textures)
        || Object.values(parsed.textures).some(value => typeof value !== "string"))) throw new Error("Textures must map names to texture IDs.");
    const vector = (value: unknown, path: string, length = 3) => {
        if (!Array.isArray(value) || value.length !== length || value.some(number => typeof number !== "number" || !Number.isFinite(number))) {
            throw new Error(`${path} must contain ${length} numbers.`);
        }
    };
    if (parsed.elements !== undefined) {
        if (!Array.isArray(parsed.elements) || parsed.elements.length > 2048) throw new Error("Elements must be an array of at most 2048 entries.");
        parsed.elements.forEach((element: any, index: number) => {
            if (!element || typeof element !== "object") throw new Error(`Element ${index} must be an object.`);
            vector(element.from, `Element ${index} from`);
            vector(element.to, `Element ${index} to`);
            if (!element.faces || typeof element.faces !== "object" || Array.isArray(element.faces)) throw new Error(`Element ${index} needs a faces object.`);
            for (const [name, face] of Object.entries(element.faces) as Array<[string, any]>) {
                if (!["east", "west", "up", "down", "south", "north"].includes(name) || !face || typeof face.texture !== "string") throw new Error(`Element ${index} has an invalid ${name} face.`);
                if (face.uv !== undefined) vector(face.uv, `Element ${index} ${name} UV`, 4);
            }
            if (element.rotation !== undefined) {
                if (!element.rotation || !["x", "y", "z"].includes(element.rotation.axis) || !Number.isFinite(element.rotation.angle)) throw new Error(`Element ${index} has an invalid rotation.`);
                vector(element.rotation.origin, `Element ${index} rotation origin`);
            }
        });
    }
    if (parsed.display !== undefined) {
        if (!parsed.display || typeof parsed.display !== "object" || Array.isArray(parsed.display)) throw new Error("Display poses must be an object.");
        for (const [name, pose] of Object.entries(parsed.display) as Array<[string, any]>) {
            if (!pose || typeof pose !== "object" || !DISPLAY_POSITIONS.includes(name as DisplayPosition)) throw new Error(`Invalid display pose: ${name}`);
            for (const transform of ["translation", "rotation", "scale"]) if (pose[transform] !== undefined) vector(pose[transform], `${name} ${transform}`);
        }
    }
    if (!parsed.parent && !parsed.elements?.length) throw new Error("Add a parent model or at least one element.");
    const model: BlockModel & ItemModel = {};
    for (const key of ["parent", "textures", "elements", "display", "ambientocclusion", "gui_light"] as const) {
        if (parsed[key] !== undefined) Object.assign(model, { [key]: parsed[key] });
    }
    return model;
}

void app.start();
