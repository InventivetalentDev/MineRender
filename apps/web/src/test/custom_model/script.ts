import { AssetKey, DISPLAY_POSITIONS, ModelMerger, Models, isInstanceReference, type DisplayPosition, type BlockModel, type ItemModel, type Model } from "minerender";
import { Box3 } from "three";
import { Playground, type DemoContext, type DemoContent } from "../../playground/Playground";
import { assetKey, button, field, group, loadModel, modelControls, modelDefaults, modelOptions, note, select, selectModel, textInput, type ModelSettings } from "../../demo/block/modelControls";

interface CustomSettings extends ModelSettings {
    json: string;
    namespace: string;
    display: DisplayPosition | "";
    filename: string;
    modelID: string;
}

const cube = JSON.stringify({ parent: "minecraft:block/cube_all", textures: { all: "minecraft:block/diamond_block" } }, null, 2);
const generated = JSON.stringify({ parent: "minecraft:item/generated", textures: { layer0: "minecraft:item/diamond_sword" } }, null, 2);
const tinted = JSON.stringify({
    textures: { all: "minecraft:block/white_wool" },
    elements: [{ from: [0, 0, 0], to: [16, 16, 16], faces: Object.fromEntries(["east", "west", "up", "down", "south", "north"].map(face => [face, { texture: "#all", tintindex: 0 }])) }]
}, null, 2);
const defaults: CustomSettings = { ...modelDefaults, json: cube, namespace: "minecraft", display: "", filename: "", modelID: "" };
const app = new Playground<CustomSettings>({
    title: "Custom model playground",
    defaults,
    renderer: { camera: { position: [40, 30, 40] } },
    presets: {
        cube: { label: "Inherited cube", state: defaults },
        generated: { label: "Generated item edges", state: { ...defaults, json: generated } },
        tinted: { label: "Tinted model elements", state: { ...defaults, json: tinted, tints: { 0: 0x5599ee } } }
    },
    load,
    code(state) {
        const definition = parseModel(state.json);
        return `const definition = ${JSON.stringify(definition, null, 2)};
definition.key = new MineRender.AssetKey(${JSON.stringify(state.namespace)}, "custom-model", "models", "block");
const model = await MineRender.ModelMerger.mergeWithParents(definition);
await renderer.scene.addModel(model, ${JSON.stringify({ ...modelOptions(state), displayPosition: state.display || undefined }, null, 2)});`;
    }
});

const modelPanel = group(app.controls, "Java model JSON");
note(modelPanel, "Paste a Java block or item model, or import its JSON file. Parent models and textures use the selected asset sources. Blockbench project files (.bbmodel) need a Java model export first.");
const namespace = textInput(modelPanel, "Namespace for relative textures", app.state.namespace, () => {});
const json = field(modelPanel, "Model JSON", document.createElement("textarea"));
json.rows = 18;
json.spellcheck = false;
json.value = typeof app.state.json === "string" ? app.state.json : "";
json.style.fontFamily = "monospace";
button(modelPanel, "Apply JSON", () => {
    void app.update({ json: json.value, namespace: namespace.value.trim(), filename: "", modelID: "" });
});
button(modelPanel, "Format JSON", () => {
    try {
        json.value = JSON.stringify(parseModel(json.value), null, 2);
    } catch (error) {
        app.report(error instanceof Error ? error.message : "Could not format model JSON.", true);
    }
});
const file = field(modelPanel, "Import model JSON", document.createElement("input"));
file.type = "file";
file.accept = ".json,application/json";
let importGeneration = 0;
file.addEventListener("change", async () => {
    const imported = file.files?.[0];
    if (!imported) return;
    const generation = ++importGeneration;
    const settings = app.state;
    try {
        if (imported.size > 1024 * 1024) throw new Error("Choose a model JSON file smaller than 1 MiB.");
        const source = await imported.text();
        parseModel(source);
        if (generation !== importGeneration || app.state !== settings) return;
        json.value = source;
        await app.update({ json: source, namespace: namespace.value.trim(), filename: imported.name, modelID: "" });
    } catch (error) {
        if (generation === importGeneration && app.state === settings) app.report(error instanceof Error ? error.message : "Could not import model JSON.", true);
    } finally {
        file.value = "";
    }
});
const fileInfo = note(modelPanel, "");
const display = select(modelPanel, "Display pose", Object.fromEntries([["", "None"], ...DISPLAY_POSITIONS.map(value => [value, value])]), app.state.display, value => {
    void app.update({ display: value as CustomSettings["display"] });
});

