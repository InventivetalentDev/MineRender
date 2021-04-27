import { Model, TextureAsset } from "../model/Model";
import { Maybe } from "../util/util";
import { Requests } from "../request/Requests";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { DEBUG_NAMESPACE } from "../util/debug";
import { MinecraftAsset } from "../MinecraftAsset";
import { ImageInfo, ImageLoader } from "../image/ImageLoader";
import debug from "debug";
import { MinecraftTextureMeta } from "../MinecraftTextureMeta";
import { BlockState } from "../model/block/BlockState";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "./Assets";
import { ListAsset } from "../ListAsset";
import { AssetKey } from "./AssetKey";

const d = debug(`${ DEBUG_NAMESPACE }:AssetLoader`);

export interface ResponseParser<T extends MinecraftAsset> {
    config(request: AxiosRequestConfig);

    parse(response: AxiosResponse): Maybe<T> | Promise<Maybe<T>>;
}

export class AssetLoader {

    static readonly MODEL: ResponseParser<Model> = {
        config(request: AxiosRequestConfig) {
        },
        parse(response: AxiosResponse): Maybe<Model> {
            return response.data as Model;
        }
    }
    static readonly BLOCKSTATE: ResponseParser<BlockState> = {
        config(request: AxiosRequestConfig) {
        },
        parse(response: AxiosResponse): Maybe<BlockState> {
            return response.data as BlockState;
        }
    }
    static readonly META: ResponseParser<MinecraftTextureMeta> = {
        config(request: AxiosRequestConfig) {
        },
        parse(response: AxiosResponse): Maybe<MinecraftTextureMeta> {
            return response.data as MinecraftTextureMeta;
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
    static readonly LIST: ResponseParser<ListAsset> = {
        config(request: AxiosRequestConfig) {
        },
        parse(response: AxiosResponse): Maybe<ListAsset> {
            return response.data as ListAsset;
        }
    }

    public static async loadOrRetryWithDefaults<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        const direct = await this.load<T>(key, parser);
        if (direct) {
            return direct;
        }
        if (key.namespace !== DEFAULT_NAMESPACE) {
            d("Retrying %j with default namespace", key);
            // Try on the same host but with default minecraft: namespace
            const namespaceKey = new AssetKey(DEFAULT_NAMESPACE, key.path, key.assetType, key.type, key.extension, key.root);
            const namespaced = await this.load<T>(namespaceKey, parser);
            if (namespaced) {
                return namespaced;
            }
            if (key.root !== undefined && key.root !== DEFAULT_ROOT) {
                d("Retrying %j with default root+namespace", key);
                // Try both defaults
                const namespacedRootedKey = new AssetKey(DEFAULT_NAMESPACE, key.path, key.assetType, key.type, key.extension, DEFAULT_ROOT);
                const namespacedRooted = await this.load<T>(namespacedRootedKey, parser);
                if (namespacedRooted) {
                    return namespacedRooted;
                }
            }
        } else if (key.root !== undefined && key.root !== DEFAULT_ROOT) {
            d("Retrying %j with default root", key);
            // Try on default root
            const rootKey = new AssetKey(key.namespace, key.path, key.assetType, key.type, key.extension, DEFAULT_ROOT);
            const rooted = await this.load<T>(rootKey, parser);
            if (rooted) {
                return rooted;
            }
        }
        return undefined;
    }


    protected static async load<T>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        d("Loading %j", key);
        let req: AxiosRequestConfig = {
            url: `${ this.assetBasePath(key) }${ key.type ? '/' + key.type : '' }/${ key.path }${ key.extension }`
        };
        parser.config(req);
        return await Requests.mcAssetRequest(req)
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
                        d("%j not found", key);
                        return undefined;
                    }
                }
                d("Failed to load %j: %s", key, err?.message);
                return undefined;
            })
    }

    public static assetBasePath(key: AssetKey) {
        return `${ key.root || DEFAULT_ROOT }/assets/${ key.namespace || DEFAULT_NAMESPACE }/${ key.assetType }`;
    }

}
