import { Model } from "./Model";
import { Models } from "../assets/Models";
import merge from "ts-deepmerge";
import { Assets } from "../assets/Assets";
import { AssetKey } from "../assets/AssetKey";
import { DisplayTransforms } from "./DisplayTransforms";

export class ModelMerger {

    public static async mergeWithParents(model: Model): Promise<Model> {
        const models = await this.collectAllParents(model);
        let merged: Model = {};
        for (const source of [...models, model]) {
            const inheritedDisplay = merged.display;
            merged = merge.withOptions({ mergeArrays: false }, merged, source);
            if (source.display) {
                // Each supplied pose replaces the parent's whole entry, including omitted components.
                merged.display = { ...inheritedDisplay, ...DisplayTransforms.withHandFallbacks(source.display) };
            }
        }
        merged.hierarchy = models.map(m => m.parent).filter(p => `${p}`) as string[];
        merged.hierarchy.push(`${merged.parent}`);
        // delete merged.parent;
        return merged;
    }

    protected static async collectAllParents(model: Model): Promise<Model[]> {
        if (!model.parent) {
            return [];
        }
        const models: Model[] = [];
        const parentKey = AssetKey.parse("models", model.parent);
        parentKey.root = model.key?.root;
        const parentModel = await Models.getRaw(parentKey);
        if (parentModel) {
            models.unshift(parentModel);
            models.unshift(...await this.collectAllParents(parentModel));
        }
        return models;
    }

}
