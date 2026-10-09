import { BUILTIN_ENTITY, ItemModel, Model } from "./Model";
import merge from "ts-deepmerge";
import { AssetContext } from "../assets/AssetContext";
import { AssetKey } from "../assets/AssetKey";
import { DisplayTransforms } from "./DisplayTransforms";

/** Resolves Java model inheritance, with child elements and display poses overriding their parents. */
export class ModelMerger {

    constructor(private readonly assets: AssetContext) {
    }

    public static mergeWithParents(model: Model): Promise<Model> {
        return new ModelMerger(AssetContext.for(model)).mergeWithParents(model);
    }

    /** Loads the parent chain and returns a merged model without modifying the supplied definition. */
    public async mergeWithParents(model: Model): Promise<Model> {
        const parts = (model as ItemModel).parts;
        if (parts) return this.assets.bind({
            ...model,
            ...(model.key && { key: this.assets.bind(Object.assign(new AssetKey("", ""), model.key)) }),
            parts: await Promise.all(parts.map(part => this.mergeWithParents(part)))
        } as ItemModel);
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
        if ((model as ItemModel).components) (merged as ItemModel).components = (model as ItemModel).components;
        // delete merged.parent;
        if (model.key) merged.key = this.assets.bind(Object.assign(new AssetKey("", ""), model.key));
        return this.assets.bind(merged);
    }

    protected async collectAllParents(model: Model): Promise<Model[]> {
        if (!model.parent) {
            return [];
        }
        const models: Model[] = [];
        const parentKey = AssetKey.parse("models", model.parent);
        if (parentKey.namespace === "minecraft" && parentKey.getFullPath() === BUILTIN_ENTITY) return models;
        parentKey.root = model.key?.root;
        const parentModel = await this.assets.models.getRaw(parentKey);
        if (parentModel) {
            models.unshift(parentModel);
            models.unshift(...await this.collectAllParents(parentModel));
        }
        return models;
    }

}
