import { Model } from "./Model";
import { Models } from "../assets/Models";
import merge from "ts-deepmerge";
import { Assets } from "../assets/Assets";
import { AssetKey } from "../assets/AssetKey";

export class ModelMerger {

    public static async mergeWithParents(model: Model): Promise<Model> {
        const models = await this.collectAllParents(model);
        let merged: Model = {};
        for (let parentModel of models) {
            merged = merge(merged, parentModel);
        }
        merged = merge(merged, model);
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
        const parentModel = await Models.getRaw(parentKey);
        if (parentModel) {
            models.unshift(parentModel);
            models.unshift(...await this.collectAllParents(parentModel));
        }
        return models;
    }

}
