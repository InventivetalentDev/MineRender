import { ModelKey } from "./cache/CacheKey";
import { Model } from "./model/Model";
import { Maybe } from "./util";
import { Requests } from "./request/Requests";
import { AxiosResponse } from "axios";
import { debug } from "./debug";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Models";

export class ModelLoader {

    public static setMcAssetRoot(root: string) {
        Requests.setMcAssetRoot(root);
    }

    public static async loadAndRetryWithDefaults(key: ModelKey): Promise<Maybe<Model>> {
        const direct = await this.load(key);
        if (direct) {
            return direct;
        }
        if (key.namespace !== DEFAULT_NAMESPACE) {
            debug("Retrying %j with default namespace", key);
            // Try on the same host but with default minecraft: namespace
            const namespaceKey = {...key,...{ namespace: DEFAULT_NAMESPACE}};
            const namespaced = await this.load(namespaceKey);
            if (namespaced) {
                return namespaced;
            }
            if (key.root !== undefined && key.root !== DEFAULT_ROOT) {
                debug("Retrying %j with default root+namespace", key);
                // Try both defaults
                const namespacedRootedKey = {...key,...{ root: DEFAULT_ROOT, namespace: DEFAULT_NAMESPACE}}
                const namespacedRooted =await this.load(namespacedRootedKey);
                if (namespacedRooted) {
                    return namespacedRooted;
                }
            }
        }else if (key.root !== undefined && key.root !== DEFAULT_ROOT) {
            debug("Retrying %j with default root", key);
            // Try on default root
            const rootKey = {...key, ...{root:DEFAULT_ROOT}};
            const rooted = await this.load(rootKey);
            if (rooted) {
                return rooted;
            }
        }
        return undefined;
    }

    public static async load(key: ModelKey): Promise<Maybe<Model>> {
        debug("Loading model %j", key);
        return Requests.mcAssetRequest({
            url: `${ this.modelBasePath(key) }${ key.type }/${ key.path }.json`
        })
            .then(response => {
                const model = response.data as Model;
                model.key = key;
                model.name = key.path;
                return model;
            })
            .catch(err => {
                if (err.response) {
                    let response = err.response as AxiosResponse;
                    if (response.status === 404) {
                        debug("Model %j not found", key);
                        return undefined;
                    }
                }
                debug("Failed to load model %j", key);
                throw err;
            })
    }

    public static modelBasePath(key: ModelKey) {
        return `${ key.root || DEFAULT_ROOT }/assets/${ key.namespace || DEFAULT_NAMESPACE }/models/`;
    }

}