const importPanel = group(app.controls, "Start from an asset");
const modelID = textInput(importPanel, "Model ID", "minecraft:block/stone", () => {});
button(importPanel, "Load asset JSON into editor", () => {
    importGeneration++;
    void app.update({ modelID: modelID.value.trim() });
});
const syncModelControls = modelControls(app);
syncModelControls();
let revision = 0;

async function load(ctx: DemoContext, state: CustomSettings): Promise<DemoContent> {
    if (typeof state.modelID !== "string" || typeof state.filename !== "string") throw new Error("Model IDs and filenames must be strings.");
    if (state.modelID) {
        const id = assetKey(state.modelID, "models");
        const [type, ...path] = id.path.split("/");
        if (!path.length) throw new Error("Include the model path, such as minecraft:block/stone.");
        const imported = await Models.getRaw(new AssetKey(id.namespace, path.join("/"), "models", type));
        if (!imported) throw new Error(`Model not found: ${state.modelID}`);
        const { key, hierarchy, ...definition } = imported;
        state = { ...state, json: JSON.stringify(definition, null, 2), namespace: id.namespace, filename: "", modelID: "" };
    }
    if (typeof state.namespace !== "string" || !/^[a-z0-9_.-]+$/.test(state.namespace)) throw new Error("Namespaces use lowercase letters, numbers, periods, underscores, and hyphens.");
    if (state.display !== "" && !DISPLAY_POSITIONS.includes(state.display)) throw new Error("Choose a supported display pose.");
    const definition = parseModel(state.json);
    // Each edited definition needs its own atlas cache key. Asset sources remain caller-configured.
    definition.key = new AssetKey(state.namespace, `playground-${++revision}`, "models", "block");
    const model = await ModelMerger.mergeWithParents(definition);
    const object = await loadModel(ctx, model, { ...modelOptions(state), displayPosition: state.display || undefined });
    const visual = isInstanceReference(object) ? object.instanceable : object;
    const restore = () => {
        json.value = app.state.json;
        namespace.value = app.state.namespace;
        display.value = app.state.display;
        fileInfo.textContent = app.state.filename ? `Imported ${app.state.filename}. The JSON is included in copied configurations.` : "";
        syncModelControls();
        selectModel(app, object);
        Object.assign(window, { model: object });
    };
    return {
        object: visual,
        bounds: new Box3().setFromObject(visual),
        activate() {
            app.record({ json: state.json, namespace: state.namespace, filename: state.filename, modelID: "" });
            restore();
        },
        restore
    };
}

function parseModel(source: string): Model {
    if (typeof source !== "string") throw new Error("Model JSON must be text.");
    if (source.length > 1024 * 1024) throw new Error("Model JSON must be smaller than 1 MiB.");
    const parsed = JSON.parse(source, (key, value) => {
        if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error(`Unsupported JSON property: ${key}`);
        return value;
    });
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Model JSON must be an object.");
    if (parsed.meta?.model_format || parsed.outliner) throw new Error("Export a Java block or item model from Blockbench before importing it.");
    if (parsed.parent !== undefined && typeof parsed.parent !== "string") throw new Error("The parent must be a model ID string.");
    if (parsed.textures !== undefined && (!parsed.textures || typeof parsed.textures !== "object" || Array.isArray(parsed.textures)
        || Object.values(parsed.textures).some(value => typeof value !== "string"))) throw new Error("Textures must map names to texture ID strings.");
    if (parsed.ambientocclusion !== undefined && typeof parsed.ambientocclusion !== "boolean") throw new Error("Ambient occlusion must be true or false.");
    if (parsed.gui_light !== undefined && !["front", "side"].includes(parsed.gui_light)) throw new Error("GUI light must be front or side.");
    const vector = (value: unknown, path: string, length = 3) => {
        if (!Array.isArray(value) || value.length !== length || value.some(number => typeof number !== "number" || !Number.isFinite(number))) {
            throw new Error(`${path} must contain ${length} finite numbers.`);
        }
    };
    if (parsed.elements !== undefined) {
        if (!Array.isArray(parsed.elements) || parsed.elements.length > 2048) throw new Error("Elements must be an array with at most 2,048 entries.");
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
