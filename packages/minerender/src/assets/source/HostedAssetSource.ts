import { AssetSource } from ".";
import { BlockState, Model, TextureAsset } from "../../model";
import { AxiosRequestConfig, AxiosResponse } from "axios";
import { Maybe, prefix } from "../../util";
import { MinecraftTextureMeta } from "../../MinecraftTextureMeta";
import { NBTAsset, NBTHelper } from "../../nbt";
import { ImageLoader } from "../../image";
import { ListAsset } from "../../ListAsset";
import { MinecraftAsset } from "../../MinecraftAsset";
import { AssetKey } from "../AssetKey";
import { DEFAULT_NAMESPACE, DEFAULT_ROOT } from "../Assets";
import { Requests } from "../../request";
import { AssetLoader } from "../AssetLoader";
import { AssetParser } from "./parser";
import { ResponseParser } from "./parser";
import merge from "ts-deepmerge";

const p = prefix("HostedAssetSource");

const DEFAULT_OPTIONS: HostedAssetSourceOptions = {
    retryDefaults: true
}

export class HostedAssetSource extends AssetSource {

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
            // request.responseType = "arraybuffer";
        },
        parse(response: AxiosResponse): Maybe<MinecraftTextureMeta> {
            return response.data as MinecraftTextureMeta;
        }
    }
    static readonly NBT: ResponseParser<NBTAsset> = {
        config(request: AxiosRequestConfig) {
            request.responseType = "arraybuffer";
        },
        parse(response: AxiosResponse): Promise<Maybe<NBTAsset>> {
            return NBTHelper.fromBuffer(Buffer.from(response.data));
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
    static readonly JSON: ResponseParser<any> = {
        config(request: AxiosRequestConfig) {
        },
        parse(response: AxiosResponse): Maybe<any> {
            return response.data;
        }
    }

    static readonly PARSER_MAP: Map<AssetParser, ResponseParser<any>> = new Map<AssetParser, ResponseParser<any>>([
        [AssetParser.MODEL, HostedAssetSource.MODEL],
        [AssetParser.BLOCKSTATE, HostedAssetSource.BLOCKSTATE],
        [AssetParser.META, HostedAssetSource.META],
        [AssetParser.NBT, HostedAssetSource.NBT],
        [AssetParser.IMAGE, HostedAssetSource.IMAGE],
        [AssetParser.LIST, HostedAssetSource.LIST],
        [AssetParser.JSON, HostedAssetSource.JSON],
    ]);

    public async loadOrRetryWithDefaults<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        const direct = await this.load<T>(key, parser);
        if (typeof direct !== "undefined") {
            return direct;
        }
        if (key.namespace !== DEFAULT_NAMESPACE) {
            console.info(p, "Retrying", key, "with default namespace");
            // Try on the same host but with default minecraft: namespace
            const namespaceKey = new AssetKey(DEFAULT_NAMESPACE, key.path, key.assetType, key.type, key.rootType, key.extension, key.root);
            const namespaced = await this.load<T>(namespaceKey, parser);
            if (typeof namespaced !== "undefined") {
                return namespaced;
            }
            if ((typeof key.root !== "undefined" && key.root !== DEFAULT_ROOT) || (typeof this.root !== "undefined" && this.root !== DEFAULT_ROOT)) {
                console.info(p, "Retrying", key, "with default root+namespace");
                // Try both defaults
                const namespacedRootedKey = new AssetKey(DEFAULT_NAMESPACE, key.path, key.assetType, key.type, key.rootType, key.extension, DEFAULT_ROOT);
                const namespacedRooted = await this.load<T>(namespacedRootedKey, parser);
                if (typeof namespacedRooted !== "undefined") {
                    return namespacedRooted;
                }
            }
        } else if ((typeof key.root !== "undefined" && key.root !== DEFAULT_ROOT) || (typeof this.root !== "undefined" && this.root !== DEFAULT_ROOT)) {
            console.info(p, "Retrying", key, "with default root");
            // Try on default root
            const rootKey = new AssetKey(key.namespace, key.path, key.assetType, key.type, key.rootType, key.extension, DEFAULT_ROOT);
            const rooted = await this.load<T>(rootKey, parser);
            if (typeof rooted !== "undefined") {
                return rooted;
            }
        }
        return undefined;
    }


    protected async load<T extends MinecraftAsset>(key: AssetKey, parser: ResponseParser<T>): Promise<Maybe<T>> {
        console.info(p, "Loading", key);
        const url = `${ this.assetBasePath(key) }${ key.type !== undefined ? key.type + '/' : '' }${ key.path }${ key.extension }`;
        console.debug(p, url);
        let req: AxiosRequestConfig = {
            url: url
        };
        parser.config(req);
        // @ts-ignore
        return await Requests.mcAssetRequest(req)
            .then(response => {
                if (response && response.data) {
                    try {
                        return parser.parse(response);
                    } catch (e) {
                        console.warn("Parser failed to process response", response, e);
                        throw e;
                    }
                }
                return undefined;
            })
            .catch(err => {
                if (err.response) {
                    let response = err.response as AxiosResponse;
                    if (response.status === 404) {
                        console.debug(p, key, "not found");
                        return undefined;
                    }
                }
                console.debug(p, "Failed to load", key, err?.message);
                return undefined;
            })
    }

    public assetBasePath(key: AssetKey) {
        return `${ key.root ?? this.root ?? AssetLoader.ROOT }/${ key.rootType !== undefined ? key.rootType + '/' : '' }${ key.namespace !== undefined ? key.namespace + '/' : '' }${ key.assetType !== undefined ? key.assetType + '/' : '' }`;
    }

    private readonly _root: string;
    private readonly _options: HostedAssetSourceOptions;

    public constructor(root: string, options?: Partial<HostedAssetSourceOptions>) {
        super();
        this._root = root;
        this._options = merge({}, DEFAULT_OPTIONS, options ?? {});
    }

    public get root(): string {
        return this._root;
    }

    public get options(): HostedAssetSourceOptions {
        return this._options;
    }

    public get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser): Promise<Maybe<T>> {
        const responseParser = HostedAssetSource.PARSER_MAP.get(parser) as ResponseParser<T>;
        if (this.options.retryDefaults) {
            return this.loadOrRetryWithDefaults(key, responseParser);
        }
        return this.load(key, responseParser);
    }

}

interface HostedAssetSourceOptions {
    retryDefaults: boolean;
}