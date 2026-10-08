import { AssetKey, isInstanceReference, ModelObject, type Model, type ModelObjectOptions, type InstanceReference } from "minerender";
import { Vector3 } from "three";
import type { DemoContext, Playground } from "./Playground";
import { button, checkbox, field, group, input } from "./controls";

/** Settings shared by the block, item, and custom-model playgrounds. */
export interface ModelSettings {
    wireframe: boolean;
    mergeMeshes: boolean;
    instanceMeshes: boolean;
    tints: Record<number, number>;
}

export const modelDefaults: ModelSettings = { wireframe: false, mergeMeshes: true, instanceMeshes: false, tints: {} };

/** Adds the model option and tint controls; the returned function syncs them with `app.state`. */
export function modelControls<S extends ModelSettings>(app: Playground<S>): () => void {
    const parent = group(app.controls, "Model options");
    const toggles = ([["wireframe", "Wireframe"], ["mergeMeshes", "Merge meshes"], ["instanceMeshes", "Instance meshes (requires merged meshes)"]] as const).map(([key, title]) => {
        const control = checkbox(parent, title, false);
        control.addEventListener("change", () => {
            const patch: Partial<ModelSettings> = { [key]: control.checked };
            if (key === "mergeMeshes" && !control.checked) patch.instanceMeshes = false;
            if (key === "instanceMeshes" && control.checked) patch.mergeMeshes = true;
            void app.update(patch as Partial<S>);
        });
        return { key, control };
    });

    const palette = group(app.controls, "Tint colors");
    const entries = document.createElement("div");
    palette.append(entries);
    const index = input(palette, "Tint index", 0, "number");
    Object.assign(index, { min: "0", max: "255", step: "1" });
    const color = input(palette, "Color", "#6dbb45", "color");
    button(palette, "Set tint", () => {
        const tintIndex = index.valueAsNumber;
        if (!Number.isInteger(tintIndex) || tintIndex < 0 || tintIndex > 255) return app.report("Tint index must be an integer from 0 to 255.", true);
        void app.update({ tints: { ...app.state.tints, [tintIndex]: parseInt(color.value.slice(1), 16) } } as Partial<S>);
    });

    return () => {
        for (const { key, control } of toggles) control.checked = Boolean(app.state[key]);
        entries.replaceChildren();
        for (const [tintIndex, tintColor] of Object.entries(app.state.tints ?? {})) {
            const row = document.createElement("div");
            row.className = "row";
            const picker = field(row, `Index ${tintIndex}`, document.createElement("input"));
            picker.type = "color";
            picker.value = `#${Number(tintColor).toString(16).padStart(6, "0")}`;
            picker.addEventListener("change", () => {
                void app.update({ tints: { ...app.state.tints, [tintIndex]: parseInt(picker.value.slice(1), 16) } } as Partial<S>);
            });
            button(row, "Remove", () => {
                const tints = { ...app.state.tints };
                delete tints[Number(tintIndex)];
                void app.update({ tints } as Partial<S>);
            });
            entries.append(row);
        }
    };
}

export function modelOptions(state: ModelSettings): Partial<ModelObjectOptions> {
    if (![state.wireframe, state.mergeMeshes, state.instanceMeshes].every(value => typeof value === "boolean")) throw new Error("Model options must be true or false.");
    if (!state.tints || typeof state.tints !== "object" || Array.isArray(state.tints)) throw new Error("Tints must be an object keyed by tint index.");
    for (const [index, color] of Object.entries(state.tints)) {
        if (!/^\d+$/.test(index) || Number(index) > 255 || !Number.isInteger(color) || color < 0 || color > 0xffffff) throw new Error("Tints use indices 0–255 and RGB integers.");
    }
    return {
        wireframe: state.wireframe,
        mergeMeshes: state.mergeMeshes,
        instanceMeshes: state.instanceMeshes && state.mergeMeshes,
        tints: state.tints
    };
}

/** Parse `namespace:path` (namespace optional) into an asset key. */
export function assetKey(value: string, assetType: string, defaultType?: string): AssetKey {
    const match = /^(?:([a-z0-9_.-]+):)?([a-z0-9_./-]+)$/.exec(String(value).trim().replace(/\.json$/, ""));
    if (!match || match[2].split("/").some(part => !part || part === "." || part === "..")) throw new Error("Enter an asset ID such as minecraft:stone.");
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
        object, distance: 0, point: new Vector3(), instanceId: isInstanceReference(model) ? model.index : undefined
    }, isInstanceReference(model) ? model : undefined);
}
