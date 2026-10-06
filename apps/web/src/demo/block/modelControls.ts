import { AssetKey, isInstanceReference, ModelObject, type Model, type ModelObjectOptions, type InstanceReference } from "minerender";
import { Vector3 } from "three";
import type { DemoContext, Playground } from "../../playground/Playground";

export interface ModelSettings {
    wireframe: boolean;
    mergeMeshes: boolean;
    instanceMeshes: boolean;
    tints: Record<number, number>;
}

export const modelDefaults: ModelSettings = {
    wireframe: false,
    mergeMeshes: true,
    instanceMeshes: false,
    tints: {}
};

export function group(parent: HTMLElement, title: string): HTMLElement {
    const fieldset = document.createElement("fieldset");
    const legend = document.createElement("legend");
    legend.textContent = title;
    fieldset.append(legend);
    parent.append(fieldset);
    return fieldset;
}

export function note(parent: HTMLElement, message: string): HTMLElement {
    const element = document.createElement("p");
    element.className = "control-note";
    element.textContent = message;
    parent.append(element);
    return element;
}

export function field<T extends HTMLElement>(parent: HTMLElement, title: string, control: T): T {
    const label = document.createElement("label");
    label.className = "control-field";
    const name = document.createElement("span");
    name.textContent = title;
    label.append(name, control);
    parent.append(label);
    return control;
}

export function textInput(parent: HTMLElement, title: string, value: string, change: (value: string) => void): HTMLInputElement {
    const control = field(parent, title, document.createElement("input"));
    control.type = "text";
    control.value = typeof value === "string" ? value : "";
    control.addEventListener("change", () => change(control.value.trim()));
    return control;
}

export function select(parent: HTMLElement, title: string, options: Record<string, string>, value: string,
                       change: (value: string) => void): HTMLSelectElement {
    const control = field(parent, title, document.createElement("select"));
    for (const [key, label] of Object.entries(options)) {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = label;
        control.append(option);
    }
    control.value = typeof value === "string" ? value : "";
    control.addEventListener("change", () => change(control.value));
    return control;
}

export function button(parent: HTMLElement, title: string, click: () => void): HTMLButtonElement {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = title;
    control.addEventListener("click", click);
    parent.append(control);
    return control;
}

export function modelControls<S extends ModelSettings>(app: Playground<S>): () => void {
    const parent = group(app.controls, "Model options");
    const controls = new Map<keyof ModelSettings, HTMLInputElement>();
    for (const [key, title] of [["wireframe", "Wireframe"], ["mergeMeshes", "Merge meshes"], ["instanceMeshes", "Instance meshes"]] as const) {
        const control = field(parent, title, document.createElement("input"));
        control.type = "checkbox";
        control.parentElement!.classList.add("control-checkbox");
        controls.set(key, control);
        control.addEventListener("change", () => {
            const patch: Partial<ModelSettings> = { [key]: control.checked };
            if (key === "mergeMeshes" && !control.checked) patch.instanceMeshes = false;
            if (key === "instanceMeshes" && control.checked) patch.mergeMeshes = true;
            void app.update(patch as Partial<S>);
        });
    }
    note(parent, "Instancing requires merged meshes. Use the inspector to edit transforms and visibility.");
    const palette = group(app.controls, "Tint colors");
    note(palette, "Override colors by face tint index. Remove an override to restore the model's default color.");
    const entries = document.createElement("div");
    palette.append(entries);
    const index = field(palette, "Tint index", document.createElement("input"));
    index.type = "number";
    index.min = "0";
    index.max = "255";
    index.step = "1";
    index.value = "0";
    const color = field(palette, "Color", document.createElement("input"));
    color.type = "color";
    color.value = "#6dbb45";
    button(palette, "Add or update tint", () => {
        const tintIndex = Number(index.value);
        if (!Number.isInteger(tintIndex) || tintIndex < 0 || tintIndex > 255) {
            app.report("Tint index must be an integer from 0 to 255.", true);
            return;
        }
        void app.update({ tints: { ...app.state.tints, [tintIndex]: parseInt(color.value.slice(1), 16) } } as Partial<S>);
    });
    return () => {
        for (const [key, control] of controls) control.checked = Boolean(app.state[key]);
        entries.replaceChildren();
        for (const [tintIndex, tintColor] of Object.entries(app.state.tints ?? {})) {
            if (typeof tintColor !== "number" || !Number.isInteger(tintColor) || tintColor < 0 || tintColor > 0xffffff) continue;
            const row = document.createElement("div");
            row.className = "row";
            const colorControl = field(row, `Index ${tintIndex}`, document.createElement("input"));
            colorControl.type = "color";
            colorControl.value = `#${Number(tintColor).toString(16).padStart(6, "0")}`;
            colorControl.addEventListener("change", () => {
                void app.update({ tints: { ...app.state.tints, [tintIndex]: parseInt(colorControl.value.slice(1), 16) } } as Partial<S>);
            });
            button(row, `Remove index ${tintIndex}`, () => {
                const tints = { ...app.state.tints };
                delete tints[Number(tintIndex)];
                void app.update({ tints } as Partial<S>);
            });
            entries.append(row);
        }
    };
}

