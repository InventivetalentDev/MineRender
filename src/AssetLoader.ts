import { AssetKey } from "./cache/CacheKey";
import { Model, TextureAsset } from "./model/Model";
import { Maybe } from "./util/util";
import { Requests } from "./request/Requests";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { debug } from "./debug";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Models";
import { MinecraftAsset } from "./MinecraftAsset";
import imageSize from "image-size";
import { ImageInfo, ImageLoader } from "./image/ImageLoader";

export interface ResponseParser<T extends MinecraftAsset> {
    config(request: AxiosRequestConfig);

    parse(response: AxiosResponse): Maybe<T>|Promise<Maybe<T>>;
}

export class AssetLoader {

    static readonly MODEL: ResponseParser<Model> = {
        config(request: AxiosRequestConfig) {
        },
        parse(response: AxiosResponse): Maybe<Model> {
            return response.data as Model;
        }
    }
    static readonly IMAGE: ResponseParser<TextureAsset> = {
        config(request: AxiosRequestConfig) {
            request.responseType = "arraybuffer";
        },
        async parse(response: AxiosResponse): Promise<Maybe<TextureAsset>> {
            return await ImageLoader.processResponse(response) as TextureAsset;
        }
    }

    public static async loadOrRetryWithDefaults<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        const direct = await this.load<T>(key, parser);
        if (direct) {
            return direct;
        }
        if (key.namespace !== DEFAULT_NAMESPACE) {
            debug("Retrying %j with default namespace", key);
            // Try on the same host but with default minecraft: namespace
            const namespaceKey = { ...key, ...{ namespace: DEFAULT_NAMESPACE } };
            const namespaced = await this.load<T>(namespaceKey, parser);
            if (namespaced) {
                return namespaced;
            }
            if (key.root !== undefined && key.root !== DEFAULT_ROOT) {
                debug("Retrying %j with default root+namespace", key);
                // Try both defaults
                const namespacedRootedKey = { ...key, ...{ root: DEFAULT_ROOT, namespace: DEFAULT_NAMESPACE } }
                const namespacedRooted = await this.load<T>(namespacedRootedKey, parser);
                if (namespacedRooted) {
                    return namespacedRooted;
                }
            }
        } else if (key.root !== undefined && key.root !== DEFAULT_ROOT) {
            debug("Retrying %j with default root", key);
            // Try on default root
            const rootKey = { ...key, ...{ root: DEFAULT_ROOT } };
            const rooted = await this.load<T>(rootKey, parser);
            if (rooted) {
                return rooted;
            }
        }
        return undefined;
    }


    protected static async load<T>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        debug("Loading %j", key);
        let req: AxiosRequestConfig = {
            url: `${ this.assetBasePath(key) }${ key.type }/${ key.path }${ key.extension }`
        };
        parser.config(req);
        return Requests.mcAssetRequest(req)
            .then(response => {
                if (response && response.data) {
                    return parser.parse(response);
                }
                return undefined;
            })
            .catch(err => {
                if (err.response) {
                    let response = err.response as AxiosResponse;
                    if (response.status === 404) {
                        debug("%j not found", key);
                        return undefined;
                    }
                }
                debug("Failed to load %j: %s", key, err?.message);
                throw err;
            })
    }

    public static assetBasePath(key: AssetKey) {
        return `${ key.root || DEFAULT_ROOT }/assets/${ key.namespace || DEFAULT_NAMESPACE }/${ key.assetType }/`;
    }

}
