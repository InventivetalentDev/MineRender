import { ModelKey, serializeModelKey } from "./cache/CacheKey";
import { Model } from "./model/Model";
import { Caching } from "./cache/Caching";
import { Textures } from "./Textures";
import { Maybe } from "./util";
import { ModelLoader } from "./ModelLoader";
import { debug } from "./debug";
import { ModelMerger } from "./ModelMerger";

export const DEFAULT_ROOT = "https://assets.mcasset.cloud/1.16.5";
export const DEFAULT_NAMESPACE = "minecraft";

export class Models {

    public static parseModelKey(str: string, origin?: ModelKey): ModelKey {
        let namespace = origin?.namespace || DEFAULT_NAMESPACE;
        if (str.includes(":")) {
            let split = str.split("\:");
            namespace = split[0];
            str = split[1];
        }

        let type = "block";
        if (str.startsWith("block/")) {
            type = "block";
            str = str.substr("block/".length);
        } else if (str.startsWith("item/")) {
            type = "item";
            str = str.substr("item/".length);
        } else {
            debug("unknown model type prefix %s", str);
        }

        let path = str;

        return {
            root: origin?.root,
            namespace,
            type,
            path
        }
    }

    public static async loadAndMerge(key: ModelKey): Promise<Maybe<Model>> {
        const model = await this.getRaw(key);
        if (!model) {
            return undefined;
        }
        return ModelMerger.mergeWithParents(model);
    }

    public static async getRaw(key: ModelKey): Promise<Maybe<Model>> {
        const keyStr = serializeModelKey(key);
        return Caching.rawModelCache.get(keyStr, k => {
            return ModelLoader.load(key);
        });
    }

    public static async getMerged(key: ModelKey): Promise<Maybe<Model>> {
        const keyStr = serializeModelKey(key);
        return Caching.mergedModelCache.get(keyStr, k => {
            return Models.loadAndMerge(key);
        });
    }

}