export function modelOptions(state: ModelSettings): Partial<ModelObjectOptions> {
    if (![state.wireframe, state.mergeMeshes, state.instanceMeshes].every(value => typeof value === "boolean")) {
        throw new Error("Wireframe, merge meshes, and instance meshes must be true or false.");
    }
    if (!state.tints || typeof state.tints !== "object" || Array.isArray(state.tints)) throw new Error("Tint colors must be an object keyed by tint index.");
    const tints = Object.fromEntries(Object.entries(state.tints ?? {}).map(([index, color]) => {
        if (!/^\d+$/.test(index) || Number(index) > 255 || !Number.isInteger(color) || color < 0 || color > 0xffffff) {
            throw new Error("Tints must use integer indices from 0 to 255 and colors from 0x000000 to 0xffffff.");
        }
        return [index, color];
    }));
    return {
        wireframe: !!state.wireframe,
        mergeMeshes: !!state.mergeMeshes,
        instanceMeshes: !!state.instanceMeshes && !!state.mergeMeshes,
        tints
    };
}

export function assetKey(value: string, assetType: string, defaultType?: string): AssetKey {
    if (typeof value !== "string") throw new Error("The asset ID must be a string.");
    const match = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)$/.exec(value.trim().replace(/\.json$/, ""));
    if (!match || match[2].split("/").some(part => !part || part === "." || part === "..")) {
        throw new Error("Enter a Minecraft asset ID, such as minecraft:stone or my_pack:custom_model.");
    }
    return new AssetKey(match[1] || "minecraft", match[2], assetType, defaultType);
}

export async function loadModel(ctx: DemoContext, model: Model, options: Partial<ModelObjectOptions>): Promise<ModelObject | InstanceReference<ModelObject>> {
    const candidate = new ModelObject(model, options);
    let result: ModelObject | InstanceReference<ModelObject> | undefined;
    ctx.onCleanup(() => {
        result?.removeFromScene();
        candidate.removeFromScene();
        candidate.dispose();
    });
    result = await ctx.renderer.scene.addSceneObject(model, () => candidate, options);
    return result;
}

export function selectModel<S extends object>(app: Playground<S>, model: ModelObject | InstanceReference<ModelObject>): void {
    const object = isInstanceReference(model) ? model.instanceable : model;
    app.inspector?.selectObject(object, {
        object,
        distance: 0,
        point: new Vector3(),
        instanceId: isInstanceReference(model) ? model.index : undefined
    }, isInstanceReference(model) ? model : undefined);
}

export function suggestions(input: HTMLInputElement, values: string[]): void {
    const list = document.createElement("datalist");
    list.id = `${input.id || "asset"}-suggestions`;
    for (const value of values) {
        if (!value.endsWith(".json") || value === "_list.json") continue;
        const option = document.createElement("option");
        option.value = value.slice(0, -5);
        list.append(option);
    }
    document.getElementById(list.id)?.remove();
    input.setAttribute("list", list.id);
    input.after(list);
}
